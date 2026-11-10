import type { Period } from './colors';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHmm(value: string): number | null {
  const m = HHMM.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export const DEFAULT_DAY_START = '06:00';
export const DEFAULT_DAY_END = '19:00';

/**
 * Day runs from `dayStart` (inclusive) to `dayEnd` (exclusive), in the device's local time. A window that crosses
 * midnight (e.g. 20:00 → 04:00 for night workers) is supported. Invalid or equal times fall back to the defaults.
 */
export function periodAt(now: Date, dayStart: string, dayEnd: string): Period {
  let start = parseHHmm(dayStart);
  let end = parseHHmm(dayEnd);
  if (start === null || end === null || start === end) {
    start = parseHHmm(DEFAULT_DAY_START) as number;
    end = parseHHmm(DEFAULT_DAY_END) as number;
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  const inside = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  return inside ? 'day' : 'night';
}
