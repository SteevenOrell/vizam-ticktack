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

export type ReminderKind = 'due' | 'step' | 'monthly' | 'daily' | 'weekly';

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
  goalId: string;
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
      goalId: goal.id,
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
  return out.sort((a, b) => a.fireAt - b.fireAt || a.id.localeCompare(b.id)).slice(0, options.max ?? MAX_SCHEDULED);
}
