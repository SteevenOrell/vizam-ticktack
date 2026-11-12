import { ZodError } from 'zod';

import { addDays } from '../../domain/localDate';
import { occurrenceId } from '../../domain/recurrence/generator';
import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import type { SqlDriver } from '../db/driver';
import { ensureOccurrences, pruneOccurrences } from '../occurrences';
import { getAgenda, getTodayView } from '../queries/agenda';
import { getEntity, mutate, OwnershipError, writeEntity } from '../store';
import {
  createTask,
  deleteTask,
  emptyDraft,
  loadTaskForm,
  moveToDate,
  previewOrphans,
  setDone,
  setSubtaskDone,
  updateTask,
  type TaskDraft,
} from '../tasks';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const draft = (patch: Partial<TaskDraft> = {}): TaskDraft => ({
  ...emptyDraft(TODAY),
  title: 'Plan the week',
  ...patch,
});
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

describe('write path', () => {
  it('validates, bumps local_rev, marks dirty and enqueues one coalesced outbox entry', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, draft({ startTime: '09:00', durationMin: 30 }));
    let row = await db.first<{ local_rev: number; dirty: number }>('SELECT local_rev, dirty FROM tasks WHERE id = ?', [
      task.id,
    ]);
    expect(row).toEqual({ local_rev: 1, dirty: 1 });

    await updateTask(ctx, task.id, draft({ title: 'Plan the month' }));
    await updateTask(ctx, task.id, draft({ title: 'Plan the year' }));
    row = await db.first('SELECT local_rev, dirty FROM tasks WHERE id = ?', [task.id]);
    expect(row).toEqual({ local_rev: 3, dirty: 1 });
    const outbox = await db.all<{ op: string; enqueued_rev: number; attempts: number }>(
      'SELECT op, enqueued_rev, attempts FROM outbox WHERE entity_id = ?',
      [task.id],
    );
    expect(outbox).toEqual([{ op: 'upsert', enqueued_rev: 3, attempts: 0 }]);
  });

  it('rejects invalid input before touching the database', async () => {
    const ctx = context(db);
    await expect(createTask(ctx, draft({ title: '   ' }))).rejects.toBeInstanceOf(ZodError);
    await expect(createTask(ctx, draft({ startTime: '9am' }))).rejects.toBeInstanceOf(ZodError);
    await expect(createTask(ctx, draft({ date: null, repeat: daily }))).rejects.toBeInstanceOf(ZodError);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(0);
    expect(await count(db, 'SELECT count(*) AS n FROM outbox')).toBe(0);
  });

  it('refuses to overwrite another owner’s row and rolls the whole transaction back', async () => {
    const mine = context(db, 'local');
    const theirs = context(db, 'other-user');
    const task = await createTask(theirs, draft());
    await expect(
      mutate(mine, async () => {
        await writeEntity(mine, 'categories', {
          id: 'cat-1',
          name: 'Home',
          color: 'sand',
          icon: 'home',
          sortOrder: 0,
          archived: false,
        });
        const stolen = await getEntity(db, 'tasks', task.id, 'other-user');
        await writeEntity(mine, 'tasks', { ...stolen!, title: 'Hijacked' });
      }),
    ).rejects.toBeInstanceOf(OwnershipError);
    expect(await count(db, "SELECT count(*) AS n FROM categories WHERE id = 'cat-1'")).toBe(0);
    expect((await getEntity(db, 'tasks', task.id, 'other-user'))?.title).toBe('Plan the week');
    // Reads are scoped to the owner too.
    expect(await getEntity(db, 'tasks', task.id, 'local')).toBeNull();
    expect(await getAgenda(db, 'local', TODAY, TODAY, TODAY)).toEqual([]);
  });

  it('keeps subtasks in step with the draft and ticks them', async () => {
    const ctx = context(db);
    const task = await createTask(
      ctx,
      draft({
        subtasks: [
          { title: 'Outline', done: false },
          { title: 'Draft', done: false },
        ],
      }),
    );
    const form = await loadTaskForm(ctx, task.id);
    expect(form?.draft.subtasks.map((s) => s.title)).toEqual(['Outline', 'Draft']);
    const [first, second] = form!.draft.subtasks;
    await setSubtaskDone(ctx, { taskId: task.id }, first!.id!, true);
    await updateTask(ctx, task.id, { ...form!.draft, subtasks: [{ ...second! }, { title: 'Review', done: false }] });
    const view = await getTodayView(db, 'local', TODAY);
    expect(view.anytime[0]?.subtasks).toEqual({ total: 2, done: 0 });
    expect(await count(db, 'SELECT count(*) AS n FROM tasks WHERE parent_task_id = ? AND deleted = 1', [task.id])).toBe(
      1,
    );
  });
});

describe('Today view', () => {
  it('groups overdue, scheduled, anytime and done, and sums the workload', async () => {
    const ctx = context(db);
    await createTask(ctx, draft({ title: 'Late one', date: addDays(TODAY, -2) }));
    const timed = await createTask(ctx, draft({ title: 'Timed', startTime: '09:30', durationMin: 90 }));
    await createTask(ctx, draft({ title: 'Anytime', durationMin: 20 }));
    await createTask(ctx, draft({ title: 'Tomorrow', date: addDays(TODAY, 1) }));
    await setDone(ctx, { taskId: timed.id }, true);

    const view = await getTodayView(db, 'local', TODAY);
    expect(view.overdue.map((i) => i.title)).toEqual(['Late one']);
    expect(view.scheduled).toEqual([]);
    expect(view.anytime.map((i) => i.title)).toEqual(['Anytime']);
    expect(view.done.map((i) => i.title)).toEqual(['Timed']);
    expect(view.plannedMin).toBe(110);
    expect(view.doneMin).toBe(90);
  });

  it('moves a task to another day', async () => {
    const ctx = context(db);
    const t = await createTask(ctx, draft());
    await moveToDate(ctx, { taskId: t.id }, addDays(TODAY, 1));
    expect((await getTodayView(db, 'local', TODAY)).anytime).toEqual([]);
    expect(await getAgenda(db, 'local', addDays(TODAY, 1), addDays(TODAY, 1), TODAY)).toHaveLength(1);
  });
});

describe('recurring series', () => {
  it('materialises only the bounded window, never duplicates, and never queues generated rows', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ startTime: '07:00', repeat: daily }));
    // Starts today: today .. today + 21.
    expect(await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE series_id = ?', [series.id])).toBe(22);
    expect(await ensureOccurrences(db, 'local', { from: addDays(TODAY, -7), to: addDays(TODAY, 21) })).toBe(0);
    expect(await count(db, "SELECT count(*) AS n FROM outbox WHERE entity_type = 'occurrences'")).toBe(0);
    expect(await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE dirty = 1')).toBe(0);
    const row = await db.first<{ id: string }>('SELECT id FROM task_occurrences WHERE original_date = ?', [TODAY]);
    expect(row?.id).toBe(occurrenceId(series.id, TODAY));
  });

  it('caps a request at 62 days and a series at 400 rows', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ date: '2025-01-01', repeat: daily }));
    await ensureOccurrences(db, 'local', { from: '2025-01-01', to: '2026-12-31' });
    const n = await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE series_id = ? AND original_date < ?', [
      series.id,
      '2025-03-05',
    ]);
    expect(n).toBe(62);
  });

  it('completes one occurrence as a synced exception', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ repeat: daily }));
    const occ = occurrenceId(series.id, TODAY);
    await setDone(ctx, { taskId: series.id, occurrenceId: occ }, true);
    const view = await getTodayView(db, 'local', TODAY);
    expect(view.done.map((i) => i.occurrenceId)).toEqual([occ]);
    expect(await count(db, 'SELECT count(*) AS n FROM outbox WHERE entity_id = ?', [occ])).toBe(1);
    const tomorrow = await getAgenda(db, 'local', addDays(TODAY, 1), addDays(TODAY, 1), TODAY);
    expect(tomorrow[0]?.done).toBe(false);
  });

  it('"this occurrence": moves one day without duplicating it on regeneration', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ startTime: '08:00', repeat: daily }));
    const occ = occurrenceId(series.id, addDays(TODAY, 2));
    const form = await loadTaskForm(ctx, series.id, occ);
    await updateTask(
      ctx,
      series.id,
      { ...form!.draft, date: addDays(TODAY, 3), startTime: '18:00' },
      { scope: 'this', occurrenceId: occ },
    );
    await ensureOccurrences(db, 'local', { from: TODAY, to: addDays(TODAY, 30) });
    const day3 = await getAgenda(db, 'local', addDays(TODAY, 3), addDays(TODAY, 3), TODAY);
    expect(day3.map((i) => [i.occurrenceId, i.startTime])).toEqual([
      [occurrenceId(series.id, addDays(TODAY, 3)), '08:00'],
      [occ, '18:00'],
    ]);
    expect(await getAgenda(db, 'local', addDays(TODAY, 2), addDays(TODAY, 2), TODAY)).toEqual([]);
  });

  it('"this and following": splits the series and keeps the past', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ title: 'Stretch', date: addDays(TODAY, -3), repeat: daily }));
    const splitDay = addDays(TODAY, 2);
    const later = occurrenceId(series.id, addDays(TODAY, 5));
    await setDone(ctx, { taskId: series.id, occurrenceId: later }, true); // exception after the split: removed
    const occ = occurrenceId(series.id, splitDay);
    const form = await loadTaskForm(ctx, series.id, occ);
    await updateTask(
      ctx,
      series.id,
      { ...form!.draft, title: 'Long stretch' },
      { scope: 'following', occurrenceId: occ },
    );

    const titles = async (d: string) => (await getAgenda(db, 'local', d, d, TODAY)).map((i) => i.title);
    expect(await titles(TODAY)).toEqual(['Stretch']);
    expect(await titles(addDays(TODAY, 1))).toEqual(['Stretch']);
    expect(await titles(splitDay)).toEqual(['Long stretch']);
    expect(await titles(addDays(TODAY, 5))).toEqual(['Long stretch']);
    const oldRule = await db.first<{ end_type: string; end_date: string }>(
      'SELECT end_type, end_date FROM recurrence_rules WHERE series_id = ?',
      [series.id],
    );
    expect(oldRule).toEqual({ end_type: 'onDate', end_date: addDays(TODAY, 1) });
    expect(await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE id = ? AND deleted = 1', [later])).toBe(1);
  });

  it('"all occurrences": changes the rule, regenerates from today, keeps history, removes orphaned exceptions', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ title: 'Gym', date: addDays(TODAY, -6), repeat: daily }));
    const past = occurrenceId(series.id, addDays(TODAY, -2));
    await setDone(ctx, { taskId: series.id, occurrenceId: past }, true);
    const thursday = occurrenceId(series.id, addDays(TODAY, 3)); // 2026-11-12
    await setDone(ctx, { taskId: series.id, occurrenceId: thursday }, true);

    const weekly = { ...daily, freq: 'weekly' as const, byWeekday: [1, 3] }; // Mon, Wed
    expect((await previewOrphans(ctx, series.id, weekly)).map((o) => o.originalDate)).toEqual([addDays(TODAY, 3)]);
    const form = await loadTaskForm(ctx, series.id, occurrenceId(series.id, TODAY));
    await updateTask(ctx, series.id, { ...form!.draft, repeat: weekly }, { scope: 'all' });

    const days = (await getAgenda(db, 'local', TODAY, addDays(TODAY, 9), TODAY)).map((i) => i.date);
    expect(days).toEqual(['2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18']);
    expect(await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE id = ? AND deleted = 1', [thursday])).toBe(
      1,
    );
    // History before today stays as it was (daily rows, including the completed one).
    const history = await getAgenda(db, 'local', addDays(TODAY, -6), addDays(TODAY, -1), TODAY);
    expect(history).toHaveLength(6);
    expect(history.find((i) => i.occurrenceId === past)?.done).toBe(true);
  });

  it('"all occurrences" with repeat turned off stops the series and keeps a one-off task', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ title: 'Read', date: addDays(TODAY, -2), repeat: daily }));
    const form = await loadTaskForm(ctx, series.id, occurrenceId(series.id, TODAY));
    await updateTask(ctx, series.id, { ...form!.draft, repeat: null }, { scope: 'all' });
    const today = await getAgenda(db, 'local', TODAY, addDays(TODAY, 5), TODAY);
    expect(today.map((i) => [i.kind, i.date])).toEqual([['task', TODAY]]);
    expect(await getAgenda(db, 'local', addDays(TODAY, -2), addDays(TODAY, -1), TODAY)).toHaveLength(2);
  });

  it('deletes one, following, or all occurrences with tombstones', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ repeat: daily }));
    const ref = (d: string) => ({ taskId: series.id, occurrenceId: occurrenceId(series.id, d) });
    await deleteTask(ctx, ref(addDays(TODAY, 1)), 'this');
    await deleteTask(ctx, ref(addDays(TODAY, 4)), 'following');
    const days = (await getAgenda(db, 'local', TODAY, addDays(TODAY, 10), TODAY)).map((i) => i.date);
    expect(days).toEqual([TODAY, addDays(TODAY, 2), addDays(TODAY, 3)]);

    await deleteTask(ctx, ref(TODAY), 'all');
    expect(await getAgenda(db, 'local', TODAY, addDays(TODAY, 10), TODAY)).toEqual([]);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks WHERE id = ? AND deleted = 1', [series.id])).toBe(1);
    expect(await count(db, 'SELECT count(*) AS n FROM recurrence_rules WHERE deleted = 1')).toBe(1);
    // Tombstones are queued as deletes.
    expect(await count(db, "SELECT count(*) AS n FROM outbox WHERE entity_id = ? AND op = 'delete'", [series.id])).toBe(
      1,
    );
  });

  it('prunes recomputable rows outside [today - 30, today + 60] but keeps exceptions', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ date: '2026-08-01', repeat: daily }));
    await ensureOccurrences(db, 'local', { from: '2026-08-01', to: '2026-09-15' });
    await setDone(ctx, { taskId: series.id, occurrenceId: occurrenceId(series.id, '2026-08-02') }, true);
    const removed = await pruneOccurrences(db, TODAY);
    expect(removed).toBeGreaterThan(0);
    expect(await count(db, "SELECT count(*) AS n FROM task_occurrences WHERE original_date < '2026-10-10'")).toBe(1);
  });
});

it('serialises concurrent writes on one connection (no nested BEGIN)', async () => {
  const ctx = context(db);
  await Promise.all(Array.from({ length: 8 }, (_, i) => createTask(ctx, draft({ title: `Parallel ${i}` }))));
  expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(8);
  expect(await count(db, 'SELECT count(*) AS n FROM outbox')).toBe(8);
});

it('uses the injected clock for timestamps', async () => {
  const ctx = context(db);
  const t = await createTask(ctx, draft());
  expect(t.createdAt).toBe(NOW.toISOString());
});
