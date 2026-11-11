/**
 * Phase 5a: sync robustness (docs/SECURITY_REVIEW.md). Poison rows, retry cap, clock skew, first sync after
 * signing in to an existing account (profile and starter-category conflicts). Synthetic data only.
 */
import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { adoptGuestData } from '../../data/account';
import type { SqlDriver } from '../../data/db/driver';
import { ensureDefaultCategories, ensureProfile, getProfile, updateProfile } from '../../data/profile';
import { getEntity, listEntities } from '../../data/store';
import { createTask, emptyDraft, updateTask } from '../../data/tasks';
import {
  BACKOFF_CAP_MS,
  INVALID_LOCAL,
  MAX_RETRY_ATTEMPTS,
  outboxStats,
  PULLED_ONCE_KEY,
  syncOnce,
  type SyncDeps,
} from '../engine';
import { createMemoryRemote, type MemoryRemote } from '../memoryRemote';
import type { RemoteStore } from '../types';

const UID = 'user-a';
let remote: MemoryRemote;
let clock: number;
const dbs: SqlDriver[] = [];

async function device(): Promise<SqlDriver> {
  const db = await freshDb();
  dbs.push(db);
  return db;
}
const deps = (db: SqlDriver, r: RemoteStore = remote): SyncDeps => ({ db, remote: r, uid: UID, now: () => clock });
const ctx = (db: SqlDriver) => context(db, UID);
const draft = (title: string) => ({ ...emptyDraft(TODAY), title });
const outbox = (db: SqlDriver, id: string) =>
  db.first<{ state: string; attempts: number; last_error: string | null }>(
    'SELECT state, attempts, last_error FROM outbox WHERE entity_id = ?',
    [id],
  );

/** The memory remote, except that writes of `badId` are refused with `code`. */
function refusing(code: string, badId: string): RemoteStore {
  return {
    async push(uid, writes) {
      const ok = await remote.push(
        uid,
        writes.filter((w) => w.id !== badId),
      );
      let i = 0;
      return writes.map((w) => (w.id === badId ? { ok: false as const, code } : ok[i++]!));
    },
    pull: (...args) => remote.pull(...args),
    deleteAll: (uid) => remote.deleteAll(uid),
  };
}

beforeEach(() => {
  remote = createMemoryRemote();
  clock = NOW.getTime();
});
afterEach(async () => {
  while (dbs.length) await dbs.pop()!.close();
});

describe('poison entries', () => {
  it('marks a row that no longer passes its schema as failed (invalid-local) and pushes the rest', async () => {
    const db = await device();
    const bad = await createTask(ctx(db), draft('Will be corrupted'));
    const good = await createTask(ctx(db), draft('Fine'));
    await db.run("UPDATE tasks SET start_time = '25:99' WHERE id = ?", [bad.id]); // e.g. written by an old build

    const report = await syncOnce(deps(db));
    expect(report.failed).toBe(1);
    expect(report.pushed).toBeGreaterThanOrEqual(1);
    expect(remote.docs(UID, 'tasks').map((d) => d.id)).toEqual([good.id]);
    expect(await outbox(db, bad.id)).toEqual({ state: 'failed', attempts: 1, last_error: INVALID_LOCAL });
    expect(await outboxStats(db)).toEqual({ pending: 0, failed: 1 });
  });

  it('does not let unreadable JSON in a row stop the sync run', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('Mine'));
    await db.run(
      `INSERT INTO routines (id, owner_id, created_at, client_updated_at, deleted, schema_version, title, part_of_day,
        steps, active, local_rev, dirty) VALUES ('r-bad', ?, ?, ?, 0, 1, 'Broken', 'morning', '{not json', 1, 1, 1)`,
      [UID, NOW.toISOString(), NOW.toISOString()],
    );
    await db.run(
      `INSERT INTO outbox (entity_type, entity_id, op, enqueued_rev, attempts, next_attempt_at, state)
       VALUES ('routines', 'r-bad', 'upsert', 1, 0, 0, 'pending')`,
    );
    await expect(syncOnce(deps(db))).resolves.toMatchObject({ failed: 1 });
    expect(remote.docs(UID, 'tasks').map((d) => d.id)).toEqual([t.id]);
    expect((await outbox(db, 'r-bad'))?.last_error).toBe(INVALID_LOCAL);
  });

  it('gives up on a write the server keeps refusing with a non-network error after the retry cap', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('Refused'));
    const flaky = refusing('internal', t.id);
    for (let i = 1; i < MAX_RETRY_ATTEMPTS; i += 1) {
      await syncOnce(deps(db, flaky));
      expect(await outbox(db, t.id)).toMatchObject({ state: 'pending', attempts: i, last_error: 'internal' });
      clock += BACKOFF_CAP_MS;
    }
    await syncOnce(deps(db, flaky));
    expect(await outbox(db, t.id)).toMatchObject({ state: 'failed', last_error: 'internal' });
  });

  it('keeps retrying network errors for as long as it takes', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('Offline for days'));
    const offline = refusing('unavailable', t.id);
    for (let i = 0; i < MAX_RETRY_ATTEMPTS * 2; i += 1) {
      await syncOnce(deps(db, offline));
      clock += BACKOFF_CAP_MS;
    }
    expect(await outbox(db, t.id)).toMatchObject({ state: 'pending', attempts: MAX_RETRY_ATTEMPTS * 2 });
    await syncOnce(deps(db));
    expect(await outbox(db, t.id)).toBeNull();
  });
});

describe('clock skew', () => {
  it('pushes an entry scheduled by a clock that later moved back a day', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('Skewed'));
    remote.online = false;
    await syncOnce(deps(db)).catch(() => null);
    expect(await outbox(db, t.id)).toMatchObject({ state: 'pending', attempts: 1 });

    remote.online = true;
    clock -= 24 * 60 * 60_000; // device clock corrected backwards
    const report = await syncOnce(deps(db));
    expect(report.pushed).toBe(1);
    expect(remote.docs(UID, 'tasks')).toHaveLength(1);
  });

  it('orders conflicting edits by server time, whatever the device clocks say', async () => {
    const a = await device();
    const b = await device();
    const t = await createTask(ctx(a), draft('v1'));
    await syncOnce(deps(a));
    await syncOnce(deps(b));
    // Device B's clock is a year behind, but its edit reaches the server last: it wins everywhere.
    await updateTask(ctx(a), t.id, draft('from A'));
    await syncOnce(deps(a));
    const lateCtx = context(b, UID, () => new Date(NOW.getTime() - 365 * 86_400_000));
    await updateTask(lateCtx, t.id, draft('from B, slow clock'));
    await syncOnce(deps(b));
    await syncOnce(deps(a));
    expect((await getEntity(a, 'tasks', t.id, UID))?.title).toBe('from B, slow clock');
    expect((await getEntity(b, 'tasks', t.id, UID))?.title).toBe('from B, slow clock');
  });
});

describe('first sync after signing in to an existing account', () => {
  async function existingAccount() {
    const a = await device();
    await ensureProfile(ctx(a), { timeZone: 'Europe/Paris', weekStartsOn: 1 });
    await updateProfile(ctx(a), { dailyCapacityMin: 300, onboardingCompletedAt: NOW.toISOString() });
    await ensureDefaultCategories(ctx(a), 'en');
    await syncOnce(deps(a));
    return a;
  }

  it('keeps the account’s profile instead of overwriting it with this device’s defaults', async () => {
    await existingAccount();
    const b = await device();
    const guest = context(b, 'local');
    await ensureProfile(guest, { timeZone: 'America/Toronto', weekStartsOn: 0 });
    await adoptGuestData(b, UID, { keepGuestProfile: false, now: NOW });
    // SessionProvider housekeeping runs before the first pull and creates a default profile for the account.
    await ensureProfile(ctx(b), { timeZone: 'America/Toronto', weekStartsOn: 0 });

    clock += 1000;
    await syncOnce(deps(b));
    const cloud = remote.docs(UID, 'profile')[0]?.data;
    expect(cloud).toMatchObject({ dailyCapacityMin: 300, timeZone: 'Europe/Paris', weekStartsOn: 1 });
    expect(cloud?.onboardingCompletedAt).toBe(NOW.toISOString());
    expect(await getProfile(ctx(b))).toMatchObject({ dailyCapacityMin: 300, timeZone: 'Europe/Paris' });
    expect(await count(b, "SELECT count(*) AS n FROM outbox WHERE entity_type = 'profile'")).toBe(0);
  });

  it('uploads a new account’s profile right after the first pull', async () => {
    const db = await device();
    await ensureProfile(context(db, 'local'), { timeZone: 'America/Toronto', weekStartsOn: 0 });
    await adoptGuestData(db, UID, { keepGuestProfile: true, now: NOW });
    await syncOnce(deps(db));
    expect(remote.docs(UID, 'profile')[0]?.data).toMatchObject({ id: UID, timeZone: 'America/Toronto' });
    expect(await db.first('SELECT value FROM sync_state WHERE key = ?', [PULLED_ONCE_KEY])).not.toBeNull();
  });

  it('merges the guest’s starter categories into the account’s and moves their tasks', async () => {
    const a = await existingAccount();
    const accountHealth = (await listEntities(a, 'categories', UID)).find((c) => c.name === 'Health')!;

    const b = await device();
    const guest = context(b, 'local', () => new Date(NOW.getTime() + 60_000));
    await ensureDefaultCategories(guest, 'en');
    const task = await createTask(guest, { ...draft('Guest run'), categoryName: 'health' });
    await adoptGuestData(b, UID, { keepGuestProfile: false, now: NOW });

    clock += 1000;
    await syncOnce(deps(b));
    clock += 1000;
    await syncOnce(deps(b));

    const live = await listEntities(b, 'categories', UID);
    expect(live.map((c) => c.name).sort()).toEqual(['Focus work', 'Health', 'Home', 'Learning']);
    expect(live.find((c) => c.name === 'Health')?.id).toBe(accountHealth.id);
    expect((await getEntity(b, 'tasks', task.id, UID))?.categoryId).toBe(accountHealth.id);
    expect(remote.docs(UID, 'categories').filter((d) => d.data.deleted !== true)).toHaveLength(4);
    expect(remote.docs(UID, 'tasks').find((d) => d.id === task.id)?.data.categoryId).toBe(accountHealth.id);

    // The other device converges on the same four categories.
    await syncOnce(deps(a));
    expect(await listEntities(a, 'categories', UID)).toHaveLength(4);
    expect(await outboxStats(b)).toEqual({ pending: 0, failed: 0 });
  });
});
