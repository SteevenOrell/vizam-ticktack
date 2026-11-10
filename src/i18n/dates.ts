import { format, type Locale } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';

import type { Language } from './index';

const locales: Record<Language, Locale> = { en: enUS, fr };

export function dateLocale(language: string): Locale {
  return language === 'fr' ? fr : enUS;
}

/** Monday in French, Sunday in English (until the user picks a week start in Me > Planning). */
export function defaultWeekStartsOn(language: string): 0 | 1 {
  return language === 'fr' ? 1 : 0;
}

export interface DayFaceParts {
  day: string;
  month: string;
  weekday: string;
}

export function dayFaceParts(date: Date, language: string): DayFaceParts {
  const locale = locales[language as Language] ?? enUS;
  return {
    day: format(date, 'dd', { locale }),
    month: format(date, 'LLL', { locale }),
    weekday: format(date, 'EEEE', { locale }),
  };
}

/** "Mon, Nov 9" in English, "lun. 9 nov." in French. */
export function shortDate(date: Date, language: string): string {
  return language === 'fr' ? format(date, 'EEE d MMM', { locale: fr }) : format(date, 'EEE, MMM d', { locale: enUS });
}

/** 24 h clock in French, 12 h in English. */
export function shortTime(date: Date, language: string): string {
  return language === 'fr' ? format(date, 'HH:mm', { locale: fr }) : format(date, 'h:mm a', { locale: enUS });
}

/** "Tue 10" style label for recurrence previews and week strips. */
export function dayLabel(date: Date, language: string): string {
  return language === 'fr' ? format(date, 'EEE d', { locale: fr }) : format(date, 'EEE d', { locale: enUS });
}

/** Two-letter-ish weekday names starting at `weekStartsOn` (Sun = 0). */
export function weekdayNames(language: string, style: 'short' | 'narrow' = 'short'): string[] {
  const locale = language === 'fr' ? fr : enUS;
  // 2026-11-08 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format(new Date(2026, 10, 8 + i, 12), style === 'short' ? 'EEE' : 'EEEEE', { locale }),
  );
}

/** "November 2026" / "novembre 2026". */
export function monthTitle(date: Date, language: string): string {
  return format(date, 'LLLL yyyy', { locale: language === 'fr' ? fr : enUS });
}
