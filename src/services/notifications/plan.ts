/**
 * Goal reminder planner (pure). Computes the notifications wanted in the rolling window (ARCHITECTURE.md section 8):
 * every enabled goal reminder whose fire time falls in the next 7 days, soonest first, capped at 50 (iOS allows 64
 * pending local notifications per app). Identifiers are deterministic, so planning twice gives the same set and the
 * scheduler can reconcile idempotently.
 */
import { periodContaining } from '../../domain/goals';
import {
  addDays,
  compactDate,
  datesBetween,
  daysInMonth,
  parseYmd,
  weekdayOf,
  type LocalDate,
} from '../../domain/localDate';
import type { GoalReminders } from '../../domain/models';

export const WINDOW_DAYS = 7;
export const MAX_SCHEDULED = 50;
/** Every identifier this app schedules starts with this prefix (other notifications are never touched). */
export const ID_PREFIX = 'tt_';

export type ReminderKind = 'due' | 'step' | 'monthly' | 'daily' | 'weekly' | 'task' | 'routine';
export type ReminderTargetType = 'goal' | 'task' | 'routine';

export interface GoalStep {
  /** Task id, or occurrence id for one occurrence of a series. */
  key: string;
  taskId: string;
  occurrenceId: string | null;
  title: string;
  date: LocalDate;
  startTime: string | null;
}

export interface GoalReminderInput {
  id: string;
  title: string;
  status: 'active' | 'achieved' | 'archived';
  period: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  startDate: LocalDate | null;
  targetDate: LocalDate | null;
  createdOn: LocalDate;
  reminders: GoalReminders;
  /** Open linked tasks / occurrences dated inside the window (for "At each step"). */
  steps: readonly GoalStep[];
}

export interface PlannedNotification {
  id: string;
  /** What the reminder is for: `targetId` is a goal, task or routine id. */
  targetType: ReminderTargetType;
  targetId: string;
  /** The day of a repeating task or routine the reminder is for (null for goals and one-off tasks). */
  occurrenceId: string | null;
  kind: ReminderKind;
  /** What the notification is about inside the goal (date, offset or step key); stored locally for debugging. */
  key: string;
  fireAt: number;
  title: string;
  body: string;
  /** Deep link opened on tap. */
  url: string;
  /** Changes when the time or text changes, so the scheduler replaces the OS notification. */
  fingerprint: string;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Local wall-clock time of a floating date + HH:mm, as epoch ms (device time zone, DST-aware via Date). */
export function fireTime(date: LocalDate, hhmm: string): number {
  const { y, m, d } = parseYmd(date);
  const [h, min] = hhmm.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

/** Small stable hash (FNV-1a, 32 bit) for fingerprints. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '');

/** Due dates of a goal that matter in `[from, to + 7]` (a 1-week-before reminder can fire inside the window). */
function dueDates(goal: GoalReminderInput, from: LocalDate, to: LocalDate): LocalDate[] {
  const last = addDays(to, 7);
  if (goal.period === 'once') {
    return goal.targetDate && goal.targetDate >= from && goal.targetDate <= last ? [goal.targetDate] : [];
  }
  const anchor = goal.startDate ?? goal.createdOn;
  const out: LocalDate[] = [];
  let p = periodContaining(goal.period, anchor, from);
  while (p && p.end <= last) {
    if (p.end >= from) out.push(p.end);
    p = periodContaining(goal.period, anchor, addDays(p.end, 1));
  }
  return out;
}

export function planGoalNotifications(
  goals: readonly GoalReminderInput[],
  now: Date,
  t: Translate,
  options: { windowDays?: number; max?: number; today?: LocalDate } = {},
): PlannedNotification[] {
  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const nowMs = now.getTime();
  const horizon = nowMs + windowDays * 86_400_000;
  const today =
    options.today ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const lastDay = addDays(today, windowDays);
  const days = datesBetween(today, lastDay);
  const out: PlannedNotification[] = [];

  const add = (
    goal: GoalReminderInput,
    kind: ReminderKind,
    key: string,
    date: LocalDate,
    time: string,
    body: string,
  ) => {
    const fireAt = fireTime(date, time);
    if (fireAt <= nowMs || fireAt > horizon) return;
    const title = goal.title;
    out.push({
      id: `${ID_PREFIX}${safe(goal.id)}_${kind}_${safe(key)}`,
      targetType: 'goal',
      targetId: goal.id,
      occurrenceId: null,
      kind,
      key,
      fireAt,
      title,
      body,
      url: `ticktack://goal/${encodeURIComponent(goal.id)}`,
      fingerprint: hash(`${fireAt}|${title}|${body}`),
    });
  };

  for (const goal of goals) {
    if (goal.status !== 'active') continue;
    const r = goal.reminders;

    for (const due of dueDates(goal, today, lastDay)) {
      for (const offset of r.beforeDue) {
        const date = addDays(due, -offset);
        add(goal, 'due', `${compactDate(due)}d${offset}`, date, r.beforeDueTime, t(`notifications.due_${offset}`));
      }
    }

    if (r.eachStep) {
      for (const step of goal.steps) {
        add(
          goal,
          'step',
          `${step.key}${compactDate(step.date)}`,
          step.date,
          step.startTime ?? r.beforeDueTime,
          t('notifications.step', { task: step.title }),
        );
      }
    }

    if (r.monthlyDay) {
      for (const date of days) {
        const { y, m, d } = parseYmd(date);
        if (d !== Math.min(r.monthlyDay, daysInMonth(y, m))) continue;
        add(goal, 'monthly', compactDate(date), date, r.monthlyTime, t('notifications.monthly'));
      }
    }

    if (r.periodic && goal.period === 'daily') {
      for (const date of days) add(goal, 'daily', compactDate(date), date, r.periodicTime, t('notifications.daily'));
    }
    if (r.periodic && goal.period === 'weekly') {
      for (const date of days) {
        if (weekdayOf(date) !== r.periodicWeekday) continue;
        add(goal, 'weekly', compactDate(date), date, r.periodicTime, t('notifications.weekly'));
      }
    }
  }

  // Same identifier twice (e.g. two steps at the same moment) cannot happen: keys include the step and date.
  return capPlan(out, options.max);
}

/** Soonest first, capped (the OS limits pending notifications per app; see MAX_SCHEDULED). */
export function capPlan(list: readonly PlannedNotification[], max: number = MAX_SCHEDULED): PlannedNotification[] {
  return [...list].sort((a, b) => a.fireAt - b.fireAt || a.id.localeCompare(b.id)).slice(0, max);
}

/** One day of a task or routine that has a reminder (open items of the window only). */
export interface ItemReminderInput {
  targetType: 'task' | 'routine';
  /** Task id (one-off or series) or routine id. */
  targetId: string;
  /** Occurrence id for one day of a series, null for a one-off task. */
  occurrenceId: string | null;
  /** Unique per reminder: the task id, or the occurrence id (`seriesId_YYYYMMDD`). */
  key: string;
  title: string;
  date: LocalDate;
  startTime: string | null;
  /** Minutes before the start time (days with a start time). */
  offsetMin: number;
  /** Time of day used on days without a start time. */
  atTime: string;
}

/** When the reminder of one item fires: before its start time, or at the fallback time on an untimed day. */
export function itemFireTime(item: Pick<ItemReminderInput, 'date' | 'startTime' | 'offsetMin' | 'atTime'>): number {
  return item.startTime
    ? fireTime(item.date, item.startTime) - item.offsetMin * 60_000
    : fireTime(item.date, item.atTime);
}

/**
 * Task and routine reminders in the rolling window. The window is what bounds a repeating task: only its days
 * inside the next `windowDays` are planned, and each maintenance pass (foreground or background) moves the window
 * on. The identifier depends only on the item (not on its time), so a moved or renamed item replaces its
 * notification instead of adding one; done and deleted items are simply not passed in, so theirs is cancelled.
 */
export function planItemNotifications(
  items: readonly ItemReminderInput[],
  now: Date,
  t: Translate,
  options: { windowDays?: number; max?: number; formatTime?: (hhmm: string) => string } = {},
): PlannedNotification[] {
  const nowMs = now.getTime();
  const horizon = nowMs + (options.windowDays ?? WINDOW_DAYS) * 86_400_000;
  const clock = options.formatTime ?? ((hhmm: string) => hhmm);
  const out: PlannedNotification[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const fireAt = itemFireTime(item);
    if (fireAt <= nowMs || fireAt > horizon) continue;
    const id = `${ID_PREFIX}${safe(item.key)}_${item.targetType}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const body = item.startTime
      ? item.offsetMin === 0
        ? t(`notifications.${item.targetType}Now`)
        : t(`notifications.${item.targetType}At`, { time: clock(item.startTime) })
      : t(`notifications.${item.targetType}Today`);
    const occ = item.occurrenceId ? `?occ=${encodeURIComponent(item.occurrenceId)}` : '';
    const path =
      item.targetType === 'routine'
        ? `routine/${encodeURIComponent(item.targetId)}`
        : `task/details/${encodeURIComponent(item.targetId)}${occ}`;
    out.push({
      id,
      targetType: item.targetType,
      targetId: item.targetId,
      occurrenceId: item.occurrenceId,
      kind: item.targetType,
      key: item.key,
      fireAt,
      title: item.title,
      body,
      url: `ticktack://${path}`,
      fingerprint: hash(`${fireAt}|${item.title}|${body}`),
    });
  }
  return capPlan(out, options.max);
}
