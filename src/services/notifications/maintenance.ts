/**
 * One upkeep pass, shared by the foreground hook (useGoalMaintenance) and the background task: records ended
 * periods of periodic goals (history), then rebuilds the reminder window (goals, tasks, routines). The OS module is
 * only loaded when something has a reminder on (or reminders were used on this device, to clean up after a wipe)
 * and permission is granted; otherwise reminders stay saved and nothing is scheduled.
 */
import i18n from '../../i18n';
import { enforceGoalRepeats, rollGoalHistory } from '../../data/goals';
import type { SqlDriver } from '../../data/db/driver';
import type { DataContext } from '../../data/store';
import { formatClock } from '../../lib/dates';
import { usePreferences } from '../../state/preferences';
import { schedulesExact } from './exactAlarm';
import {
  expoNotificationsApi,
  getExactAlarmState,
  getReminderPermission,
  remindersSupported,
} from './expoNotifications';
import type { Translate } from './plan';
import { cancelAll, hasAnyReminder, rescheduleReminders, type NotificationsApi } from './scheduler';

const translate: Translate = (key, vars) => i18n.t(key as never, vars as never) as unknown as string;

/** OS hooks of a maintenance pass (the real adapter by default; tests pass fakes). */
export interface MaintenanceDeps {
  supported: boolean;
  permission: () => Promise<string>;
  /** Exact-alarm access granted (Android); false when not, on iOS and in Expo Go. */
  exact: () => Promise<boolean>;
  api: () => NotificationsApi;
  now?: () => Date;
}

const osDeps: MaintenanceDeps = {
  supported: remindersSupported,
  permission: getReminderPermission,
  exact: async () => schedulesExact(await getExactAlarmState()),
  api: expoNotificationsApi,
};

/**
 * Goal history first, then the reminder window: goal, task and routine reminders of the next 7 days (at most 50),
 * so a moved, completed or deleted task and an edited or deleted routine get their notification replaced or
 * cancelled. Never throws (it runs from effects and the background task).
 */
export async function maintainGoals(ctx: DataContext, deps: MaintenanceDeps = osDeps): Promise<void> {
  try {
    await enforceGoalRepeats(ctx);
    await rollGoalHistory(ctx);
  } catch (e) {
    console.warn('Goal history update failed', e instanceof Error ? e.name : 'unknown');
  }
  if (!deps.supported) return;
  try {
    const now = deps.now ?? (() => new Date());
    const used = usePreferences.getState().remindersUsed;
    // Nothing to plan and nothing scheduled before on this device: never load the OS module.
    if (!used && !(await hasAnyReminder(ctx.db, ctx.ownerId, now()))) return;
    if ((await deps.permission()) !== 'granted') return;
    await rescheduleReminders({
      db: ctx.db,
      ownerId: ctx.ownerId,
      api: deps.api(),
      t: translate,
      now,
      exact: await deps.exact(),
      formatTime: (hhmm) => formatClock(hhmm, i18n.language),
    });
  } catch (e) {
    console.warn('Reminder scheduling failed', e instanceof Error ? e.name : 'unknown');
  }
}

/**
 * Sign-out / account deletion / signed-out start with a previous account's data: cancels every notification this
 * app scheduled, so the next person on the device never sees the previous account's reminder titles. Needs no
 * permission. Never throws; returns the number cancelled.
 */
export async function cancelAllReminders(db: SqlDriver, deps: Pick<MaintenanceDeps, 'supported' | 'api'> = osDeps) {
  if (!deps.supported) return 0;
  try {
    return await cancelAll(db, deps.api());
  } catch (e) {
    console.warn('Reminder cleanup failed', e instanceof Error ? e.name : 'unknown');
    return 0;
  }
}
