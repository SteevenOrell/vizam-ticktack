/**
 * Phase 5a: the client models enforce the same limits as firebase/firestore.rules, so a local write the app
 * accepts is never refused by the server (which would leave it stuck as a failed sync). Each row: a value at the
 * limit is accepted, one past it is refused. Rules counterparts are tested in tests/rules/firestore.rules.test.ts.
 */
import {
  categorySchema,
  DEFAULT_GOAL_REMINDERS,
  goalSchema,
  milestoneSchema,
  occurrenceSchema,
  profileSchema,
  recurrenceRuleSchema,
  reminderSchema,
  routineSchema,
  taskSchema,
} from '../models';

const ISO = '2026-11-09T10:00:00.000Z';
const base = {
  id: 'id-1',
  ownerId: 'uid-1',
  createdAt: ISO,
  clientUpdatedAt: ISO,
  serverUpdatedAt: null,
  deleted: false,
  schemaVersion: 1,
};
const valid = {
  profile: {
    ...base,
    displayName: null,
    timeZone: 'Europe/Paris',
    weekStartsOn: 1,
    theme: 'system',
    dayStart: '06:00',
    dayEnd: '19:00',
    dailyCapacityMin: 480,
    defaultReminderOffsetMin: 10,
    onboardingCompletedAt: null,
  },
  category: { ...base, name: 'Health', color: 'moss', icon: 'heart', sortOrder: 0, archived: false },
  task: {
    ...base,
    title: 'Task',
    notes: null,
    status: 'open',
    priority: 0,
    categoryId: null,
    goalId: null,
    milestoneId: null,
    parentTaskId: null,
    date: '2026-11-09',
    startTime: null,
    durationMin: null,
    sortOrder: 0,
    completedAt: null,
    recurrenceRuleId: null,
  },
  rule: {
    ...base,
    seriesType: 'task',
    seriesId: 'task-1',
    freq: 'daily',
    interval: 1,
    byWeekday: null,
    byMonthDay: null,
    weekStartsOn: 1,
    startDate: '2026-11-09',
    endType: 'never',
    endDate: null,
    count: null,
  },
  occurrence: {
    ...base,
    id: 'task-1_20261109',
    seriesType: 'task',
    seriesId: 'task-1',
    ruleId: 'rule-1',
    originalDate: '2026-11-09',
    date: '2026-11-09',
    startTime: null,
    durationMin: null,
    title: null,
    notes: null,
    status: 'scheduled',
    completedAt: null,
    completedStepIds: [],
    isException: true,
  },
  reminder: {
    ...base,
    targetType: 'task',
    targetId: 't-1',
    kind: 'relative',
    offsetMin: 10,
    atTime: null,
    enabled: true,
  },
  goal: {
    ...base,
    title: 'Goal',
    description: null,
    targetDate: '2026-12-31',
    status: 'active',
    color: null,
    progressMode: 'tasks',
    manualProgress: 0,
    achievedAt: null,
    period: 'once',
    startDate: null,
    reminders: DEFAULT_GOAL_REMINDERS,
    history: [],
  },
  milestone: { ...base, goalId: 'g-1', title: 'Step', dueDate: null, completedAt: null, sortOrder: 0 },
  routine: {
    ...base,
    title: 'Morning',
    partOfDay: 'morning',
    startTime: null,
    steps: [],
    categoryId: null,
    active: true,
    recurrenceRuleId: null,
  },
};
const schemas = {
  profile: profileSchema,
  category: categorySchema,
  task: taskSchema,
  rule: recurrenceRuleSchema,
  occurrence: occurrenceSchema,
  reminder: reminderSchema,
  goal: goalSchema,
  milestone: milestoneSchema,
  routine: routineSchema,
};
type Kind = keyof typeof schemas;
const ok = (kind: Kind, patch: Record<string, unknown>) =>
  schemas[kind].safeParse({ ...valid[kind], ...patch }).success;
const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: 'Step' }));
const history = (n: number) =>
  Array.from({ length: n }, () => ({ start: '2026-11-02', end: '2026-11-08', percent: 50, done: 1, total: 2 }));

describe('client limits match the Firestore rules', () => {
  it.each(Object.keys(schemas) as Kind[])('the %s fixture is valid', (kind) => {
    expect(ok(kind, {})).toBe(true);
  });

  it.each<[Kind, string, unknown, unknown]>([
    ['task', 'title', 'x'.repeat(200), 'x'.repeat(201)],
    ['task', 'notes', 'x'.repeat(5000), 'x'.repeat(5001)],
    ['task', 'durationMin', 1440, 1441],
    ['task', 'priority', 3, 4],
    ['task', 'sortOrder', 100000, 100001],
    ['category', 'name', 'x'.repeat(40), 'x'.repeat(41)],
    ['category', 'sortOrder', 10000, 10001],
    ['profile', 'displayName', 'x'.repeat(60), 'x'.repeat(61)],
    ['profile', 'timeZone', 'x'.repeat(64), 'x'.repeat(65)],
    ['profile', 'dailyCapacityMin', 1440, 1441],
    ['profile', 'defaultReminderOffsetMin', 10080, 10081],
    ['rule', 'interval', 99, 100],
    ['rule', 'count', 999, 1000],
    ['rule', 'byMonthDay', 31, 32],
    ['occurrence', 'title', 'x'.repeat(200), 'x'.repeat(201)],
    ['occurrence', 'notes', 'x'.repeat(5000), 'x'.repeat(5001)],
    [
      'occurrence',
      'completedStepIds',
      Array.from({ length: 60 }, (_, i) => `s${i}`),
      Array.from({ length: 61 }, (_, i) => `s${i}`),
    ],
    ['reminder', 'offsetMin', 10080, 10081],
    ['goal', 'title', 'x'.repeat(120), 'x'.repeat(121)],
    ['goal', 'description', 'x'.repeat(2000), 'x'.repeat(2001)],
    ['goal', 'manualProgress', 100, 101],
    ['milestone', 'title', 'x'.repeat(120), 'x'.repeat(121)],
    ['milestone', 'sortOrder', 10000, 10001],
    ['routine', 'title', 'x'.repeat(80), 'x'.repeat(81)],
    ['routine', 'steps', steps(30), steps(31)],
  ])('%s.%s: at the limit accepted, past it refused', (kind, field, atLimit, past) => {
    expect(ok(kind, { [field]: atLimit })).toBe(true);
    expect(ok(kind, { [field]: past })).toBe(false);
  });

  it('periodic goals: start required, no stored due date, bounded history (rules goalOk)', () => {
    const weekly = { period: 'weekly', startDate: '2026-11-02', targetDate: null };
    expect(ok('goal', { ...weekly, history: history(60) })).toBe(true);
    expect(ok('goal', { ...weekly, history: history(61) })).toBe(false);
    expect(ok('goal', { ...weekly, startDate: null })).toBe(false);
    expect(ok('goal', { ...weekly, targetDate: '2026-12-01' })).toBe(false);
    expect(ok('goal', { startDate: '2027-01-01', targetDate: '2026-12-31' })).toBe(false);
    const bad = { start: '2026-11-08', end: '2026-11-02', percent: 0, done: 0, total: 0 };
    expect(ok('goal', { ...weekly, history: [bad] })).toBe(false);
    expect(
      ok('goal', { ...weekly, history: [{ ...bad, start: '2026-11-02', end: '2026-11-08', done: 3, total: 2 }] }),
    ).toBe(false);
  });

  it('timestamps: ISO date-times as the app writes them, nothing else (rules isIso)', () => {
    for (const good of [ISO, '2026-11-09T10:00:00Z', '2026-11-09T10:00:00+01:00']) {
      expect(ok('task', { createdAt: good, completedAt: good })).toBe(true);
    }
    for (const bad of ['2026-11-09', 'not a timestamp!', '2026-11-09 10:00:00', `${ISO}x`]) {
      expect(ok('task', { createdAt: bad })).toBe(false);
      expect(ok('task', { clientUpdatedAt: bad })).toBe(false);
      expect(ok('task', { completedAt: bad })).toBe(false);
      expect(ok('goal', { achievedAt: bad })).toBe(false);
    }
  });

  it('category names are single-line and stored trimmed (rules ^\\S(.*\\S)?$)', () => {
    expect(ok('category', { name: 'A\nB' })).toBe(false);
    expect(ok('category', { name: 'A\r\nB' })).toBe(false);
    expect(categorySchema.parse({ ...valid.category, name: '  Été 2  ' }).name).toBe('Été 2');
  });

  it('ids use the rules alphabet and length (isId)', () => {
    expect(ok('task', { id: 'a'.repeat(128) })).toBe(true);
    expect(ok('task', { id: 'a'.repeat(129) })).toBe(false);
    expect(ok('task', { goalId: '../users/other' })).toBe(false);
    expect(ok('task', { categoryId: 'a b' })).toBe(false);
  });
});
