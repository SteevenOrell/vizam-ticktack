import { ZodError } from 'zod';

import { addDays } from '../../domain/localDate';
import { occurrenceId } from '../../domain/recurrence/generator';
import { context, count, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { CategoryNameError } from '../categories';
import type { SqlDriver } from '../db/driver';
import { getGoalOptions } from '../goals';
import { getAgenda, getCategoryOptions, getTodayView } from '../queries/agenda';
import { writeEntity, mutate } from '../store';
import { createTask, deleteTask, emptyDraft, loadTaskForm, setSubtaskDone, updateTask, type TaskDraft } from '../tasks';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const draft = (patch: Partial<TaskDraft> = {}): TaskDraft => ({ ...emptyDraft(TODAY), title: 'Plan', ...patch });
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

describe('free-text categories', () => {
  it('creates a category from a typed name with a palette colour, and queues it for sync', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, draft({ categoryName: '  Side   project ' }));
    const cats = await getCategoryOptions(db, 'local');
    expect(cats).toEqual([{ id: task.categoryId, name: 'Side project', color: 'ember' }]);
    expect(await count(db, "SELECT count(*) AS n FROM outbox WHERE entity_type = 'categories'")).toBe(1);
  });

  it('reuses an existing category case-insensitively instead of creating a duplicate', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, draft({ categoryName: 'Work' }));
    const b = await createTask(ctx, draft({ title: 'Other', categoryName: ' WORK ' }));
    expect(b.categoryId).toBe(a.categoryId);
    expect(await count(db, 'SELECT count(*) AS n FROM categories')).toBe(1);
  });

  it('gives each new category the next least-used colour', async () => {
    const ctx = context(db);
    for (const name of ['One', 'Two', 'Three']) await createTask(ctx, draft({ title: name, categoryName: name }));
    expect((await getCategoryOptions(db, 'local')).map((c) => c.color)).toEqual(['ember', 'sky', 'moss']);
  });

  it('unarchives an archived match instead of creating a twin', async () => {
    const ctx = context(db);
    const first = await createTask(ctx, draft({ categoryName: 'Garden' }));
    const cat = await db.first<{ id: string; name: string; color: string; icon: string; sort_order: number }>(
      'SELECT id, name, color, icon, sort_order FROM categories',
    );
    await mutate(ctx, () =>
      writeEntity(ctx, 'categories', {
        id: cat!.id,
        name: cat!.name,
        color: 'ember',
        icon: 'dot',
        sortOrder: cat!.sort_order,
        archived: true,
      }),
    );
    const second = await createTask(ctx, draft({ categoryName: 'garden' }));
    expect(second.categoryId).toBe(first.categoryId);
    expect(await count(db, 'SELECT count(*) AS n FROM categories WHERE archived = 0')).toBe(1);
  });

  it('clears the category with an empty name and rejects names over 40 characters', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, draft({ categoryName: 'Work' }));
    await updateTask(ctx, task.id, { ...(await loadTaskForm(ctx, task.id))!.draft, categoryName: '   ' });
    expect((await loadTaskForm(ctx, task.id))!.task.categoryId).toBeNull();
    await expect(createTask(ctx, draft({ categoryName: 'x'.repeat(41) }))).rejects.toBeInstanceOf(ZodError);
    expect(CategoryNameError).toBeDefined();
  });

  it('loads the category name into the editor draft', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, draft({ categoryName: 'Errands' }));
    expect((await loadTaskForm(ctx, task.id))!.draft.categoryName).toBe('Errands');
  });
});

describe('goals', () => {
  it('creates a goal by name together with the task that links to it', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, draft({ newGoalTitle: '  Run a 10K ' }));
    const [goal] = await getGoalOptions(db, 'local');
    expect(goal?.title).toBe('Run a 10K');
    expect(task.goalId).toBe(goal?.id);
    const view = await getTodayView(db, 'local', TODAY);
    expect(view.anytime[0]?.goalTitle).toBe('Run a 10K');
  });

  it('refuses a goal id that is not the owner’s', async () => {
    await expect(createTask(context(db), draft({ goalId: 'not-a-goal' }))).rejects.toThrow('Goal not found');
  });

  it('keeps the goal link when an update does not mention it', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, draft({ newGoalTitle: 'Read more' }));
    const { goalId: _omit, ...rest } = (await loadTaskForm(ctx, task.id))!.draft;
    await updateTask(ctx, task.id, { ...rest, title: 'Renamed' });
    expect((await loadTaskForm(ctx, task.id))!.task.goalId).toBe(task.goalId);
    expect(task.goalId).toBeTruthy();
  });
});

describe('row previews', () => {
  it('carries notes, category name and the subtasks with their state', async () => {
    const ctx = context(db);
    const task = await createTask(
      ctx,
      draft({
        notes: 'Bring the blue folder',
        categoryName: 'Work',
        subtasks: [
          { title: 'One', done: true },
          { title: 'Two', done: false },
          { title: 'Three', done: false },
        ],
      }),
    );
    const [item] = await getAgenda(db, 'local', TODAY, TODAY, TODAY);
    expect(item).toMatchObject({ key: task.id, notes: 'Bring the blue folder', categoryName: 'Work' });
    expect(item!.subtaskItems.map((s) => [s.title, s.done])).toEqual([
      ['One', true],
      ['Two', false],
      ['Three', false],
    ]);
    expect(item!.subtasks).toEqual({ total: 3, done: 1 });
  });

  it('shows the per-occurrence subtask state of a series', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ repeat: daily, subtasks: [{ title: 'Warm up', done: false }] }));
    const sub = await db.first<{ id: string }>('SELECT id FROM tasks WHERE parent_task_id = ?', [series.id]);
    const occ = occurrenceId(series.id, TODAY);
    await setSubtaskDone(ctx, { taskId: series.id, occurrenceId: occ }, sub!.id, true);
    const items = await getAgenda(db, 'local', TODAY, addDays(TODAY, 1), TODAY);
    expect(items.find((i) => i.key === occ)!.subtaskItems[0]).toMatchObject({ title: 'Warm up', done: true });
    expect(items.find((i) => i.key === occurrenceId(series.id, addDays(TODAY, 1)))!.subtaskItems[0]!.done).toBe(false);
  });
});

describe('never-ending series in the bounded window', () => {
  it('stores no end and only materialises the window around the dates on screen', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ date: '2026-01-01', repeat: daily }));
    const rule = await db.first<{ end_type: string; end_date: string | null; count: number | null }>(
      'SELECT end_type, end_date, count FROM recurrence_rules WHERE series_id = ?',
      [series.id],
    );
    expect(rule).toEqual({ end_type: 'never', end_date: null, count: null });
    // today - 7 .. today + 21
    expect(await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE series_id = ?', [series.id])).toBe(29);

    // Both sides of the window edge, and a week far in the future, without filling the gap.
    const edge = addDays(TODAY, 21);
    const around = await getAgenda(db, 'local', edge, addDays(edge, 1), TODAY);
    expect(around.map((i) => i.date)).toEqual([edge, addDays(edge, 1)]);
    const far = await getAgenda(db, 'local', '2028-06-05', '2028-06-11', TODAY);
    expect(far).toHaveLength(7);
    expect(await count(db, 'SELECT count(*) AS n FROM task_occurrences WHERE series_id = ?', [series.id])).toBe(
      29 + 1 + 7,
    );
  });

  it('deleting "this and following" turns a never-ending series into one that ends the day before', async () => {
    const ctx = context(db);
    const series = await createTask(ctx, draft({ repeat: daily }));
    await deleteTask(ctx, { taskId: series.id, occurrenceId: occurrenceId(series.id, addDays(TODAY, 3)) }, 'following');
    const rule = await db.first<{ end_type: string; end_date: string }>(
      'SELECT end_type, end_date FROM recurrence_rules WHERE series_id = ?',
      [series.id],
    );
    expect(rule).toEqual({ end_type: 'onDate', end_date: addDays(TODAY, 2) });
    expect(NOW).toBeInstanceOf(Date);
  });
});
