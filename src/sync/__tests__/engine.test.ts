import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { adoptGuestData } from '../../data/account';
import type { SqlDriver } from '../../data/db/driver';
import { getAgenda } from '../../data/queries/agenda';
import { getEntity } from '../../data/store';
import { createTask, deleteTask, emptyDraft, setDone, updateTask } from '../../data/tasks';
import { occurrenceId } from '../../domain/recurrence/generator';
import { toRemote } from '../mappers';
import {
  backoffMs,
  BACKOFF_CAP_MS,
  createSyncRunner,
  outboxStats,
  retryFailed,
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
const title = async (db: SqlDriver, id: string) => (await getEntity(db, 'tasks', id, UID))?.title;

beforeEach(() => {
  remote = createMemoryRemote();
  clock = NOW.getTime();
});
afterEach(async () => {
  while (dbs.length) await dbs.pop()!.close();
});

describe('push', () => {
  it('creates offline, backs off, then uploads once online', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('Offline task'));
    remote.online = false;
    let report = await syncOnce(deps(db)).catch(() => null);
    expect(report).toBeNull(); // pull fails while offline; the push was recorded as a retry
    const entry = await db.first<{ attempts: number; next_attempt_at: number; last_error: string }>(
      'SELECT attempts, next_attempt_at, last_error FROM outbox WHERE entity_id = ?',
      [t.id],
    );
    expect(entry).toEqual({ attempts: 1, next_attempt_at: clock + 2000, last_error: 'unavailable' });

    remote.online = true;
    report = await syncOnce(deps(db));
    expect(report.pushed).toBe(0); // still backing off
    clock += 2000;
    report = await syncOnce(deps(db));
    expect(report.pushed).toBe(1);
    expect(remote.docs(UID, 'tasks')).toHaveLength(1);
    expect(await count(db, 'SELECT count(*) AS n FROM outbox')).toBe(0);
    const row = await db.first<{ dirty: number; server_updated_at: number }>(
      'SELECT dirty, server_updated_at FROM tasks WHERE id = ?',
      [t.id],
    );
    expect(row?.dirty).toBe(0);
    expect(row?.server_updated_at).toBe(remote.docs(UID, 'tasks')[0]?.updatedAtMs);
  });

  it('coalesces repeated offline edits into one write', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('v1'));
    await updateTask(ctx(db), t.id, draft('v2'));
    await updateTask(ctx(db), t.id, draft('v3'));
    await syncOnce(deps(db));
    expect(remote.pushCalls).toBe(1);
    expect(remote.docs(UID, 'tasks').map((d) => d.data.title)).toEqual(['v3']);
  });

  it('is idempotent when an acknowledgement is lost and the write is retried', async () => {
    const db = await device();
    await createTask(ctx(db), draft('Once'));
    const lossy: RemoteStore = {
      ...remote,
      push: async (uid, writes) => {
        await remote.push(uid, writes); // the server applies it...
        throw Object.assign(new Error('timeout'), { code: 'deadline-exceeded' }); // ...but the client never hears back
      },
    };
    await syncOnce(deps(db, lossy));
    clock += backoffMs(1);
    await syncOnce(deps(db));
    expect(remote.docs(UID, 'tasks')).toHaveLength(1);
    expect(await count(db, 'SELECT count(*) AS n FROM outbox')).toBe(0);
  });

  it('keeps an entry edited while its push was in flight, and pushes the newer version next', async () => {
    const db = await device();
    const t = await createTask(ctx(db), draft('Before'));
    const racing: RemoteStore = {
      ...remote,
      push: async (uid, writes) => {
        await updateTask(ctx(db), t.id, draft('Edited during push'));
        return remote.push(uid, writes);
      },
    };
    await syncOnce(deps(db, racing));
    expect(await count(db, 'SELECT count(*) AS n FROM outbox WHERE entity_id = ?', [t.id])).toBe(1);
    expect((await db.first<{ dirty: number }>('SELECT dirty FROM tasks WHERE id = ?', [t.id]))?.dirty).toBe(1);
    await syncOnce(deps(db));
    expect(remote.docs(UID, 'tasks')[0]?.data.title).toBe('Edited during push');
    expect(await title(db, t.id)).toBe('Edited during push');
  });

  it('moves rejected writes to failed, and retries them on request', async () => {
    const db = await device();
    await createTask(ctx(db), draft('Rejected'));
    const denying: RemoteStore = {
      ...remote,
      push: async (_u, w) => w.map(() => ({ ok: false, code: 'permission-denied' })),
    };
    const report = await syncOnce(deps(db, denying));
    expect(report.failed).toBe(1);
    expect(await outboxStats(db)).toEqual({ pending: 0, failed: 1 });
    await retryFailed(db, clock);
    await syncOnce(deps(db));
    expect(await outboxStats(db)).toEqual({ pending: 0, failed: 0 });
  });

  it('never uploads generated occurrences, only exceptions', async () => {
    const db = await device();
    const series = await createTask(ctx(db), {
      ...draft('Daily'),
      repeat: {
        freq: 'daily',
        interval: 1,
        byWeekday: null,
        byMonthDay: null,
        weekStartsOn: 1,
        endType: 'never',
        endDate: null,
        count: null,
      },
    });
    await setDone(ctx(db), { taskId: series.id, occurrenceId: occurrenceId(series.id, TODAY) }, true);
    await syncOnce(deps(db));
    expect(remote.docs(UID, 'occurrences').map((d) => d.id)).toEqual([occurrenceId(series.id, TODAY)]);
    expect(remote.docs(UID, 'recurrenceRules')).toHaveLength(1);
  });

  it('grows the backoff exponentially up to 15 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(30)).toBe(BACKOFF_CAP_MS);
  });
});

describe('pull and conflicts', () => {
  it('converges two devices on the last write accepted by the server', async () => {
    const a = await device();
    const b = await device();
    const t = await createTask(ctx(a), draft('Original'));
    await syncOnce(deps(a));
    await syncOnce(deps(b));
    expect(await title(b, t.id)).toBe('Original');

    // B edits offline first; A edits later but syncs first. B's edit reaches the server last, so it wins.
    await updateTask(ctx(b), t.id, draft('Edited on B (offline)'));
    await updateTask(ctx(a), t.id, draft('Edited on A'));
    await syncOnce(deps(a));
    clock += 60_000;
    await syncOnce(deps(b)); // B's dirty row is kept over A's version and pushed
    await syncOnce(deps(a));
    expect(await title(a, t.id)).toBe('Edited on B (offline)');
    expect(await title(b, t.id)).toBe('Edited on B (offline)');
    expect(remote.docs(UID, 'tasks')[0]?.data.title).toBe('Edited on B (offline)');
  });

  it('replaces a clean local row only with a newer server version (cursor overlap is deduplicated)', async () => {
    const a = await device();
    const t = await createTask(ctx(a), draft('Mine'));
    await syncOnce(deps(a));
    const first = await syncOnce(deps(a)); // the 60 s overlap returns the same doc again
    expect(first.pulled).toBe(1);
    expect(first.applied).toBe(0);

    const doc = remote.docs(UID, 'tasks')[0]!;
    remote.inject(UID, 'tasks', {
      ...doc,
      data: { ...doc.data, title: 'Older copy' },
      updatedAtMs: doc.updatedAtMs - 1,
    });
    await syncOnce(deps(a));
    expect(await title(a, t.id)).toBe('Mine');
    remote.inject(UID, 'tasks', {
      ...doc,
      data: { ...doc.data, title: 'From the web' },
      updatedAtMs: remote.clock + 5,
    });
    await syncOnce(deps(a));
    expect(await title(a, t.id)).toBe('From the web');
  });

  it('applies a remote tombstone over a concurrent local edit (sticky delete)', async () => {
    const a = await device();
    const b = await device();
    const t = await createTask(ctx(a), draft('Shared'));
    await syncOnce(deps(a));
    await syncOnce(deps(b));

    await deleteTask(ctx(a), { taskId: t.id });
    await syncOnce(deps(a));
    await updateTask(ctx(b), t.id, draft('Edited after delete'));
    const report = await syncOnce(deps(b));
    expect(report.failed).toBe(1); // the server refuses to revive it
    expect(await getEntity(b, 'tasks', t.id, UID)).toBeNull(); // ...and the tombstone wins locally
    expect(await count(b, 'SELECT count(*) AS n FROM outbox WHERE entity_id = ?', [t.id])).toBe(0);
    expect(remote.docs(UID, 'tasks')[0]?.data.deleted).toBe(true);
  });

  it('skips invalid or foreign documents without crashing', async () => {
    const a = await device();
    const t = await createTask(ctx(a), draft('Valid'));
    await syncOnce(deps(a));
    const good = remote.docs(UID, 'tasks')[0]!;
    remote.inject(UID, 'tasks', {
      id: 'bad-1',
      data: { ...good.data, id: 'bad-1', title: '' },
      updatedAtMs: remote.clock + 1,
    });
    remote.inject(UID, 'tasks', {
      id: 'bad-2',
      data: { ...good.data, id: 'bad-2', ownerId: 'someone-else' },
      updatedAtMs: remote.clock + 2,
    });
    remote.inject(UID, 'tasks', { id: 'bad-3', data: { ...good.data, id: 'other-id' }, updatedAtMs: remote.clock + 3 });
    const report = await syncOnce(deps(a));
    expect(report.invalid).toBe(3);
    expect(await count(a, 'SELECT count(*) AS n FROM tasks')).toBe(1);
    expect(await title(a, t.id)).toBe('Valid');
  });

  it('pages through large collections', async () => {
    const a = await device();
    const template = toRemote('categories', {
      id: 'x',
      ownerId: UID,
      createdAt: '2026-11-09T10:00:00.000Z',
      clientUpdatedAt: '2026-11-09T10:00:00.000Z',
      deleted: false,
      schemaVersion: 1,
      name: 'Bulk',
      color: 'sky',
      icon: 'dot',
      sortOrder: 0,
      archived: false,
    });
    // 1,200 docs, many sharing one server time (a batch commit), to exercise the page cursor.
    for (let i = 0; i < 1200; i += 1) {
      const id = `cat-${String(i).padStart(4, '0')}`;
      remote.inject(UID, 'categories', { id, data: { ...template, id }, updatedAtMs: clock + Math.floor(i / 300) });
    }
    const report = await syncOnce(deps(a));
    expect(report.applied).toBe(1200);
    expect(await count(a, 'SELECT count(*) AS n FROM categories')).toBe(1200);
  });

  it('regenerates future occurrences when a rule changes on another device', async () => {
    const a = await device();
    const b = await device();
    const daily = {
      freq: 'daily' as const,
      interval: 1,
      byWeekday: null,
      byMonthDay: null,
      weekStartsOn: 1 as const,
      endType: 'never' as const,
      endDate: null,
      count: null,
    };
    const series = await createTask(ctx(a), { ...draft('Walk'), repeat: daily });
    await syncOnce(deps(a));
    await syncOnce(deps(b));
    await updateTask(ctx(a), series.id, { ...draft('Walk'), repeat: { ...daily, freq: 'weekly', byWeekday: [1] } });
    await syncOnce(deps(a));
    clock += 1000;
    await syncOnce(deps(b));

    const days = (await getAgenda(b, UID, TODAY, '2026-11-20', TODAY)).map((i) => i.date);
    expect(days).toEqual(['2026-11-09', '2026-11-16']);
  });
});

describe('runner and guest mode', () => {
  it('runs one sync at a time and coalesces concurrent requests', async () => {
    const db = await device();
    await createTask(ctx(db), draft('One'));
    const runner = createSyncRunner(() => deps(db));
    const [r1, r2] = await Promise.all([runner.run(), runner.run()]);
    expect(r1).toBe(r2);
    expect(remote.pushCalls).toBe(1);
    expect(runner.running).toBe(false);
  });

  it('does nothing in guest mode (no deps)', async () => {
    const runner = createSyncRunner(() => null);
    expect(await runner.run()).toBeNull();
  });

  it('uploads adopted guest data after sign-up', async () => {
    const db = await device();
    const guest = context(db, 'local');
    const t = await createTask(guest, draft('Made as a guest'));
    await adoptGuestData(db, UID, { keepGuestProfile: true, now: NOW });
    await syncOnce(deps(db));
    expect(remote.docs(UID, 'tasks').map((d) => d.id)).toEqual([t.id]);
    expect(remote.docs(UID, 'tasks')[0]?.data.ownerId).toBe(UID);
  });
});
