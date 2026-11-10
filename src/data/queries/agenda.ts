/**
 * Read models for Today and Calendar: one-off tasks, task occurrences (with per-occurrence overrides falling back to
 * the series template) and routine occurrences, for a date range. Ensures the range is materialised first.
 */
import { addDays, diffDays, type LocalDate } from '../../domain/localDate';
import type { CategoryColor } from '../../domain/models';
import type { SqlDriver } from '../db/driver';
import { defaultWindow, ensureOccurrences } from '../occurrences';

export type AgendaKind = 'task' | 'occurrence' | 'routine';

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
  subtasks: { total: number; done: number };
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
  color: string | null;
  sub_total: number;
  sub_done: number;
}

interface OccRow {
  id: string;
  series_id: string;
  series_type: 'task' | 'routine';
  date: string;
  status: string;
  completed_step_ids: string;
  o_title: string | null;
  o_start: string | null;
  o_duration: number | null;
  s_title: string;
  s_start: string | null;
  s_duration: number | null;
  priority: number;
  color: string | null;
  sub_total: number;
  steps: string | null;
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
    `SELECT t.id, t.title, t.date, t.start_time, t.duration_min, t.status, t.priority, c.color,
       (SELECT count(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.owner_id = t.owner_id AND s.deleted = 0) AS sub_total,
       (SELECT count(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.owner_id = t.owner_id AND s.deleted = 0
          AND s.status = 'done') AS sub_done
     FROM tasks t
     LEFT JOIN categories c ON c.id = t.category_id AND c.owner_id = t.owner_id AND c.deleted = 0
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
       AND t.status != 'cancelled' AND t.date BETWEEN ? AND ?
     LIMIT 1000`,
    [ownerId, from, to],
  );

  const occurrences = await db.all<OccRow>(
    `SELECT o.id, o.series_id, o.series_type, o.date, o.status, o.completed_step_ids,
       o.title AS o_title, o.start_time AS o_start, o.duration_min AS o_duration,
       COALESCE(t.title, r.title) AS s_title, COALESCE(t.start_time, r.start_time) AS s_start,
       COALESCE(t.duration_min, NULL) AS s_duration, COALESCE(t.priority, 0) AS priority, c.color,
       (SELECT count(*) FROM tasks s WHERE s.parent_task_id = o.series_id AND s.owner_id = o.owner_id
          AND s.deleted = 0) AS sub_total,
       r.steps
     FROM task_occurrences o
     LEFT JOIN tasks t ON o.series_type = 'task' AND t.id = o.series_id AND t.owner_id = o.owner_id AND t.deleted = 0
     LEFT JOIN routines r ON o.series_type = 'routine' AND r.id = o.series_id AND r.owner_id = o.owner_id
       AND r.deleted = 0 AND r.active = 1
     LEFT JOIN categories c ON c.id = COALESCE(t.category_id, r.category_id) AND c.owner_id = o.owner_id
       AND c.deleted = 0
     WHERE o.owner_id = ? AND o.deleted = 0 AND o.status != 'skipped' AND o.date BETWEEN ? AND ?
       AND (t.id IS NOT NULL OR r.id IS NOT NULL)
     LIMIT 2000`,
    [ownerId, from, to],
  );

  const items: AgendaItem[] = tasks.map((t) => ({
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
    subtasks: { total: t.sub_total, done: t.sub_done },
    recurring: false,
  }));

  for (const o of occurrences) {
    const ticked = safeJsonArray(o.completed_step_ids).length;
    const isRoutine = o.series_type === 'routine';
    const steps = isRoutine ? safeJsonArray(o.steps) : [];
    items.push({
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
      subtasks: {
        total: isRoutine ? steps.length : o.sub_total,
        done: Math.min(ticked, isRoutine ? steps.length : o.sub_total),
      },
      recurring: true,
    });
  }
  return items.sort(compareAgenda);
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
    `SELECT t.id, t.title, t.date, t.start_time, t.duration_min, t.status, t.priority, c.color,
       (SELECT count(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.owner_id = t.owner_id AND s.deleted = 0) AS sub_total,
       (SELECT count(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.owner_id = t.owner_id AND s.deleted = 0
          AND s.status = 'done') AS sub_done
     FROM tasks t
     LEFT JOIN categories c ON c.id = t.category_id AND c.owner_id = t.owner_id AND c.deleted = 0
     WHERE t.owner_id = ? AND t.deleted = 0 AND t.parent_task_id IS NULL AND t.recurrence_rule_id IS NULL
       AND t.status = 'open' AND t.date < ?
     ORDER BY t.date DESC, t.priority DESC LIMIT 50`,
    [ownerId, today],
  );
  const profile = await db.first<{ daily_capacity_min: number }>(
    'SELECT daily_capacity_min FROM profile WHERE owner_id = ? AND deleted = 0 LIMIT 1',
    [ownerId],
  );

  const open = items.filter((i) => !i.done);
  const minutes = (list: AgendaItem[]) => list.reduce((sum, i) => sum + (i.durationMin ?? 0), 0);
  const tasksOnly = items.filter((i) => i.kind !== 'routine');
  return {
    date: today,
    overdue: overdueRows.map((t) => ({
      key: t.id,
      kind: 'task' as const,
      taskId: t.id,
      occurrenceId: null,
      title: t.title,
      date: t.date,
      startTime: t.start_time,
      durationMin: t.duration_min,
      done: false,
      priority: t.priority,
      categoryColor: asColor(t.color),
      subtasks: { total: t.sub_total, done: t.sub_done },
      recurring: false,
    })),
    scheduled: open.filter((i) => i.kind !== 'routine' && i.startTime),
    anytime: open.filter((i) => i.kind !== 'routine' && !i.startTime),
    routines: items.filter((i) => i.kind === 'routine'),
    done: items.filter((i) => i.done && i.kind !== 'routine'),
    plannedMin: minutes(tasksOnly),
    doneMin: minutes(tasksOnly.filter((i) => i.done)),
    capacityMin: profile?.daily_capacity_min ?? 480,
  };
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
