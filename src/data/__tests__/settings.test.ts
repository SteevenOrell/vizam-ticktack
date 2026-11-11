import { context, count, freshDb } from '../../../tests/support/db';
import type { SqlDriver } from '../db/driver';
import { ensureProfile, getProfile } from '../profile';
import { createRoutine, emptyRoutineDraft } from '../routines';
import {
  addCategory,
  clampCapacity,
  deleteCategory,
  discardFailedItem,
  getPlanningSettings,
  listCategoryUsage,
  listFailedSync,
  retryFailedItem,
  setDailyCapacity,
  setWeekStart,
  updateCategory,
} from '../settings';
import { getEntity, mutate, writeEntity } from '../store';
import { createTask, emptyDraft } from '../tasks';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

async function routineIn(ctx: ReturnType<typeof context>, title: string, categoryId: string) {
  const r = await createRoutine(ctx, {
    ...emptyRoutineDraft(1),
    title,
    steps: [{ title: 'Step', durationMin: 2 }],
  });
  await mutate(ctx, () => writeEntity(ctx, 'routines', { ...r, categoryId }));
  return r;
}

const defaults = { timeZone: 'UTC', weekStartsOn: 0 as const };

describe('planning settings', () => {
  it('has no week start until the profile exists, then follows what is saved', async () => {
    const ctx = context(db);
    expect((await getPlanningSettings(db, 'local')).weekStartsOn).toBeNull();
    await ensureProfile(ctx, defaults);
    expect(await getPlanningSettings(db, 'local')).toEqual({ weekStartsOn: 0, dailyCapacityMin: 480 });
    await setWeekStart(ctx, 1);
    await setDailyCapacity(ctx, 390);
    expect(await getPlanningSettings(db, 'local')).toEqual({ weekStartsOn: 1, dailyCapacityMin: 390 });
    // Queued for sync like any profile change.
    expect(await count(db, "SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'profile'")).toBe(1);
  });

  it('keeps capacity inside 0-1440 minutes', async () => {
    const ctx = context(db);
    await ensureProfile(ctx, defaults);
    await setDailyCapacity(ctx, 99999);
    expect((await getProfile(ctx))?.dailyCapacityMin).toBe(1440);
    await setDailyCapacity(ctx, -5);
    expect((await getProfile(ctx))?.dailyCapacityMin).toBe(0);
    expect(clampCapacity(Number.NaN)).toBe(480);
  });

  it('does not read another account’s settings', async () => {
    await ensureProfile(context(db), defaults);
    await setWeekStart(context(db), 1);
    expect((await getPlanningSettings(db, 'someone-else')).weekStartsOn).toBeNull();
  });
});

describe('categories manager', () => {
  it('adds, renames and recolours; rejects empty and duplicate names', async () => {
    const ctx = context(db);
    const work = await addCategory(ctx, '  Deep   work ');
    expect(work.name).toBe('Deep work');
    await expect(addCategory(ctx, 'deep WORK')).rejects.toMatchObject({ problem: 'duplicate' });
    await expect(addCategory(ctx, '   ')).rejects.toMatchObject({ problem: 'empty' });
    const home = await addCategory(ctx, 'Home', 'sky');
    expect(home.color).toBe('sky');
    await expect(updateCategory(ctx, home.id, { name: 'DEEP work' })).rejects.toMatchObject({ problem: 'duplicate' });
    const renamed = await updateCategory(ctx, home.id, { name: 'House', color: 'rose' });
    expect(renamed).toMatchObject({ name: 'House', color: 'rose' });
    // Renaming to its own name in another case is allowed.
    expect(await updateCategory(ctx, home.id, { name: 'HOUSE' })).toMatchObject({ name: 'HOUSE' });
    expect(await updateCategory(ctx, 'missing', { name: 'x' })).toBeNull();
  });

  it('counts what uses a category', async () => {
    const ctx = context(db);
    const cat = await addCategory(ctx, 'Health');
    await createTask(ctx, { ...emptyDraft('2026-11-09'), title: 'Run', categoryName: 'Health' });
    await routineIn(ctx, 'Morning', cat.id);
    expect((await listCategoryUsage(db, 'local')).map((u) => [u.category.name, u.usedBy])).toEqual([['Health', 2]]);
    expect(await listCategoryUsage(db, 'other')).toEqual([]);
  });

  it('deletes with reassignment to another category', async () => {
    const ctx = context(db);
    const a = await addCategory(ctx, 'A');
    const b = await addCategory(ctx, 'B');
    const task = await createTask(ctx, { ...emptyDraft('2026-11-09'), title: 'T', categoryName: 'A' });
    expect(await deleteCategory(ctx, a.id, b.id)).toEqual({ moved: 1 });
    expect((await getEntity(db, 'tasks', task.id, 'local'))?.categoryId).toBe(b.id);
    expect(await getEntity(db, 'categories', a.id, 'local')).toBeNull();
    expect((await listCategoryUsage(db, 'local')).map((u) => u.category.name)).toEqual(['B']);
  });

  it('deletes with "none": items lose their category', async () => {
    const ctx = context(db);
    const a = await addCategory(ctx, 'A');
    const routine = await routineIn(ctx, 'R', a.id);
    expect(await deleteCategory(ctx, a.id, null)).toEqual({ moved: 1 });
    expect((await getEntity(db, 'routines', routine.id, 'local'))?.categoryId).toBeNull();
  });

  it('refuses a missing or self reassignment target and unknown ids', async () => {
    const ctx = context(db);
    const a = await addCategory(ctx, 'A');
    await expect(deleteCategory(ctx, a.id, a.id)).rejects.toThrow();
    await expect(deleteCategory(ctx, a.id, 'nope')).rejects.toThrow();
    expect(await getEntity(db, 'categories', a.id, 'local')).not.toBeNull();
    expect(await deleteCategory(ctx, 'unknown', null)).toBe(false);
  });
});

describe('failed sync list', () => {
  async function failOne(title: string) {
    const ctx = context(db);
    const task = await createTask(ctx, { ...emptyDraft('2026-11-09'), title });
    await db.run(
      `UPDATE outbox SET state = 'failed', attempts = 3, last_error = 'permission-denied' WHERE entity_id = ?`,
      [task.id],
    );
    return task;
  }

  it('lists failed entries with entity, title and error, for the owner only', async () => {
    const task = await failOne('Buy milk');
    await createTask(context(db), { ...emptyDraft('2026-11-09'), title: 'Still pending' });
    const items = await listFailedSync(db, 'local');
    expect(items).toEqual([
      {
        entityType: 'tasks',
        entityId: task.id,
        op: 'upsert',
        attempts: 3,
        error: 'permission-denied',
        label: 'Buy milk',
      },
    ]);
    expect(await listFailedSync(db, 'other')).toEqual([]);
  });

  it('retry puts one item back in the queue', async () => {
    const task = await failOne('Buy milk');
    await retryFailedItem(db, 'tasks', task.id, 5000);
    expect(await listFailedSync(db, 'local')).toEqual([]);
    expect(
      await db.first(
        "SELECT state, attempts, next_attempt_at, last_error FROM outbox WHERE entity_id = '" + task.id + "'",
      ),
    ).toEqual({ state: 'pending', attempts: 0, next_attempt_at: 5000, last_error: null });
  });

  it('discard drops the queue entry, keeps the item and clears its upload flag', async () => {
    const task = await failOne('Buy milk');
    await discardFailedItem(db, 'tasks', task.id);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM outbox')).toBe(0);
    expect(await getEntity(db, 'tasks', task.id, 'local')).toMatchObject({ title: 'Buy milk' });
    expect(await db.first('SELECT dirty FROM tasks WHERE id = ?', [task.id])).toEqual({ dirty: 0 });
  });

  it('discard leaves a pending entry alone', async () => {
    const task = await createTask(context(db), { ...emptyDraft('2026-11-09'), title: 'Pending' });
    await discardFailedItem(db, 'tasks', task.id);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM outbox')).toBe(1);
    expect(await db.first('SELECT dirty FROM tasks WHERE id = ?', [task.id])).toEqual({ dirty: 1 });
  });
});
