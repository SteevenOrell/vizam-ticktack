import { format } from 'date-fns';
import { LocaleConfig } from 'react-native-calendars';

import { dateLocale } from '../../i18n/dates';

/** Month and weekday names for react-native-calendars, generated from the date-fns locale (no hand-typed lists). */
function buildLocale(language: string) {
  const locale = dateLocale(language);
  const months = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 1));
  const days = Array.from({ length: 7 }, (_, d) => new Date(2026, 10, 1 + d)); // 2026-11-01 is a Sunday
  return {
    monthNames: months.map((d) => format(d, 'LLLL', { locale })),
    monthNamesShort: months.map((d) => format(d, 'LLL', { locale })),
    dayNames: days.map((d) => format(d, 'EEEE', { locale })),
    dayNamesShort: days.map((d) => format(d, 'EEEEEE', { locale })),
  };
}

export function applyCalendarLocale(language: string) {
  const key = language === 'fr' ? 'fr' : 'en';
  if (!LocaleConfig.locales[key]) LocaleConfig.locales[key] = buildLocale(key);
  LocaleConfig.defaultLocale = key;
}
