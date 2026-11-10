import { randomUUID } from 'crypto';

import { ZodError } from 'zod';

import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { DEFAULT_GOAL_REMINDERS } from '../../domain/models';
import { occurrenceId } from '../../domain/recurrence/generator';
import type { SqlDriver } from '../db/driver';
import { buildDemoData, insertDemoData } from '../seed/demoData';
import {
  createGoal,
  deleteGoal,
  enforceGoalRepeats,
  getGoalDetail,
  getGoalList,
  getGoalOptions,
  getLinkableTasks,
  goalLeftEmptyBy,
  GoalNeedsTaskError,
  GoalRepeatError,
  linkTasks,
  loadGoalForm,
  rollGoalHistory,
  setGoalDone,
  unlinkTask,
  updateGoal,
  type GoalDraft,
} from '../goals';
import { getEntity } from '../store';
import { createTask, deleteTask, emptyDraft, setDone, updateTask, type TaskDraft } from '../tasks';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const task = (over: Partial<TaskDraft> = {}): TaskDraft => ({ ...emptyDraft(TODAY), title: 'Task', ...over });
const goal = (over: Partial<GoalDraft> = {}): GoalDraft => ({
  title: 'Run a 10K',
  description: null,
  period: 'once',
  startDate: null,
  dueDate: '2026-11-21',
  color: null,
  reminders: DEFAULT_GOAL_REMINDERS,
  linkTaskIds: [],
  newTasks: [],
  ...over,
});

describe('at least one task', () => {
  it('refuses a goal without linked or new tasks (validation names the rule)', async () => {
    const error = await createGoal(context(db), goal()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((i) => i.message)).toContain('needsTask');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM goals')).toBe(0);
  });

  it('creates a goal with linked and new tasks in one transaction', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'Existing' }));
    const g = await createGoal(
      ctx,
      goal({ linkTaskIds: [a.id], newTasks: [{ title: 'New one', date: TODAY, startTime: '07:00', durationMin: 30 }] }),
    );
    expect(await count(db, 'SELECT COUNT(*) AS n FROM tasks WHERE goal_id = ?', [g.id])).toBe(2);
    const created = await db.first<{ start_time: string; duration_min: number }>(
      "SELECT start_time, duration_min FROM tasks WHERE title = 'New one'",
    );
    expect(created).toEqual({ start_time: '07:00', duration_min: 30 });
    // Goal and tasks are queued for sync through the outbox.
    expect(await count(db, "SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'goals'")).toBe(1);
  });

  it('rolls everything back when a linked task does not exist', async () => {
    await expect(createGoal(context(db), goal({ linkTaskIds: ['missing'] }))).rejects.toThrow('Task not found');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM goals')).toBe(0);
  });

  it('requires a due date for a one-time goal and a start for a periodic one', async () => {
    const ctx = context(db);
    const t = await createTask(ctx, task());
    const err = (d: GoalDraft) => createGoal(ctx, d).catch((e: ZodError) => e.issues.map((i) => i.message));
    expect(await err(goal({ dueDate: null, linkTaskIds: [t.id] }))).toEqual(['dueRequired']);
    expect(await err(goal({ period: 'weekly', dueDate: null, linkTaskIds: [t.id] }))).toEqual(['startRequired']);
    expect(await err(goal({ startDate: '2026-11-30', linkTaskIds: [t.id] }))).toEqual(['dueBeforeStart']);
  });

  it('refuses to unlink the last task and refuses an edit that leaves none', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'A' }));
    const b = await createTask(ctx, task({ title: 'B' }));
    const g = await createGoal(ctx, goal({ linkTaskIds: [a.id, b.id] }));
    await unlinkTask(ctx, g.id, a.id);
    expect((await getEntity(db, 'tasks', a.id, 'local'))?.goalId).toBeNull();
    await expect(unlinkTask(ctx, g.id, b.id)).rejects.toBeInstanceOf(GoalNeedsTaskError);
    await expect(updateGoal(ctx, g.id, goal({ linkTaskIds: [] }))).rejects.toBeInstanceOf(ZodError);
    await expect(updateGoal(ctx, g.id, goal({ linkTaskIds: ['deleted-task'] }))).rejects.toThrow();
    expect((await getEntity(db, 'tasks', b.id, 'local'))?.goalId).toBe(g.id);
  });

  it('warns when a task delete would leave its goal empty', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'A' }));
    const b = await createTask(ctx, task({ title: 'B' }));
    const g = await createGoal(ctx, goal({ title: 'Read more', linkTaskIds: [a.id, b.id] }));
    expect(await goalLeftEmptyBy(db, 'local', a.id)).toBeNull();
    await deleteTask(ctx, { taskId: b.id });
    expect(await goalLeftEmptyBy(db, 'local', a.id)).toEqual({ id: g.id, title: 'Read more' });
    expect(await goalLeftEmptyBy(db, 'other-user', a.id)).toBeNull();
  });
});

describe('edit, link and delete', () => {
  it('edits fields, swaps linked tasks (unlinked tasks are kept) and adds new tasks', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'A' }));
    const b = await createTask(ctx, task({ title: 'B' }));
    const g = await createGoal(ctx, goal({ linkTaskIds: [a.id] }));
    const form = (await loadGoalForm(ctx, g.id))!;
    expect(form.draft.linkTaskIds).toEqual([a.id]);
    await updateGoal(ctx, g.id, {
      ...form.draft,
      title: 'Run a half',
      period: 'monthly',
      startDate: '2026-11-01',
      dueDate: null,
      linkTaskIds: [b.id],
      newTasks: [{ title: 'C', date: null, startTime: null, durationMin: null }],
      reminders: { ...DEFAULT_GOAL_REMINDERS, beforeDue: [7, 0] },
    });
    const saved = (await getEntity(db, 'goals', g.id, 'local'))!;
    expect(saved).toMatchObject({ title: 'Run a half', period: 'monthly', startDate: '2026-11-01', targetDate: null });
    expect(saved.reminders.beforeDue).toEqual([0, 7]);
    expect((await getEntity(db, 'tasks', a.id, 'local'))?.goalId).toBeNull();
    expect(await count(db, 'SELECT COUNT(*) AS n FROM tasks WHERE goal_id = ? AND deleted = 0', [g.id])).toBe(2);
    await linkTasks(ctx, g.id, [a.id]);
    expect((await getEntity(db, 'tasks', a.id, 'local'))?.goalId).toBe(g.id);
  });

  it('delete keeps and unlinks the tasks, tombstones the goal and its reminders', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'A' }));
    const g = await createGoal(ctx, goal({ linkTaskIds: [a.id] }));
    await deleteGoal(ctx, g.id);
    expect(await getEntity(db, 'goals', g.id, 'local')).toBeNull();
    expect(await count(db, 'SELECT COUNT(*) AS n FROM goals WHERE id = ? AND deleted = 1', [g.id])).toBe(1);
    const kept = await getEntity(db, 'tasks', a.id, 'local');
    expect(kept).toMatchObject({ title: 'A', goalId: null, deleted: false });
    expect(await count(db, "SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'goals' AND op = 'delete'")).toBe(1);
    expect(await getGoalList(db, 'local', TODAY)).toEqual([]);
  });

  it('mark done moves the goal to Completed; undo makes it active again', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task());
    const g = await createGoal(ctx, goal({ linkTaskIds: [a.id] }));
    await setGoalDone(ctx, g.id, true);
    expect((await getGoalList(db, 'local', TODAY))[0]?.section).toBe('completed');
    await setGoalDone(ctx, g.id, false);
    expect((await getGoalList(db, 'local', TODAY))[0]?.section).toBe('active');
  });

  it('another owner cannot read or edit the goal', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task());
    const g = await createGoal(ctx, goal({ linkTaskIds: [a.id] }));
    expect(await getGoalDetail(db, 'intruder', g.id, TODAY)).toBeNull();
    await expect(updateGoal(context(db, 'intruder'), g.id, goal({ linkTaskIds: [a.id] }))).rejects.toThrow();
    expect(await getGoalList(db, 'intruder', TODAY)).toEqual([]);
  });
});

describe('read models', () => {
  it('list: percentage, countdown and sections (overdue first)', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'A' }));
    const b = await createTask(ctx, task({ title: 'B' }));
    await setDone(ctx, { taskId: a.id }, true);
    await createGoal(ctx, goal({ title: 'Half done', linkTaskIds: [a.id, b.id] }));
    const c = await createTask(ctx, task({ title: 'C' }));
    await createGoal(ctx, goal({ title: 'Late', startDate: '2026-11-01', dueDate: '2026-11-05', linkTaskIds: [c.id] }));
    const list = await getGoalList(db, 'local', TODAY);
    expect(list.map((g) => [g.title, g.section, g.progress.percent, g.daysLeft])).toEqual([
      ['Late', 'overdue', 0, -4],
      ['Half done', 'active', 50, 12],
    ]);
  });

  it('detail: recurring linked task counts occurrences in the current period and shows its next occurrence', async () => {
    const ctx = context(db);
    // Daily series from Monday 9 Nov; weekly goal starting that Monday -> 7 occurrences this week.
    const series = await createTask(
      ctx,
      task({
        title: 'Stretch',
        startTime: '07:00',
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
      }),
    );
    await setDone(ctx, { taskId: series.id, occurrenceId: occurrenceId(series.id, TODAY) }, true);
    const g = await createGoal(
      ctx,
      goal({ period: 'weekly', startDate: TODAY, dueDate: null, linkTaskIds: [series.id] }),
    );
    const detail = (await getGoalDetail(db, 'local', g.id, TODAY))!;
    expect(detail.summary.progress).toEqual({ done: 1, total: 7, percent: 14 });
    expect(detail.summary.due).toBe('2026-11-15');
    expect(detail.items).toHaveLength(1);
    // Today's occurrence is done, so the row shows the next open one.
    expect(detail.items[0]?.occurrenceId).toBe(occurrenceId(series.id, '2026-11-10'));
  });

  it('linkable tasks: search, top-level only, current goal shown', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'Buy running shoes', subtasks: [{ title: 'Sub', done: false }] }));
    await createTask(ctx, task({ title: 'Call the bank' }));
    await createGoal(ctx, goal({ title: 'Run', linkTaskIds: [a.id] }));
    const found = await getLinkableTasks(db, 'local', 'RUNNING');
    expect(found.map((t) => [t.title, t.goal_title])).toEqual([['Buy running shoes', 'Run']]);
    expect((await getLinkableTasks(db, 'local')).map((t) => t.title).sort()).toEqual([
      'Buy running shoes',
      'Call the bank',
    ]);
  });
});

describe('period history', () => {
  it('records ended periods once, then progress restarts for the new period', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ title: 'Tidy desk', date: '2026-10-27' }));
    await setDone(ctx, { taskId: a.id }, true);
    const b = await createTask(ctx, task({ title: 'Laundry', date: '2026-11-10' }));
    const g = await createGoal(
      ctx,
      goal({ period: 'weekly', startDate: '2026-10-26', dueDate: null, linkTaskIds: [a.id, b.id] }),
    );
    expect(await rollGoalHistory(ctx, TODAY)).toBe(1);
    const saved = (await getEntity(db, 'goals', g.id, 'local'))!;
    expect(saved.history).toEqual([
      { start: '2026-10-26', end: '2026-11-01', percent: 100, done: 1, total: 1 },
      { start: '2026-11-02', end: '2026-11-08', percent: 0, done: 0, total: 0 },
    ]);
    // Idempotent: nothing new until the next period ends.
    expect(await rollGoalHistory(ctx, TODAY)).toBe(0);
    expect(
      await rollGoalHistory(
        context(db, 'local', () => NOW),
        '2026-11-16',
      ),
    ).toBe(1);
    const detail = (await getGoalDetail(db, 'local', g.id, '2026-11-16'))!;
    expect(detail.history[0]).toMatchObject({ start: '2026-11-09', end: '2026-11-15', percent: 0, total: 1 });
    expect(detail.summary.progress.total).toBe(0);
  });
});

describe('repeating tasks in a goal must end', () => {
  const never: NonNullable<TaskDraft['repeat']> = {
    freq: 'daily',
    interval: 1,
    byWeekday: null,
    byMonthDay: null,
    weekStartsOn: 1,
    endType: 'never',
    endDate: null,
    count: null,
  };
  const until = (endDate: string): NonNullable<TaskDraft['repeat']> => ({ ...never, endType: 'onDate', endDate });
  const ruleOf = (seriesId: string) =>
    db.first<{ end_type: string; end_date: string | null; count: number | null }>(
      'SELECT end_type, end_date, count FROM recurrence_rules WHERE series_id = ? AND deleted = 0',
      [seriesId],
    );
  /** A goal due 21 Nov with one plain task. */
  async function goalWithTask(over: Partial<GoalDraft> = {}) {
    const ctx = context(db);
    const plain = await createTask(ctx, task({ title: 'Plain' }));
    return createGoal(ctx, goal({ linkTaskIds: [plain.id], ...over }));
  }

  it('task editor path: refuses "never" and an end after the due date, accepts an end by the due date', async () => {
    const ctx = context(db);
    const g = await goalWithTask();
    const before = await count(db, 'SELECT COUNT(*) AS n FROM tasks');

    const zod = await createTask(ctx, task({ goalId: g.id, repeat: never })).catch((e: unknown) => e);
    expect(zod).toBeInstanceOf(ZodError);
    expect((zod as ZodError).issues.map((i) => i.message)).toContain('repeatNeverInGoal');

    const late = await createTask(ctx, task({ goalId: g.id, repeat: until('2026-11-22') })).catch((e: unknown) => e);
    expect(late).toBeInstanceOf(GoalRepeatError);
    expect((late as GoalRepeatError).issue).toBe('repeatAfterGoalEnd');
    const counted = await createTask(
      ctx,
      task({ goalId: g.id, repeat: { ...never, endType: 'afterCount', count: 14 } }),
    ).catch((e: unknown) => e);
    expect((counted as GoalRepeatError).issue).toBe('repeatAfterGoalEnd');
    // Refused saves leave nothing behind.
    expect(await count(db, 'SELECT COUNT(*) AS n FROM tasks')).toBe(before);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM recurrence_rules')).toBe(0);

    const ok = await createTask(ctx, task({ goalId: g.id, repeat: until('2026-11-21') }));
    expect(await ruleOf(ok.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-21' });
    await createTask(ctx, task({ goalId: g.id, repeat: { ...never, endType: 'afterCount', count: 13 } }));
  });

  it('a goal created by name from the task editor (no due date) still needs an end', async () => {
    const ctx = context(db);
    const zod = await createTask(ctx, task({ newGoalTitle: 'Read more', repeat: never })).catch((e: unknown) => e);
    expect((zod as ZodError).issues.map((i) => i.message)).toContain('repeatNeverInGoal');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM goals')).toBe(0);
    const ok = await createTask(ctx, task({ newGoalTitle: 'Read more', repeat: until('2027-06-30') }));
    expect(ok.goalId).toBeTruthy();
  });

  it('editing a linked series: "never" and a later end are refused, also when the goal is left untouched', async () => {
    const ctx = context(db);
    const g = await goalWithTask();
    const series = await createTask(ctx, task({ title: 'Stretch', goalId: g.id, repeat: until('2026-11-15') }));
    // `goalId: undefined` keeps the stored link (quick edit and "all occurrences" edits).
    const draft = (repeat: TaskDraft['repeat']): TaskDraft => ({
      ...task({ title: 'Stretch', repeat }),
      goalId: undefined,
    });
    await expect(updateTask(ctx, series.id, draft(never))).rejects.toMatchObject({ issue: 'repeatNeverInGoal' });
    await expect(updateTask(ctx, series.id, draft(until('2026-12-01')))).rejects.toMatchObject({
      issue: 'repeatAfterGoalEnd',
    });
    expect(await ruleOf(series.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-15' });
    await updateTask(ctx, series.id, draft(until('2026-11-21')));
    expect(await ruleOf(series.id)).toMatchObject({ end_date: '2026-11-21' });
  });

  it('picking a goal in the task editor for a task that repeats forever is refused until it has an end', async () => {
    const ctx = context(db);
    const g = await goalWithTask();
    const series = await createTask(ctx, task({ title: 'Free', repeat: never }));
    const linked = (repeat: TaskDraft['repeat']) => task({ title: 'Free', goalId: g.id, repeat });
    await expect(updateTask(ctx, series.id, linked(never))).rejects.toBeInstanceOf(ZodError);
    // A one-off task turned into a series while linked.
    const one = await createTask(ctx, task({ title: 'One', goalId: g.id }));
    await expect(updateTask(ctx, one.id, linked(until('2026-11-30')))).rejects.toBeInstanceOf(GoalRepeatError);
    await updateTask(ctx, series.id, linked(until('2026-11-21')));
    expect((await getEntity(db, 'tasks', series.id, 'local'))?.goalId).toBe(g.id);
  });

  it('linking a never-ending series ends it on the due date and drops later occurrences', async () => {
    const ctx = context(db);
    const g = await goalWithTask();
    const series = await createTask(ctx, task({ title: 'Stretch', repeat: never }));
    expect(
      await count(
        db,
        "SELECT COUNT(*) AS n FROM task_occurrences WHERE series_id = ? AND original_date > '2026-11-21'",
        [series.id],
      ),
    ).toBeGreaterThan(0);
    await linkTasks(ctx, g.id, [series.id]);
    expect(await ruleOf(series.id)).toEqual({ end_type: 'onDate', end_date: '2026-11-21', count: null });
    expect(
      await count(
        db,
        "SELECT COUNT(*) AS n FROM task_occurrences WHERE series_id = ? AND original_date > '2026-11-21'",
        [series.id],
      ),
    ).toBe(0);
    // Occurrences up to the end are still there, and the rule change is queued for sync.
    expect(
      await count(db, 'SELECT COUNT(*) AS n FROM task_occurrences WHERE series_id = ? AND original_date = ?', [
        series.id,
        '2026-11-21',
      ]),
    ).toBe(1);
    expect(await count(db, "SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'recurrenceRules'")).toBe(1);
    // 13 occurrences (9 .. 21 Nov) + the plain task.
    const [summary] = await getGoalList(db, 'local', TODAY);
    expect(summary?.progress).toEqual({ done: 0, total: 14, percent: 0 });
  });

  it('linking keeps an end that is already allowed, and clamps an "after n times" end that runs too long', async () => {
    const ctx = context(db);
    const short = await createTask(ctx, task({ title: 'Short', repeat: until('2026-11-12') }));
    const long = await createTask(ctx, task({ title: 'Long', repeat: { ...never, endType: 'afterCount', count: 60 } }));
    const fits = await createTask(ctx, task({ title: 'Fits', repeat: { ...never, endType: 'afterCount', count: 3 } }));
    await createGoal(ctx, goal({ linkTaskIds: [short.id, long.id, fits.id] }));
    expect(await ruleOf(short.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-12' });
    expect(await ruleOf(long.id)).toEqual({ end_type: 'onDate', end_date: '2026-11-21', count: null });
    expect(await ruleOf(fits.id)).toMatchObject({ end_type: 'afterCount', count: 3 });
  });

  it('periodic goal: a linked series ends with the current period', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, task({ title: 'Tidy', repeat: never }));
    const g = await createGoal(
      ctx,
      goal({ period: 'weekly', startDate: TODAY, dueDate: null, linkTaskIds: [series.id] }),
    );
    expect(await ruleOf(series.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-15' });
    expect((await getGoalDetail(db, 'local', g.id, TODAY))?.summary.progress.total).toBe(7);
    await expect(createTask(ctx, task({ goalId: g.id, repeat: until('2026-11-16') }))).rejects.toMatchObject({
      issue: 'repeatAfterGoalEnd',
    });
    // In a later period the limit has moved on: the old end is still valid, a new one may reach the new period end.
    const later = context(db, 'local', () => new Date(2026, 10, 17, 9, 0));
    expect(await enforceGoalRepeats(later)).toBe(0);
    await createTask(later, task({ date: '2026-11-17', goalId: g.id, repeat: until('2026-11-22') }));
  });

  it('moving the due date earlier (or changing the period) clamps linked series; a later date extends nothing', async () => {
    const ctx = context(db);
    const g = await goalWithTask();
    const series = await createTask(ctx, task({ title: 'Stretch', goalId: g.id, repeat: until('2026-11-21') }));
    const form = (await loadGoalForm(ctx, g.id))!;

    await updateGoal(ctx, g.id, { ...form.draft, dueDate: '2026-11-14' });
    expect(await ruleOf(series.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-14' });
    expect(
      await count(
        db,
        "SELECT COUNT(*) AS n FROM task_occurrences WHERE series_id = ? AND original_date > '2026-11-14'",
        [series.id],
      ),
    ).toBe(0);

    await updateGoal(ctx, g.id, { ...form.draft, dueDate: '2026-12-31' });
    expect(await ruleOf(series.id)).toMatchObject({ end_date: '2026-11-14' });

    await updateGoal(ctx, g.id, { ...form.draft, period: 'daily', startDate: TODAY, dueDate: null });
    expect(await ruleOf(series.id)).toMatchObject({ end_date: TODAY });
  });

  it('repair pass ends series linked before the rule existed, once', async () => {
    const ctx = context(db);
    const g = await goalWithTask();
    const open = await goalWithTask({ title: 'No due date' });
    await db.run('UPDATE goals SET target_date = NULL WHERE id = ?', [open.id]);
    const a = await createTask(ctx, task({ title: 'Old forever', repeat: never }));
    const b = await createTask(ctx, task({ title: 'Old too long', repeat: until('2027-01-01') }));
    const c = await createTask(ctx, task({ title: 'Old open-ended', repeat: never }));
    const free = await createTask(ctx, task({ title: 'Not in a goal', repeat: never }));
    // Written the way an older build (or another device) left them: linked without an end.
    await db.run('UPDATE tasks SET goal_id = ? WHERE id IN (?, ?)', [g.id, a.id, b.id]);
    await db.run('UPDATE tasks SET goal_id = ? WHERE id = ?', [open.id, c.id]);

    expect(await enforceGoalRepeats(ctx)).toBe(3);
    expect(await ruleOf(a.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-21' });
    expect(await ruleOf(b.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-11-21' });
    // No due date: a month from today.
    expect(await ruleOf(c.id)).toMatchObject({ end_type: 'onDate', end_date: '2026-12-09' });
    expect(await ruleOf(free.id)).toMatchObject({ end_type: 'never' });
    const outbox = await count(db, 'SELECT COUNT(*) AS n FROM outbox');
    expect(await enforceGoalRepeats(ctx)).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM outbox')).toBe(outbox);
  });

  it('goal options carry the end a linked repeat must respect', async () => {
    const ctx = context(db);
    const once = await goalWithTask();
    const weekly = await goalWithTask({ title: 'Weekly', period: 'weekly', startDate: TODAY, dueDate: null });
    const options = await getGoalOptions(db, 'local', TODAY);
    expect(options.find((o) => o.id === once.id)?.repeatEnd).toBe('2026-11-21');
    expect(options.find((o) => o.id === weekly.id)?.repeatEnd).toBe('2026-11-15');
    const named = await createTask(ctx, task({ newGoalTitle: 'By name' }));
    expect((await getGoalOptions(db, 'local', TODAY)).find((o) => o.id === named.goalId)?.repeatEnd).toBeNull();
  });

  it('demo data follows the rule: the race goal reads 6 of 12, not 1 of 37', async () => {
    await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID, language: 'en' }));
    expect(await enforceGoalRepeats(context(db))).toBe(0);
    const race = (await getGoalList(db, 'local', TODAY)).find((g) => g.title === 'Run a 10 km race');
    expect(race?.progress).toEqual({ done: 6, total: 12, percent: 50 });
    expect(
      await count(
        db,
        `SELECT COUNT(*) AS n FROM recurrence_rules r JOIN tasks t ON t.recurrence_rule_id = r.id
         WHERE t.goal_id IS NOT NULL AND r.end_type = 'never'`,
      ),
    ).toBe(0);
  });
});
