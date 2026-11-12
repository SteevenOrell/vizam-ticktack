/**
 * Bounded recurrence generator (ARCHITECTURE.md section 5). Pure functions over floating local dates.
 *
 * - `occurrencesBetween` jumps arithmetically to the first period at or after `from`, so its cost depends on the
 *   window, not on the age of the series. `afterCount` series are walked from the start (count <= 999).
 * - Weekly: weeks are counted from the week containing `startDate`, using the rule's own `weekStartsOn`, so every
 *   device computes the same weeks. Without `byWeekday` the start date's weekday is used.
 * - Monthly: a day the month lacks (31, 30, 29) clamps to the month's last day.
 */
import {
  addDays,
  compactDate,
  dateInMonth,
  diffDays,
  maxDate,
  monthIndex,
  parseYmd,
  startOfWeek,
  weekdayOf,
  type LocalDate,
} from '../localDate';
import type { RuleCore } from '../models';

/** Hard caps (section 5). */
export const MAX_WINDOW_DAYS = 62;
export const MAX_ROWS_PER_SERIES = 400;

export function occurrenceId(seriesId: string, originalDate: LocalDate): string {
  return `${seriesId}_${compactDate(originalDate)}`;
}

export function parseOccurrenceId(id: string): { seriesId: string; originalDate: LocalDate } | null {
  const match = /^(.+)_(\d{4})(\d{2})(\d{2})$/.exec(id);
  if (!match) return null;
  return { seriesId: match[1] as string, originalDate: `${match[2]}-${match[3]}-${match[4]}` };
}

function weekdaysOf(rule: RuleCore): number[] {
  const days = rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(rule.startDate)];
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Yields the rule's dates in order, starting at the first period that can contain `from`. Never ends by itself. */
function* candidates(rule: RuleCore, from: LocalDate): Generator<LocalDate> {
  const start = rule.startDate;
  const lower = maxDate(from, start);
  const interval = Math.max(1, rule.interval);

  if (rule.freq === 'daily') {
    const k = Math.ceil(diffDays(lower, start) / interval);
    for (let i = k; ; i += 1) yield addDays(start, i * interval);
  }

  if (rule.freq === 'weekly') {
    const weekStart0 = startOfWeek(start, rule.weekStartsOn);
    const offsets = weekdaysOf(rule)
      .map((wd) => (wd - rule.weekStartsOn + 7) % 7)
      .sort((a, b) => a - b);
    const weeksToLower = Math.floor(diffDays(lower, weekStart0) / 7);
    let w = Math.floor(weeksToLower / interval) * interval;
    for (;;) {
      const weekStart = addDays(weekStart0, w * 7);
      for (const offset of offsets) {
        const date = addDays(weekStart, offset);
        if (date >= lower) yield date;
      }
      w += interval;
    }
  }

  // monthly
  const day = rule.byMonthDay ?? parseYmd(start).d;
  const m0 = monthIndex(start);
  let k = Math.max(0, Math.floor((monthIndex(lower) - m0) / interval));
  for (;;) {
    const date = dateInMonth(m0 + k * interval, day);
    if (date >= lower) yield date;
    k += 1;
  }
}

function lastAllowed(rule: RuleCore): LocalDate | null {
  return rule.endType === 'onDate' ? rule.endDate : null;
}

/**
 * Dates the rule produces in the inclusive window `[from, to]`, at most `limit`. An `endDate` before `startDate`
 * yields nothing.
 */
export function occurrencesBetween(
  rule: RuleCore,
  from: LocalDate,
  to: LocalDate,
  limit: number = MAX_ROWS_PER_SERIES,
): LocalDate[] {
  if (to < from || limit <= 0) return [];
  const end = lastAllowed(rule);
  if (end && end < rule.startDate) return [];
  const upper = end && end < to ? end : to;
  if (upper < rule.startDate) return [];

  const out: LocalDate[] = [];
  if (rule.endType === 'afterCount') {
    const count = rule.count ?? 0;
    let produced = 0;
    for (const date of candidates(rule, rule.startDate)) {
      if (produced >= count || date > upper) break;
      produced += 1;
      if (date >= from) {
        out.push(date);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  for (const date of candidates(rule, from)) {
    if (date > upper) break;
    out.push(date);
    if (out.length >= limit) break;
  }
  return out;
}

/** True if the rule produces `date`. */
export function producesDate(rule: RuleCore, date: LocalDate): boolean {
  return occurrencesBetween(rule, date, date, 1).length === 1;
}

/** Number of dates the rule produced strictly before `date` (used when splitting an `afterCount` series). */
export function countBefore(rule: RuleCore, date: LocalDate): number {
  if (date <= rule.startDate) return 0;
  return occurrencesBetween(rule, rule.startDate, addDays(date, -1), 1000).length;
}

/** The next `n` dates on or after `from` (live preview "Next: Tue 10, Thu 12, ..."). */
export function nextOccurrences(rule: RuleCore, from: LocalDate, n = 3): LocalDate[] {
  // A year is enough for any interval <= 99 days or weeks within the preview; monthly needs up to 99 months.
  const horizon = rule.freq === 'monthly' ? 31 * 12 * 9 : rule.freq === 'weekly' ? 7 * 99 + 7 : 99 + 1;
  return occurrencesBetween(rule, from, addDays(from, horizon), n);
}

/**
 * Clamps a requested window to the 62-day cap, keeping its start. Returns `null` for an empty window.
 */
export function clampWindow(from: LocalDate, to: LocalDate): { from: LocalDate; to: LocalDate } | null {
  if (to < from) return null;
  return { from, to: diffDays(to, from) >= MAX_WINDOW_DAYS ? addDays(from, MAX_WINDOW_DAYS - 1) : to };
}
