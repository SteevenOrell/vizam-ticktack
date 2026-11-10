import {
  CATEGORY_PALETTE,
  categoryKey,
  matchCategories,
  normalizeCategoryName,
  pickCategoryColor,
} from '../categoryName';
import { addDays } from '../localDate';
import type { RuleCore } from '../models';
import { nextOccurrences, occurrencesBetween, producesDate } from '../recurrence/generator';
import { layoutTimeline } from '../timeline';
import { DURATION_OPTIONS, durationOptions, initialTimeIndex, nextQuarterHour, timeOptions } from '../timeOptions';

describe('duration options', () => {
  it('runs 5–45 min, then 15 min steps to 4 h, 30 min steps to 8 h, then whole hours to 12 h', () => {
    expect(DURATION_OPTIONS.slice(0, 7)).toEqual([5, 10, 15, 20, 30, 45, 60]);
    expect(DURATION_OPTIONS).toContain(75);
    expect(DURATION_OPTIONS).toContain(225);
    expect(DURATION_OPTIONS).toContain(240);
    expect(DURATION_OPTIONS).not.toContain(255);
    expect(DURATION_OPTIONS).toContain(270);
    expect(DURATION_OPTIONS).toContain(480);
    expect(DURATION_OPTIONS).not.toContain(510);
    expect(DURATION_OPTIONS.slice(-5)).toEqual([480, 540, 600, 660, 720]);
    // Strictly increasing, so the list reads top to bottom.
    expect([...DURATION_OPTIONS].sort((a, b) => a - b)).toEqual([...DURATION_OPTIONS]);
    expect(new Set(DURATION_OPTIONS).size).toBe(DURATION_OPTIONS.length);
  });

  it('keeps an off-list value of an existing task in order', () => {
    const list = durationOptions(25);
    expect(list.indexOf(25)).toBe(list.indexOf(20) + 1);
    expect(durationOptions(30)).toEqual([...DURATION_OPTIONS]);
    expect(durationOptions(null)).toEqual([...DURATION_OPTIONS]);
  });
});

describe('time options', () => {
  it('lists every 15 minutes across 24 h', () => {
    const list = timeOptions();
    expect(list).toHaveLength(96);
    expect(list[0]).toBe('00:00');
    expect(list[37]).toBe('09:15');
    expect(list.at(-1)).toBe('23:45');
  });

  it('adds an off-grid current time in order', () => {
    const list = timeOptions('09:10');
    expect(list).toHaveLength(97);
    expect(list.indexOf('09:10')).toBe(list.indexOf('09:00') + 1);
  });

  it('opens on the selected time, otherwise the next slot after now', () => {
    const list = timeOptions();
    expect(initialTimeIndex(list, '18:30', '07:00')).toBe(74);
    expect(initialTimeIndex(list, null, '10:31')).toBe(list.indexOf('10:45'));
    expect(initialTimeIndex(list, null, '23:59')).toBe(95);
    expect(nextQuarterHour(new Date(2026, 10, 9, 10, 30))).toBe('10:45');
    expect(nextQuarterHour(new Date(2026, 10, 9, 23, 50))).toBe('23:45');
  });
});

describe('free-text categories', () => {
  it('normalises and matches names case-insensitively', () => {
    expect(normalizeCategoryName('  Deep   work ')).toBe('Deep work');
    expect(normalizeCategoryName('   ')).toBeNull();
    expect(categoryKey(' WORK ')).toBe(categoryKey('work'));
  });

  it('gives a new category the least-used palette colour', () => {
    expect(pickCategoryColor([])).toBe('ember');
    expect(pickCategoryColor(['ember', 'moss', 'sand', 'plum'])).toBe('sky');
    expect(pickCategoryColor([...CATEGORY_PALETTE])).toBe('ember');
    expect(pickCategoryColor([...CATEGORY_PALETTE, 'ember'])).toBe('sky');
  });

  it('suggests names starting with the text first, then names containing it', () => {
    const options = [{ name: 'Home' }, { name: 'Health' }, { name: 'Work' }, { name: 'Homework' }];
    expect(matchCategories(options, 'ho').map((o) => o.name)).toEqual(['Home', 'Homework']);
    expect(matchCategories(options, 'WORK').map((o) => o.name)).toEqual(['Work', 'Homework']);
    expect(matchCategories(options, '')).toHaveLength(4);
  });
});

describe('day timeline layout', () => {
  const opts = { hourHeight: 60, minHeight: 44 };

  it('positions items at their start time with a height proportional to the duration', () => {
    const [a] = layoutTimeline([{ key: 'a', startMin: 8 * 60 + 30, durationMin: 90 }], opts);
    expect(a).toMatchObject({ top: 510, height: 90, column: 0, columns: 1 });
  });

  it('keeps a minimum tap height and uses 30 min for items without a duration', () => {
    const blocks = layoutTimeline(
      [
        { key: 'short', startMin: 600, durationMin: 5 },
        { key: 'none', startMin: 900, durationMin: null },
      ],
      opts,
    );
    expect(blocks.find((b) => b.key === 'short')?.height).toBe(44);
    expect(blocks.find((b) => b.key === 'none')).toMatchObject({ height: 44, endMin: 930 });
  });

  it('puts overlapping items side by side and reuses free columns', () => {
    const blocks = layoutTimeline(
      [
        { key: 'a', startMin: 540, durationMin: 120 }, // 9:00–11:00
        { key: 'b', startMin: 570, durationMin: 30 }, // 9:30–10:00
        { key: 'c', startMin: 600, durationMin: 30 }, // 10:00–10:30 (column of b is free again)
        { key: 'd', startMin: 720, durationMin: 60 }, // 12:00, its own group
      ],
      { hourHeight: 120, minHeight: 44 }, // 30 min = 60 px, above the minimum height
    );
    const by = Object.fromEntries(blocks.map((b) => [b.key, b]));
    expect(by.a).toMatchObject({ column: 0, columns: 2 });
    expect(by.b).toMatchObject({ column: 1, columns: 2 });
    expect(by.c).toMatchObject({ column: 1, columns: 2 });
    expect(by.d).toMatchObject({ column: 0, columns: 1 });
  });

  it('treats items that only touch visually (minimum height) as overlapping', () => {
    const blocks = layoutTimeline(
      [
        { key: 'a', startMin: 600, durationMin: 10 }, // drawn 44 px = 44 min
        { key: 'b', startMin: 620, durationMin: 10 },
      ],
      opts,
    );
    expect(blocks.map((b) => b.columns)).toEqual([2, 2]);
  });

  it('keeps late items on the grid', () => {
    const [late] = layoutTimeline([{ key: 'late', startMin: 23 * 60 + 50, durationMin: 60 }], opts);
    expect(late!.top + late!.height).toBeLessThanOrEqual(24 * 60);
    expect(late!.endMin).toBe(24 * 60);
  });
});

describe('never-ending series', () => {
  const rule = (r: Partial<RuleCore> = {}): RuleCore => ({
    freq: 'daily',
    interval: 1,
    byWeekday: null,
    byMonthDay: null,
    weekStartsOn: 1,
    startDate: '2026-11-09',
    endType: 'never',
    endDate: null,
    count: null,
    ...r,
  });

  it('keeps producing dates years ahead without walking the whole series', () => {
    const r = rule({ freq: 'weekly', byWeekday: [1, 3] });
    expect(producesDate(r, '2036-11-10')).toBe(true); // a Monday ten years later
    expect(nextOccurrences(r, '2036-11-10', 3)).toEqual(['2036-11-10', '2036-11-12', '2036-11-17']);
    const started = performance.now();
    expect(occurrencesBetween(rule(), '2099-01-01', '2099-01-31')).toHaveLength(31);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('produces the same dates on both sides of a window edge', () => {
    const r = rule({ interval: 3 });
    const edge = addDays('2026-11-09', 21);
    const a = occurrencesBetween(r, '2026-11-09', edge);
    const b = occurrencesBetween(r, addDays(edge, 1), addDays(edge, 30));
    const all = occurrencesBetween(r, '2026-11-09', addDays(edge, 30));
    expect([...a, ...b]).toEqual(all);
  });
});
