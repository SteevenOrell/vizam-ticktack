import {
  computeProgress,
  daysLeft,
  defaultPeriodStart,
  dueDateOf,
  endedPeriodsSince,
  goalSection,
  periodContaining,
  progressRange,
  type LinkedTask,
} from '../goals';
import type { RuleCore } from '../models';

const weekly = (byWeekday: number[], startDate = '2026-11-02'): RuleCore => ({
  freq: 'weekly',
  interval: 1,
  byWeekday,
  byMonthDay: null,
  weekStartsOn: 1,
  startDate,
  endType: 'never',
  endDate: null,
  count: null,
});
const daily = (startDate: string): RuleCore => ({ ...weekly([], startDate), freq: 'daily', byWeekday: null });

describe('goal periods', () => {
  it('default starts: today, start of week, 1st of month, 1 January', () => {
    expect(defaultPeriodStart('daily', '2026-11-11', 1)).toBe('2026-11-11');
    expect(defaultPeriodStart('weekly', '2026-11-11', 1)).toBe('2026-11-09');
    expect(defaultPeriodStart('weekly', '2026-11-11', 0)).toBe('2026-11-08');
    expect(defaultPeriodStart('monthly', '2026-11-11', 1)).toBe('2026-11-01');
    expect(defaultPeriodStart('yearly', '2026-11-11', 1)).toBe('2026-01-01');
    expect(defaultPeriodStart('once', '2026-11-11', 1)).toBe('2026-11-11');
  });

  it('daily and weekly periods are aligned to the start date', () => {
    expect(periodContaining('daily', '2026-11-01', '2026-11-10')).toEqual({ start: '2026-11-10', end: '2026-11-10' });
    expect(periodContaining('weekly', '2026-11-04', '2026-11-10')).toEqual({ start: '2026-11-04', end: '2026-11-10' });
    expect(periodContaining('weekly', '2026-11-04', '2026-11-11')).toEqual({ start: '2026-11-11', end: '2026-11-17' });
    expect(periodContaining('once', '2026-11-04', '2026-11-11')).toBeNull();
  });

  it('monthly periods clamp the start day to short months and handle leap years', () => {
    expect(periodContaining('monthly', '2026-01-31', '2026-02-15')).toEqual({ start: '2026-01-31', end: '2026-02-27' });
    expect(periodContaining('monthly', '2026-01-31', '2026-02-28')).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(periodContaining('monthly', '2026-11-20', '2026-12-05')).toEqual({ start: '2026-11-20', end: '2026-12-19' });
    expect(periodContaining('monthly', '2028-01-31', '2028-02-29')).toEqual({ start: '2028-02-29', end: '2028-03-30' });
    expect(periodContaining('monthly', '2026-11-01', '2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('yearly periods run from anniversary to the day before the next one (29 Feb clamps)', () => {
    expect(periodContaining('yearly', '2026-01-01', '2026-11-10')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodContaining('yearly', '2024-02-29', '2025-03-01')).toEqual({ start: '2025-02-28', end: '2026-02-27' });
    expect(periodContaining('yearly', '2026-06-15', '2027-06-14')).toEqual({ start: '2026-06-15', end: '2027-06-14' });
  });

  it('a date before the start maps to the first period', () => {
    expect(periodContaining('weekly', '2026-12-01', '2026-11-10')).toEqual({ start: '2026-12-01', end: '2026-12-07' });
  });

  it('due date and countdown: target date for once, end of the current period otherwise', () => {
    const once = { period: 'once' as const, startDate: null, targetDate: '2026-11-22', createdOn: '2026-11-01' };
    expect(dueDateOf(once, '2026-11-10')).toBe('2026-11-22');
    expect(daysLeft('2026-11-22', '2026-11-10')).toBe(12);
    expect(daysLeft('2026-11-08', '2026-11-10')).toBe(-2);
    const monthly = { period: 'monthly' as const, startDate: '2026-11-01', targetDate: null, createdOn: '2026-11-01' };
    expect(dueDateOf(monthly, '2026-11-10')).toBe('2026-11-30');
    expect(dueDateOf({ ...once, targetDate: null }, '2026-11-10')).toBeNull();
  });

  it('progress range of a one-time goal runs from its start (or creation) to its due date', () => {
    const once = { period: 'once' as const, startDate: null, targetDate: '2026-11-22', createdOn: '2026-11-01' };
    expect(progressRange(once, '2026-11-10')).toEqual({ start: '2026-11-01', end: '2026-11-22' });
    expect(progressRange({ ...once, targetDate: null }, '2026-11-10')).toEqual({
      start: '2026-11-01',
      end: '2026-11-10',
    });
  });

  it('lists ended periods since the last recorded one, oldest first and capped', () => {
    expect(endedPeriodsSince('weekly', '2026-10-19', null, '2026-11-10')).toEqual([
      { start: '2026-10-19', end: '2026-10-25' },
      { start: '2026-10-26', end: '2026-11-01' },
      { start: '2026-11-02', end: '2026-11-08' },
    ]);
    expect(endedPeriodsSince('weekly', '2026-10-19', '2026-11-01', '2026-11-10')).toEqual([
      { start: '2026-11-02', end: '2026-11-08' },
    ]);
    expect(endedPeriodsSince('weekly', '2026-10-19', '2026-11-08', '2026-11-10')).toEqual([]);
    expect(endedPeriodsSince('daily', '2026-01-01', null, '2026-11-10', 12)).toHaveLength(12);
    expect(endedPeriodsSince('daily', '2026-01-01', null, '2026-11-10', 12).at(-1)).toEqual({
      start: '2026-11-09',
      end: '2026-11-09',
    });
    expect(endedPeriodsSince('once', '2026-01-01', null, '2026-11-10')).toEqual([]);
    expect(endedPeriodsSince('monthly', '2026-11-01', null, '2026-11-10')).toEqual([]);
  });
});

describe('goal completion percentage', () => {
  const range = { start: '2026-11-09', end: '2026-11-15' };

  it('is done / total over one-off tasks, rounded down; 0 without tasks', () => {
    const tasks: LinkedTask[] = [
      { id: 'a', status: 'done', date: null, rule: null },
      { id: 'b', status: 'open', date: null, rule: null },
      { id: 'c', status: 'open', date: null, rule: null },
      { id: 'd', status: 'cancelled', date: null, rule: null },
    ];
    expect(computeProgress(tasks, range, false)).toEqual({ done: 1, total: 3, percent: 33 });
    expect(computeProgress([], range, false)).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('counts each occurrence of a recurring task inside the period; skipped ones are left out', () => {
    const occurrences = new Map([
      ['2026-11-10', 'done' as const],
      ['2026-11-12', 'done' as const],
      ['2026-11-14', 'skipped' as const],
    ]);
    // Tue, Thu, Sat in the week of 9-15 Nov: 3 occurrences, 1 skipped -> 2 counted, both done.
    const series: LinkedTask = { id: 's', status: 'open', date: '2026-11-03', rule: weekly([2, 4, 6]), occurrences };
    expect(computeProgress([series], range, true)).toEqual({ done: 2, total: 2, percent: 100 });
    const oneOff: LinkedTask = { id: 'o', status: 'open', date: '2026-11-11', rule: null };
    expect(computeProgress([series, oneOff], range, true)).toEqual({ done: 2, total: 3, percent: 66 });
  });

  it('a daily series in a monthly period counts every day of the period (progress resets per period)', () => {
    const series: LinkedTask = {
      id: 's',
      status: 'open',
      date: '2026-10-01',
      rule: daily('2026-10-01'),
      occurrences: new Map([['2026-10-31', 'done']]),
    };
    expect(computeProgress([series], { start: '2026-11-01', end: '2026-11-30' }, true)).toEqual({
      done: 0,
      total: 30,
      percent: 0,
    });
    expect(computeProgress([series], { start: '2026-10-01', end: '2026-10-31' }, true).done).toBe(1);
  });

  it('periodic goals count dated one-off tasks only in their period; undated ones always', () => {
    const tasks: LinkedTask[] = [
      { id: 'in', status: 'done', date: '2026-11-10', rule: null },
      { id: 'out', status: 'done', date: '2026-11-20', rule: null },
      { id: 'undated', status: 'open', date: null, rule: null },
    ];
    expect(computeProgress(tasks, range, true)).toEqual({ done: 1, total: 2, percent: 50 });
    expect(computeProgress(tasks, range, false)).toEqual({ done: 2, total: 3, percent: 66 });
  });

  it('sections: completed when marked done or 100 %, overdue only for past one-time goals', () => {
    const base = { status: 'active' as const, period: 'once' as const, percent: 40, total: 5, today: '2026-11-10' };
    expect(goalSection({ ...base, due: '2026-11-20' })).toBe('active');
    expect(goalSection({ ...base, due: '2026-11-09' })).toBe('overdue');
    expect(goalSection({ ...base, due: '2026-11-09', percent: 100 })).toBe('completed');
    expect(goalSection({ ...base, due: '2026-11-20', status: 'achieved' })).toBe('completed');
    expect(goalSection({ ...base, period: 'weekly', due: '2026-11-09' })).toBe('active');
    expect(goalSection({ ...base, percent: 0, total: 0, due: null })).toBe('active');
  });
});
