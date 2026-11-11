/**
 * Offline-first sync (ARCHITECTURE.md section 6): push the outbox, then pull every collection.
 *
 * - Push: due outbox entries -> full documents -> remote. Success clears the entry only if no newer local edit was
 *   queued meanwhile (in-flight edits are pushed again). Network-type errors back off exponentially (2 s doubling,
 *   cap 15 min); permission/validation errors move the entry to `failed`, so do rows that fail local validation
 *   (`invalid-local`) and entries still refused with a non-network error after MAX_RETRY_ATTEMPTS tries. Network
 *   errors (offline, timeout) retry forever. A wall clock moved backwards cannot park an entry beyond the cap.
 * - Pull: per collection, `updatedAt > cursor - 60 s`, paged; each document is Zod-validated. Last write wins by
 *   server timestamp: a clean local row is replaced by a newer remote one, a dirty local row is kept (it is pushed
 *   next and becomes the last write). Tombstones are sticky: a remote tombstone always wins, even over local edits.
 * - Until the first pull finished on this device the profile is held back, so a profile created locally with
 *   device defaults right after sign-in never overwrites the account's real one (the cloud profile replaces a
 *   never-synced local profile on pull); a held profile is pushed right after that first pull.
 * - One run at a time (mutex). Guests never sync.
 */
import { localDateOf } from '../domain/localDate';
import { getSyncValue, setSyncValue } from '../data/account';
import { mergeDuplicateCategories } from '../data/mergeCategories';
import { notifyDataChanged } from '../data/changes';
import type { SqlDriver } from '../data/db/driver';
import {
  entities,
  entityToColumns,
  ENTITY_TYPES,
  rowToEntity,
  type EntityDef,
  type EntityType,
  type SqlRow,
  parseEntity,
} from '../data/entities';
import { resetGenerated } from '../data/occurrences';
import { fromRemote, toRemote } from './mappers';
import { errorCode, FATAL_CODES, NETWORK_CODES, type PushWrite, type RemoteStore } from './types';

export const PUSH_BATCH = 200;
export const PULL_PAGE = 500;
export const CURSOR_OVERLAP_MS = 60_000;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 15 * 60_000;
/** Tries before a non-network error (e.g. `internal`, `resource-exhausted`, `unknown`) marks an entry failed. */
export const MAX_RETRY_ATTEMPTS = 10;
/** `last_error` of an entry whose local row no longer passes the entity schema (never sent). */
export const INVALID_LOCAL = 'invalid-local';
/** sync_state key set once the first full pull finished on this device (wiped with the rest on sign-out). */
export const PULLED_ONCE_KEY = 'pulled_once';

export interface SyncDeps {
  db: SqlDriver;
  remote: RemoteStore;
  uid: string;
  now?: () => number;
}

export interface SyncReport {
  pushed: number;
  retrying: number;
  failed: number;
  pulled: number;
  applied: number;
  invalid: number;
}

interface OutboxRow {
  entity_type: EntityType;
  entity_id: string;
  enqueued_rev: number;
  attempts: number;
}

export const backoffMs = (attempts: number) =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);

const tableOf = (type: EntityType) => (entities[type] as EntityDef).table;

/** Pushes due entries. Returns true when a profile was held back because nothing was pulled yet. */
export async function pushOutbox(deps: SyncDeps, report: SyncReport): Promise<boolean> {
  const { db, remote, uid } = deps;
  const now = deps.now?.() ?? Date.now();
  const pulledOnce = (await getSyncValue(db, PULLED_ONCE_KEY)) !== null;
  let held = false;
  // Each entry is visited at most once per run: an entry re-queued by an in-flight edit keeps its outbox id, so it
  // waits for the next run instead of looping.
  let lastId = 0;
  for (;;) {
    const due = await db.all<OutboxRow & { id: number }>(
      // An entry due later than now + cap was scheduled by a clock that has since moved backwards: it is due now.
      `SELECT id, entity_type, entity_id, enqueued_rev, attempts FROM outbox
       WHERE state = 'pending' AND (next_attempt_at <= ? OR next_attempt_at > ?) AND id > ? ORDER BY id LIMIT ?`,
      [now, now + BACKOFF_CAP_MS, lastId, PUSH_BATCH],
    );
    if (due.length === 0) return held;
    lastId = due[due.length - 1]?.id ?? lastId;

    const writes: (PushWrite & { rev: number; entry: OutboxRow })[] = [];
    for (const entry of due) {
      if (!(ENTITY_TYPES as readonly string[]).includes(entry.entity_type)) {
        await db.run('DELETE FROM outbox WHERE entity_type = ? AND entity_id = ?', [
          entry.entity_type,
          entry.entity_id,
        ]);
        continue;
      }
      const row = await db.first<SqlRow>(`SELECT * FROM ${tableOf(entry.entity_type)} WHERE id = ? AND owner_id = ?`, [
        entry.entity_id,
        uid,
      ]);
      if (entry.entity_type === 'profile' && !pulledOnce && row?.server_updated_at === null) {
        held = true;
        continue;
      }
      if (!row) {
        await db.run('DELETE FROM outbox WHERE entity_type = ? AND entity_id = ?', [
          entry.entity_type,
          entry.entity_id,
        ]);
        continue;
      }
      let data: Record<string, unknown>;
      try {
        // Same schema as every local write: a row corrupted on disk (or by an older build) is never sent and does
        // not block the rest of the queue.
        const entity = parseEntity(entry.entity_type, rowToEntity(entry.entity_type, row)) as Record<string, unknown>;
        data = toRemote(entry.entity_type, entity);
      } catch {
        report.failed += 1;
        await db.run(
          `UPDATE outbox SET state = 'failed', attempts = attempts + 1, last_error = ?
           WHERE entity_type = ? AND entity_id = ? AND enqueued_rev = ?`,
          [INVALID_LOCAL, entry.entity_type, entry.entity_id, entry.enqueued_rev],
        );
        continue;
      }
      writes.push({ type: entry.entity_type, id: entry.entity_id, data, rev: Number(row.local_rev ?? 0), entry });
    }
    if (writes.length === 0) continue;

    let outcomes;
    try {
      outcomes = await remote.push(
        uid,
        writes.map(({ type, id, data }) => ({ type, id, data })),
      );
    } catch (error) {
      const code = errorCode(error);
      outcomes = writes.map(() => ({ ok: false as const, code }));
    }

    let progressed = false;
    await db.transaction(async () => {
      for (const [i, w] of writes.entries()) {
        const outcome = outcomes[i] ?? { ok: false, code: 'unknown' };
        if (outcome.ok) {
          progressed = true;
          report.pushed += 1;
          await db.run('DELETE FROM outbox WHERE entity_type = ? AND entity_id = ? AND enqueued_rev <= ?', [
            w.type,
            w.id,
            w.rev,
          ]);
          await db.run(`UPDATE ${tableOf(w.type)} SET dirty = 0 WHERE id = ? AND local_rev = ?`, [w.id, w.rev]);
        } else if (
          FATAL_CODES.has(outcome.code) ||
          (!NETWORK_CODES.has(outcome.code) && w.entry.attempts + 1 >= MAX_RETRY_ATTEMPTS)
        ) {
          report.failed += 1;
          await db.run(
            `UPDATE outbox SET state = 'failed', attempts = attempts + 1, last_error = ?
             WHERE entity_type = ? AND entity_id = ? AND enqueued_rev = ?`,
            [outcome.code, w.type, w.id, w.entry.enqueued_rev],
          );
        } else {
          report.retrying += 1;
          const attempts = w.entry.attempts + 1;
          await db.run(
            `UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ?
             WHERE entity_type = ? AND entity_id = ? AND enqueued_rev = ?`,
            [attempts, now + backoffMs(attempts), outcome.code, w.type, w.id, w.entry.enqueued_rev],
          );
        }
      }
    });
    // Stop when nothing went through (offline): the rest waits for its backoff.
    if (!progressed) return held;
  }
}

async function applyRemote(deps: SyncDeps, type: EntityType, entity: Record<string, unknown>): Promise<boolean> {
  const { db, uid } = deps;
  const table = tableOf(type);
  const id = entity.id as string;
  const local = await db.first<{
    owner_id: string;
    dirty: number;
    deleted: number;
    server_updated_at: number | null;
    local_rev: number;
  }>(`SELECT owner_id, dirty, deleted, server_updated_at, local_rev FROM ${table} WHERE id = ?`, [id]);
  if (local && local.owner_id !== uid) return false;
  const remoteMs = entity.serverUpdatedAt as number;
  const remoteDeleted = entity.deleted === true;

  const stickyTombstone = remoteDeleted && local && local.deleted === 0;
  // A profile made on this device before the account's own profile was ever seen (device defaults) loses to it.
  const unseenProfile = type === 'profile' && local?.server_updated_at === null;
  if (!stickyTombstone && !unseenProfile) {
    if (local?.dirty === 1) return false; // local edit wins: it is pushed next
    if (local && local.server_updated_at !== null && remoteMs <= local.server_updated_at) return false;
  }

  const cols = entityToColumns(type, entity);
  const names = Object.keys(cols);
  const updatable = names.filter((c) => c !== 'id');
  await db.run(
    `INSERT INTO ${table} (${names.join(', ')}, local_rev, dirty) VALUES (${names.map(() => '?').join(', ')}, 0, 0)
     ON CONFLICT(id) DO UPDATE SET ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')}, dirty = 0`,
    names.map((c) => cols[c] ?? null),
  );
  if (stickyTombstone || unseenProfile) {
    await db.run('DELETE FROM outbox WHERE entity_type = ? AND entity_id = ?', [type, id]);
  }
  return true;
}

export async function pullAll(deps: SyncDeps, report: SyncReport): Promise<void> {
  const { db, remote, uid } = deps;
  const changedSeries = new Set<string>();
  for (const type of ENTITY_TYPES) {
    const key = `cursor:${type}`;
    const cursor = Number((await getSyncValue(db, key)) ?? 0) || 0;
    const since = Math.max(0, cursor - CURSOR_OVERLAP_MS);
    let maxSeen = cursor;
    let after: unknown = null;
    for (let page = 0; page < 1000; page += 1) {
      const { docs, next } = await remote.pull(uid, type, since, after, PULL_PAGE);
      await db.transaction(async () => {
        for (const doc of docs) {
          report.pulled += 1;
          maxSeen = Math.max(maxSeen, doc.updatedAtMs);
          const entity = fromRemote(type, doc, uid);
          if (!entity) {
            report.invalid += 1;
            continue;
          }
          if (await applyRemote(deps, type, entity as Record<string, unknown>)) {
            report.applied += 1;
            if (type === 'recurrenceRules') changedSeries.add((entity as { seriesId: string }).seriesId);
          }
        }
      });
      if (!next) break;
      after = next;
    }
    if (maxSeen !== cursor) await setSyncValue(db, key, String(maxSeen));
  }
  // A rule changed elsewhere: regenerate its future occurrences from the new rule (exceptions are kept).
  const today = localDateOf(new Date(deps.now?.() ?? Date.now()));
  for (const seriesId of changedSeries) await resetGenerated(db, seriesId, today);
  if ((await getSyncValue(db, PULLED_ONCE_KEY)) === null) {
    // First pull for this account on this device: guest data adopted at sign-in may duplicate the account's
    // starter categories; merge twins by name now that both sides are local.
    // Local edits (queued like any other): screens refresh and the next sync pushes them.
    if ((await mergeDuplicateCategories(db, uid, deps.now)) > 0) notifyDataChanged('local');
    await setSyncValue(db, PULLED_ONCE_KEY, String(deps.now?.() ?? Date.now()));
  }
}

const emptyReport = (): SyncReport => ({ pushed: 0, retrying: 0, failed: 0, pulled: 0, applied: 0, invalid: 0 });

/** One full sync run: push then pull. */
export async function syncOnce(deps: SyncDeps): Promise<SyncReport> {
  const report = emptyReport();
  const held = await pushOutbox(deps, report);
  await pullAll(deps, report);
  if (held) await pushOutbox(deps, report);
  if (report.applied > 0) notifyDataChanged('sync');
  return report;
}

/** Serialises runs: a call while a run is active waits for it and then runs once more. */
export function createSyncRunner(getDeps: () => SyncDeps | null) {
  let active: Promise<SyncReport | null> | null = null;
  let queued = false;
  const runLoop = async (): Promise<SyncReport | null> => {
    let last: SyncReport | null = null;
    do {
      queued = false;
      const deps = getDeps();
      if (!deps) return null;
      last = await syncOnce(deps);
    } while (queued);
    return last;
  };
  return {
    run(): Promise<SyncReport | null> {
      if (active) {
        queued = true;
        return active;
      }
      active = runLoop().finally(() => {
        active = null;
      });
      return active;
    },
    get running() {
      return active !== null;
    },
  };
}

/** Failed entries (Me > Sync): retry puts them back in the queue; discard drops the local change from the queue. */
export async function retryFailed(db: SqlDriver, now = Date.now()): Promise<void> {
  await db.run(`UPDATE outbox SET state = 'pending', attempts = 0, next_attempt_at = ? WHERE state = 'failed'`, [now]);
}

export async function outboxStats(db: SqlDriver): Promise<{ pending: number; failed: number }> {
  const rows = await db.all<{ state: string; n: number }>('SELECT state, count(*) AS n FROM outbox GROUP BY state');
  return {
    pending: rows.find((r) => r.state === 'pending')?.n ?? 0,
    failed: rows.find((r) => r.state === 'failed')?.n ?? 0,
  };
}
