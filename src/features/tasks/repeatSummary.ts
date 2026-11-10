import type { TFunction } from 'i18next';

import { weekdayOf } from '../../domain/localDate';
import type { RuleCore } from '../../domain/models';
import { shortDate, weekdayNames } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';

/**
 * One line for a repeat rule (task details): "Every 2 weeks on Mon, Thu · until Sun, Dec 20",
 * "Every day · 10 times", "Every month on day 31 · no end date".
 */
export function repeatSummary(t: TFunction, lang: string, rule: RuleCore): string {
  const count = Math.max(1, rule.interval);
  let line: string;
  if (rule.freq === 'daily') {
    line = t('repeat.sumDaily', { count });
  } else if (rule.freq === 'weekly') {
    const names = weekdayNames(lang);
    const days = [...new Set(rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(rule.startDate)])]
      // In week order from the rule's week start (Monday first in French).
      .sort((a, b) => ((a - rule.weekStartsOn + 7) % 7) - ((b - rule.weekStartsOn + 7) % 7))
      .map((d) => names[d] ?? '')
      .join(', ');
    line = `${t('repeat.sumWeekly', { count })} ${t('repeat.sumOnDays', { days })}`;
  } else {
    const day = rule.byMonthDay ?? Number(rule.startDate.slice(8, 10));
    line = `${t('repeat.sumMonthly', { count })} ${t('repeat.sumOnMonthDay', { day })}`;
  }
  const end =
    rule.endType === 'onDate' && rule.endDate
      ? t('repeat.sumUntil', { date: shortDate(noonOf(rule.endDate), lang) })
      : rule.endType === 'afterCount' && rule.count
        ? t('repeat.times', { count: rule.count })
        : t('repeat.sumNoEnd');
  return `${line} · ${end}`;
}
