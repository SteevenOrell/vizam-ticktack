/**
 * Goal use cases: create (with at least one linked or new task), edit, link / unlink tasks, mark done, delete
 * (linked tasks are kept and unlinked), period history, and the read models for the Goals list and detail.
 * Every write goes through `writeEntity` (validation + outbox) inside `mutate`.
 */
import { z } from 'zod';

import {
  computeProgress,
  daysLeft,
  dueDateOf,
  endedPeriodsSince,
  goalRepeatIssue,
  goalSection,
  progressRange,
  type GoalSection,
  type LinkedTask,
  type PeriodRange,
  type Progress,
} from '../domain/goals';
import { addDays, localDateOf, type LocalDate } from '../domain/localDate';
import {
  categoryColorSchema,
  GOAL_HISTORY_MAX,
  goalPeriodSchema,
  goalRemindersSchema,
  goalSchema,
  hhmmSchema,
  idSchema,
  localDateSchema,
  type CategoryColor,
  type Goal,
  type GoalHistoryEntry,
  type RuleCore,
} from '../domain/models';
import type { SqlDriver } from './db/driver';
import { rowToEntity, type SqlRow } from './entities';
import { goalRepeatLimit, insertGoal, timingOf } from './goalBase';
import { defaultWindow, ensureOccurrences } from './occurrences';
import { getAgenda, getTaskItems, type AgendaItem } from './queries/agenda';
import { getEntity, listEntities, mutate, nowIso, tombstone, writeEntity, type DataContext } from './store';
import { clampSeriesToGoal, emptyDraft, insertTask } from './tasks';

export { GoalRepeatError } from './goalBase';

export class GoalNeedsTaskError extends Error {
  constructor() {
    super('A goal needs at least one task');
    this.name = 'GoalNeedsTaskError';
  }
}

export interface GoalOption {
  id: string;
  title: string;
}

export interface GoalChoice extends GoalOption {
  /** Last day a repeating task linked to this goal may run (null: no due date, the repeat still has to end). */
  repeatEnd: LocalDate | null;
}

/** Active goals for the task editor's goal selector, with the end a linked repeating task must respect. */
export async function getGoalOptions(
  db: SqlDriver,
  ownerId: string,
  today: LocalDate = localDateOf(new Date()),
): Promise<GoalChoice[]> {
  const goals = await listEntities(db, 'goals', ownerId, "status = 'active'", [], 'created_at');
  return goals.slice(0, 100).map((g) => ({ id: g.id, title: g.title, repeatEnd: goalRepeatLimit(g, today) }));
}

export const goalTitleSchema = goalSchema.shape.title;

/** A task created inline from the goal form. */
export const newGoalTaskSchema = z.object({
  title: z.string().trim().min(1, 'taskTitleRequired').max(200, 'titleTooLong'),
  date: localDateSchema.nullable(),
  startTime: hhmmSchema.nullable(),
  durationMin: z.number().int().min(1).max(1440).nullable(),
});
export type NewGoalTask = z.infer<typeof newGoalTaskSchema>;

/** What the goal form submits. `linkTaskIds` is the full set of existing tasks that should be linked. */
export const goalDraftSchema = z
  .object({
    title: z.string().trim().min(1, 'titleRequired').max(120, 'titleTooLong'),
    description: z.string().max(2000, 'descriptionTooLong').nullable(),
    period: goalPeriodSchema,
    startDate: localDateSchema.nullable(),
    dueDate: localDateSchema.nullable(),
    color: categoryColorSchema.nullable(),
    reminders: goalRemindersSchema,
    linkTaskIds: z.array(idSchema).max(200),
    newTasks: z.array(newGoalTaskSchema).max(30),
  })
  .superRefine((d, ctx) => {
    if (d.period === 'once' && !d.dueDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'dueRequired' });
    if (d.period !== 'once' && !d.startDate) {
      ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'startRequired' });
    }
    if (d.period === 'once' && d.startDate && d.dueDate && d.dueDate < d.startDate) {
      ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'dueBeforeStart' });
    }
    if (new Set(d.linkTaskIds).size + d.newTasks.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'needsTask' });
    }
  });
export type GoalDraft = z.infer<typeof goalDraftSchema>;

const todayOf = (ctx: Pick<DataContext, 'now'>) => localDateOf(ctx.now?.() ?? new Date());

function goalFields(d: GoalDraft) {
  return {
    title: d.title.trim(),
    description: d.description?.trim() ? d.description.trim() : null,
    period: d.period,
    startDate: d.startDate,
    targetDate: d.period === 'once' ? d.dueDate : null,
    color: d.color,
    reminders: { ...d.reminders, beforeDue: [...new Set(d.reminders.beforeDue)].sort((a, b) => a - b) },
  };
}

async function linkedTaskIds(db: SqlDriver, ownerId: string, goalId: string): Promise<string[]> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM tasks WHERE owner_id = ? AND goal_id = ? AND deleted = 0 AND parent_task_id IS NULL`,
    [ownerId, goalId],
  );
  return rows.map((r) => r.id);
}

/** Links existing tasks and creates the new ones. Returns the ids of new series (occurrences generated after). */
async function attachTasks(ctx: DataContext, goalId: string, link: readonly string[], create: readonly NewGoalTask[]) {
  for (const id of link) {
    const task = await getEntity(ctx.db, 'tasks', id, ctx.ownerId);
    if (!task || task.parentTaskId) throw new Error('Task not found');
    if (task.goalId !== goalId) await writeEntity(ctx, 'tasks', { ...task, goalId });
  }
  for (const n of create) {
    const parsed = newGoalTaskSchema.parse(n);
    await insertTask(ctx, {
      ...emptyDraft(parsed.date),
      title: parsed.title,
      startTime: parsed.date ? parsed.startTime : null,
      durationMin: parsed.durationMin,
      goalId,
    });
  }
}

/**
 * Repeating tasks in a goal must end: every linked series without an end, or ending after the goal's limit (due
 * date of a one-time goal, end of the current period of a periodic one), is ended on that limit. An end that is
 * already allowed is kept (never extended). Returns the ids of the changed series. Must run inside `mutate`.
 */
async function clampGoalSeries(ctx: DataContext, goal: Goal): Promise<string[]> {
  const limit = goalRepeatLimit(goal, todayOf(ctx));
  const series = await listEntities(
    ctx.db,
    'tasks',
    ctx.ownerId,
    'goal_id = ? AND recurrence_rule_id IS NOT NULL AND parent_task_id IS NULL',
    [goal.id],
  );
  const changed: string[] = [];
  for (const task of series) if (await clampSeriesToGoal(ctx, task, limit)) changed.push(task.id);
  return changed;
}

/** Rebuilds the occurrences of series whose rule was shortened (after the transaction). */
async function regenerate(ctx: DataContext, seriesIds: readonly string[]): Promise<void> {
  for (const seriesId of seriesIds) {
    await ensureOccurrences(ctx.db, ctx.ownerId, defaultWindow(todayOf(ctx)), { seriesId });
  }
}

/**
 * Repair pass for data written before the rule existed, or pulled from another device: ends every goal-linked
 * series that has no end or runs past its goal. Idempotent and write-free when nothing is wrong. Returns how many
 * series changed. Runs with the goal maintenance (app start, foreground, after changes).
 */
export async function enforceGoalRepeats(ctx: DataContext): Promise<number> {
  const today = todayOf(ctx);
  const rows = await ctx.db.all<{ goal_id: string }>(
    `SELECT DISTINCT t.goal_id FROM tasks t
       JOIN recurrence_rules r ON r.id = t.recurrence_rule_id AND r.owner_id = t.owner_id AND r.deleted = 0
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.goal_id IS NOT NULL AND t.parent_task_id IS NULL
       AND (r.end_type != 'onDate' OR r.end_date > r.start_date) LIMIT 500`,
    [ctx.ownerId],
  );
  const candidates: Goal[] = [];
  for (const row of rows) {
    const goal = await getEntity(ctx.db, 'goals', row.goal_id, ctx.ownerId);
    if (!goal) continue;
    const limit = goalRepeatLimit(goal, today);
    const series = await listEntities(ctx.db, 'tasks', ctx.ownerId, 'goal_id = ? AND recurrence_rule_id IS NOT NULL', [
      goal.id,
    ]);
    for (const task of series) {
      const rule = await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId as string, ctx.ownerId);
      if (rule && goalRepeatIssue(rule, limit)) {
        candidates.push(goal);
        break;
      }
    }
  }
  if (candidates.length === 0) return 0;
  const changed = await mutate(ctx, async () => {
    const ids: string[] = [];
    for (const goal of candidates) ids.push(...(await clampGoalSeries(ctx, goal)));
    return ids;
  });
  await regenerate(ctx, changed);
  return changed.length;
}

/** Creates a goal with its linked and new tasks in one transaction. At least one task is required. */
export async function createGoal(ctx: DataContext, input: GoalDraft): Promise<Goal> {
  const draft = goalDraftSchema.parse(input);
  const { goal, changed } = await mutate(ctx, async () => {
    const goal = await insertGoal(ctx, goalFields(draft));
    await attachTasks(ctx, goal.id, [...new Set(draft.linkTaskIds)], draft.newTasks);
    if ((await linkedTaskIds(ctx.db, ctx.ownerId, goal.id)).length === 0) throw new GoalNeedsTaskError();
    return { goal, changed: await clampGoalSeries(ctx, goal) };
  });
  await regenerate(ctx, changed);
  return goal;
}

/**
 * Saves the goal form: fields, the full set of linked tasks (missing ones are unlinked, never deleted) and new
 * tasks. A change of period or start clears the history (its periods no longer match). Linked repeating tasks that
 * would now run past the goal (earlier due date, other period, newly linked) are ended on the goal's limit.
 */
export async function updateGoal(ctx: DataContext, goalId: string, input: GoalDraft): Promise<Goal> {
  const draft = goalDraftSchema.parse(input);
  const { goal, changed } = await mutate(ctx, async () => {
    const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
    if (!goal) throw new Error('Goal not found');
    const keep = new Set(draft.linkTaskIds);
    for (const id of await linkedTaskIds(ctx.db, ctx.ownerId, goalId)) {
      if (keep.has(id)) continue;
      const task = await getEntity(ctx.db, 'tasks', id, ctx.ownerId);
      if (task) await writeEntity(ctx, 'tasks', { ...task, goalId: null });
    }
    await attachTasks(ctx, goalId, [...keep], draft.newTasks);
    if ((await linkedTaskIds(ctx.db, ctx.ownerId, goalId)).length === 0) throw new GoalNeedsTaskError();
    const fields = goalFields(draft);
    const reset = fields.period !== goal.period || fields.startDate !== goal.startDate;
    const saved = await writeEntity(ctx, 'goals', { ...goal, ...fields, history: reset ? [] : goal.history });
    return { goal: saved, changed: await clampGoalSeries(ctx, saved) };
  });
  await regenerate(ctx, changed);
  return goal;
}

/** Links more existing tasks to a goal (from the detail screen). A repeating task is ended on the goal's limit. */
export async function linkTasks(ctx: DataContext, goalId: string, taskIds: readonly string[]): Promise<void> {
  const changed = await mutate(ctx, async () => {
    const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
    if (!goal) throw new Error('Goal not found');
    await attachTasks(ctx, goalId, [...new Set(taskIds)], []);
    return clampGoalSeries(ctx, goal);
  });
  await regenerate(ctx, changed);
}

/** Unlinks one task (the task is kept). Refuses to remove the goal's last task. */
export async function unlinkTask(ctx: DataContext, goalId: string, taskId: string): Promise<void> {
  await mutate(ctx, async () => {
    const ids = await linkedTaskIds(ctx.db, ctx.ownerId, goalId);
    if (!ids.includes(taskId)) return;
    if (ids.length <= 1) throw new GoalNeedsTaskError();
    const task = await getEntity(ctx.db, 'tasks', taskId, ctx.ownerId);
    if (task) await writeEntity(ctx, 'tasks', { ...task, goalId: null });
  });
}

/** Marks a goal done (Completed section) or active again. */
export async function setGoalDone(ctx: DataContext, goalId: string, done: boolean): Promise<void> {
  await mutate(ctx, async () => {
    const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
    if (!goal) throw new Error('Goal not found');
    await writeEntity(ctx, 'goals', {
      ...goal,
      status: done ? 'achieved' : 'active',
      achievedAt: done ? (goal.achievedAt ?? nowIso(ctx)) : null,
    });
  });
}

/** Archives a goal (hidden from the list; tasks keep their link). Used when its last task is deleted. */
export async function archiveGoal(ctx: DataContext, goalId: string): Promise<void> {
  await mutate(ctx, async () => {
    const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
    if (goal) await writeEntity(ctx, 'goals', { ...goal, status: 'archived' });
  });
}

/** Deletes a goal: linked tasks are kept and unlinked, goal reminders are removed, the goal is tombstoned. */
export async function deleteGoal(ctx: DataContext, goalId: string): Promise<void> {
  await mutate(ctx, async () => {
    const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
    if (!goal) return;
    for (const task of await listEntities(ctx.db, 'tasks', ctx.ownerId, 'goal_id = ?', [goalId])) {
      await writeEntity(ctx, 'tasks', { ...task, goalId: null });
    }
    const reminders = await listEntities(ctx.db, 'reminders', ctx.ownerId, "target_type = 'goal' AND target_id = ?", [
      goalId,
    ]);
    for (const r of reminders) await tombstone(ctx, 'reminders', r.id);
    await tombstone(ctx, 'goals', goalId);
  });
}

/**
 * The goal that deleting `taskId` would leave without any task (the task is its only live linked task), or null.
 * Used to warn before a task delete.
 */
export async function goalLeftEmptyBy(db: SqlDriver, ownerId: string, taskId: string): Promise<GoalOption | null> {
  const row = await db.first<{ id: string; title: string; others: number }>(
    `SELECT g.id, g.title,
       (SELECT COUNT(*) FROM tasks o WHERE o.owner_id = g.owner_id AND o.goal_id = g.id AND o.deleted = 0
          AND o.parent_task_id IS NULL AND o.id != t.id) AS others
     FROM tasks t JOIN goals g ON g.id = t.goal_id AND g.owner_id = t.owner_id AND g.deleted = 0
     WHERE t.id = ? AND t.owner_id = ? AND t.deleted = 0 AND g.status != 'archived'`,
    [taskId, ownerId],
  );
  return row && row.others === 0 ? { id: row.id, title: row.title } : null;
}

// ---------- progress ----------

interface LinkedRow {
  id: string;
  goal_id: string;
  status: 'open' | 'done' | 'cancelled';
  date: string | null;
  recurrence_rule_id: string | null;
}

/** Linked tasks of the given goals with their rules and done / skipped occurrences, by goal id. */
async function loadLinked(db: SqlDriver, ownerId: string, goalIds: readonly string[]) {
  const byGoal = new Map<string, LinkedTask[]>();
  if (goalIds.length === 0) return byGoal;
  const rows: LinkedRow[] = [];
  for (let i = 0; i < goalIds.length; i += 400) {
    const chunk = goalIds.slice(i, i + 400);
    rows.push(
      ...(await db.all<LinkedRow>(
        `SELECT id, goal_id, status, date, recurrence_rule_id FROM tasks
         WHERE owner_id = ? AND deleted = 0 AND parent_task_id IS NULL
           AND goal_id IN (${chunk.map(() => '?').join(', ')}) LIMIT 5000`,
        [ownerId, ...chunk],
      )),
    );
  }
  const seriesIds = rows.filter((r) => r.recurrence_rule_id).map((r) => r.id);
  const rules = new Map<string, RuleCore>();
  const occ = new Map<string, Map<LocalDate, 'scheduled' | 'done' | 'skipped'>>();
  for (let i = 0; i < seriesIds.length; i += 400) {
    const chunk = seriesIds.slice(i, i + 400);
    const marks = chunk.map(() => '?').join(', ');
    for (const r of await db.all<SqlRow>(
      `SELECT * FROM recurrence_rules WHERE owner_id = ? AND deleted = 0 AND series_id IN (${marks})`,
      [ownerId, ...chunk],
    )) {
      const rule = rowToEntity('recurrenceRules', r);
      rules.set(rule.seriesId, rule);
    }
    for (const o of await db.all<{ series_id: string; original_date: string; status: 'done' | 'skipped' }>(
      `SELECT series_id, original_date, status FROM task_occurrences
       WHERE owner_id = ? AND deleted = 0 AND status != 'scheduled' AND series_id IN (${marks}) LIMIT 20000`,
      [ownerId, ...chunk],
    )) {
      const m = occ.get(o.series_id) ?? new Map();
      m.set(o.original_date, o.status);
      occ.set(o.series_id, m);
    }
  }
  for (const r of rows) {
    const list = byGoal.get(r.goal_id) ?? [];
    list.push({
      id: r.id,
      status: r.status,
      date: r.date,
      rule: r.recurrence_rule_id ? (rules.get(r.id) ?? null) : null,
      occurrences: occ.get(r.id),
    });
    byGoal.set(r.goal_id, list);
  }
  return byGoal;
}

export interface GoalSummary {
  id: string;
  title: string;
  description: string | null;
  period: Goal['period'];
  status: Goal['status'];
  color: CategoryColor | null;
  due: LocalDate | null;
  daysLeft: number | null;
  range: PeriodRange;
  progress: Progress;
  section: GoalSection;
  taskCount: number;
}

function summarize(goal: Goal, linked: readonly LinkedTask[], today: LocalDate): GoalSummary {
  const timing = timingOf(goal);
  const range = progressRange(timing, today);
  const progress = computeProgress(linked, range, goal.period !== 'once');
  const due = dueDateOf(timing, today);
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    period: goal.period,
    status: goal.status,
    color: goal.color,
    due,
    daysLeft: due ? daysLeft(due, today) : null,
    range,
    progress,
    section: goalSection({
      status: goal.status,
      period: goal.period,
      percent: progress.percent,
      total: progress.total,
      due,
      today,
    }),
    taskCount: linked.length,
  };
}

const SECTION_ORDER: Record<GoalSection, number> = { overdue: 0, active: 1, completed: 2 };

/** Goals list (archived goals are hidden): overdue, then active by due date, then completed. */
export async function getGoalList(db: SqlDriver, ownerId: string, today: LocalDate): Promise<GoalSummary[]> {
  const goals = await listEntities(db, 'goals', ownerId, "status != 'archived'");
  const linked = await loadLinked(
    db,
    ownerId,
    goals.map((g) => g.id),
  );
  return goals
    .map((g) => summarize(g, linked.get(g.id) ?? [], today))
    .sort(
      (a, b) =>
        SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        a.title.localeCompare(b.title),
    );
}

export interface GoalDetail {
  goal: Goal;
  summary: GoalSummary;
  /** One row per linked task: one-off tasks, and for a series its next open occurrence (or the latest one). */
  items: AgendaItem[];
  linkedIds: string[];
  history: GoalHistoryEntry[];
}

export async function getGoalDetail(
  db: SqlDriver,
  ownerId: string,
  goalId: string,
  today: LocalDate,
): Promise<GoalDetail | null> {
  const goal = await getEntity(db, 'goals', goalId, ownerId);
  if (!goal) return null;
  const linked = (await loadLinked(db, ownerId, [goalId])).get(goalId) ?? [];
  const oneOff = linked.filter((t) => !t.rule).map((t) => t.id);
  const series = new Set(linked.filter((t) => t.rule).map((t) => t.id));
  const items = await getTaskItems(db, ownerId, oneOff);
  if (series.size) {
    const window = await getAgenda(db, ownerId, addDays(today, -14), addDays(today, 45), today);
    for (const id of series) {
      const occs = window.filter((i) => i.taskId === id);
      const pick =
        occs.find((i) => i.date >= today && !i.done) ??
        occs.find((i) => i.date >= today) ??
        occs.filter((i) => i.date < today).at(-1);
      if (pick) items.push(pick);
    }
  }
  items.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title));
  return {
    goal,
    summary: summarize(goal, linked, today),
    // The goal is the screen itself: rows leave its name out to keep room for date and category.
    items: items.map((i) => ({ ...i, goalTitle: null })),
    linkedIds: linked.map((t) => t.id),
    history: [...goal.history].reverse(),
  };
}

export interface GoalForm {
  goal: Goal;
  draft: GoalDraft;
}

/** Loads a goal into the form draft (linked tasks included). */
export async function loadGoalForm(ctx: Pick<DataContext, 'db' | 'ownerId'>, goalId: string): Promise<GoalForm | null> {
  const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
  if (!goal) return null;
  return {
    goal,
    draft: {
      title: goal.title,
      description: goal.description,
      period: goal.period,
      startDate: goal.startDate,
      dueDate: goal.period === 'once' ? goal.targetDate : null,
      color: goal.color,
      reminders: goal.reminders,
      linkTaskIds: await linkedTaskIds(ctx.db, ctx.ownerId, goalId),
      newTasks: [],
    },
  };
}

export interface LinkableTask {
  id: string;
  title: string;
  date: string | null;
  start_time: string | null;
  recurring: number;
  done: number;
  goal_id: string | null;
  goal_title: string | null;
}

/** Tasks that can be linked (top-level, not deleted), newest first; filtered by a case-insensitive search. */
export async function getLinkableTasks(db: SqlDriver, ownerId: string, search = ''): Promise<LinkableTask[]> {
  const q = search.trim().toLowerCase().slice(0, 100);
  return db.all<LinkableTask>(
    `SELECT t.id, t.title, t.date, t.start_time, (t.recurrence_rule_id IS NOT NULL) AS recurring,
       (t.status = 'done') AS done, t.goal_id, g.title AS goal_title
     FROM tasks t LEFT JOIN goals g ON g.id = t.goal_id AND g.owner_id = t.owner_id AND g.deleted = 0
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.status != 'cancelled'
       AND (? = '' OR instr(lower(t.title), ?) > 0)
     ORDER BY t.status = 'done', t.created_at DESC LIMIT 200`,
    [ownerId, q, q],
  );
}

// ---------- period history ----------

/**
 * Appends the ended periods of every active periodic goal to its history (period, % reached), at most 12 new
 * periods per goal per run and 60 kept. Idempotent: periods already recorded are skipped. Returns how many goals
 * changed. Runs on app start and when the app comes to the foreground.
 */
export async function rollGoalHistory(ctx: DataContext, today: LocalDate = todayOf(ctx)): Promise<number> {
  const goals = await listEntities(ctx.db, 'goals', ctx.ownerId, "status = 'active' AND period != 'once'");
  if (goals.length === 0) return 0;
  const linked = await loadLinked(
    ctx.db,
    ctx.ownerId,
    goals.map((g) => g.id),
  );
  const updates: Goal[] = [];
  for (const goal of goals) {
    const timing = timingOf(goal);
    const anchor = goal.startDate ?? timing.createdOn;
    const lastEnd = goal.history.at(-1)?.end ?? null;
    const ended = endedPeriodsSince(goal.period, anchor, lastEnd, today);
    if (ended.length === 0) continue;
    const entries = ended.map((range) => {
      const p = computeProgress(linked.get(goal.id) ?? [], range, true);
      return { start: range.start, end: range.end, percent: p.percent, done: p.done, total: p.total };
    });
    updates.push({ ...goal, history: [...goal.history, ...entries].slice(-GOAL_HISTORY_MAX) });
  }
  if (updates.length === 0) return 0;
  await mutate(ctx, async () => {
    for (const g of updates) await writeEntity(ctx, 'goals', g);
  });
  return updates.length;
}
