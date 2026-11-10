/**
 * Planning helpers for edits on a recurring series (ARCHITECTURE.md section 5):
 * - "this occurrence": an exception on one occurrence (handled by the data layer, no rule change);
 * - "this and following": the series is split at the occurrence — the old rule ends the day before, a new series
 *   starts on that occurrence with the same phase (weeks / months keep counting the same way);
 * - "all occurrences": the rule and template change in place; future exceptions the new rule no longer produces
 *   are orphaned and listed for confirmation.
 */
import { addDays, parseYmd, weekdayOf, type LocalDate } from '../localDate';
import type { RuleCore } from '../models';
import { countBefore, occurrencesBetween, producesDate } from './generator';

export type EditScope = 'this' | 'following' | 'all';

const FAR = 366 * 9; // horizon to find the next occurrence (covers monthly interval 99)

/** Rule core with the implicit defaults written out, so a new start date cannot change which days repeat. */
export function explicitRule(rule: RuleCore): RuleCore {
  if (rule.freq === 'weekly') {
    return { ...rule, byWeekday: rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(rule.startDate)] };
  }
  if (rule.freq === 'monthly') return { ...rule, byMonthDay: rule.byMonthDay ?? parseYmd(rule.startDate).d };
  return rule;
}

export interface SplitResult {
  /** The original series, ended before `from`; null when nothing of it remains (split at or before its start). */
  before: RuleCore | null;
  /** The new series from the first occurrence on or after `from`; null when the rule produces nothing more. */
  after: RuleCore | null;
}

export function splitRule(rule: RuleCore, from: LocalDate): SplitResult {
  const full = explicitRule(rule);
  const first = occurrencesBetween(full, from, addDays(from, FAR), 1)[0] ?? null;

  let before: RuleCore | null = null;
  if (from > rule.startDate) {
    const dayBefore = addDays(from, -1);
    const endDate = rule.endType === 'onDate' && rule.endDate && rule.endDate < dayBefore ? rule.endDate : dayBefore;
    before = { ...rule, endType: 'onDate', endDate, count: null };
    if (occurrencesBetween(before, before.startDate, endDate, 1).length === 0) before = null;
  }

  let after: RuleCore | null = null;
  if (first) {
    if (rule.endType === 'afterCount') {
      const remaining = (rule.count ?? 0) - countBefore(full, first);
      if (remaining > 0) after = { ...full, startDate: first, count: remaining };
    } else {
      after = { ...full, startDate: first };
    }
  }
  return { before, after };
}

/** "Stop repeating": keep history, end the rule yesterday. */
export function stopRepeating(rule: RuleCore, today: LocalDate): RuleCore {
  return { ...rule, endType: 'onDate', endDate: addDays(today, -1), count: null };
}

/** Exceptions on or after `from` whose original date the new rule no longer produces. */
export function orphanedExceptions<T extends { originalDate: LocalDate }>(
  rule: RuleCore,
  exceptions: readonly T[],
  from: LocalDate,
): T[] {
  return exceptions.filter((e) => e.originalDate >= from && !producesDate(rule, e.originalDate));
}

/** True when two rule cores produce the same schedule definition (used to skip needless regeneration). */
export function sameSchedule(a: RuleCore, b: RuleCore): boolean {
  const x = explicitRule(a);
  const y = explicitRule(b);
  return (
    x.freq === y.freq &&
    x.interval === y.interval &&
    JSON.stringify(x.byWeekday ?? null) === JSON.stringify(y.byWeekday ?? null) &&
    x.byMonthDay === y.byMonthDay &&
    x.weekStartsOn === y.weekStartsOn &&
    x.startDate === y.startDate &&
    x.endType === y.endType &&
    (x.endDate ?? null) === (y.endDate ?? null) &&
    (x.count ?? null) === (y.count ?? null)
  );
}
