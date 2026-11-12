/**
 * Choices for the duration and start-time dropdowns (task editor and quick edit). Pure: no React, no formatting.
 */
import { HHMM_RE, minutesOf } from './localDate';

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/**
 * 5, 10, 15, 20, 30, 45 min, then every 15 min up to 4 h, every 30 min up to 8 h, then 9 to 12 h (minutes).
 * "None" is not part of the list; the dropdown adds it as its own row.
 */
export const DURATION_OPTIONS: readonly number[] = Object.freeze([
  5,
  10,
  15,
  20,
  30,
  45,
  ...range(60, 240, 15),
  ...range(270, 480, 30),
  ...range(540, 720, 60),
]);

/** The duration list, plus the current value when it is not on the list (an older or synced task). */
export function durationOptions(current?: number | null): number[] {
  const list = [...DURATION_OPTIONS];
  if (current && current > 0 && current <= 1440 && !list.includes(current)) {
    list.push(current);
    list.sort((a, b) => a - b);
  }
  return list;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmmOf = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** Every `step` minutes across 24 h (`00:00` … `23:45`), plus the current value when it is off the grid. */
export function timeOptions(current?: string | null, step = 15): string[] {
  const list = range(0, 24 * 60 - step, step).map(hhmmOf);
  if (current && HHMM_RE.test(current) && !list.includes(current)) {
    list.push(current);
    list.sort();
  }
  return list;
}

/**
 * Row the time list opens on: the selected time, otherwise the first slot at or after `now` (HH:mm), so the list
 * starts around the current time instead of midnight.
 */
export function initialTimeIndex(options: readonly string[], selected: string | null, now: string): number {
  if (selected) {
    const i = options.indexOf(selected);
    if (i >= 0) return i;
  }
  const target = HHMM_RE.test(now) ? minutesOf(now) : 0;
  const i = options.findIndex((o) => minutesOf(o) >= target);
  return i >= 0 ? i : options.length - 1;
}

/** Default start time offered when the user leaves "All day": the next quarter hour after `now`. */
export function nextQuarterHour(now: Date): string {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const next = Math.min(Math.ceil((minutes + 1) / 15) * 15, 23 * 60 + 45);
  return hhmmOf(next);
}
