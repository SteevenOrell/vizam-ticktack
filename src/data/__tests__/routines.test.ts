import { context, count, freshDb, TODAY } from '../../../tests/support/db';
import { addDays } from '../../domain/localDate';
import type { SqlDriver } from '../db/driver';
import { getItemReminder } from '../reminders';
import {
  createRoutine,
  deleteRoutine,
  emptyRoutineDraft,
  getRoutineDetail,
  getRoutineList,
  loadRoutineForm,
  recordRoutineRun,
  updateRoutine,
  type RoutineDraft,
} from '../routines';
import { getEntity } from '../store';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const draft = (patch: Partial<RoutineDraft> = {}): RoutineDraft => ({
  ...emptyRoutineDraft(1),
  title: 'Morning',
  steps: [
    { title: 'Water', durationMin: 1 },
    { title: 'Stretch', durationMin: 5 },
  ],
  ...patch,
});
const reminder = { offsetMin: 10, atTime: '09:00' };

describe('createRoutine / list', () => {
  it('creates a routine with steps, a daily rule and today’s occurrence', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft({ startTime: '07:00' }));
    expect(r.steps.map((s) => s.title)).toEqual(['Water', 'Stretch']);
    expect(new Set(r.steps.map((s) => s.id)).size).toBe(2);
    const list = await getRoutineList(db, 'local', TODAY);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Morning', stepCount: 2, totalMin: 6, startTime: '07:00' });
    expect(list[0]?.today).toMatchObject({ scheduled: true, done: false, completedStepIds: [] });
  });

  it('needs a title and at least one step', async () => {
    const ctx = context(db);
    await expect(createRoutine(ctx, draft({ title: ' ' }))).rejects.toThrow();
    await expect(createRoutine(ctx, draft({ steps: [] }))).rejects.toThrow();
    await expect(createRoutine(ctx, draft({ steps: [{ title: '', durationMin: null }] }))).rejects.toThrow();
  });

  it('orders by part of day then start time', async () => {
    const ctx = context(db);
    await createRoutine(ctx, draft({ title: 'Night', partOfDay: 'evening' }));
    await createRoutine(ctx, draft({ title: 'Late morning', partOfDay: 'morning', startTime: '10:00' }));
    await createRoutine(ctx, draft({ title: 'Early', partOfDay: 'morning', startTime: '06:00' }));
    expect((await getRoutineList(db, 'local', TODAY)).map((r) => r.title)).toEqual(['Early', 'Late morning', 'Night']);
  });

  it('keeps other owners apart', async () => {
    await createRoutine(context(db), draft());
    expect(await getRoutineList(db, 'someone-else', TODAY)).toEqual([]);
  });

  it('saves the reminder with the routine', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft({ startTime: '07:00', reminder }));
    expect(await getItemReminder(db, 'local', 'routine', r.id)).toEqual(reminder);
    expect((await getRoutineDetail(db, 'local', r.id, TODAY))?.reminder).toEqual(reminder);
  });
});

describe('updateRoutine / form', () => {
  it('round-trips through the form and keeps step ids', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft());
    const form = await loadRoutineForm(ctx, r.id, 1);
    expect(form?.draft.steps.map((s) => s.id)).toEqual(r.steps.map((s) => s.id));
    const saved = await updateRoutine(ctx, r.id, {
      ...form!.draft,
      title: 'Morning 2',
      steps: [form!.draft.steps[1]!, { title: 'Read', durationMin: null }],
    });
    expect(saved.title).toBe('Morning 2');
    expect(saved.steps.map((s) => s.title)).toEqual(['Stretch', 'Read']);
    expect(saved.steps[0]?.id).toBe(r.steps[1]?.id);
  });

  it('a changed schedule keeps a day that holds a run', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft());
    await recordRoutineRun(ctx, r.id, TODAY, { completedStepIds: [r.steps[0]!.id] });
    const form = await loadRoutineForm(ctx, r.id, 1);
    await updateRoutine(ctx, r.id, { ...form!.draft, repeat: { ...form!.draft.repeat, interval: 2 } });
    const detail = await getRoutineDetail(db, 'local', r.id, TODAY);
    expect(detail?.today.done).toBe(true);
    expect(detail?.rule?.interval).toBe(2);
  });

  it('switches the reminder off with null and keeps it with undefined', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft({ startTime: '07:00', reminder }));
    await updateRoutine(ctx, r.id, draft({ startTime: '07:00', reminder: undefined }));
    expect(await getItemReminder(db, 'local', 'routine', r.id)).toEqual(reminder);
    await updateRoutine(ctx, r.id, draft({ startTime: '07:00', reminder: null }));
    expect(await getItemReminder(db, 'local', 'routine', r.id)).toBeNull();
  });

  it('throws for a missing routine', async () => {
    await expect(updateRoutine(context(db), 'nope', draft())).rejects.toThrow('Routine not found');
  });
});

describe('recordRoutineRun', () => {
  it('marks the day done when a step was done and replaces an earlier run', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft());
    const [a, b] = r.steps;
    await recordRoutineRun(ctx, r.id, TODAY, { completedStepIds: [a!.id, a!.id, 'unknown'] });
    let detail = await getRoutineDetail(db, 'local', r.id, TODAY);
    expect(detail?.today).toMatchObject({ done: true, completedStepIds: [a!.id] });
    expect(detail?.runs).toEqual([{ date: TODAY, done: 1, total: 2 }]);
    await recordRoutineRun(ctx, r.id, TODAY, { completedStepIds: [a!.id, b!.id] });
    detail = await getRoutineDetail(db, 'local', r.id, TODAY);
    expect(detail?.runs[0]).toMatchObject({ done: 2 });
  });

  it('a run with nothing done leaves the day open', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft());
    await recordRoutineRun(ctx, r.id, TODAY, { completedStepIds: [] });
    expect((await getRoutineDetail(db, 'local', r.id, TODAY))?.today.done).toBe(false);
  });

  it('keeps an extra run on an unplanned day', async () => {
    const ctx = context(db);
    const r = await createRoutine(
      ctx,
      draft({ repeat: { ...emptyRoutineDraft(1).repeat, freq: 'weekly', byWeekday: [3] } }),
    );
    // 2026-11-09 is a Monday; the routine is planned for Wednesdays only.
    expect((await getRoutineList(db, 'local', TODAY))[0]?.today.scheduled).toBe(false);
    await recordRoutineRun(ctx, r.id, TODAY, { completedStepIds: [r.steps[0]!.id] });
    const detail = await getRoutineDetail(db, 'local', r.id, TODAY);
    expect(detail?.today.done).toBe(true);
    expect(detail?.today.scheduled).toBe(true);
  });

  it('rejects a missing routine', async () => {
    await expect(recordRoutineRun(context(db), 'nope', TODAY, { completedStepIds: [] })).rejects.toThrow();
  });
});

describe('deleteRoutine', () => {
  it('removes the routine, its reminder and future days but keeps past runs stored', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, draft({ startTime: '07:00', reminder }));
    await recordRoutineRun(ctx, r.id, addDays(TODAY, -1), { completedStepIds: [r.steps[0]!.id] });
    await deleteRoutine(ctx, r.id);
    expect(await getEntity(db, 'routines', r.id, 'local')).toBeNull();
    expect(await getRoutineList(db, 'local', TODAY)).toEqual([]);
    expect(await getRoutineDetail(db, 'local', r.id, TODAY)).toBeNull();
    expect(await getItemReminder(db, 'local', 'routine', r.id)).toBeNull();
    expect(
      await count(db, 'SELECT COUNT(*) AS n FROM task_occurrences WHERE series_id = ? AND deleted = 0 AND date >= ?', [
        r.id,
        TODAY,
      ]),
    ).toBe(0);
  });

  it('does nothing for an unknown id', async () => {
    await expect(deleteRoutine(context(db), 'nope')).resolves.toBeUndefined();
  });
});
