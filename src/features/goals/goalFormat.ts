import type { TFunction } from 'i18next';

import type { GoalPeriod } from '../../domain/goals';
import type { LocalDate } from '../../domain/localDate';
import { shortDate } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';

export const periodLabel = (t: TFunction, period: GoalPeriod) => t(`goals.period_${period}`);

/** "12 days left", "Due today", "3 days overdue" (or "No due date"). */
export function countdown(t: TFunction, daysLeft: number | null): string {
  if (daysLeft === null) return t('goals.noDueDate');
  if (daysLeft === 0) return t('goals.dueToday');
  if (daysLeft < 0) return t('goals.overdueBy', { count: -daysLeft });
  return t('goals.daysLeft', { count: daysLeft });
}

/** "Due Sat, Nov 21" (one-time) or "Ends Sun, Nov 15" (end of the current period). */
export function dueLabel(t: TFunction, lang: string, period: GoalPeriod, due: LocalDate | null): string {
  if (!due) return t('goals.noDueDate');
  const date = shortDate(noonOf(due), lang);
  return period === 'once' ? t('goals.dueOn', { date }) : t('goals.endsOn', { date });
}

export const rangeLabel = (lang: string, start: LocalDate, end: LocalDate) =>
  start === end
    ? shortDate(noonOf(start), lang)
    : `${shortDate(noonOf(start), lang)} – ${shortDate(noonOf(end), lang)}`;
