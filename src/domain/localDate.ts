/**
 * Floating local dates (`YYYY-MM-DD`) handled as pure calendar arithmetic on an epoch-day number. No `Date` object
 * and no time zone is involved, so daylight-saving changes can never shift or duplicate a day
 * (ARCHITECTURE.md section 3.1 and 5).
 */
export type LocalDate = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function parseYmd(date: LocalDate): Ymd {
  if (!isLocalDate(date)) throw new RangeError(`Invalid local date: ${String(date)}`);
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

export function formatYmd({ y, m, d }: Ymd): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toEpochDay(date: LocalDate): number {
  const { y: y0, m, d } = parseYmd(date);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(days: number): LocalDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return formatYmd({ y, m, d });
}

export const addDays = (date: LocalDate, n: number): LocalDate => fromEpochDay(toEpochDay(date) + n);
export const diffDays = (later: LocalDate, earlier: LocalDate): number => toEpochDay(later) - toEpochDay(earlier);

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(date: LocalDate): Weekday {
  return ((((toEpochDay(date) + 4) % 7) + 7) % 7) as Weekday;
}

/** First day of the week containing `date`, for a week that starts on `weekStartsOn`. */
export function startOfWeek(date: LocalDate, weekStartsOn: number): LocalDate {
  const offset = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/** Month index since year 0 (for month arithmetic). */
export const monthIndex = (date: LocalDate): number => {
  const { y, m } = parseYmd(date);
  return y * 12 + (m - 1);
};

/** The `day` of month `index`, clamped to the month's last day (31 -> 30 / 28 / 29). */
export function dateInMonth(index: number, day: number): LocalDate {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return formatYmd({ y, m, d: Math.min(day, daysInMonth(y, m)) });
}

export function addMonthsClamped(date: LocalDate, n: number): LocalDate {
  return dateInMonth(monthIndex(date) + n, parseYmd(date).d);
}

export const compactDate = (date: LocalDate): string => date.replace(/-/g, '');

export const minDate = (a: LocalDate, b: LocalDate): LocalDate => (a <= b ? a : b);
export const maxDate = (a: LocalDate, b: LocalDate): LocalDate => (a >= b ? a : b);

/** Device-local calendar date of an instant (the only place a `Date` is read). */
export function localDateOf(instant: Date): LocalDate {
  return formatYmd({ y: instant.getFullYear(), m: instant.getMonth() + 1, d: instant.getDate() });
}

/** Inclusive list of dates from `from` to `to`. */
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let e = toEpochDay(from), end = toEpochDay(to); e <= end; e += 1) out.push(fromEpochDay(e));
  return out;
}

export function minutesOf(hhmm: string): number {
  const match = HHMM_RE.exec(hhmm);
  if (!match) throw new RangeError(`Invalid time: ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
