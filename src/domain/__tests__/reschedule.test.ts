import { dragStartMinutes, draggedTime, DRAG_STEP_MIN, snapMinutes } from '../reschedule';

const HOUR = 60; // px per hour: 1 px = 1 minute

describe('drag to reschedule: snapping', () => {
  it('snaps to 5 minutes, halves up', () => {
    expect(DRAG_STEP_MIN).toBe(5);
    expect(snapMinutes(542)).toBe(540);
    expect(snapMinutes(542.5)).toBe(545);
    expect(snapMinutes(543)).toBe(545);
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(37, 15)).toBe(30);
    expect(snapMinutes(38, 15)).toBe(45);
  });

  it('turns a drag distance into a start on the 5-minute grid', () => {
    expect(dragStartMinutes(9 * 60, 0, HOUR)).toBe(540);
    expect(dragStartMinutes(9 * 60, 32, HOUR)).toBe(570); // 09:32 -> 09:30
    expect(dragStartMinutes(9 * 60, 33, HOUR)).toBe(575);
    expect(dragStartMinutes(9 * 60, -61, HOUR)).toBe(480); // 07:59 -> 08:00
    // Twice the scale: 2 px per minute.
    expect(dragStartMinutes(9 * 60, 30, 120)).toBe(555);
  });

  it('puts an off-grid start on the grid as soon as it moves', () => {
    expect(dragStartMinutes(9 * 60 + 7, 10, HOUR)).toBe(9 * 60 + 15); // 09:17 -> 09:15
    expect(dragStartMinutes(9 * 60 + 7, -4, HOUR)).toBe(9 * 60 + 5);
  });

  it('stops at midnight and at the last slot of the day', () => {
    expect(dragStartMinutes(30, -500, HOUR)).toBe(0);
    expect(dragStartMinutes(23 * 60, 500, HOUR)).toBe(23 * 60 + 55);
    expect(dragStartMinutes(23 * 60 + 55, 3, HOUR)).toBe(23 * 60 + 55);
  });

  it('ignores a broken distance or scale', () => {
    expect(dragStartMinutes(600, Number.NaN, HOUR)).toBe(600);
    expect(dragStartMinutes(600, 40, 0)).toBe(600);
    expect(draggedTime(600, 40, 0)).toBeNull();
  });

  it('returns the new HH:mm, or null when nothing changed', () => {
    expect(draggedTime(9 * 60, 45, HOUR)).toBe('09:45');
    expect(draggedTime(9 * 60, -540, HOUR)).toBe('00:00');
    expect(draggedTime(9 * 60, 2, HOUR)).toBeNull(); // under half a step: a long press, not a move
    expect(draggedTime(9 * 60 + 7, 1, HOUR)).toBeNull(); // off-grid start that was only pressed
    expect(draggedTime(0, -300, HOUR)).toBeNull(); // already at the top edge
    expect(draggedTime(9 * 60, 3, HOUR)).toBe('09:05');
  });
});
