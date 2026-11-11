import { pageDirection, pageKeyOf, rangeFor, samePage, stepDate, type ShownPage } from '../paging';

describe('calendar paging', () => {
  it('steps a day, a week or a month (clamped to the month end)', () => {
    expect(stepDate('day', '2026-11-30', 1)).toBe('2026-12-01');
    expect(stepDate('week', '2026-11-09', -1)).toBe('2026-11-02');
    expect(stepDate('month', '2026-01-31', 1)).toBe('2026-02-28');
  });

  it('slides only when the target is on another page, in its direction', () => {
    // Monday-first weeks: 9 and 15 Nov 2026 are in the same week.
    expect(pageDirection('week', '2026-11-09', '2026-11-15', 1)).toBe(0);
    expect(pageDirection('week', '2026-11-09', '2026-11-16', 1)).toBe(1);
    expect(pageDirection('week', '2026-11-16', '2026-11-09', 1)).toBe(-1);
    expect(pageDirection('day', '2026-11-09', '2026-11-08', 1)).toBe(-1);
    expect(pageDirection('month', '2026-11-01', '2026-11-30', 1)).toBe(0);
    expect(pageDirection('month', '2026-11-30', '2026-12-01', 1)).toBe(1);
  });

  it('keys pages by the day, or by the first loaded date of a week or month', () => {
    const week: ShownPage = { view: 'week', selected: '2026-11-11', ...rangeFor('week', '2026-11-11', 1) };
    expect(pageKeyOf(week)).toBe('week:2026-11-09');
    // Picking another day of the same week keeps the page (no slide, no scroll jump).
    expect(pageKeyOf({ ...week, selected: '2026-11-12' })).toBe('week:2026-11-09');
    expect(pageKeyOf({ view: 'day', selected: '2026-11-11', from: '2026-11-11', to: '2026-11-11' })).toBe(
      'day:2026-11-11',
    );
    expect(samePage(week, { ...week })).toBe(true);
    expect(samePage(week, { ...week, selected: '2026-11-12' })).toBe(false);
  });
});
