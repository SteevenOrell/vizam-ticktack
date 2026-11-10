import {
  clampRuleToGoal,
  computeProgress,
  daysLeft,
  defaultPeriodStart,
  defaultRepeatEnd,
  dueDateOf,
  endedPeriodsSince,
  goalRepeatIssue,
  goalSection,
  lastRepeatDate,
  periodContaining,
  progressRange,
  repeatLimitOf,
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

describe('repeating tasks in a goal must end', () => {
  const ending = (rule: RuleCore, endDate: string): RuleCore => ({ ...rule, endType: 'onDate', endDate });
  const times = (rule: RuleCore, count: number): RuleCore => ({ ...rule, endType: 'afterCount', count });
  const timing = { startDate: null, targetDate: null, createdOn: '2026-11-01' };

  it('limit: due date of a one-time goal, end of the current period of a periodic goal', () => {
    expect(repeatLimitOf({ ...timing, period: 'once', targetDate: '2026-11-21' }, '2026-11-09')).toBe('2026-11-21');
    expect(repeatLimitOf({ ...timing, period: 'once' }, '2026-11-09')).toBeNull();
    expect(repeatLimitOf({ ...timing, period: 'daily', startDate: '2026-11-01' }, '2026-11-09')).toBe('2026-11-09');
    expect(repeatLimitOf({ ...timing, period: 'weekly', startDate: '2026-11-02' }, '2026-11-11')).toBe('2026-11-15');
    expect(repeatLimitOf({ ...timing, period: 'monthly', startDate: '2026-11-01' }, '2026-11-11')).toBe('2026-11-30');
    expect(repeatLimitOf({ ...timing, period: 'yearly', startDate: '2026-01-01' }, '2026-11-11')).toBe('2026-12-31');
  });

  it('last repeat date: none for "never", the end date, or the n-th occurrence', () => {
    expect(lastRepeatDate(daily('2026-11-09'))).toBeNull();
    expect(lastRepeatDate(ending(daily('2026-11-09'), '2026-11-20'))).toBe('2026-11-20');
    expect(lastRepeatDate(times(daily('2026-11-09'), 3))).toBe('2026-11-11');
    // Mon + Thu from Monday 2 Nov, 5 times: 2, 5, 9, 12, 16.
    expect(lastRepeatDate(times(weekly([1, 4]), 5))).toBe('2026-11-16');
    expect(lastRepeatDate(times({ ...daily('2026-01-31'), freq: 'monthly' }, 2))).toBe('2026-02-28');
  });

  it('refuses "never" always, and an end after the goal limit', () => {
    const rule = daily('2026-11-09');
    expect(goalRepeatIssue(rule, '2026-11-21')).toBe('repeatNeverInGoal');
    expect(goalRepeatIssue(rule, null)).toBe('repeatNeverInGoal');
    expect(goalRepeatIssue(ending(rule, '2026-11-21'), '2026-11-21')).toBeNull();
    expect(goalRepeatIssue(ending(rule, '2026-11-22'), '2026-11-21')).toBe('repeatAfterGoalEnd');
    expect(goalRepeatIssue(times(rule, 13), '2026-11-21')).toBeNull(); // 9 .. 21 Nov
    expect(goalRepeatIssue(times(rule, 14), '2026-11-21')).toBe('repeatAfterGoalEnd');
    // A goal without a due date only asks for an end.
    expect(goalRepeatIssue(ending(rule, '2030-01-01'), null)).toBeNull();
    expect(goalRepeatIssue(times(rule, 999), null)).toBeNull();
  });

  it('a series starting after the limit may keep its first occurrence only', () => {
    const late = daily('2026-11-25');
    expect(goalRepeatIssue(ending(late, '2026-11-25'), '2026-11-21')).toBeNull();
    expect(goalRepeatIssue(times(late, 1), '2026-11-21')).toBeNull();
    expect(goalRepeatIssue(ending(late, '2026-11-26'), '2026-11-21')).toBe('repeatAfterGoalEnd');
    expect(clampRuleToGoal(late, '2026-11-21', '2026-11-09')).toMatchObject({
      endType: 'onDate',
      endDate: '2026-11-25',
    });
  });

  it('clamps to the limit, keeps an allowed end untouched and never extends it', () => {
    const rule = daily('2026-11-09');
    expect(clampRuleToGoal(rule, '2026-11-21', '2026-11-09')).toEqual(ending(rule, '2026-11-21'));
    expect(clampRuleToGoal(times(rule, 99), '2026-11-21', '2026-11-09')).toEqual(ending(rule, '2026-11-21'));
    expect(clampRuleToGoal(ending(rule, '2026-12-31'), '2026-11-21', '2026-11-09').endDate).toBe('2026-11-21');
    const short = ending(rule, '2026-11-12');
    expect(clampRuleToGoal(short, '2026-11-21', '2026-11-09')).toBe(short);
    const counted = times(rule, 3);
    expect(clampRuleToGoal(counted, '2026-11-21', '2026-11-09')).toBe(counted);
  });

  it('without a goal limit a never-ending rule ends a month after its start, or after today for an old series', () => {
    expect(defaultRepeatEnd('2026-11-09', '2026-11-09')).toBe('2026-12-09');
    expect(clampRuleToGoal(daily('2026-11-20'), null, '2026-11-09').endDate).toBe('2026-12-20');
    expect(clampRuleToGoal(daily('2025-01-31'), null, '2026-01-31').endDate).toBe('2026-02-28');
  });

  it('progress counts occurrences only up to the end of the rule and of the goal', () => {
    const range = { start: '2026-11-09', end: '2026-11-21' };
    const series = (rule: RuleCore, done: string[] = []): LinkedTask => ({
      id: 's',
      status: 'open',
      date: rule.startDate,
      rule,
      occurrences: new Map(done.map((d) => [d, 'done' as const])),
    });
    // Ends on the goal's due date: 9 .. 21 Nov = 13 occurrences.
    expect(computeProgress([series(ending(daily('2026-11-09'), '2026-11-21'))], range, false).total).toBe(13);
    // Ends earlier: only its own 4 occurrences count, 2 of them done.
    expect(
      computeProgress([series(ending(daily('2026-11-09'), '2026-11-12'), ['2026-11-09', '2026-11-10'])], range, false),
    ).toEqual({ done: 2, total: 4, percent: 50 });
    expect(computeProgress([series(times(daily('2026-11-09'), 3), ['2026-11-09'])], range, false)).toEqual({
      done: 1,
      total: 3,
      percent: 33,
    });
    // A done occurrence after the end is not counted.
    expect(computeProgress([series(ending(daily('2026-11-09'), '2026-11-10'), ['2026-11-15'])], range, false)).toEqual({
      done: 0,
      total: 2,
      percent: 0,
    });
    // Periodic goal: the current period bounds the count even when the rule ends later.
    expect(
      computeProgress(
        [series(ending(daily('2026-11-02'), '2026-11-30'))],
        { start: '2026-11-09', end: '2026-11-15' },
        true,
      ).total,
    ).toBe(7);
  });
});
