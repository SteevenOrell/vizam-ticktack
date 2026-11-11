import { context, count, freshDb, TODAY } from '../../../tests/support/db';
import { DEFAULT_GOAL_REMINDERS } from '../../domain/models';
import type { SqlDriver } from '../db/driver';
import { createGoal, deleteGoal, getGoalDetail, loadGoalForm, updateGoal, type GoalDraft } from '../goals';
import {
  listMilestones,
  MILESTONES_MAX,
  milestoneDraftOf,
  milestoneProgress,
  moveItem,
  setMilestoneDone,
} from '../milestones';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const goalDraft = (patch: Partial<GoalDraft> = {}): GoalDraft => ({
  title: 'Run a race',
  description: null,
  period: 'once',
  startDate: null,
  dueDate: '2026-12-09',
  color: null,
  reminders: DEFAULT_GOAL_REMINDERS,
  linkTaskIds: [],
  newTasks: [{ title: 'First run', date: null, startTime: null, durationMin: null }],
  ...patch,
});
const ms = (title: string, done = false, dueDate: string | null = null) => ({ title, dueDate, done });

describe('milestones', () => {
  it('saves them in order and loads them back in the form', async () => {
    const ctx = context(db);
    const goal = await createGoal(ctx, goalDraft({ milestones: [ms('Buy shoes'), ms('5 km', true, '2026-11-20')] }));
    const list = await listMilestones(db, 'local', goal.id);
    expect(list.map((m) => [m.title, m.sortOrder])).toEqual([
      ['Buy shoes', 0],
      ['5 km', 1],
    ]);
    expect(list[1]?.completedAt).not.toBeNull();
    const form = await loadGoalForm(ctx, goal.id);
    expect(form?.draft.milestones?.map((m) => [m.title, m.done])).toEqual([
      ['Buy shoes', false],
      ['5 km', true],
    ]);
  });

  it('reorders, edits and removes on update; undefined leaves them alone', async () => {
    const ctx = context(db);
    const goal = await createGoal(ctx, goalDraft({ milestones: [ms('A'), ms('B'), ms('C')] }));
    const [a, b, c] = (await listMilestones(db, 'local', goal.id)).map(milestoneDraftOf);
    await updateGoal(ctx, goal.id, goalDraft({ milestones: [c!, { ...a!, title: 'A2' }] }));
    expect((await listMilestones(db, 'local', goal.id)).map((m) => m.title)).toEqual(['C', 'A2']);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM milestones WHERE id = ? AND deleted = 1', [b!.id!])).toBe(1);
    await updateGoal(ctx, goal.id, goalDraft());
    expect(await listMilestones(db, 'local', goal.id)).toHaveLength(2);
  });

  it('does not rewrite unchanged milestones (no extra outbox entries)', async () => {
    const ctx = context(db);
    const goal = await createGoal(ctx, goalDraft({ milestones: [ms('A')] }));
    const [m] = (await listMilestones(db, 'local', goal.id)).map(milestoneDraftOf);
    const before = await count(db, 'SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ?', [m!.id!]);
    await updateGoal(ctx, goal.id, goalDraft({ milestones: [m!] }));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ?', [m!.id!])).toBe(before);
  });

  it('rejects an empty title, a too long title and more than the maximum', async () => {
    const ctx = context(db);
    await expect(createGoal(ctx, goalDraft({ milestones: [ms('  ')] }))).rejects.toThrow();
    await expect(createGoal(ctx, goalDraft({ milestones: [ms('x'.repeat(121))] }))).rejects.toThrow();
    const many = Array.from({ length: MILESTONES_MAX + 1 }, (_, i) => ms(`m${i}`));
    await expect(createGoal(ctx, goalDraft({ milestones: many }))).rejects.toThrow();
  });

  it('checks off and reopens, and keeps the task-based percentage separate', async () => {
    const ctx = context(db);
    const goal = await createGoal(ctx, goalDraft({ milestones: [ms('A'), ms('B')] }));
    const [a] = await listMilestones(db, 'local', goal.id);
    await setMilestoneDone(ctx, a!.id, true);
    const detail = await getGoalDetail(db, 'local', goal.id, TODAY);
    expect(detail?.milestoneProgress).toEqual({ done: 1, total: 2, percent: 50 });
    expect(detail?.summary.progress.percent).toBe(0);
    await setMilestoneDone(ctx, a!.id, false);
    expect((await getGoalDetail(db, 'local', goal.id, TODAY))?.milestoneProgress.done).toBe(0);
    await expect(setMilestoneDone(ctx, 'missing', true)).rejects.toThrow('Milestone not found');
  });

  it('tombstones the milestones of a deleted goal', async () => {
    const ctx = context(db);
    const goal = await createGoal(ctx, goalDraft({ milestones: [ms('A')] }));
    await deleteGoal(ctx, goal.id);
    expect(await listMilestones(db, 'local', goal.id)).toHaveLength(0);
  });
});

describe('milestoneProgress and moveItem', () => {
  it('counts and rounds down', () => {
    expect(milestoneProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(milestoneProgress([{ completedAt: 'x' }, { completedAt: null }, { completedAt: null }]).percent).toBe(33);
    expect(milestoneProgress([{ completedAt: 'x' }]).percent).toBe(100);
  });
  it('moves within bounds only', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
