/**
 * Sync engine against the Firestore and Auth emulators with the real rules (firebase/firestore.rules loaded by
 * `emulators:exec`). Two simulated devices = two SQLite databases + two Firebase app instances signed in as the same
 * synthetic user. Project ID is `demo-ticktack`, so nothing can reach a real project.
 */
import { randomUUID } from 'crypto';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  initializeFirestore,
  memoryLocalCache,
  setLogLevel,
  type Firestore,
} from 'firebase/firestore';

import { adoptGuestData } from '../../src/data/account';
import type { SqlDriver } from '../../src/data/db/driver';
import { getEntity } from '../../src/data/store';
import { createTask, deleteTask, emptyDraft, setDone, updateTask } from '../../src/data/tasks';
import { localDateOf } from '../../src/domain/localDate';
import { occurrenceId } from '../../src/domain/recurrence/generator';
import { toRemote } from '../../src/sync/mappers';
import { backoffMs, syncOnce, type SyncDeps } from '../../src/sync/engine';
import { createFirestoreRemote } from '../../src/sync/firestoreRemote';
import { RemoteError, type RemoteStore } from '../../src/sync/types';
import { context, count, freshDb } from '../support/db';

const PROJECT_ID = 'demo-ticktack';
const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

interface Device {
  app: FirebaseApp;
  fs: Firestore;
  user: User;
  db: SqlDriver;
}

const open: Device[] = [];
const TODAY = localDateOf(new Date());
const draft = (title: string) => ({ ...emptyDraft(TODAY), title });

async function signIn(email: string, create: boolean): Promise<{ app: FirebaseApp; fs: Firestore; user: User }> {
  const app = initializeApp(
    { projectId: PROJECT_ID, apiKey: 'demo-api-key', authDomain: `${PROJECT_ID}.firebaseapp.com`, appId: 'demo-app' },
    `device-${randomUUID()}`,
  );
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const fs = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(fs, fsHost as string, Number(fsPort));
  const password = 'synthetic-Pass-2026';
  const cred = create
    ? await createUserWithEmailAndPassword(auth, email, password)
    : await signInWithEmailAndPassword(auth, email, password);
  return { app, fs, user: cred.user };
}

async function device(email: string, create = false): Promise<Device> {
  const d = { ...(await signIn(email, create)), db: await freshDb() };
  open.push(d);
  return d;
}

const deps = (d: Device, remote: RemoteStore = createFirestoreRemote(d.fs)): SyncDeps => ({
  db: d.db,
  remote,
  uid: d.user.uid,
});
const ctx = (d: Device) => context(d.db, d.user.uid, () => new Date());
const title = async (d: Device, id: string) => (await getEntity(d.db, 'tasks', id, d.user.uid))?.title;

beforeAll(() => {
  setLogLevel('silent'); // denied writes are asserted, not logged
});

afterEach(async () => {
  while (open.length) {
    const d = open.pop()!;
    await d.db.close();
    await deleteApp(d.app);
  }
});

const email = () => `planner-${randomUUID().slice(0, 8)}@example.test`;

it('uploads from one device and downloads on another', async () => {
  const address = email();
  const a = await device(address, true);
  const b = await device(address);
  const t = await createTask(ctx(a), { ...draft('Synced task'), startTime: '09:00', durationMin: 30 });
  const pushed = await syncOnce(deps(a));
  expect(pushed.pushed).toBe(1);
  const pulled = await syncOnce(deps(b));
  expect(pulled.applied).toBeGreaterThanOrEqual(1);
  expect(await title(b, t.id)).toBe('Synced task');
  const row = await b.db.first<{ server_updated_at: number; dirty: number }>(
    'SELECT server_updated_at, dirty FROM tasks WHERE id = ?',
    [t.id],
  );
  expect(row?.dirty).toBe(0);
  expect(row?.server_updated_at).toBeGreaterThan(0);
});

it('resolves a conflict by the last write the server accepted, on both devices', async () => {
  const address = email();
  const a = await device(address, true);
  const b = await device(address);
  const t = await createTask(ctx(a), draft('Original'));
  await syncOnce(deps(a));
  await syncOnce(deps(b));

  await updateTask(ctx(b), t.id, draft('Edited offline on B'));
  await updateTask(ctx(a), t.id, draft('Edited on A'));
  await syncOnce(deps(a)); // A reaches the server first
  await syncOnce(deps(b)); // B's dirty edit is kept, pushed, and gets the later server timestamp
  await syncOnce(deps(a));
  expect(await title(a, t.id)).toBe('Edited offline on B');
  expect(await title(b, t.id)).toBe('Edited offline on B');
});

it('queues while offline and uploads after reconnecting (network disabled in the SDK)', async () => {
  const a = await device(email(), true);
  const t = await createTask(ctx(a), draft('Made offline'));
  await disableNetwork(a.fs);
  let now = Date.now();
  const offline = { ...deps(a, createFirestoreRemote(a.fs, { timeoutMs: 1500 })), now: () => now };
  await expect(syncOnce(offline)).rejects.toBeInstanceOf(RemoteError); // the pull cannot reach the server either
  const entry = await a.db.first<{ attempts: number; last_error: string }>(
    'SELECT attempts, last_error FROM outbox WHERE entity_id = ?',
    [t.id],
  );
  expect(entry).toEqual({ attempts: 1, last_error: 'deadline-exceeded' });

  await enableNetwork(a.fs);
  now += backoffMs(1);
  const report = await syncOnce({ ...deps(a), now: () => now });
  expect(report.pushed).toBe(1);
  expect(await count(a.db, 'SELECT count(*) AS n FROM outbox')).toBe(0);
});

it('keeps tombstones sticky: an edit made after a delete on another device loses', async () => {
  const address = email();
  const a = await device(address, true);
  const b = await device(address);
  const t = await createTask(ctx(a), draft('Shared'));
  await syncOnce(deps(a));
  await syncOnce(deps(b));
  await deleteTask(ctx(a), { taskId: t.id });
  await syncOnce(deps(a));
  await updateTask(ctx(b), t.id, draft('Late edit'));
  const report = await syncOnce(deps(b));
  expect(report.failed).toBe(1); // rules refuse to revive the tombstone
  expect(await getEntity(b.db, 'tasks', t.id, b.user.uid)).toBeNull();
  expect(await count(b.db, 'SELECT count(*) AS n FROM outbox WHERE entity_id = ?', [t.id])).toBe(0);
});

it('syncs recurring exceptions but never generated occurrences', async () => {
  const a = await device(email(), true);
  const series = await createTask(ctx(a), {
    ...draft('Daily walk'),
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
  await setDone(ctx(a), { taskId: series.id, occurrenceId: occurrenceId(series.id, TODAY) }, true);
  const report = await syncOnce(deps(a));
  expect(report.failed).toBe(0);
  expect(report.pushed).toBe(3); // template task, rule, one exception
});

it('denies another user reading or writing the account (cross-user)', async () => {
  const alice = await device(email(), true);
  const bob = await device(email(), true);
  const secret = await createTask(ctx(alice), draft('Private'));
  await syncOnce(deps(alice));

  // Bob's client aims at Alice's path with Alice's uid in the data: the rules refuse.
  const bobRemote = createFirestoreRemote(bob.fs);
  const outcomes = await bobRemote
    .push(alice.user.uid, [
      {
        type: 'tasks',
        id: 'intruder-1',
        data: toRemote('tasks', { ...secret, id: 'intruder-1' }),
      },
    ])
    .catch((e: unknown) => [{ ok: false, code: (e as RemoteError).code }]);
  expect(outcomes[0]).toMatchObject({ ok: false, code: 'permission-denied' });
  await expect(bobRemote.pull(alice.user.uid, 'tasks', 0, null, 10)).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(bobRemote.deleteAll(alice.user.uid)).rejects.toMatchObject({ code: 'permission-denied' });
});

it('uploads guest data after sign-up, then deletes all account data', async () => {
  const a = await device(email(), true);
  const guest = context(a.db, 'local', () => new Date());
  const t = await createTask(guest, draft('Made as a guest'));
  await adoptGuestData(a.db, a.user.uid, { keepGuestProfile: true });
  const report = await syncOnce(deps(a));
  expect(report.failed).toBe(0);
  const fresh = await device(email(), false).catch(() => null);
  expect(fresh).toBeNull(); // no such account: sign-in fails without saying why (no enumeration)

  const remote = createFirestoreRemote(a.fs);
  const page = await remote.pull(a.user.uid, 'tasks', 0, null, 10);
  expect(page.docs.map((d) => d.id)).toEqual([t.id]);
  expect(await remote.deleteAll(a.user.uid)).toBeGreaterThanOrEqual(1);
  expect((await remote.pull(a.user.uid, 'tasks', 0, null, 10)).docs).toEqual([]);
  await deleteUser(a.user);
});
