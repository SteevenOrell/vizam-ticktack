import { ZodError } from 'zod';

import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { DEFAULT_GOAL_REMINDERS } from '../../domain/models';
import { occurrenceId } from '../../domain/recurrence/generator';
import type { SqlDriver } from '../db/driver';
import {
  createGoal,
  deleteGoal,
  getGoalDetail,
  getGoalList,
  getLinkableTasks,
  goalLeftEmptyBy,
  GoalNeedsTaskError,
  linkTasks,
  loadGoalForm,
  rollGoalHistory,
  setGoalDone,
  unlinkTask,
  updateGoal,
  type GoalDraft,
} from '../goals';
import { getEntity } from '../store';
import { createTask, deleteTask, emptyDraft, setDone, type TaskDraft } from '../tasks';

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
