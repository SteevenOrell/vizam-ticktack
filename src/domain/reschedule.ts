/**
 * Drag to reschedule (Calendar day timeline and week hour grid): turns a vertical drag distance into a new start
 * time, snapped to 5 minutes and kept inside the day. Pure functions, unit-tested; the grid only renders the result.
 */
import { hhmmOf } from './timeOptions';

/** Start times snap to this many minutes while dragging. */
export const DRAG_STEP_MIN = 5;
const DAY = 24 * 60;

/** Rounds to the nearest `step` minutes (halves round up). */
export function snapMinutes(minutes: number, step: number = DRAG_STEP_MIN): number {
  return Math.round(minutes / step) * step;
}

/**
 * New start (minutes after midnight) for an item that started at `startMin` and was dragged `dy` px on a grid of
 * `hourHeight` px per hour. The result is on the `step` grid and between 00:00 and the last slot of the day, so a
 * drag past either edge stops there. An off-grid start (say 09:07) lands on the grid as soon as it moves.
 */
export function dragStartMinutes(
  startMin: number,
  dy: number,
  hourHeight: number,
  step: number = DRAG_STEP_MIN,
): number {
  if (!Number.isFinite(dy) || !(hourHeight > 0)) return startMin;
  const moved = snapMinutes(startMin + (dy / hourHeight) * 60, step);
  return Math.max(0, Math.min(DAY - step, moved));
}

/** `HH:mm` of a dragged start, or null when the drag ends where it started (nothing to save). */
export function draggedTime(startMin: number, dy: number, hourHeight: number, step: number = DRAG_STEP_MIN) {
  // A press that barely moved is not a reschedule, even when the start was off the grid.
  if (!(hourHeight > 0) || (Math.abs(dy) / hourHeight) * 60 < step / 2) return null;
  const next = dragStartMinutes(startMin, dy, hourHeight, step);
  return next === startMin ? null : hhmmOf(next);
}
