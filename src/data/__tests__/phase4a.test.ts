import { context, count, freshDb, TODAY } from '../../../tests/support/db';
import { addDays } from '../../domain/localDate';
import { DEFAULT_GOAL_REMINDERS } from '../../domain/models';
import { occurrenceId } from '../../domain/recurrence/generator';
import type { SqlDriver } from '../db/driver';
import { GoalRepeatError } from '../goalBase';
import { createGoal } from '../goals';
import { getAgenda, getHistory, getOverdue, getTaskDetail, HISTORY_DAYS } from '../queries/agenda';
import { createRoutine, emptyRoutineDraft, recordRoutineRun } from '../routines';
import { getEntity, mutate, writeEntity } from '../store';
import { createTask, emptyDraft, rescheduleTime, setDone, setSubtaskDone, updateTask, type TaskDraft } from '../tasks';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const draft = (patch: Partial<TaskDraft> = {}): TaskDraft => ({ ...emptyDraft(TODAY), title: 'Task', ...patch });
const daily = {
  freq: 'daily',
  interval: 1,
  byWeekday: null,
  byMonthDay: null,
  weekStartsOn: 1,
  endType: 'never',
  endDate: null,
  count: null,
} as const;
const at =
  (y: number, m: number, d: number, h = 12) =>
  () =>
    new Date(y, m - 1, d, h, 0);
const startOf = async (date: string, title = 'Stretch') =>
  (await getAgenda(db, 'local', date, date, TODAY)).find((i) => i.title === title)?.startTime;

describe('rescheduleTime (drag to a new start time)', () => {
  it('moves a one-off task and keeps everything else', async () => {
    const ctx = context(db);
    const t = await createTask(
      ctx,
      draft({ startTime: '09:00', durationMin: 45, notes: 'Bring the list', subtasks: [{ title: 'A', done: true }] }),
    );
    await rescheduleTime(ctx, { taskId: t.id }, '10:35');
    const saved = await getEntity(db, 'tasks', t.id, 'local');
    expect(saved).toMatchObject({ startTime: '10:35', durationMin: 45, notes: 'Bring the list', date: TODAY });
    const sub = await db.first<{ status: string }>('SELECT status FROM tasks WHERE parent_task_id = ?', [t.id]);
    expect(sub?.status).toBe('done');
    expect(await count(db, "SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND state = 'pending'", [t.id])).toBe(
      1,
    );
  });

  it('rejects a bad time, an undated task and another owner', async () => {
    const ctx = context(db);
    const t = await createTask(ctx, draft({ startTime: '09:00' }));
    await expect(rescheduleTime(ctx, { taskId: t.id }, '25:00')).rejects.toThrow();
    await expect(rescheduleTime(ctx, { taskId: t.id }, '9:5')).rejects.toThrow();
    const undated = await createTask(ctx, draft({ date: null }));
    await expect(rescheduleTime(ctx, { taskId: undated.id }, '09:00')).rejects.toThrow('Task has no date');
    await expect(rescheduleTime(context(db, 'someone-else'), { taskId: t.id }, '10:00')).rejects.toThrow(
      'Task not found',
    );
    expect((await getEntity(db, 'tasks', t.id, 'local'))?.startTime).toBe('09:00');
  });

  it('"this" moves one occurrence only', async () => {
    const ctx = context(db);
    const s = await createTask(ctx, draft({ title: 'Stretch', startTime: '15:00', repeat: daily }));
    const day2 = addDays(TODAY, 2);
    await rescheduleTime(ctx, { taskId: s.id, occurrenceId: occurrenceId(s.id, day2) }, '16:05', 'this');
    expect(await startOf(day2)).toBe('16:05');
    expect(await startOf(addDays(TODAY, 1))).toBe('15:00');
    expect(await startOf(addDays(TODAY, 3))).toBe('15:00');
    expect((await getEntity(db, 'tasks', s.id, 'local'))?.startTime).toBe('15:00');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM recurrence_rules WHERE deleted = 0')).toBe(1);
  });

  it('"following" splits the series at the occurrence', async () => {
    const ctx = context(db);
    const s = await createTask(ctx, draft({ title: 'Stretch', startTime: '15:00', repeat: daily }));
    const day2 = addDays(TODAY, 2);
    await rescheduleTime(ctx, { taskId: s.id, occurrenceId: occurrenceId(s.id, day2) }, '17:00', 'following');
    expect(await startOf(TODAY)).toBe('15:00');
    expect(await startOf(addDays(TODAY, 1))).toBe('15:00');
    expect(await startOf(day2)).toBe('17:00');
    expect(await startOf(addDays(TODAY, 5))).toBe('17:00');
    // One item per day: the old series ended the day before the split.
    const items = await getAgenda(db, 'local', day2, day2, TODAY);
    expect(items.filter((i) => i.title === 'Stretch')).toHaveLength(1);
    const old = await getEntity(db, 'recurrenceRules', s.recurrenceRuleId as string, 'local');
    expect(old).toMatchObject({ endType: 'onDate', endDate: addDays(TODAY, 1) });
    expect(await count(db, 'SELECT COUNT(*) AS n FROM recurrence_rules WHERE deleted = 0')).toBe(2);
  });

  it('"all" moves the whole series, including an occurrence that had its own time, and keeps the repeat', async () => {
    const ctx = context(db);
    const s = await createTask(ctx, draft({ title: 'Stretch', startTime: '15:00', repeat: daily }));
    const day1 = addDays(TODAY, 1);
    const occ = occurrenceId(s.id, day1);
    await rescheduleTime(ctx, { taskId: s.id, occurrenceId: occ }, '08:00', 'this');
    // The moved day gets a renamed title too; "all" must not copy that name to the series.
    await updateTask(
      ctx,
      s.id,
      { ...draft({ title: 'Stretch', startTime: '08:00', repeat: daily, date: day1 }) },
      { scope: 'this', occurrenceId: occ },
    );
    await rescheduleTime(ctx, { taskId: s.id, occurrenceId: occ }, '18:30', 'all');
    expect(await startOf(TODAY)).toBe('18:30');
    expect(await startOf(day1)).toBe('18:30');
    expect(await startOf(addDays(TODAY, 9))).toBe('18:30');
    const rule = await getEntity(db, 'recurrenceRules', s.recurrenceRuleId as string, 'local');
    expect(rule).toMatchObject({ freq: 'daily', endType: 'never', startDate: TODAY });
    expect((await getEntity(db, 'tasks', s.id, 'local'))?.title).toBe('Stretch');
  });

  it('needs the occurrence to move a repeating task', async () => {
    const ctx = context(db);
    const s = await createTask(ctx, draft({ startTime: '15:00', repeat: daily }));
    await expect(rescheduleTime(ctx, { taskId: s.id }, '16:00', 'all')).rejects.toThrow('Occurrence required');
  });

  it('keeps a goal-linked repeat inside the goal (step 0): a valid end is untouched, an endless one is refused', async () => {
    const ctx = context(db);
    const end = addDays(TODAY, 10);
    const s = await createTask(
      ctx,
      draft({ title: 'Stretch', startTime: '15:00', repeat: { ...daily, endType: 'onDate', endDate: end } }),
    );
    await createGoal(ctx, {
      title: 'Move more',
      description: null,
      period: 'once',
      startDate: null,
      dueDate: addDays(TODAY, 12),
      color: null,
      reminders: DEFAULT_GOAL_REMINDERS,
      linkTaskIds: [s.id],
      newTasks: [],
    });
    const occ = occurrenceId(s.id, addDays(TODAY, 1));
    await rescheduleTime(ctx, { taskId: s.id, occurrenceId: occ }, '16:00', 'all');
    expect(await getEntity(db, 'recurrenceRules', s.recurrenceRuleId as string, 'local')).toMatchObject({
      endType: 'onDate',
      endDate: end,
    });
    expect(await startOf(addDays(TODAY, 3))).toBe('16:00');
    // "Following" on a goal-linked series: the new series still ends by the goal's due date.
    await rescheduleTime(
      ctx,
      { taskId: s.id, occurrenceId: occurrenceId(s.id, addDays(TODAY, 4)) },
      '17:00',
      'following',
    );
    const rules = await db.all<{ end_type: string; end_date: string | null }>(
      'SELECT end_type, end_date FROM recurrence_rules WHERE deleted = 0',
    );
    expect(rules).toHaveLength(2);
    for (const r of rules) {
      expect(r.end_type).toBe('onDate');
      expect((r.end_date as string) <= addDays(TODAY, 12)).toBe(true);
    }

    // Older data: an endless series that got a goal link without the check. The move is refused, nothing changes.
    const endless = await createTask(ctx, draft({ title: 'Endless', startTime: '07:00', repeat: daily }));
    const goalId = (await db.first<{ id: string }>('SELECT id FROM goals LIMIT 1'))?.id as string;
    const stored = await getEntity(db, 'tasks', endless.id, 'local');
    await mutate(ctx, () => writeEntity(ctx, 'tasks', { ...stored!, goalId }));
    const error = await rescheduleTime(
      ctx,
      { taskId: endless.id, occurrenceId: occurrenceId(endless.id, TODAY) },
      '07:30',
      'all',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoalRepeatError);
    expect((error as GoalRepeatError).issue).toBe('repeatNeverInGoal');
    expect((await getEntity(db, 'tasks', endless.id, 'local'))?.startTime).toBe('07:00');
    // "This occurrence" does not touch the rule and stays possible.
    await rescheduleTime(ctx, { taskId: endless.id, occurrenceId: occurrenceId(endless.id, TODAY) }, '07:30', 'this');
    expect(await startOf(TODAY, 'Endless')).toBe('07:30');
  });
});

describe('getOverdue', () => {
  it('lists open one-off tasks before today, oldest first, for the owner only', async () => {
    const ctx = context(db);
    await createTask(ctx, draft({ title: 'Yesterday late', date: addDays(TODAY, -1), startTime: '18:00' }));
    await createTask(ctx, draft({ title: 'Yesterday early', date: addDays(TODAY, -1), startTime: '08:00' }));
    await createTask(
      ctx,
      draft({ title: 'Last week', date: addDays(TODAY, -7), subtasks: [{ title: 'x', done: false }] }),
    );
    await createTask(ctx, draft({ title: 'Today', date: TODAY }));
    await createTask(ctx, draft({ title: 'No date', date: null }));
    const done = await createTask(ctx, draft({ title: 'Done before', date: addDays(TODAY, -2) }));
    await setDone(ctx, { taskId: done.id }, true);
    await createTask(ctx, draft({ title: 'Repeating', date: addDays(TODAY, -3), repeat: daily }));
    await createTask(context(db, 'other'), draft({ title: 'Not mine', date: addDays(TODAY, -1) }));

    const items = await getOverdue(db, 'local', TODAY);
    expect(items.map((i) => i.title)).toEqual(['Last week', 'Yesterday early', 'Yesterday late']);
    expect(items[0]?.subtasks).toEqual({ total: 1, done: 0 });
    expect(await getOverdue(db, 'nobody', TODAY)).toEqual([]);
  });
});

describe('getHistory', () => {
  it('files completed tasks under the day they were done, newest first, with missed occurrences', async () => {
    // A one-off task planned last week, done two days ago.
    const old = await createTask(context(db), draft({ title: 'Old task', date: addDays(TODAY, -7) }));
    await setDone(context(db, 'local', at(2026, 11, 7, 9)), { taskId: old.id }, true);
    // Done today, in time order.
    const late = await createTask(context(db), draft({ title: 'Late', startTime: '16:00' }));
    const early = await createTask(context(db), draft({ title: 'Early', startTime: '08:00' }));
    await setDone(context(db, 'local', at(2026, 11, 9, 17)), { taskId: late.id }, true);
    await setDone(context(db, 'local', at(2026, 11, 9, 9)), { taskId: early.id }, true);
    // A daily series from three days ago: yesterday done (yesterday), the two days before missed, today not listed.
    const series = await createTask(
      context(db),
      draft({ title: 'Daily', date: addDays(TODAY, -3), startTime: '07:00', repeat: daily }),
    );
    const yesterday = addDays(TODAY, -1);
    await setDone(
      context(db, 'local', at(2026, 11, 8, 20)),
      { taskId: series.id, occurrenceId: occurrenceId(series.id, yesterday) },
      true,
    );
    await createTask(context(db), draft({ title: 'Still open' }));
    const other = await createTask(context(db, 'other'), draft({ title: 'Not mine' }));
    await setDone(context(db, 'other'), { taskId: other.id }, true);

    const entries = await getHistory(db, 'local', TODAY);
    expect(entries.map((e) => [e.day, e.item.title, e.missed])).toEqual([
      [TODAY, 'Early', false],
      [TODAY, 'Late', false],
      [yesterday, 'Daily', false],
      ['2026-11-07', 'Daily', true],
      ['2026-11-07', 'Old task', false],
      ['2026-11-06', 'Daily', true],
    ]);
    expect(entries.find((e) => e.item.title === 'Old task')?.item.date).toBe(addDays(TODAY, -7));
  });

  it('lists completed routine runs, never a not-done routine as missed', async () => {
    const ctx = context(db, 'local', at(2026, 11, 9, 8));
    const routine = await createRoutine(ctx, {
      ...emptyRoutineDraft(1),
      title: 'Morning',
      steps: [
        { title: 'Water', durationMin: 2 },
        { title: 'Stretch', durationMin: 4 },
      ],
    });
    const stepId = routine.steps[0]?.id ?? '';
    await recordRoutineRun(ctx, routine.id, TODAY, { completedStepIds: [stepId] });
    // Yesterday's run was not done: it is not history, and it is not "missed" either.
    const entries = await getHistory(db, 'local', TODAY);
    expect(entries.map((e) => [e.day, e.item.kind, e.item.title, e.missed])).toEqual([
      [TODAY, 'routine', 'Morning', false],
    ]);
    expect(await getHistory(db, 'other', TODAY)).toEqual([]);
  });

  it('drops what is older than the window and un-completing removes the entry', async () => {
    const long = await createTask(context(db), draft({ title: 'Long ago', date: addDays(TODAY, -90) }));
    const old = new Date(2026, 10, 9 - (HISTORY_DAYS + 1), 12, 0);
    await setDone(
      context(db, 'local', () => old),
      { taskId: long.id },
      true,
    );
    const edge = await createTask(context(db), draft({ title: 'Edge' }));
    await setDone(
      context(db, 'local', () => new Date(2026, 10, 9 - HISTORY_DAYS, 0, 30)),
      { taskId: edge.id },
      true,
    );
    expect((await getHistory(db, 'local', TODAY)).map((e) => e.item.title)).toEqual(['Edge']);
    await setDone(context(db), { taskId: edge.id }, false);
    expect(await getHistory(db, 'local', TODAY)).toEqual([]);
  });
});

describe('getTaskDetail', () => {
  it('returns a one-off task with its goal and subtasks', async () => {
    const ctx = context(db);
    const t = await createTask(
      ctx,
      draft({
        title: 'Write report',
        startTime: '09:30',
        durationMin: 60,
        notes: 'Two pages',
        newGoalTitle: 'Ship it',
        categoryName: 'Work',
        subtasks: [
          { title: 'Outline', done: true },
          { title: 'Draft', done: false },
        ],
      }),
    );
    const d = await getTaskDetail(db, 'local', t.id, null);
    expect(d).toMatchObject({ rule: null, template: false, goal: { title: 'Ship it' } });
    expect(d?.item).toMatchObject({
      key: t.id,
      kind: 'task',
      title: 'Write report',
      startTime: '09:30',
      durationMin: 60,
      notes: 'Two pages',
      categoryName: 'Work',
      recurring: false,
      subtasks: { total: 2, done: 1 },
    });
    expect(await getTaskDetail(db, 'someone-else', t.id, null)).toBeNull();
    expect(await getTaskDetail(db, 'local', 'missing', null)).toBeNull();
    // A subtask is not a task of its own.
    const sub = d?.item.subtaskItems[0]?.id as string;
    expect(await getTaskDetail(db, 'local', sub, null)).toBeNull();
  });

  it('returns one occurrence with its own values and ticks, even far from today', async () => {
    const ctx = context(db);
    const s = await createTask(
      ctx,
      draft({ title: 'Stretch', startTime: '15:00', repeat: daily, subtasks: [{ title: 'Neck', done: false }] }),
    );
    const far = addDays(TODAY, 120);
    const occ = occurrenceId(s.id, far);
    const d = await getTaskDetail(db, 'local', s.id, occ);
    expect(d?.item).toMatchObject({ key: occ, kind: 'occurrence', date: far, startTime: '15:00', recurring: true });
    expect(d?.rule).toMatchObject({ freq: 'daily', endType: 'never' });
    expect(d?.template).toBe(false);

    const subId = d?.item.subtaskItems[0]?.id as string;
    await setSubtaskDone(ctx, { taskId: s.id, occurrenceId: occ }, subId, true);
    await rescheduleTime(ctx, { taskId: s.id, occurrenceId: occ }, '16:10', 'this');
    const after = await getTaskDetail(db, 'local', s.id, occ);
    expect(after?.item).toMatchObject({ startTime: '16:10', subtasks: { total: 1, done: 1 } });

    // The series without an occurrence, a date the rule does not produce, an id of another series.
    expect(await getTaskDetail(db, 'local', s.id, null)).toMatchObject({ template: true, item: { recurring: true } });
    expect(await getTaskDetail(db, 'local', s.id, occurrenceId(s.id, addDays(TODAY, -5)))).toBeNull();
    expect(await getTaskDetail(db, 'local', s.id, occurrenceId('other-series', far))).toBeNull();
  });
});
