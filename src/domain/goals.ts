/**
 * Goal domain (pure): periods (Once, Daily, Weekly, Monthly, Yearly), due dates, countdown and completion
 * percentage. Periods are aligned to the goal's start date: weekly = 7-day blocks from the start, monthly = from
 * the start's day of month (clamped, 31 -> 30 / 28), yearly = anniversaries of the start. No React, Expo or SQLite.
 */
import {
  addDays,
  addMonthsClamped,
  diffDays,
  maxDate,
  minDate,
  monthIndex,
  parseYmd,
  startOfWeek,
  type LocalDate,
} from './localDate';
import type { RuleCore } from './models';
import { occurrencesBetween } from './recurrence/generator';

export type GoalPeriod = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const GOAL_PERIODS: readonly GoalPeriod[] = ['once', 'daily', 'weekly', 'monthly', 'yearly'];

export interface PeriodRange {
  start: LocalDate;
  end: LocalDate;
}

/** Default start for a new periodic goal: today, this week, the 1st of this month, or 1 January. */
export function defaultPeriodStart(period: GoalPeriod, today: LocalDate, weekStartsOn: number): LocalDate {
  const { y, m } = parseYmd(today);
  switch (period) {
    case 'weekly':
      return startOfWeek(today, weekStartsOn);
    case 'monthly':
      return `${y}-${String(m).padStart(2, '0')}-01`;
    case 'yearly':
      return `${y}-01-01`;
    default:
      return today;
  }
}

/** The `n`-th period after the one starting at `anchor` (n may be negative). */
function nthStart(period: Exclude<GoalPeriod, 'once'>, anchor: LocalDate, n: number): LocalDate {
  if (period === 'daily') return addDays(anchor, n);
  if (period === 'weekly') return addDays(anchor, 7 * n);
  return addMonthsClamped(anchor, period === 'monthly' ? n : 12 * n);
}

function periodAt(period: Exclude<GoalPeriod, 'once'>, anchor: LocalDate, n: number): PeriodRange {
  return { start: nthStart(period, anchor, n), end: addDays(nthStart(period, anchor, n + 1), -1) };
}

/**
 * The period containing `date` for a periodic goal starting at `anchor`. Dates before the start map to the first
 * period (a goal that has not started yet counts towards its first period). `null` for one-time goals.
 */
export function periodContaining(period: GoalPeriod, anchor: LocalDate, date: LocalDate): PeriodRange | null {
  if (period === 'once') return null;
  if (date <= anchor) return periodAt(period, anchor, 0);
  let n: number;
  if (period === 'daily') n = diffDays(date, anchor);
  else if (period === 'weekly') n = Math.floor(diffDays(date, anchor) / 7);
  else {
    const months = monthIndex(date) - monthIndex(anchor);
    n = period === 'monthly' ? months : Math.floor(months / 12);
    // The clamped start of that month/year may still be after `date` (e.g. anchor on the 20th, date on the 5th).
    while (n > 0 && nthStart(period, anchor, n) > date) n -= 1;
  }
  return periodAt(period, anchor, n);
}

export interface GoalTiming {
  period: GoalPeriod;
  startDate: LocalDate | null;
  targetDate: LocalDate | null;
  /** Local date the goal was created (fallback start of a one-time goal). */
  createdOn: LocalDate;
}

/** Due date: the target date of a one-time goal, the end of the current period for a periodic goal. */
export function dueDateOf(goal: GoalTiming, today: LocalDate): LocalDate | null {
  if (goal.period === 'once') return goal.targetDate;
  return periodContaining(goal.period, goal.startDate ?? goal.createdOn, today)?.end ?? null;
}

/** Whole days from today to the due date (negative = overdue, 0 = due today). */
export const daysLeft = (due: LocalDate, today: LocalDate): number => diffDays(due, today);

/**
 * Range in which linked work counts: the current period of a periodic goal, or for a one-time goal from its start
 * (or creation) to the due date (or today when it has none).
 */
export function progressRange(goal: GoalTiming, today: LocalDate): PeriodRange {
  if (goal.period !== 'once') {
    return periodContaining(goal.period, goal.startDate ?? goal.createdOn, today) as PeriodRange;
  }
  const start = goal.startDate ?? goal.createdOn;
  const end = goal.targetDate ?? today;
  return { start: minDate(start, end), end: maxDate(start, end) };
}

/** Linked task as the progress calculation needs it. */
export interface LinkedTask {
  id: string;
  status: 'open' | 'done' | 'cancelled';
  date: LocalDate | null;
  /** Recurrence of a series template (null for a one-off task). */
  rule: RuleCore | null;
  /** Per-occurrence state by original date (only exceptions are stored: done or skipped). */
  occurrences?: ReadonlyMap<LocalDate, 'scheduled' | 'done' | 'skipped'>;
}

export interface Progress {
  done: number;
  total: number;
  /** 0..100, rounded down so 100 means every counted item is done. */
  percent: number;
}

const MAX_COUNTED_OCCURRENCES = 1000;

/**
 * Completion = completed linked items / linked items. A recurring task counts each occurrence inside the range
 * (skipped ones are left out). A one-off task counts once: for a periodic goal only when it is dated inside the
 * period or undated; for a one-time goal always. Cancelled tasks are left out.
 */
export function computeProgress(tasks: readonly LinkedTask[], range: PeriodRange, periodic: boolean): Progress {
  let done = 0;
  let total = 0;
  for (const task of tasks) {
    if (task.status === 'cancelled') continue;
    if (task.rule) {
      for (const date of occurrencesBetween(task.rule, range.start, range.end, MAX_COUNTED_OCCURRENCES)) {
        const state = task.occurrences?.get(date) ?? 'scheduled';
        if (state === 'skipped') continue;
        total += 1;
        if (state === 'done') done += 1;
      }
      continue;
    }
    if (periodic && task.date && (task.date < range.start || task.date > range.end)) continue;
    total += 1;
    if (task.status === 'done') done += 1;
  }
  return { done, total, percent: total === 0 ? 0 : Math.floor((done / total) * 100) };
}

// ---------- repeating tasks in a goal must end ----------

/**
 * Last day a repeating task linked to the goal may run: the due date of a one-time goal (null when it has none),
 * the end of the current period for a periodic goal.
 */
export const repeatLimitOf = (goal: GoalTiming, today: LocalDate): LocalDate | null => dueDateOf(goal, today);

/** Last date a rule can produce an occurrence on: its end date, its n-th occurrence, or null when it never ends. */
export function lastRepeatDate(rule: RuleCore): LocalDate | null {
  if (rule.endType === 'onDate') return rule.endDate;
  if (rule.endType === 'afterCount') {
    return occurrencesBetween(rule, rule.startDate, '9999-12-31', MAX_COUNTED_OCCURRENCES).at(-1) ?? rule.startDate;
  }
  return null;
}

export type GoalRepeatIssue = 'repeatNeverInGoal' | 'repeatAfterGoalEnd';

/**
 * Why a rule is not allowed on a goal-linked task, or null when it is fine. "Never" is always refused; an end is
 * refused when it lies after the goal's limit. A series that starts after the limit may still hold its first
 * occurrence (the bound is `max(limit, startDate)`), like a one-off task dated after the due date.
 */
export function goalRepeatIssue(rule: RuleCore, limit: LocalDate | null): GoalRepeatIssue | null {
  const last = lastRepeatDate(rule);
  if (last === null) return 'repeatNeverInGoal';
  if (limit && last > maxDate(limit, rule.startDate)) return 'repeatAfterGoalEnd';
  return null;
}

/** Default end when the goal gives no limit (one-time goal without a due date): a month from the start or today. */
export const defaultRepeatEnd = (startDate: LocalDate, today: LocalDate): LocalDate =>
  addMonthsClamped(maxDate(startDate, today), 1);

/**
 * The rule made valid for a goal: a never-ending or too-long rule ends on the goal's limit (or on the default end
 * when the goal has no limit). Returns the same object when nothing has to change; an allowed end is never extended.
 */
export function clampRuleToGoal<T extends RuleCore>(rule: T, limit: LocalDate | null, today: LocalDate): T {
  if (!goalRepeatIssue(rule, limit)) return rule;
  const endDate = limit ? maxDate(limit, rule.startDate) : defaultRepeatEnd(rule.startDate, today);
  return { ...rule, endType: 'onDate', endDate, count: null };
}

export type GoalSection = 'active' | 'completed' | 'overdue';

/** List section: completed when marked done or at 100 %, overdue when a one-time goal passed its due date. */
export function goalSection(input: {
  status: 'active' | 'achieved' | 'archived';
  period: GoalPeriod;
  percent: number;
  total: number;
  due: LocalDate | null;
  today: LocalDate;
}): GoalSection {
  if (input.status === 'achieved' || (input.total > 0 && input.percent >= 100)) return 'completed';
  if (input.period === 'once' && input.due && input.due < input.today) return 'overdue';
  return 'active';
}

/** Ended periods after `lastEnd` (exclusive) and before `today`, oldest first, at most `limit` (the latest ones). */
export function endedPeriodsSince(
  period: GoalPeriod,
  anchor: LocalDate,
  lastEnd: LocalDate | null,
  today: LocalDate,
  limit = 12,
): PeriodRange[] {
  if (period === 'once') return [];
  const current = periodContaining(period, anchor, today);
  if (!current || current.start <= anchor) return [];
  const out: PeriodRange[] = [];
  let p = periodContaining(period, anchor, addDays(current.start, -1));
  while (p && out.length < limit && (!lastEnd || p.end > lastEnd) && p.start >= anchor) {
    out.unshift(p);
    if (p.start <= anchor) break;
    p = periodContaining(period, anchor, addDays(p.start, -1));
  }
  return out;
}
