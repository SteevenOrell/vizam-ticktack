/**
 * Firestore rules tests (phase 2 skeleton). Run with `npm run test:rules`, which starts the emulator through
 * `firebase-tools emulators:exec`. Uses a `demo-` project ID, so nothing can reach a real Firebase project.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  setLogLevel,
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ID = 'demo-ticktack';
let env: RulesTestEnvironment;

beforeAll(async () => {
  setLogLevel('error'); // expected PERMISSION_DENIED results are asserted, not logged
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(join(__dirname, '..', '..', 'firebase', 'firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

const task = (ownerId: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  ownerId,
  title: 'Synthetic task',
  deleted: false,
  schemaVersion: 1,
  clientUpdatedAt: '2026-11-09T10:00:00.000Z',
  updatedAt: serverTimestamp(),
  ...extra,
});

async function seedAliceTask() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/alice/tasks/t1'), { ...task('alice', 't1'), updatedAt: Timestamp.now() });
  });
}

describe('owner access', () => {
  it('lets a user create, read, list, update and delete their own task', async () => {
    const db = alice();
    const ref = doc(db, 'users/alice/tasks/t1');
    await assertSucceeds(setDoc(ref, task('alice', 't1')));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(collection(db, 'users/alice/tasks')));
    await assertSucceeds(updateDoc(ref, { title: 'Renamed', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('lets a user write their own profile document', async () => {
    const ref = doc(alice(), 'users/alice');
    await assertSucceeds(setDoc(ref, task('alice', 'alice')));
  });
});

describe('cross-user and anonymous access is denied', () => {
  beforeEach(seedAliceTask);

  it('denies another user reading, listing, updating, deleting or creating in alice’s data', async () => {
    const db = bob();
    await assertFails(getDoc(doc(db, 'users/alice/tasks/t1')));
    await assertFails(getDocs(collection(db, 'users/alice/tasks')));
    await assertFails(updateDoc(doc(db, 'users/alice/tasks/t1'), { title: 'x', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'users/alice/tasks/t1')));
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t2'), task('alice', 't2')));
    await assertFails(getDoc(doc(db, 'users/alice')));
  });

  it('denies unauthenticated reads and writes', async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, 'users/alice/tasks/t1')));
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t3'), task('alice', 't3')));
  });
});

describe('write validation', () => {
  it('denies a spoofed ownerId', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/tasks/t1'), task('bob', 't1')));
  });

  it('denies a document whose id field does not match its path', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/tasks/t1'), task('alice', 'other')));
  });

  it('denies a client-supplied updatedAt', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users/alice/tasks/t1'), task('alice', 't1', { updatedAt: Timestamp.fromMillis(0) })),
    );
  });

  it('denies changing ownerId on update', async () => {
    await seedAliceTask();
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/tasks/t1'), { ownerId: 'bob', updatedAt: serverTimestamp() }),
    );
  });

  it('denies unknown collections and paths outside users/{uid}', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/secrets/s1'), task('alice', 's1')));
    await assertFails(setDoc(doc(alice(), 'public/p1'), task('alice', 'p1')));
  });
});
