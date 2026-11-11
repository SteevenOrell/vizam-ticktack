/** Calendar pages (day, week, month): date ranges, stepping and which way a date change slides. */
import {
  addDays,
  addMonthsClamped,
  daysInMonth,
  formatYmd,
  parseYmd,
  startOfWeek,
  type LocalDate,
} from '../../domain/localDate';

export type CalendarView = 'day' | 'week' | 'month';

/** Dates loaded for a page: the day, the week, or the whole weeks that cover the month. */
export function rangeFor(view: CalendarView, selected: LocalDate, weekStartsOn: number) {
  if (view === 'day') return { from: selected, to: selected };
  if (view === 'week') {
    const from = startOfWeek(selected, weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  const { y, m } = parseYmd(selected);
  const first = formatYmd({ y, m, d: 1 });
  const last = formatYmd({ y, m, d: daysInMonth(y, m) });
  return { from: startOfWeek(first, weekStartsOn), to: addDays(startOfWeek(last, weekStartsOn), 6) };
}

/** The selected date one page earlier (-1) or later (1). */
export function stepDate(view: CalendarView, date: LocalDate, dir: -1 | 1): LocalDate {
  if (view === 'day') return addDays(date, dir);
  if (view === 'week') return addDays(date, dir * 7);
  return addMonthsClamped(date, dir);
}

/** Which way the page slides to show `to`: 0 when it is on the same page (no transition). */
export function pageDirection(view: CalendarView, from: LocalDate, to: LocalDate, weekStartsOn: number): -1 | 0 | 1 {
  const a = view === 'month' ? from.slice(0, 7) : rangeFor(view, from, weekStartsOn).from;
  const b = view === 'month' ? to.slice(0, 7) : rangeFor(view, to, weekStartsOn).from;
  return a === b ? 0 : b > a ? 1 : -1;
}

/** What the calendar renders: the live selection, or the previous one while the next page's data loads. */
export interface ShownPage {
  view: CalendarView;
  selected: LocalDate;
  from: LocalDate;
  to: LocalDate;
}

export const samePage = (a: ShownPage, b: ShownPage) =>
  a.view === b.view && a.selected === b.selected && a.from === b.from && a.to === b.to;

/** Key of the page on screen; the pager slides the new page in when it changes. */
export const pageKeyOf = (page: ShownPage) => `${page.view}:${page.view === 'day' ? page.selected : page.from}`;
