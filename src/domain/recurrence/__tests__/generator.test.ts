import {
  addDays,
  dateInMonth,
  datesBetween,
  diffDays,
  fromEpochDay,
  localDateOf,
  monthIndex,
  parseYmd,
  startOfWeek,
  toEpochDay,
  weekdayOf,
} from '../../localDate';
import type { RuleCore } from '../../models';
import {
  clampWindow,
  countBefore,
  MAX_ROWS_PER_SERIES,
  nextOccurrences,
  occurrenceId,
  occurrencesBetween,
  parseOccurrenceId,
  producesDate,
} from '../generator';
import { explicitRule, orphanedExceptions, sameSchedule, splitRule, stopRepeating } from '../seriesEdit';

const rule = (r: Partial<RuleCore>): RuleCore => ({
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

/** Day-by-day reference implementation straight from the definitions; slow but obviously right. */
function naive(r: RuleCore, from: string, to: string): string[] {
  const out: string[] = [];
  let produced = 0;
  const weekdays = r.byWeekday?.length ? r.byWeekday : [weekdayOf(r.startDate)];
  const day = r.byMonthDay ?? parseYmd(r.startDate).d;
  for (const date of datesBetween(r.startDate, to)) {
    if (r.endType === 'onDate' && r.endDate && date > r.endDate) break;
    let hit = false;
    if (r.freq === 'daily') hit = diffDays(date, r.startDate) % r.interval === 0;
    if (r.freq === 'weekly') {
      const weeks = Math.floor(diffDays(date, startOfWeek(r.startDate, r.weekStartsOn)) / 7);
      hit = weeks % r.interval === 0 && weekdays.includes(weekdayOf(date));
    }
    if (r.freq === 'monthly') {
      const k = monthIndex(date) - monthIndex(r.startDate);
      hit = k % r.interval === 0 && date === dateInMonth(monthIndex(date), day);
    }
    if (!hit) continue;
    if (r.endType === 'afterCount' && produced >= (r.count ?? 0)) break;
    produced += 1;
    if (date >= from) out.push(date);
  }
  return out;
}

describe('local dates', () => {
  it('round-trips epoch days over four centuries, including leap days', () => {
    for (let e = toEpochDay('1900-01-01'); e <= toEpochDay('2300-12-31'); e += 37) {
      expect(toEpochDay(fromEpochDay(e))).toBe(e);
    }
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01'); // 2100 is not a leap year
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29'); // 2000 is
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows weekdays (2026-11-09 is a Monday) and week starts', () => {
    expect(weekdayOf('2026-11-09')).toBe(1);
    expect(weekdayOf('1970-01-01')).toBe(4);
    expect(startOfWeek('2026-11-09', 0)).toBe('2026-11-08');
    expect(startOfWeek('2026-11-09', 1)).toBe('2026-11-09');
    expect(startOfWeek('2026-11-09', 6)).toBe('2026-11-07');
  });

  it('rejects impossible dates', () => {
    expect(() => toEpochDay('2026-02-29')).toThrow(RangeError);
    expect(() => toEpochDay('2026-13-01')).toThrow(RangeError);
  });
});

describe('daylight saving time', () => {
  const previousTz = process.env.TZ;
  afterAll(() => {
    process.env.TZ = previousTz;
  });

  it('produces exactly one occurrence per day across DST start and end (America/Toronto)', () => {
    process.env.TZ = 'America/Toronto';
    const daily = rule({ startDate: '2026-01-01' });
    expect(occurrencesBetween(daily, '2026-03-07', '2026-03-09')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(occurrencesBetween(daily, '2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    // The device clock maps to the right local day on the short and the long day.
    expect(localDateOf(new Date(2026, 2, 8, 23, 30))).toBe('2026-03-08');
    expect(localDateOf(new Date(2026, 10, 1, 0, 30))).toBe('2026-11-01');
    expect(localDateOf(new Date(2026, 10, 1, 23, 59))).toBe('2026-11-01');
  });

  it('keeps weekly series on their weekday across a DST change', () => {
    process.env.TZ = 'Europe/Paris';
    const weekly = rule({ freq: 'weekly', byWeekday: [0], startDate: '2026-03-01' });
    expect(occurrencesBetween(weekly, '2026-03-20', '2026-04-06')).toEqual(['2026-03-22', '2026-03-29', '2026-04-05']);
  });
});

describe('daily', () => {
  it('repeats every n days, also across a year end', () => {
    const r = rule({ interval: 3, startDate: '2026-12-26' });
    expect(occurrencesBetween(r, '2026-12-20', '2027-01-08')).toEqual([
      '2026-12-26',
      '2026-12-29',
      '2027-01-01',
      '2027-01-04',
      '2027-01-07',
    ]);
  });

  it('jumps straight to the window for a decades-old series', () => {
    const r = rule({ interval: 7, startDate: '1990-01-01' });
    const got = occurrencesBetween(r, '2026-11-01', '2026-11-30');
    expect(got).toEqual(naive(r, '2026-11-01', '2026-11-30'));
    expect(got.every((d) => weekdayOf(d) === weekdayOf('1990-01-01'))).toBe(true);
  });
});

describe('weekly', () => {
  it('uses selected weekdays and starts on the start date, not before', () => {
    const r = rule({ freq: 'weekly', byWeekday: [1, 3, 5], startDate: '2026-11-11' }); // a Wednesday
    expect(occurrencesBetween(r, '2026-11-09', '2026-11-22')).toEqual([
      '2026-11-11',
      '2026-11-13',
      '2026-11-16',
      '2026-11-18',
      '2026-11-20',
    ]);
  });

  it('defaults to the start weekday', () => {
    const r = rule({ freq: 'weekly', startDate: '2026-11-12' }); // Thursday
    expect(occurrencesBetween(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-12', '2026-11-19', '2026-11-26']);
  });

  it('counts every-2-weeks phases across a year end', () => {
    const r = rule({ freq: 'weekly', interval: 2, byWeekday: [1, 4], startDate: '2026-12-14' });
    expect(occurrencesBetween(r, '2026-12-14', '2027-01-17')).toEqual([
      '2026-12-14',
      '2026-12-17',
      '2026-12-28',
      '2026-12-31',
      '2027-01-11',
      '2027-01-14',
    ]);
  });

  it('depends on the week start the rule was created with', () => {
    // Every 2 weeks on Sunday and Monday, starting Monday 2026-11-09.
    const mondayWeeks = rule({ freq: 'weekly', interval: 2, byWeekday: [0, 1], weekStartsOn: 1 });
    const sundayWeeks = rule({ freq: 'weekly', interval: 2, byWeekday: [0, 1], weekStartsOn: 0 });
    // Monday-start: week of Nov 9 holds Mon 9 and Sun 15.
    expect(occurrencesBetween(mondayWeeks, '2026-11-09', '2026-11-30')).toEqual([
      '2026-11-09',
      '2026-11-15',
      '2026-11-23',
      '2026-11-29',
    ]);
    // Sunday-start: week of Nov 8 holds Sun 8 (before start) and Mon 9; next active week starts Sun 22.
    expect(occurrencesBetween(sundayWeeks, '2026-11-09', '2026-11-30')).toEqual([
      '2026-11-09',
      '2026-11-22',
      '2026-11-23',
    ]);
  });
});

describe('monthly', () => {
  it('clamps day 31 to the last day of shorter months, including a leap February', () => {
    const r = rule({ freq: 'monthly', startDate: '2027-12-31' });
    expect(occurrencesBetween(r, '2027-12-01', '2028-06-30')).toEqual([
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
    ]);
  });

  it('handles a leap-day start repeated yearly (every 12 months)', () => {
    const r = rule({ freq: 'monthly', interval: 12, startDate: '2024-02-29' });
    expect(occurrencesBetween(r, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('uses byMonthDay and an interval across a year end', () => {
    const r = rule({ freq: 'monthly', interval: 2, byMonthDay: 15, startDate: '2026-11-01' });
    expect(occurrencesBetween(r, '2026-11-01', '2027-05-31')).toEqual([
      '2026-11-15',
      '2027-01-15',
      '2027-03-15',
      '2027-05-15',
    ]);
  });
});

describe('end conditions and caps', () => {
  it('returns nothing when endDate is before startDate', () => {
    expect(occurrencesBetween(rule({ endType: 'onDate', endDate: '2026-11-01' }), '2026-10-01', '2026-12-01')).toEqual(
      [],
    );
  });

  it('stops on the end date (inclusive)', () => {
    const r = rule({ endType: 'onDate', endDate: '2026-11-12' });
    expect(occurrencesBetween(r, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
  });

  it('stops after count, even when the count is reached inside the window', () => {
    const r = rule({ freq: 'weekly', byWeekday: [1, 3], endType: 'afterCount', count: 5 });
    expect(occurrencesBetween(r, '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-09',
      '2026-11-11',
      '2026-11-16',
      '2026-11-18',
      '2026-11-23',
    ]);
    // A window that starts after some occurrences still counts from the start.
    expect(occurrencesBetween(r, '2026-11-17', '2026-12-31')).toEqual(['2026-11-18', '2026-11-23']);
  });

  it('caps one request at 400 rows per series and windows at 62 days', () => {
    const r = rule({ startDate: '2020-01-01' });
    expect(occurrencesBetween(r, '2020-01-01', '2030-01-01')).toHaveLength(MAX_ROWS_PER_SERIES);
    expect(clampWindow('2026-11-01', '2027-06-01')).toEqual({ from: '2026-11-01', to: '2027-01-01' });
    expect(clampWindow('2026-11-01', '2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(clampWindow('2026-11-30', '2026-11-01')).toBeNull();
  });

  it('is idempotent: the same rule and window always give the same dates and IDs', () => {
    const r = rule({ freq: 'weekly', interval: 3, byWeekday: [2, 6] });
    const a = occurrencesBetween(r, '2026-11-01', '2026-12-31').map((d) => occurrenceId('s1', d));
    const b = occurrencesBetween(r, '2026-11-01', '2026-12-31').map((d) => occurrenceId('s1', d));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('matches the day-by-day reference', () => {
  // Deterministic pseudo-random rules (no Math.random, so failures are reproducible).
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const freqs = ['daily', 'weekly', 'monthly'] as const;
  const cases = Array.from({ length: 150 }, () => {
    const start = addDays('2024-01-01', rand(900));
    const endType = (['never', 'onDate', 'afterCount'] as const)[rand(3)]!;
    const weekdays = [...new Set(Array.from({ length: 1 + rand(3) }, () => rand(7)))];
    const r = rule({
      freq: freqs[rand(3)],
      interval: 1 + rand(4),
      byWeekday: rand(2) ? weekdays : null,
      byMonthDay: rand(2) ? 1 + rand(31) : null,
      weekStartsOn: ([0, 1, 6] as const)[rand(3)],
      startDate: start,
      endType,
      endDate: endType === 'onDate' ? addDays(start, rand(400) - 20) : null,
      count: endType === 'afterCount' ? 1 + rand(40) : null,
    });
    const from = addDays(start, rand(300) - 30);
    return { r, from, to: addDays(from, rand(62)) };
  });

  it.each(cases.map((c, i) => [i, c] as const))('case %i', (_i, { r, from, to }) => {
    expect(occurrencesBetween(r, from, to)).toEqual(naive(r, from, to));
  });
});

describe('helpers', () => {
  it('builds and parses stable occurrence IDs', () => {
    expect(occurrenceId('a1b2-c3', '2026-11-09')).toBe('a1b2-c3_20261109');
    expect(parseOccurrenceId('a1b2-c3_20261109')).toEqual({ seriesId: 'a1b2-c3', originalDate: '2026-11-09' });
    expect(parseOccurrenceId('nope')).toBeNull();
  });

  it('previews the next occurrences and answers membership', () => {
    const r = rule({ freq: 'weekly', byWeekday: [2, 4] });
    expect(nextOccurrences(r, '2026-11-09', 3)).toEqual(['2026-11-10', '2026-11-12', '2026-11-17']);
    expect(producesDate(r, '2026-11-10')).toBe(true);
    expect(producesDate(r, '2026-11-11')).toBe(false);
    expect(countBefore(r, '2026-11-17')).toBe(2);
  });
});

describe('series edits', () => {
  it('"this and following" keeps the every-2-weeks phase in the new series', () => {
    const r = rule({ freq: 'weekly', interval: 2, byWeekday: [1, 4], startDate: '2026-11-09' });
    const { before, after } = splitRule(r, '2026-11-26');
    expect(before).toMatchObject({ endType: 'onDate', endDate: '2026-11-25' });
    expect(after).toMatchObject({ startDate: '2026-11-26', byWeekday: [1, 4] });
    const window = ['2026-11-09', '2027-01-31'] as const;
    const combined = [...occurrencesBetween(before!, ...window), ...occurrencesBetween(after!, ...window)];
    expect(combined).toEqual(occurrencesBetween(r, ...window));
  });

  it('splits an afterCount series into the remaining count', () => {
    const r = rule({ endType: 'afterCount', count: 10 });
    const { before, after } = splitRule(r, '2026-11-13');
    expect(occurrencesBetween(before!, '2026-11-01', '2026-12-31')).toHaveLength(4);
    expect(after).toMatchObject({ startDate: '2026-11-13', count: 6, endType: 'afterCount' });
  });

  it('a split at the start moves the whole series; a split after the end leaves nothing new', () => {
    const r = rule({ endType: 'onDate', endDate: '2026-11-20' });
    expect(splitRule(r, '2026-11-09').before).toBeNull();
    expect(splitRule(r, '2026-11-25').after).toBeNull();
  });

  it('keeps a monthly day-31 rule clamped after a split in a short month', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-01-31' });
    const { after } = splitRule(r, '2026-04-01');
    expect(after).toMatchObject({ startDate: '2026-04-30', byMonthDay: 31 });
    expect(occurrencesBetween(after!, '2026-04-01', '2026-06-30')).toEqual(['2026-04-30', '2026-05-31', '2026-06-30']);
  });

  it('lists future exceptions orphaned by a new rule, ignoring the past', () => {
    const newRule = rule({ freq: 'weekly', byWeekday: [2] }); // Tuesdays only
    const exceptions = [{ originalDate: '2026-11-03' }, { originalDate: '2026-11-10' }, { originalDate: '2026-11-12' }];
    expect(orphanedExceptions(newRule, exceptions, '2026-11-09')).toEqual([{ originalDate: '2026-11-12' }]);
  });

  it('stops repeating yesterday and compares schedules', () => {
    expect(stopRepeating(rule({}), '2026-11-20')).toMatchObject({ endType: 'onDate', endDate: '2026-11-19' });
    const w = rule({ freq: 'weekly', startDate: '2026-11-09' });
    expect(sameSchedule(w, explicitRule(w))).toBe(true);
    expect(sameSchedule(w, { ...w, interval: 2 })).toBe(false);
  });
});
