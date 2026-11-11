/**
 * Phase 5a: sign-out wipe and guest -> account migration (docs/SECURITY_REVIEW.md). Synthetic users and data only.
 */
import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { createFakeAuth } from '../../../tests/support/fakeAuth';
import { adoptGuestData, getBoundUid } from '../../data/account';
import type { SqlDriver } from '../../data/db/driver';
import { ensureDefaultCategories, ensureProfile } from '../../data/profile';
import { createTask, emptyDraft } from '../../data/tasks';
import { LOCAL_OWNER } from '../../domain/models';
import { useSyncStatus } from '../../state/session';
import { syncOnce } from '../../sync/engine';
import { createMemoryRemote } from '../../sync/memoryRemote';
import { OWNER_KEY, rememberOwner } from '../background/maintenanceTask';
import { clearSignedOutDevice, deleteAccountFlow, signInFlow, signOutFlow } from '../accountFlows';
import { cancelAllReminders } from '../notifications/maintenance';
import type { NotificationsApi } from '../notifications/scheduler';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const tables = async (d: SqlDriver) =>
  (
    await d.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
  ).map((r) => r.name);

async function rowCounts(d: SqlDriver): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await tables(d)) out[t] = await count(d, `SELECT count(*) AS n FROM ${t}`);
  return out;
}

/** OS scheduler stand-in: this app's ids start with `tt_`; another app's (or Expo's) do not. */
function fakeOs(ids: string[]): NotificationsApi & { pending: string[] } {
  const api = {
    pending: [...ids],
    async getScheduledIds() {
      return [...api.pending];
    },
    async schedule() {},
    async cancel(id: string) {
      api.pending = api.pending.filter((x) => x !== id);
    },
  };
  return api;
}

async function fillAccount(uid: string) {
  const ctx = context(db, uid);
  await ensureProfile(ctx, { timeZone: 'Europe/Paris', weekStartsOn: 1 });
  await ensureDefaultCategories(ctx, 'en');
  await createTask(ctx, { ...emptyDraft(TODAY), title: 'Private: see the doctor' });
  await rememberOwner(db, uid);
  await db.run(
    `INSERT INTO scheduled_notifications (notification_id, reminder_id, occurrence_key, fire_at, fingerprint)
     VALUES ('tt_x_task', 'x', 'task:x', 0, 'f')`,
  );
}

describe('sign-out wipe', () => {
  it('empties every local table, cancels this app’s notifications and resets the sync status', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1' });
    const remote = createMemoryRemote();
    const os = fakeOs(['tt_task1_task', 'tt_goal1_due_x', 'other-app-id']);
    const a = await signInFlow({ db, gateway, remote }, 'a@example.test', 'password-a1');
    await fillAccount(a.uid);
    await syncOnce({ db, remote, uid: a.uid, now: () => Date.now() + 1000 });
    useSyncStatus.getState().set({ state: 'idle', pending: 3, failed: 2, lastSuccessAt: 123 });

    await signOutFlow({
      db,
      gateway,
      remote,
      syncNow: async () => null,
      clearDevice: () => cancelAllReminders(db, { supported: true, api: () => os }),
    });

    expect(gateway.current()).toBeNull();
    const counts = await rowCounts(db);
    expect(Object.keys(counts)).toEqual(expect.arrayContaining(['outbox', 'sync_state', 'scheduled_notifications']));
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(await db.first('SELECT value FROM sync_state WHERE key = ?', [OWNER_KEY])).toBeNull();
    expect(os.pending).toEqual(['other-app-id']);
    expect(useSyncStatus.getState()).toMatchObject({ state: 'disabled', pending: 0, failed: 0, lastSuccessAt: null });
    // The cloud copy is untouched: signing back in restores it.
    expect(remote.docs(a.uid, 'tasks')).toHaveLength(1);
  });

  it('shows the next person nothing of the previous account, and uploads none of it to theirs', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1', 'b@example.test': 'password-b1' });
    const remote = createMemoryRemote();
    const a = await signInFlow({ db, gateway, remote }, 'a@example.test', 'password-a1');
    await fillAccount(a.uid);
    await signOutFlow({ db, gateway, remote });

    // Guest mode in between: nothing visible.
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(0);
    const b = await signInFlow({ db, gateway, remote }, 'b@example.test', 'password-b1');
    await syncOnce({ db, remote, uid: b.uid, now: () => Date.now() + 1000 });
    expect(remote.docs(b.uid, 'tasks')).toHaveLength(0);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks WHERE owner_id = ?', [a.uid])).toBe(0);
    expect(await count(db, 'SELECT count(*) AS n FROM profile WHERE owner_id = ?', [a.uid])).toBe(0);
  });

  it('wipes even when the last upload, the notification cleanup or the network fail', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1' });
    const a = await signInFlow({ db, gateway, remote: null }, 'a@example.test', 'password-a1');
    await fillAccount(a.uid);
    await signOutFlow({
      db,
      gateway,
      remote: null,
      syncNow: () => Promise.reject(new Error('offline')),
      clearDevice: () => Promise.reject(new Error('module missing')),
    });
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(0);
    expect(await getBoundUid(db)).toBeNull();
  });

  it('account deletion also cancels notifications and resets the sync status', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1' });
    const remote = createMemoryRemote();
    const a = await signInFlow({ db, gateway, remote }, 'a@example.test', 'password-a1');
    await fillAccount(a.uid);
    const clearDevice = jest.fn(async () => 1);
    useSyncStatus.getState().set({ failed: 4 });
    await deleteAccountFlow({ db, gateway, remote, clearDevice }, 'password-a1');
    expect(clearDevice).toHaveBeenCalledTimes(1);
    expect(Object.values(await rowCounts(db)).every((n) => n === 0)).toBe(true);
    expect(useSyncStatus.getState().failed).toBe(0);
  });

  it('a signed-out start wipes a database still bound to an account (interrupted sign-out), never guest data', async () => {
    await createTask(context(db, LOCAL_OWNER), { ...emptyDraft(TODAY), title: 'Guest' });
    expect(await clearSignedOutDevice(db)).toBe(false);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(1);

    const gateway = createFakeAuth({ 'a@example.test': 'password-a1' });
    const a = await signInFlow({ db, gateway, remote: null }, 'a@example.test', 'password-a1');
    await fillAccount(a.uid);
    await gateway.signOut(); // the app died before the wipe
    const clearDevice = jest.fn(async () => 0);
    expect(await clearSignedOutDevice(db, clearDevice)).toBe(true);
    expect(clearDevice).toHaveBeenCalled();
    expect(Object.values(await rowCounts(db)).every((n) => n === 0)).toBe(true);
  });
});

describe('guest -> account migration', () => {
  async function guestData() {
    const guest = context(db, LOCAL_OWNER);
    await ensureProfile(guest, { timeZone: 'America/Toronto', weekStartsOn: 0 });
    await ensureDefaultCategories(guest, 'en');
    for (const title of ['One', 'Two', 'Three']) await createTask(guest, { ...emptyDraft(TODAY), title });
  }
  const owned = (owner: string) =>
    count(
      db,
      'SELECT (SELECT count(*) FROM tasks WHERE owner_id = ?) + (SELECT count(*) FROM categories WHERE owner_id = ?) AS n',
      [owner, owner],
    );

  it('rolls back completely when it fails midway, and a retry then moves everything once', async () => {
    await guestData();
    const before = await owned(LOCAL_OWNER);
    const outboxBefore = await count(db, 'SELECT count(*) AS n FROM outbox');
    let armed = true;
    const failing: SqlDriver = {
      ...db,
      run: async (sql, params) => {
        if (armed && sql.includes('UPDATE tasks SET owner_id')) {
          armed = false;
          throw new Error('disk I/O error');
        }
        return db.run(sql, params);
      },
    };
    await expect(adoptGuestData(failing, 'uid-1', { keepGuestProfile: true, now: NOW })).rejects.toThrow('disk');
    expect(await owned(LOCAL_OWNER)).toBe(before);
    expect(await owned('uid-1')).toBe(0);
    expect(await getBoundUid(db)).toBeNull();
    expect(await count(db, 'SELECT count(*) AS n FROM outbox')).toBe(outboxBefore);

    await adoptGuestData(db, 'uid-1', { keepGuestProfile: true, now: NOW });
    expect(await owned('uid-1')).toBe(before);
    expect(await owned(LOCAL_OWNER)).toBe(0);
  });

  it('never duplicates on retry: adopting twice and syncing twice leaves one copy of each item', async () => {
    await guestData();
    const remote = createMemoryRemote();
    const sync = () => syncOnce({ db, remote, uid: 'uid-1', now: () => Date.now() + 1000 });
    await adoptGuestData(db, 'uid-1', { keepGuestProfile: true, now: NOW });
    remote.online = false;
    await sync().catch(() => null); // upload interrupted
    remote.online = true;
    await adoptGuestData(db, 'uid-1', { keepGuestProfile: true, now: NOW }); // e.g. the sign-in screen retried
    await sync();
    await sync();
    expect(remote.docs('uid-1', 'tasks')).toHaveLength(3);
    expect(remote.docs('uid-1', 'categories')).toHaveLength(4);
    expect(remote.docs('uid-1', 'profile')).toHaveLength(1);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(3);
    expect(await count(db, 'SELECT count(*) AS n FROM outbox')).toBe(0);
  });

  it('keeps guest data for a later sign-in when the device is bound to someone else', async () => {
    await guestData();
    await db.run("INSERT INTO sync_state (key, value) VALUES ('bound_uid', 'someone-else')");
    await expect(adoptGuestData(db, 'uid-1', { keepGuestProfile: true })).rejects.toThrow(/bound/);
    expect(await owned(LOCAL_OWNER)).toBeGreaterThan(0);
  });
});
