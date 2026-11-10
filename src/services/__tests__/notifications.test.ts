import { context, freshDb, NOW, TODAY } from '../../../tests/support/db';
import { createGoal, deleteGoal, type GoalDraft } from '../../data/goals';
import type { SqlDriver } from '../../data/db/driver';
import { createTask, emptyDraft } from '../../data/tasks';
import { DEFAULT_GOAL_REMINDERS, type GoalReminders } from '../../domain/models';
import {
  fireTime,
  ID_PREFIX,
  MAX_SCHEDULED,
  planGoalNotifications,
  type GoalReminderInput,
  type PlannedNotification,
} from '../notifications/plan';
import { cancelAll, reconcile, rescheduleGoalReminders, type NotificationsApi } from '../notifications/scheduler';

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

/** In-memory OS scheduler (stands in for expo-notifications). */
function fakeOs(initial: string[] = []) {
  const scheduled = new Map<string, PlannedNotification | null>(initial.map((id) => [id, null]));
  const api: NotificationsApi & { calls: { schedule: number; cancel: number } } = {
    calls: { schedule: 0, cancel: 0 },
    getScheduledIds: async () => [...scheduled.keys()],
    schedule: async (n) => {
      api.calls.schedule += 1;
      scheduled.set(n.id, n);
    },
    cancel: async (id) => {
      api.calls.cancel += 1;
      scheduled.delete(id);
    },
  };
  return { api, scheduled };
}

const goalInput = (
  over: Omit<Partial<GoalReminderInput>, 'reminders'> & { reminders?: Partial<GoalReminders> } = {},
): GoalReminderInput => ({
  id: 'goal-1',
  title: 'Run a 10K',
  status: 'active',
  period: 'once',
  startDate: null,
  targetDate: '2026-11-12',
  createdOn: '2026-11-01',
  steps: [],
  ...over,
  reminders: { ...DEFAULT_GOAL_REMINDERS, ...over.reminders },
});

describe('planner (rolling 7-day window)', () => {
  it('before due date: on the day, 1 day and 1 week before, at the chosen time; past times are skipped', () => {
    const plan = planGoalNotifications(
      [goalInput({ targetDate: '2026-11-12', reminders: { beforeDue: [0, 1, 7], beforeDueTime: '08:15' } })],
      NOW,
      t,
    );
    // 7 days before (5 Nov) is in the past: only 11 and 12 Nov.
    expect(plan.map((n) => [n.kind, new Date(n.fireAt).toString().slice(4, 21), n.body])).toEqual([
      ['due', 'Nov 11 2026 08:15', 'notifications.due_1'],
      ['due', 'Nov 12 2026 08:15', 'notifications.due_0'],
    ]);
    expect(plan[0]?.id).toBe(`${ID_PREFIX}goal-1_due_20261112d1`);
    expect(plan[0]?.url).toBe('ticktack://goal/goal-1');
  });

  it('keeps only the next 7 days and nothing for done or archived goals', () => {
    const far = goalInput({ targetDate: '2026-11-30', reminders: { beforeDue: [0, 1, 7] } });
    expect(planGoalNotifications([far], NOW, t).map((n) => n.key)).toEqual([]);
    const soon = goalInput({ targetDate: '2026-11-23', reminders: { beforeDue: [7] } });
    expect(planGoalNotifications([soon], NOW, t)).toHaveLength(1);
    expect(planGoalNotifications([{ ...soon, status: 'achieved' }], NOW, t)).toEqual([]);
  });

  it('at each step: the task time, or the reminder time for all-day steps', () => {
    const plan = planGoalNotifications(
      [
        goalInput({
          targetDate: null,
          reminders: { eachStep: true, beforeDueTime: '09:00' },
          steps: [
            { key: 'a', taskId: 'a', occurrenceId: null, title: 'Long run', date: '2026-11-10', startTime: '18:30' },
            { key: 'b', taskId: 'b', occurrenceId: null, title: 'Stretch', date: '2026-11-11', startTime: null },
            { key: 'c', taskId: 'c', occurrenceId: null, title: 'Too early', date: TODAY, startTime: '07:00' },
          ],
        }),
      ],
      NOW,
      t,
    );
    expect(plan.map((n) => [new Date(n.fireAt).getHours(), n.body])).toEqual([
      [18, 'notifications.step:{"task":"Long run"}'],
      [9, 'notifications.step:{"task":"Stretch"}'],
    ]);
  });

  it('monthly check-in clamps the day to the month; daily and weekly goals get their matching reminder', () => {
    const monthly = goalInput({ id: 'm', reminders: { monthlyDay: 31, monthlyTime: '10:00' } });
    // 30 Nov is outside the window from 9 Nov; from 25 Nov the clamped day (30) is inside.
    expect(planGoalNotifications([monthly], NOW, t)).toEqual([]);
    const late = new Date(2026, 10, 25, 8, 0);
    expect(planGoalNotifications([monthly], late, t).map((n) => n.key)).toEqual(['20261130']);

    const daily = goalInput({
      id: 'd',
      period: 'daily',
      startDate: '2026-11-01',
      targetDate: null,
      reminders: { periodic: true, periodicTime: '20:00' },
    });
    expect(planGoalNotifications([daily], NOW, t)).toHaveLength(7); // 9..15 Nov at 20:00 (16 Nov 20:00 > horizon)
    const weekly = goalInput({
      id: 'w',
      period: 'weekly',
      startDate: '2026-11-02',
      targetDate: null,
      reminders: { periodic: true, periodicWeekday: 5, periodicTime: '17:00' },
    });
    expect(planGoalNotifications([weekly], NOW, t).map((n) => n.key)).toEqual(['20261113']);
    // A periodic reminder is ignored for monthly goals (they use the monthly check-in).
    expect(planGoalNotifications([{ ...weekly, period: 'monthly' }], NOW, t)).toEqual([]);
  });

  it('caps the window at the 50 soonest and is deterministic', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      goalInput({
        id: `g${i}`,
        period: 'daily',
        startDate: '2026-11-01',
        targetDate: null,
        reminders: { periodic: true, periodicTime: `0${i}:30`.slice(-5) },
      }),
    );
    const plan = planGoalNotifications(many, NOW, t);
    expect(plan).toHaveLength(MAX_SCHEDULED);
    expect(plan.every((n, i) => i === 0 || n.fireAt >= plan[i - 1]!.fireAt)).toBe(true);
    expect(planGoalNotifications(many, NOW, t)).toEqual(plan);
  });

  it('due reminders of a periodic goal follow the end of each period', () => {
    const weekly = goalInput({
      period: 'weekly',
      startDate: '2026-11-02',
      targetDate: null,
      reminders: { beforeDue: [0, 1] },
    });
    expect(planGoalNotifications([weekly], NOW, t).map((n) => n.key)).toEqual(['20261115d1', '20261115d0']);
  });

  it('fire times are local wall-clock times', () => {
    expect(new Date(fireTime('2026-11-01', '09:00')).getHours()).toBe(9);
  });
});

describe('reconcile (idempotent, cancel extras, reschedule changes)', () => {
  let db: SqlDriver;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(async () => {
    await db.close();
  });

  const plan = (over = {}) => planGoalNotifications([goalInput({ reminders: { beforeDue: [0, 1] }, ...over })], NOW, t);

  it('schedules missing, keeps unchanged on the second run, records state locally', async () => {
    const { api, scheduled } = fakeOs();
    expect(await reconcile(db, api, plan())).toEqual({ scheduled: 2, cancelled: 0, kept: 0 });
    expect(await reconcile(db, api, plan())).toEqual({ scheduled: 0, cancelled: 0, kept: 2 });
    expect(scheduled.size).toBe(2);
    const rows = await db.all<{ notification_id: string; reminder_id: string }>(
      'SELECT notification_id, reminder_id FROM scheduled_notifications ORDER BY fire_at',
    );
    expect(rows.map((r) => r.reminder_id)).toEqual(['goal-1', 'goal-1']);
  });

  it('cancels extras and replaces a notification whose text changed; never touches foreign ids', async () => {
    const { api, scheduled } = fakeOs(['someone-else']);
    await reconcile(db, api, plan());
    const renamed = plan({ title: 'Run a half marathon' });
    expect(await reconcile(db, api, renamed)).toEqual({ scheduled: 2, cancelled: 2, kept: 0 });
    expect([...scheduled.values()].filter(Boolean).map((n) => n!.title)).toEqual([
      'Run a half marathon',
      'Run a half marathon',
    ]);
    expect(await reconcile(db, api, renamed.slice(0, 1))).toEqual({ scheduled: 0, cancelled: 1, kept: 1 });
    expect(await cancelAll(db, api)).toBe(1);
    expect([...scheduled.keys()]).toEqual(['someone-else']);
  });

  it('rebuilds from the database: a deleted goal cancels its reminders', async () => {
    const ctx = context(db);
    const task = await createTask(ctx, { ...emptyDraft('2026-11-11'), title: 'Long run', startTime: '18:00' });
    const draft: GoalDraft = {
      title: 'Run a 10K',
      description: null,
      period: 'once',
      startDate: null,
      dueDate: '2026-11-12',
      color: null,
      reminders: { ...DEFAULT_GOAL_REMINDERS, beforeDue: [0], eachStep: true },
      linkTaskIds: [task.id],
      newTasks: [],
    };
    const goal = await createGoal(ctx, draft);
    const { api, scheduled } = fakeOs();
    const deps = { db, ownerId: 'local', api, t, now: () => NOW };
    expect(await rescheduleGoalReminders(deps)).toEqual({ scheduled: 2, cancelled: 0, kept: 0 });
    expect([...scheduled.values()].map((n) => n?.kind).sort()).toEqual(['due', 'step']);
    expect(await rescheduleGoalReminders(deps)).toEqual({ scheduled: 0, cancelled: 0, kept: 2 });
    await deleteGoal(ctx, goal.id);
    expect(await rescheduleGoalReminders(deps)).toEqual({ scheduled: 0, cancelled: 2, kept: 0 });
    expect(scheduled.size).toBe(0);
  });
});

describe('expo-notifications adapter (mocked)', () => {
  // jest.setup.ts mocks expo-notifications; the adapter loads it lazily on first use.
  const N = jest.requireMock<Record<string, jest.Mock>>('expo-notifications');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../notifications/expoNotifications') as typeof import('../notifications/expoNotifications');

  it('asks permission only on request, schedules a DATE trigger with the deterministic identifier', async () => {
    N.getAllScheduledNotificationsAsync!.mockResolvedValueOnce([{ identifier: 'tt_a' }, { identifier: 'other' }]);
    expect(await mod.getReminderPermission()).toBe('undetermined');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await mod.requestReminderPermission()).toBe('granted');
    const api = mod.expoNotificationsApi();
    expect(await api.getScheduledIds()).toEqual(['tt_a', 'other']);
    const [n] = planGoalNotifications([goalInput({ reminders: { beforeDue: [0] } })], NOW, t);
    await api.schedule(n!);
    expect(N.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: n!.id,
      content: { title: 'Run a 10K', body: 'notifications.due_0', data: { url: n!.url, goalId: 'goal-1' } },
      trigger: { type: 'date', date: n!.fireAt, channelId: 'reminders' },
    });
    expect(N.setNotificationHandler).toHaveBeenCalledTimes(1);
    await api.cancel('tt_a');
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('tt_a');
  });

  it('reports denied when the OS will not ask again', async () => {
    N.getPermissionsAsync!.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
    expect(await mod.getReminderPermission()).toBe('denied');
  });
});
