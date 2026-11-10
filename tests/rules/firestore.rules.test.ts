/**
 * Firestore rules tests. Run with `npm run test:rules`, which starts the emulators through
 * `firebase-tools emulators:exec`. Uses a `demo-` project ID, so nothing can reach a real Firebase project.
 * Fixtures are produced by the app's own mappers (src/sync/mappers.ts) so rules and client stay in step.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';

import type { EntityType } from '../../src/data/entities';
import { DEFAULT_GOAL_REMINDERS } from '../../src/domain/models';
import { toRemote } from '../../src/sync/mappers';

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

const ISO = '2026-11-09T10:00:00.000Z';
const base = (ownerId: string, id: string) => ({
  id,
  ownerId,
  createdAt: ISO,
  clientUpdatedAt: ISO,
  serverUpdatedAt: null,
  deleted: false,
  schemaVersion: 1,
});

/** One valid entity per collection (synthetic). */
function entity(type: EntityType, ownerId: string, id: string): Record<string, unknown> {
  const b = base(ownerId, id);
  switch (type) {
    case 'profile':
      return {
        ...b,
        displayName: 'Demo planner',
        timeZone: 'America/Toronto',
        weekStartsOn: 1,
        theme: 'system',
        dayStart: '06:00',
        dayEnd: '19:00',
        dailyCapacityMin: 480,
        defaultReminderOffsetMin: 10,
        onboardingCompletedAt: null,
      };
    case 'categories':
      return { ...b, name: 'Health', color: 'moss', icon: 'heart', sortOrder: 1, archived: false };
    case 'tasks':
      return {
        ...b,
        title: 'Synthetic task',
        notes: null,
        status: 'open',
        priority: 2,
        categoryId: null,
        goalId: null,
        milestoneId: null,
        parentTaskId: null,
        date: '2026-11-09',
        startTime: '09:30',
        durationMin: 30,
        sortOrder: 0,
        completedAt: null,
        recurrenceRuleId: null,
      };
    case 'recurrenceRules':
      return {
        ...b,
        seriesType: 'task',
        seriesId: 'task-1',
        freq: 'weekly',
        interval: 2,
        byWeekday: [1, 3],
        byMonthDay: null,
        weekStartsOn: 1,
        startDate: '2026-11-09',
        endType: 'never',
        endDate: null,
        count: null,
      };
    case 'occurrences':
      return {
        ...b,
        id: 'task-1_20261109',
        seriesType: 'task',
        seriesId: 'task-1',
        ruleId: 'rule-1',
        originalDate: '2026-11-09',
        date: '2026-11-10',
        startTime: null,
        durationMin: null,
        title: null,
        notes: null,
        status: 'done',
        completedAt: ISO,
        completedStepIds: ['sub-1'],
        isException: true,
      };
    case 'reminders':
      return {
        ...b,
        targetType: 'task',
        targetId: 'task-1',
        kind: 'relative',
        offsetMin: 10,
        atTime: null,
        enabled: true,
      };
    case 'goals':
      return {
        ...b,
        title: 'Run a 10 km race',
        description: null,
        targetDate: '2026-12-20',
        status: 'active',
        color: 'moss',
        progressMode: 'tasks',
        manualProgress: 0,
        achievedAt: null,
        period: 'once',
        startDate: '2026-11-01',
        reminders: { ...DEFAULT_GOAL_REMINDERS, beforeDue: [0, 7], eachStep: true },
        history: [],
      };
    case 'milestones':
      return { ...b, goalId: 'goal-1', title: 'Run 5 km', dueDate: null, completedAt: null, sortOrder: 0 };
    case 'routines':
      return {
        ...b,
        title: 'Morning start',
        partOfDay: 'morning',
        startTime: '07:00',
        steps: [{ id: 's1', title: 'Stretch', durationMin: 10 }],
        categoryId: null,
        active: true,
        recurrenceRuleId: 'rule-2',
      };
  }
}

/** Document as the app writes it: mapped fields + server timestamp. */
function docData(type: EntityType, ownerId: string, id: string, patch: Record<string, unknown> = {}) {
  return { ...toRemote(type, { ...entity(type, ownerId, id), ...patch }), updatedAt: serverTimestamp() };
}

const COLLECTIONS = [
  'categories',
  'tasks',
  'recurrenceRules',
  'occurrences',
  'reminders',
  'goals',
  'milestones',
  'routines',
] as const;
const idFor = (type: EntityType) => (type === 'occurrences' ? 'task-1_20261109' : `${type}-1`);
const path = (uid: string, type: EntityType) =>
  type === 'profile' ? `users/${uid}` : `users/${uid}/${type}/${idFor(type)}`;

async function seed(uid: string, type: EntityType, patch: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const id = type === 'profile' ? uid : idFor(type);
    await setDoc(doc(ctx.firestore(), path(uid, type)), {
      ...toRemote(type, { ...entity(type, uid, id), ...patch }),
      updatedAt: Timestamp.now(),
    });
  });
}

describe('owner access', () => {
  it.each(COLLECTIONS)('lets the owner create, read, list, update and delete %s', async (type) => {
    const db = alice();
    const ref = doc(db, path('alice', type));
    await assertSucceeds(setDoc(ref, docData(type, 'alice', idFor(type))));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(collection(db, `users/alice/${type}`)));
    await assertSucceeds(
      setDoc(ref, docData(type, 'alice', idFor(type), { clientUpdatedAt: '2026-11-09T11:00:00.000Z' })),
    );
    await assertSucceeds(deleteDoc(ref));
  });

  it('lets the owner write and read their profile document', async () => {
    const ref = doc(alice(), 'users/alice');
    await assertSucceeds(setDoc(ref, docData('profile', 'alice', 'alice')));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(setDoc(ref, docData('profile', 'alice', 'alice', { theme: 'dark' })));
  });

  it('accepts a partial update that keeps the document valid', async () => {
    await seed('alice', 'tasks');
    await assertSucceeds(
      updateDoc(doc(alice(), path('alice', 'tasks')), { title: 'Renamed', updatedAt: serverTimestamp() }),
    );
  });

  it('accepts writing a tombstone and updating a tombstone that stays deleted', async () => {
    await seed('alice', 'tasks');
    const ref = doc(alice(), path('alice', 'tasks'));
    await assertSucceeds(setDoc(ref, docData('tasks', 'alice', 'tasks-1', { deleted: true })));
    await assertSucceeds(setDoc(ref, docData('tasks', 'alice', 'tasks-1', { deleted: true, title: 'x' })));
  });
});

describe('cross-user and anonymous access is denied', () => {
  it.each(COLLECTIONS)('denies bob every operation on alice’s %s', async (type) => {
    await seed('alice', type);
    const db = bob();
    await assertFails(getDoc(doc(db, path('alice', type))));
    await assertFails(getDocs(collection(db, `users/alice/${type}`)));
    await assertFails(setDoc(doc(db, path('alice', type)), docData(type, 'alice', idFor(type))));
    await assertFails(setDoc(doc(db, path('alice', type)), docData(type, 'bob', idFor(type))));
    await assertFails(updateDoc(doc(db, path('alice', type)), { deleted: true, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, path('alice', type))));
  });

  it('denies bob reading or writing alice’s profile, and creating new documents under alice', async () => {
    await seed('alice', 'profile');
    await assertFails(getDoc(doc(bob(), 'users/alice')));
    await assertFails(setDoc(doc(bob(), 'users/alice'), docData('profile', 'bob', 'alice')));
    await assertFails(deleteDoc(doc(bob(), 'users/alice')));
    await assertFails(setDoc(doc(bob(), 'users/alice/tasks/new-1'), docData('tasks', 'bob', 'new-1')));
  });

  it('denies unauthenticated reads, lists and writes', async () => {
    await seed('alice', 'tasks');
    const db = anon();
    await assertFails(getDoc(doc(db, path('alice', 'tasks'))));
    await assertFails(getDocs(collection(db, 'users/alice/tasks')));
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t3'), docData('tasks', 'alice', 't3')));
    await assertFails(getDoc(doc(db, 'users/alice')));
  });
});

describe('write validation', () => {
  const ref = (type: EntityType = 'tasks') => doc(alice(), path('alice', type));

  it('denies a spoofed ownerId', async () => {
    await assertFails(setDoc(ref(), docData('tasks', 'bob', 'tasks-1')));
  });

  it('denies a document whose id field does not match its path', async () => {
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'other')));
  });

  it('denies a client-supplied updatedAt', async () => {
    await assertFails(setDoc(ref(), { ...docData('tasks', 'alice', 'tasks-1'), updatedAt: Timestamp.fromMillis(0) }));
  });

  it('denies unknown and missing fields', async () => {
    await assertFails(setDoc(ref(), { ...docData('tasks', 'alice', 'tasks-1'), isAdmin: true }));
    const { notes: _n, ...missing } = docData('tasks', 'alice', 'tasks-1') as Record<string, unknown>;
    await assertFails(setDoc(ref(), missing));
  });

  it('denies oversized and empty text', async () => {
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { title: 'x'.repeat(201) })));
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { title: '' })));
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { notes: 'x'.repeat(5001) })));
    await assertFails(setDoc(ref('goals'), docData('goals', 'alice', 'goals-1', { title: 'x'.repeat(121) })));
  });

  it('denies wrong types and out-of-range values', async () => {
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { status: 'archived' })));
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { priority: 4 })));
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { date: '09/11/2026' })));
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { startTime: '25:00' })));
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { deleted: 'no' })));
    const rule = ref('recurrenceRules');
    await assertFails(setDoc(rule, docData('recurrenceRules', 'alice', 'recurrenceRules-1', { interval: 100 })));
    await assertFails(setDoc(rule, docData('recurrenceRules', 'alice', 'recurrenceRules-1', { byWeekday: [1, 7] })));
    await assertFails(setDoc(rule, docData('recurrenceRules', 'alice', 'recurrenceRules-1', { count: 1000 })));
    const steps = Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, title: 'Step' }));
    await assertFails(setDoc(ref('routines'), docData('routines', 'alice', 'routines-1', { steps })));
    await assertFails(setDoc(ref('categories'), docData('categories', 'alice', 'categories-1', { color: '#ff0000' })));
    await assertFails(setDoc(ref('categories'), docData('categories', 'alice', 'categories-1', { name: ' Work' })));
    await assertFails(setDoc(ref('categories'), docData('categories', 'alice', 'categories-1', { name: 'Work ' })));
    await assertFails(
      setDoc(ref('categories'), docData('categories', 'alice', 'categories-1', { name: 'x'.repeat(41) })),
    );
  });

  it('accepts free-text category names typed by the user', async () => {
    await assertSucceeds(
      setDoc(ref('categories'), docData('categories', 'alice', 'categories-1', { name: 'Été project 2' })),
    );
  });

  describe('goals: period, due date, reminders and history', () => {
    const goal = (patch: Record<string, unknown>) => setDoc(ref('goals'), docData('goals', 'alice', 'goals-1', patch));
    const weekly = { period: 'weekly', startDate: '2026-11-02', targetDate: null };
    const entry = { start: '2026-11-02', end: '2026-11-08', percent: 50, done: 1, total: 2 };

    it('accepts one-time and periodic goals with reminders and history', async () => {
      await assertSucceeds(goal({}));
      await assertSucceeds(goal({ ...weekly, history: [entry] }));
      await assertSucceeds(
        goal({ ...weekly, reminders: { ...DEFAULT_GOAL_REMINDERS, monthlyDay: 31, periodic: true } }),
      );
    });

    it('denies a bad period, a periodic goal without start or with a stored due date, due before start', async () => {
      await assertFails(goal({ period: 'hourly' }));
      await assertFails(goal({ ...weekly, startDate: null }));
      await assertFails(goal({ ...weekly, targetDate: '2026-12-01' }));
      await assertFails(goal({ startDate: '2026-12-31', targetDate: '2026-12-20' }));
      await assertFails(goal({ targetDate: '20/12/2026' }));
    });

    it('denies malformed reminder settings', async () => {
      const r = (patch: Record<string, unknown>) => goal({ reminders: { ...DEFAULT_GOAL_REMINDERS, ...patch } });
      await assertFails(r({ beforeDue: [2] }));
      await assertFails(r({ beforeDue: [0, 1, 7, 0] }));
      await assertFails(r({ beforeDueTime: '9:00' }));
      await assertFails(r({ monthlyDay: 32 }));
      await assertFails(r({ periodicWeekday: 7 }));
      await assertFails(r({ eachStep: 'yes' }));
      await assertFails(r({ extra: true }));
      await assertFails(goal({ reminders: null }));
    });

    it('denies a malformed or oversized history', async () => {
      await assertFails(goal({ ...weekly, history: [{ ...entry, percent: 101 }] }));
      await assertFails(goal({ ...weekly, history: [{ ...entry, done: 3, total: 2 }] }));
      await assertFails(goal({ ...weekly, history: [{ ...entry, end: '2026-11-01' }] }));
      await assertFails(goal({ ...weekly, history: [{ ...entry, note: 'x' }] }));
      await assertFails(goal({ ...weekly, history: Array.from({ length: 61 }, () => entry) }));
      await assertFails(goal({ ...weekly, history: 'none' }));
    });

    it('denies bob creating or editing a goal under alice', async () => {
      await seed('alice', 'goals');
      await assertFails(
        setDoc(doc(bob(), path('alice', 'goals')), docData('goals', 'alice', 'goals-1', { title: 'Hijacked' })),
      );
      await assertFails(
        updateDoc(doc(bob(), path('alice', 'goals')), { history: [entry], updatedAt: serverTimestamp() }),
      );
    });
  });

  it('denies an occurrence whose ID is not seriesId_YYYYMMDD of its original date', async () => {
    const bad = doc(alice(), 'users/alice/occurrences/task-1_20261110');
    await assertFails(setDoc(bad, docData('occurrences', 'alice', 'task-1_20261110')));
  });

  it('denies changing ownerId on update', async () => {
    await seed('alice', 'tasks');
    await assertFails(updateDoc(ref(), { ownerId: 'bob', updatedAt: serverTimestamp() }));
  });

  it('denies resurrecting a tombstone (sticky deletes)', async () => {
    await seed('alice', 'tasks', { deleted: true });
    await assertFails(setDoc(ref(), docData('tasks', 'alice', 'tasks-1', { deleted: false })));
    await assertFails(updateDoc(ref(), { deleted: false, updatedAt: serverTimestamp() }));
  });

  it('denies unknown collections, nested paths and paths outside users/{uid}', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/secrets/s1'), docData('tasks', 'alice', 's1')));
    await assertFails(getDocs(collection(alice(), 'users/alice/secrets')));
    await assertFails(setDoc(doc(alice(), 'public/p1'), docData('tasks', 'alice', 'p1')));
    await assertFails(setDoc(doc(alice(), 'users/alice/tasks/t1/sub/x'), docData('tasks', 'alice', 'x')));
  });
});
