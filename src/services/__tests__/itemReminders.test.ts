import { context, freshDb, NOW } from '../../../tests/support/db';
import type { SqlDriver } from '../../data/db/driver';
import { createRoutine, deleteRoutine, emptyRoutineDraft, updateRoutine, type RoutineDraft } from '../../data/routines';
import { createTask, deleteTask, emptyDraft, moveToDate, setDone, type TaskDraft } from '../../data/tasks';
import { usePreferences } from '../../state/preferences';
import { MAX_SCHEDULED, type PlannedNotification } from '../notifications/plan';
import { rescheduleReminders, type NotificationsApi, type ScheduleOptions } from '../notifications/scheduler';
import { reminderPayload, reminderRoute } from '../notifications/tapRoute';
import { maintainGoals, type MaintenanceDeps } from '../notifications/maintenance';

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

/** In-memory OS scheduler (stands in for expo-notifications). */
function fakeOs() {
  const scheduled = new Map<string, PlannedNotification>();
  const options: ScheduleOptions[] = [];
  const api: NotificationsApi = {
    getScheduledIds: async () => [...scheduled.keys()],
    schedule: async (n, o) => {
      scheduled.set(n.id, n);
      options.push(o);
    },
    cancel: async (id) => {
      scheduled.delete(id);
    },
  };
  return { api, scheduled, options };
}

const daily = {
  freq: 'daily' as const,
  interval: 1,
  byWeekday: null,
  byMonthDay: null,
  weekStartsOn: 1 as const,
  endType: 'never' as const,
  endDate: null,
  count: null,
};
const task = (patch: Partial<TaskDraft>): TaskDraft => ({ ...emptyDraft('2026-11-11'), title: 'Dentist', ...patch });
const routine = (patch: Partial<RoutineDraft> = {}): RoutineDraft => ({
  ...emptyRoutineDraft(1),
  title: 'Morning',
  startTime: '07:00',
  steps: [{ title: 'Stretch', durationMin: 5 }],
  reminder: { offsetMin: 10, atTime: '09:00' },
  ...patch,
});
const stamp = (ms: number) => new Date(ms).toString().slice(4, 21);

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

describe('task and routine reminders (7-day window)', () => {
  const run = (api: NotificationsApi) => rescheduleReminders({ db, ownerId: 'local', api, t, now: () => NOW });

  it('a repeating task gets one reminder per day of the window, opening its day', async () => {
    const ctx = context(db);
    const series = await createTask(
      ctx,
      task({
        title: 'Walk',
        date: '2026-11-09',
        startTime: '07:00',
        repeat: daily,
        reminder: { offsetMin: 10, atTime: '09:00' },
      }),
    );
    const { api, scheduled } = fakeOs();
    expect((await run(api)).scheduled).toBe(7);
    const list = [...scheduled.values()].sort((a, b) => a.fireAt - b.fireAt);
    // Today's 06:50 has passed; the window ends 7 days after now (16 Nov, 10:30).
    expect(stamp(list[0]!.fireAt)).toBe('Nov 10 2026 06:50');
    expect(stamp(list[6]!.fireAt)).toBe('Nov 16 2026 06:50');
    expect(list[0]!.url).toBe(`ticktack://task/details/${series.id}?occ=${series.id}_20261110`);
    expect(list[0]!.body).toBe('notifications.taskAt:{"time":"07:00"}');
    // The next pass, a day later, tops the window up by one day.
    const later = await rescheduleReminders({
      db,
      ownerId: 'local',
      api,
      t,
      now: () => new Date(2026, 10, 10, 10, 30),
    });
    expect(later).toEqual({ scheduled: 1, cancelled: 1, kept: 6 });
  });

  it('untimed days ring at the time of day; reminders without a reminder row are not planned', async () => {
    const ctx = context(db);
    await createTask(ctx, task({ title: 'Call mum', reminder: { offsetMin: 10, atTime: '08:30' } }));
    await createTask(ctx, task({ title: 'No reminder' }));
    const { api, scheduled } = fakeOs();
    await run(api);
    expect([...scheduled.values()].map((n) => [n.title, stamp(n.fireAt), n.body])).toEqual([
      ['Call mum', 'Nov 11 2026 08:30', 'notifications.taskToday'],
    ]);
  });

  it('a moved task replaces its notification; done and deleted tasks cancel theirs', async () => {
    const ctx = context(db);
    const a = await createTask(ctx, task({ startTime: '18:00', reminder: { offsetMin: 15, atTime: '09:00' } }));
    const b = await createTask(
      ctx,
      task({ title: 'Gym', startTime: '19:00', reminder: { offsetMin: 0, atTime: '09:00' } }),
    );
    const { api, scheduled } = fakeOs();
    expect(await run(api)).toEqual({ scheduled: 2, cancelled: 0, kept: 0 });
    expect(await run(api)).toEqual({ scheduled: 0, cancelled: 0, kept: 2 });

    await moveToDate(ctx, { taskId: a.id }, '2026-11-12');
    expect(await run(api)).toEqual({ scheduled: 1, cancelled: 1, kept: 1 });
    const moved = [...scheduled.values()].find((n) => n.targetId === a.id)!;
    expect(stamp(moved.fireAt)).toBe('Nov 12 2026 17:45');

    await setDone(ctx, { taskId: a.id }, true);
    expect(await run(api)).toEqual({ scheduled: 0, cancelled: 1, kept: 1 });
    await deleteTask(ctx, { taskId: b.id });
    expect(await run(api)).toEqual({ scheduled: 0, cancelled: 1, kept: 0 });
    expect(scheduled.size).toBe(0);
  });

  it('an edited routine replaces its reminders; a deleted routine cancels them', async () => {
    const ctx = context(db);
    const r = await createRoutine(ctx, routine());
    const { api, scheduled } = fakeOs();
    expect((await run(api)).scheduled).toBe(7);
    const first = [...scheduled.values()].sort((x, y) => x.fireAt - y.fireAt)[0]!;
    expect(first.url).toBe(`ticktack://routine/${r.id}`);
    expect(first.body).toBe('notifications.routineAt:{"time":"07:00"}');

    await updateRoutine(ctx, r.id, routine({ startTime: '11:00' }));
    const report = await run(api);
    // 10:50 today is still ahead (and 16 Nov 10:50 is past the window): 9 to 15 Nov, all replaced.
    expect(report).toEqual({ scheduled: 7, cancelled: 7, kept: 0 });
    expect(stamp([...scheduled.values()].sort((x, y) => x.fireAt - y.fireAt)[0]!.fireAt)).toBe('Nov 09 2026 10:50');

    await deleteRoutine(ctx, r.id);
    expect(await run(api)).toEqual({ scheduled: 0, cancelled: 7, kept: 0 });
  });

  it(`never schedules more than ${MAX_SCHEDULED}, keeping the soonest`, async () => {
    const ctx = context(db);
    for (let i = 0; i < 9; i += 1) {
      await createTask(
        ctx,
        task({
          title: `Daily ${i}`,
          date: '2026-11-09',
          startTime: `${String(11 + i).padStart(2, '0')}:00`,
          repeat: daily,
          reminder: { offsetMin: 0, atTime: '09:00' },
        }),
      );
    }
    const { api, scheduled } = fakeOs();
    expect((await run(api)).scheduled).toBe(MAX_SCHEDULED);
    const times = [...scheduled.values()].map((n) => n.fireAt).sort((a, b) => a - b);
    // 9 tasks x 7 or 8 days = 69 wanted; the latest ones (last day) are dropped.
    expect(stamp(times[0]!)).toBe('Nov 09 2026 11:00');
    expect(stamp(times[times.length - 1]!)).toBe('Nov 14 2026 15:00');
  });
});

describe('reminder taps', () => {
  it('routes goal, task (with its day) and routine payloads', () => {
    const base = { fireAt: 0, title: '', body: '', url: '', fingerprint: '', key: '', kind: 'task' as const };
    const occ = { ...base, id: 'x', targetType: 'task' as const, targetId: 'task1', occurrenceId: 'task1_20261110' };
    expect(reminderRoute(reminderPayload(occ))).toEqual({
      pathname: '/task/details/[id]',
      params: { id: 'task1', occ: 'task1_20261110' },
    });
    expect(reminderRoute(reminderPayload({ ...occ, occurrenceId: null }))).toEqual({
      pathname: '/task/details/[id]',
      params: { id: 'task1' },
    });
    expect(reminderRoute({ targetType: 'routine', targetId: 'r1', occurrenceId: 'r1_20261110' })).toEqual({
      pathname: '/routine/[id]',
      params: { id: 'r1' },
    });
    expect(reminderRoute(reminderPayload({ ...occ, targetType: 'goal', targetId: 'g1', occurrenceId: null }))).toEqual({
      pathname: '/goal/[id]',
      params: { id: 'g1' },
    });
    // Payload of goal reminders scheduled before task reminders existed.
    expect(reminderRoute({ url: 'ticktack://goal/g2', goalId: 'g2' })).toEqual({
      pathname: '/goal/[id]',
      params: { id: 'g2' },
    });
  });

  it('ignores unknown or unsafe payloads; drops an occurrence of another task', () => {
    expect(reminderRoute(null)).toBeNull();
    expect(reminderRoute('task1')).toBeNull();
    expect(reminderRoute({ targetType: 'note', targetId: 'n1' })).toBeNull();
    expect(reminderRoute({ targetType: 'task', targetId: '../settings' })).toBeNull();
    expect(reminderRoute({ targetType: 'task', targetId: 't1', occurrenceId: 'other_20261110' })).toEqual({
      pathname: '/task/details/[id]',
      params: { id: 't1' },
    });
  });

  it('the adapter opens the route once, including the cold-start response', async () => {
    const N = jest.requireMock<Record<string, jest.Mock>>('expo-notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../notifications/expoNotifications') as typeof import('../notifications/expoNotifications');
    const response = {
      notification: {
        date: 1,
        request: { identifier: 'tt_r1_20261110_routine', content: { data: { targetType: 'routine', targetId: 'r1' } } },
      },
    };
    N.getLastNotificationResponseAsync!.mockResolvedValue(response);
    let listener: ((r: unknown) => void) | undefined;
    N.addNotificationResponseReceivedListener!.mockImplementation((fn: (r: unknown) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    });
    const open = jest.fn();
    const stop = mod.listenForReminderTaps(open);
    await new Promise((r) => setTimeout(r, 0));
    listener!(response); // same response delivered by the listener: not opened twice
    mod.listenForReminderTaps(open); // a remount does not reopen the cold-start response
    await new Promise((r) => setTimeout(r, 0));
    listener!({ notification: { ...response.notification, date: 2 } });
    expect(open.mock.calls).toEqual([
      [{ pathname: '/routine/[id]', params: { id: 'r1' } }],
      [{ pathname: '/routine/[id]', params: { id: 'r1' } }],
    ]);
    stop();
    N.getLastNotificationResponseAsync!.mockResolvedValue(null);
  });
});

describe('maintainGoals (foreground and background pass)', () => {
  const deps = (over: Partial<MaintenanceDeps> = {}) => {
    const os = fakeOs();
    return {
      os,
      deps: {
        supported: true,
        permission: async () => 'granted',
        exact: async () => false,
        api: () => os.api,
        now: () => NOW,
        ...over,
      } satisfies MaintenanceDeps,
    };
  };

  it('schedules task and routine reminders, passing the exact-alarm state', async () => {
    const ctx = context(db);
    await createTask(ctx, task({ startTime: '18:00', reminder: { offsetMin: 15, atTime: '09:00' } }));
    await createRoutine(ctx, routine());
    const inexact = deps();
    await maintainGoals(ctx, inexact.deps);
    expect(inexact.os.scheduled.size).toBe(8);
    expect(inexact.os.options.every((o) => o.exact === false)).toBe(true);
  });

  it('does nothing without a reminder, without permission or where unsupported', async () => {
    const ctx = context(db);
    usePreferences.setState({ remindersUsed: false });
    const none = deps({ permission: jest.fn(async () => 'granted') });
    await maintainGoals(ctx, none.deps);
    expect(none.deps.permission).not.toHaveBeenCalled();

    await createTask(ctx, task({ startTime: '18:00', reminder: { offsetMin: 15, atTime: '09:00' } }));
    const denied = deps({ permission: async () => 'denied' });
    await maintainGoals(ctx, denied.deps);
    expect(denied.os.scheduled.size).toBe(0);
    const web = deps({ supported: false });
    await maintainGoals(ctx, web.deps);
    expect(web.os.scheduled.size).toBe(0);
  });
});
