/**
 * Read models for Today and Calendar: one-off tasks, task occurrences (with per-occurrence overrides falling back to
 * the series template) and routine occurrences, for a date range. Ensures the range is materialised first. Rows
 * carry what the list preview needs: notes, category name, goal title and the subtasks with their check state.
 */
import { addDays, diffDays, localDateOf, parseYmd, type LocalDate } from '../../domain/localDate';
import type { CategoryColor, RecurrenceRule } from '../../domain/models';
import { parseOccurrenceId } from '../../domain/recurrence/generator';
import type { SqlDriver } from '../db/driver';
import { defaultWindow, ensureOccurrences } from '../occurrences';
import { getEntity } from '../store';

export type AgendaKind = 'task' | 'occurrence' | 'routine';

export interface SubtaskPreview {
  id: string;
  title: string;
  done: boolean;
}

export interface AgendaItem {
  /** Unique within a list: task id, or occurrence id. */
  key: string;
  kind: AgendaKind;
  /** Task id (one-off or series template) or routine id. */
  taskId: string;
  occurrenceId: string | null;
  title: string;
  date: LocalDate;
  startTime: string | null;
  durationMin: number | null;
  done: boolean;
  priority: number;
  categoryColor: CategoryColor | null;
  categoryName: string | null;
  goalTitle: string | null;
  notes: string | null;
  subtasks: { total: number; done: number };
  /** Subtasks (routine steps for routines) in order, with their state for this item or occurrence. */
  subtaskItems: SubtaskPreview[];
  recurring: boolean;
}

interface TaskRow {
  id: string;
  title: string;
  date: string;
  start_time: string | null;
  duration_min: number | null;
  status: string;
  priority: number;
  notes: string | null;
  color: string | null;
  category_name: string | null;
  goal_title: string | null;
  completed_at?: string | null;
}

interface OccRow {
  id: string;
  series_id: string;
  series_type: 'task' | 'routine';
  date: string;
  status: string;
  completed_step_ids: string;
  completed_at: string | null;
  o_title: string | null;
  o_start: string | null;
  o_duration: number | null;
  o_notes: string | null;
  s_title: string;
  s_start: string | null;
  s_duration: number | null;
  s_notes: string | null;
  priority: number;
  color: string | null;
  category_name: string | null;
  goal_title: string | null;
  steps: string | null;
}

interface SubRow {
  id: string;
  parent_task_id: string;
  title: string;
  status: string;
}

const CATEGORY_COLORS = new Set(['ember', 'sage', 'sky', 'plum', 'moss', 'sand', 'rose', 'slate']);
const asColor = (c: string | null) => (c && CATEGORY_COLORS.has(c) ? (c as CategoryColor) : null);

function safeJsonArray(text: string | null): unknown[] {
  try {
    const v: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Sort: timed items by start time, then all-day items by priority (high first) and title. */
export function compareAgenda(a: AgendaItem, b: AgendaItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startTime && b.startTime && a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  if (!!a.startTime !== !!b.startTime) return a.startTime ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.title.localeCompare(b.title);
}

const TASK_COLUMNS = `t.id, t.title, t.date, t.start_time, t.duration_min, t.status, t.priority, t.notes, c.color,
       c.name AS category_name, g.title AS goal_title, t.completed_at`;
const TASK_JOINS = `LEFT JOIN categories c ON c.id = t.category_id AND c.owner_id = t.owner_id AND c.deleted = 0
     LEFT JOIN goals g ON g.id = t.goal_id AND g.owner_id = t.owner_id AND g.deleted = 0`;

const cleanNotes = (n: string | null) => (n && n.trim() ? n : null);

function taskItem(t: TaskRow): AgendaItem {
  return {
    key: t.id,
    kind: 'task',
    taskId: t.id,
    occurrenceId: null,
    title: t.title,
    date: t.date,
    startTime: t.start_time,
    durationMin: t.duration_min,
    done: t.status === 'done',
    priority: t.priority,
    categoryColor: asColor(t.color),
    categoryName: t.category_name,
    goalTitle: t.goal_title,
    notes: cleanNotes(t.notes),
    subtasks: { total: 0, done: 0 },
    subtaskItems: [],
    recurring: false,
  };
}

/** Loads the subtasks of the listed tasks / series (one query per 400 parents) and attaches them to the items. */
async function attachSubtasks(db: SqlDriver, ownerId: string, items: AgendaItem[], ticked: Map<string, Set<string>>) {
  const parents = [...new Set(items.filter((i) => i.kind !== 'routine').map((i) => i.taskId))];
  const byParent = new Map<string, SubRow[]>();
  for (let i = 0; i < parents.length; i += 400) {
    const chunk = parents.slice(i, i + 400);
    const rows = await db.all<SubRow>(
      `SELECT id, parent_task_id, title, status FROM tasks
       WHERE owner_id = ? AND deleted = 0 AND parent_task_id IN (${chunk.map(() => '?').join(', ')})
       ORDER BY parent_task_id, sort_order LIMIT 12000`,
      [ownerId, ...chunk],
    );
    for (const r of rows) {
      const list = byParent.get(r.parent_task_id) ?? [];
      list.push(r);
      byParent.set(r.parent_task_id, list);
    }
  }
  for (const item of items) {
    if (item.kind === 'routine') continue;
    const subs = byParent.get(item.taskId) ?? [];
    const done = item.occurrenceId ? (ticked.get(item.occurrenceId) ?? new Set<string>()) : null;
    item.subtaskItems = subs.map((s) => ({
      id: s.id,
      title: s.title,
      done: done ? done.has(s.id) : s.status === 'done',
    }));
    item.subtasks = { total: item.subtaskItems.length, done: item.subtaskItems.filter((s) => s.done).length };
  }
}

function routineSteps(steps: string | null, ticked: Set<string>): SubtaskPreview[] {
  return safeJsonArray(steps).flatMap((s) => {
    const step = s as { id?: unknown; title?: unknown } | null;
    return step && typeof step.id === 'string' && typeof step.title === 'string'
      ? [{ id: step.id, title: step.title, done: ticked.has(step.id) }]
      : [];
  });
}

const OCC_SELECT = `SELECT o.id, o.series_id, o.series_type, o.date, o.status, o.completed_step_ids,
       o.completed_at, o.title AS o_title, o.start_time AS o_start, o.duration_min AS o_duration, o.notes AS o_notes,
       COALESCE(t.title, r.title) AS s_title, COALESCE(t.start_time, r.start_time) AS s_start,
       COALESCE(t.duration_min, NULL) AS s_duration, t.notes AS s_notes, COALESCE(t.priority, 0) AS priority,
       c.color, c.name AS category_name, g.title AS goal_title, r.steps
     FROM task_occurrences o
     LEFT JOIN tasks t ON o.series_type = 'task' AND t.id = o.series_id AND t.owner_id = o.owner_id AND t.deleted = 0
     LEFT JOIN routines r ON o.series_type = 'routine' AND r.id = o.series_id AND r.owner_id = o.owner_id
       AND r.deleted = 0 AND r.active = 1
     LEFT JOIN categories c ON c.id = COALESCE(t.category_id, r.category_id) AND c.owner_id = o.owner_id
       AND c.deleted = 0
     LEFT JOIN goals g ON g.id = t.goal_id AND g.owner_id = o.owner_id AND g.deleted = 0`;

/** Row for one occurrence (its own overrides first, then the series). Records its ticked steps in `ticked`. */
function occurrenceItem(o: OccRow, ticked: Map<string, Set<string>>): AgendaItem {
  const done = new Set(safeJsonArray(o.completed_step_ids).filter((x): x is string => typeof x === 'string'));
  ticked.set(o.id, done);
  const isRoutine = o.series_type === 'routine';
  const steps = isRoutine ? routineSteps(o.steps, done) : [];
  return {
    key: o.id,
    kind: isRoutine ? 'routine' : 'occurrence',
    taskId: o.series_id,
    occurrenceId: o.id,
    title: o.o_title ?? o.s_title,
    date: o.date,
    startTime: o.o_start ?? o.s_start,
    durationMin: o.o_duration ?? o.s_duration,
    done: o.status === 'done',
    priority: o.priority,
    categoryColor: asColor(o.color),
    categoryName: o.category_name,
    goalTitle: o.goal_title,
    notes: cleanNotes(o.o_notes ?? o.s_notes),
    subtasks: { total: steps.length, done: steps.filter((s) => s.done).length },
    subtaskItems: steps,
    recurring: true,
  };
}

/** Items between `from` and `to` (inclusive). The range is capped at 62 days by the materialiser. */
export async function getAgenda(
  db: SqlDriver,
  ownerId: string,
  from: LocalDate,
  to: LocalDate,
  today: LocalDate,
): Promise<AgendaItem[]> {
  await ensureOccurrences(db, ownerId, defaultWindow(today));
  if (from < defaultWindow(today).from || to > defaultWindow(today).to) {
    await ensureOccurrences(db, ownerId, { from, to });
  }

  const tasks = await db.all<TaskRow>(
    `SELECT ${TASK_COLUMNS}
     FROM tasks t
     ${TASK_JOINS}
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
       AND t.status != 'cancelled' AND t.date BETWEEN ? AND ?
     LIMIT 1000`,
    [ownerId, from, to],
  );

  const occurrences = await db.all<OccRow>(
    `${OCC_SELECT}
     WHERE o.owner_id = ? AND o.deleted = 0 AND o.status != 'skipped' AND o.date BETWEEN ? AND ?
       AND (t.id IS NOT NULL OR r.id IS NOT NULL)
     LIMIT 2000`,
    [ownerId, from, to],
  );

  const items: AgendaItem[] = tasks.map(taskItem);
  const ticked = new Map<string, Set<string>>();

  for (const o of occurrences) items.push(occurrenceItem(o, ticked));
  await attachSubtasks(db, ownerId, items, ticked);
  return items.sort(compareAgenda);
}

/**
 * Rows for given one-off tasks whatever their date (goal detail). Undated tasks get `date: ''` (shown under
 * "No date"); rows keep the same preview data as Today.
 */
export async function getTaskItems(db: SqlDriver, ownerId: string, ids: readonly string[]): Promise<AgendaItem[]> {
  const items: AgendaItem[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await db.all<Omit<TaskRow, 'date'> & { date: string | null }>(
      `SELECT ${TASK_COLUMNS}
       FROM tasks t
       ${TASK_JOINS}
       WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
         AND t.id IN (${chunk.map(() => '?').join(', ')})`,
      [ownerId, ...chunk],
    );
    items.push(...rows.map((r) => taskItem({ ...r, date: r.date ?? '' })));
  }
  await attachSubtasks(db, ownerId, items, new Map());
  return items;
}

export interface TodayView {
  date: LocalDate;
  overdue: AgendaItem[];
  scheduled: AgendaItem[];
  anytime: AgendaItem[];
  routines: AgendaItem[];
  done: AgendaItem[];
  plannedMin: number;
  doneMin: number;
  capacityMin: number;
}

/** Today groups (DESIGN.md section 7.3): overdue one-offs, scheduled, anytime, routines, done. */
export async function getTodayView(db: SqlDriver, ownerId: string, today: LocalDate): Promise<TodayView> {
  const items = await getAgenda(db, ownerId, today, today, today);
  const overdueRows = await db.all<TaskRow>(
    `SELECT ${TASK_COLUMNS}
     FROM tasks t
     ${TASK_JOINS}
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
       AND t.status = 'open' AND t.date < ?
     ORDER BY t.date DESC, t.priority DESC LIMIT 50`,
    [ownerId, today],
  );
  const profile = await db.first<{ daily_capacity_min: number }>(
    'SELECT daily_capacity_min FROM profile WHERE owner_id = ? AND deleted = 0 LIMIT 1',
    [ownerId],
  );

  const overdue = overdueRows.map(taskItem);
  await attachSubtasks(db, ownerId, overdue, new Map());
  const open = items.filter((i) => !i.done);
  const minutes = (list: AgendaItem[]) => list.reduce((sum, i) => sum + (i.durationMin ?? 0), 0);
  const tasksOnly = items.filter((i) => i.kind !== 'routine');
  return {
    date: today,
    overdue,
    scheduled: open.filter((i) => i.kind !== 'routine' && i.startTime),
    anytime: open.filter((i) => i.kind !== 'routine' && !i.startTime),
    routines: items.filter((i) => i.kind === 'routine'),
    done: items.filter((i) => i.done && i.kind !== 'routine'),
    plannedMin: minutes(tasksOnly),
    doneMin: minutes(tasksOnly.filter((i) => i.done)),
    capacityMin: profile?.daily_capacity_min ?? 480,
  };
}

/** How far back the overdue list, the missed occurrences and the history look. */
export const OVERDUE_LIMIT = 200;
export const HISTORY_DAYS = 60;
export const MISSED_DAYS = 30;

/**
 * Overdue view: open one-off tasks dated before today, oldest first. Repeating tasks are not listed here: an
 * occurrence that was not done shows as "missed" in the history instead (the next one is already planned).
 */
export async function getOverdue(db: SqlDriver, ownerId: string, today: LocalDate): Promise<AgendaItem[]> {
  const rows = await db.all<TaskRow>(
    `SELECT ${TASK_COLUMNS}
     FROM tasks t
     ${TASK_JOINS}
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
       AND t.status = 'open' AND t.date < ?
     ORDER BY t.date, t.start_time IS NULL, t.start_time, t.priority DESC, t.title LIMIT ${OVERDUE_LIMIT}`,
    [ownerId, today],
  );
  const items = rows.map(taskItem);
  await attachSubtasks(db, ownerId, items, new Map());
  return items;
}

export interface HistoryEntry {
  item: AgendaItem;
  /** Day the entry is filed under: the day it was completed, or the planned day of a missed occurrence. */
  day: LocalDate;
  /** A past occurrence of a repeating task that was never done. */
  missed: boolean;
}

/**
 * History: tasks and occurrences completed in the last `HISTORY_DAYS` days (filed under the local day they were
 * completed) and occurrences of repeating tasks missed in the last `MISSED_DAYS` days. Newest day first; inside a
 * day, in time order. Routines are not included (their history comes with the routine runner).
 */
export async function getHistory(db: SqlDriver, ownerId: string, today: LocalDate): Promise<HistoryEntry[]> {
  const from = addDays(today, -HISTORY_DAYS);
  const missedFrom = addDays(today, -MISSED_DAYS);
  // Past occurrences outside the default window are generated first, so a missed day is not silently absent.
  await ensureOccurrences(db, ownerId, { from: missedFrom, to: today });
  // Completion times are stored in UTC: compare with the UTC instant of local midnight on the first day.
  const start = parseYmd(from);
  const since = new Date(start.y, start.m - 1, start.d).toISOString();

  const tasks = await db.all<Omit<TaskRow, 'date'> & { date: string | null }>(
    `SELECT ${TASK_COLUMNS}
     FROM tasks t
     ${TASK_JOINS}
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
       AND t.status = 'done' AND (t.completed_at >= ? OR (t.completed_at IS NULL AND t.date >= ?))
     ORDER BY t.completed_at DESC LIMIT 500`,
    [ownerId, since, from],
  );
  const occurrences = await db.all<OccRow>(
    `${OCC_SELECT}
     WHERE o.owner_id = ? AND o.deleted = 0 AND o.series_type = 'task' AND t.id IS NOT NULL
       AND ((o.status = 'done' AND (o.completed_at >= ? OR (o.completed_at IS NULL AND o.date >= ?)))
         OR (o.status = 'scheduled' AND o.date >= ? AND o.date < ?))
     ORDER BY o.date DESC LIMIT 1000`,
    [ownerId, since, from, missedFrom, today],
  );

  const dayOf = (completedAt: string | null | undefined, fallback: string | null) => {
    const at = completedAt ? new Date(completedAt) : null;
    return at && !Number.isNaN(at.getTime()) ? localDateOf(at) : (fallback ?? today);
  };
  const ticked = new Map<string, Set<string>>();
  const entries: HistoryEntry[] = [];
  for (const t of tasks) {
    const item = taskItem({ ...t, date: t.date ?? '' });
    entries.push({ item, day: dayOf(t.completed_at, t.date), missed: false });
  }
  for (const o of occurrences) {
    const item = occurrenceItem(o, ticked);
    entries.push({ item, day: item.done ? dayOf(o.completed_at, o.date) : o.date, missed: !item.done });
  }
  const kept = entries.filter((e) => e.day >= from);
  await attachSubtasks(
    db,
    ownerId,
    kept.map((e) => e.item),
    ticked,
  );
  // Inside a day the planned date does not matter (a task from last week can be done today): time, then title.
  return kept.sort((a, b) =>
    a.day !== b.day ? (a.day < b.day ? 1 : -1) : compareAgenda({ ...a.item, date: a.day }, { ...b.item, date: b.day }),
  );
}

export interface TaskDetail {
  /** The task or occurrence as a list row (drives complete, delete, quick edit and subtask ticks). */
  item: AgendaItem;
  /** Repeat rule of the series; null for a one-off task. */
  rule: RecurrenceRule | null;
  goal: { id: string; title: string } | null;
  /** A series opened without one of its occurrences: it can be edited or deleted, not completed. */
  template: boolean;
}

/**
 * Read model of the task details screen: a one-off task, or one occurrence of a series (`occId`), with its repeat
 * rule and goal. Null when the task is missing, deleted, not owned, or the occurrence does not exist.
 */
export async function getTaskDetail(
  db: SqlDriver,
  ownerId: string,
  taskId: string,
  occId: string | null,
): Promise<TaskDetail | null> {
  const task = await getEntity(db, 'tasks', taskId, ownerId);
  if (!task || task.parentTaskId) return null;
  const rule = task.recurrenceRuleId ? await getEntity(db, 'recurrenceRules', task.recurrenceRuleId, ownerId) : null;
  const goalRow = task.goalId ? await getEntity(db, 'goals', task.goalId, ownerId) : null;
  const goal = goalRow ? { id: goalRow.id, title: goalRow.title } : null;
  const ticked = new Map<string, Set<string>>();

  let item: AgendaItem | null = null;
  if (rule && occId) {
    const parsed = parseOccurrenceId(occId);
    if (!parsed || parsed.seriesId !== task.id) return null;
    // An occurrence far from today may not be generated yet.
    await ensureOccurrences(db, ownerId, { from: parsed.originalDate, to: parsed.originalDate }, { seriesId: task.id });
    const row = await db.first<OccRow>(
      `${OCC_SELECT}
       WHERE o.owner_id = ? AND o.id = ? AND o.deleted = 0 AND o.status != 'skipped' AND t.id IS NOT NULL`,
      [ownerId, occId],
    );
    if (!row) return null;
    item = occurrenceItem(row, ticked);
  } else {
    const row = await db.first<Omit<TaskRow, 'date'> & { date: string | null }>(
      `SELECT ${TASK_COLUMNS}
       FROM tasks t
       ${TASK_JOINS}
       WHERE t.owner_id = ? AND t.deleted = 0 AND t.id = ?`,
      [ownerId, task.id],
    );
    if (!row) return null;
    item = { ...taskItem({ ...row, date: row.date ?? rule?.startDate ?? '' }), recurring: !!rule };
  }
  await attachSubtasks(db, ownerId, [item], ticked);
  return { item, rule, goal, template: !!rule && !occId };
}

export interface DayLoad {
  date: LocalDate;
  total: number;
  done: number;
}

/** Per-day counts for the week strip and month dots. */
export function loadByDay(items: AgendaItem[], from: LocalDate, to: LocalDate): DayLoad[] {
  const days = diffDays(to, from) + 1;
  const out: DayLoad[] = Array.from({ length: Math.max(0, days) }, (_, i) => ({
    date: addDays(from, i),
    total: 0,
    done: 0,
  }));
  for (const item of items) {
    const slot = out[diffDays(item.date, from)];
    if (!slot) continue;
    slot.total += 1;
    if (item.done) slot.done += 1;
  }
  return out;
}

export interface CategoryOption {
  id: string;
  name: string;
  color: CategoryColor;
}

export async function getCategoryOptions(db: SqlDriver, ownerId: string): Promise<CategoryOption[]> {
  const rows = await db.all<{ id: string; name: string; color: string }>(
    `SELECT id, name, color FROM categories WHERE owner_id = ? AND deleted = 0 AND archived = 0
     ORDER BY sort_order, name LIMIT 100`,
    [ownerId],
  );
  return rows.flatMap((r) => {
    const color = asColor(r.color);
    return color ? [{ id: r.id, name: r.name, color }] : [];
  });
}
