/**
 * Reminder scheduler (goals, tasks, routines): plans the rolling window, then reconciles it with what the OS has
 * scheduled and with the local-only `scheduled_notifications` table (never synced). Idempotent: a second run with
 * the same data schedules and cancels nothing. Runs on app start, on foreground, after local or synced changes
 * (see useGoalMaintenance) and from the background task, which is how the window of a repeating task is topped up.
 */
import { localDateOf, addDays } from '../../domain/localDate';
import type { SqlDriver } from '../../data/db/driver';
import { listItemReminders } from '../../data/reminders';
import { listEntities } from '../../data/store';
import { getAgenda } from '../../data/queries/agenda';
import {
  capPlan,
  ID_PREFIX,
  planGoalNotifications,
  planItemNotifications,
  WINDOW_DAYS,
  type GoalReminderInput,
  type GoalStep,
  type ItemReminderInput,
  type PlannedNotification,
  type Translate,
} from './plan';

export interface ScheduleOptions {
  /**
   * Exact-alarm access is granted (Android). Only recorded here: the OS decides the precision from the permission.
   * It is part of what is stored, so reminders set while it was off are set again once it is on (and the reverse).
   */
  exact: boolean;
}

/** The subset of expo-notifications the scheduler needs (mocked in tests). */
export interface NotificationsApi {
  getScheduledIds(): Promise<string[]>;
  schedule(n: PlannedNotification, options: ScheduleOptions): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface ReconcileReport {
  scheduled: number;
  cancelled: number;
  kept: number;
}

interface StoredRow {
  notification_id: string;
  fingerprint: string;
}

/** Stored next to each notification; differs between exact and inexact scheduling of the same reminder. */
export const storedFingerprint = (n: Pick<PlannedNotification, 'fingerprint'>, exact: boolean) =>
  exact ? `${n.fingerprint}:x` : n.fingerprint;

/** Makes the OS schedule match `desired`: cancels ours that are extra or changed, schedules missing or changed. */
export async function reconcile(
  db: SqlDriver,
  api: NotificationsApi,
  desired: readonly PlannedNotification[],
  options: ScheduleOptions = { exact: false },
): Promise<ReconcileReport> {
  const osIds = new Set((await api.getScheduledIds()).filter((id) => id.startsWith(ID_PREFIX)));
  const stored = new Map(
    (await db.all<StoredRow>('SELECT notification_id, fingerprint FROM scheduled_notifications')).map((r) => [
      r.notification_id,
      r.fingerprint,
    ]),
  );
  const want = new Map(desired.map((n) => [n.id, n]));
  const report: ReconcileReport = { scheduled: 0, cancelled: 0, kept: 0 };

  for (const id of osIds) {
    const next = want.get(id);
    if (!next || stored.get(id) !== storedFingerprint(next, options.exact)) {
      await api.cancel(id);
      osIds.delete(id);
      report.cancelled += 1;
    }
  }
  for (const n of desired) {
    if (osIds.has(n.id)) {
      report.kept += 1;
      continue;
    }
    await api.schedule(n, options);
    report.scheduled += 1;
  }

  await db.transaction(async () => {
    await db.run('DELETE FROM scheduled_notifications');
    for (const n of desired) {
      await db.run(
        `INSERT INTO scheduled_notifications (notification_id, reminder_id, occurrence_key, fire_at, fingerprint)
         VALUES (?, ?, ?, ?, ?)`,
        [n.id, n.targetId, `${n.kind}:${n.key}`, n.fireAt, storedFingerprint(n, options.exact)],
      );
    }
  });
  return report;
}

/** Cancels every notification this app scheduled (reminders turned off everywhere, sign-out, permission lost). */
export async function cancelAll(db: SqlDriver, api: NotificationsApi): Promise<number> {
  return (await reconcile(db, api, [])).cancelled;
}

/** Goals with their open linked steps in the window, as the planner needs them. */
export async function loadReminderInputs(db: SqlDriver, ownerId: string, now: Date): Promise<GoalReminderInput[]> {
  const goals = await listEntities(db, 'goals', ownerId, "status = 'active'");
  const withReminders = goals.filter(
    (g) => g.reminders.beforeDue.length > 0 || g.reminders.eachStep || g.reminders.monthlyDay || g.reminders.periodic,
  );
  if (withReminders.length === 0) return [];
  const today = localDateOf(now);
  const stepsByGoal = new Map<string, GoalStep[]>();
  const needSteps = withReminders.filter((g) => g.reminders.eachStep).map((g) => g.id);
  if (needSteps.length) {
    const links = await db.all<{ id: string; goal_id: string }>(
      `SELECT id, goal_id FROM tasks WHERE owner_id = ? AND deleted = 0 AND parent_task_id IS NULL
         AND goal_id IN (${needSteps.map(() => '?').join(', ')})`,
      [ownerId, ...needSteps],
    );
    const goalOf = new Map(links.map((l) => [l.id, l.goal_id]));
    const items = await getAgenda(db, ownerId, today, addDays(today, WINDOW_DAYS), today);
    for (const item of items) {
      const goalId = goalOf.get(item.taskId);
      if (!goalId || item.done || item.kind === 'routine') continue;
      const list = stepsByGoal.get(goalId) ?? [];
      list.push({
        key: item.key,
        taskId: item.taskId,
        occurrenceId: item.occurrenceId,
        title: item.title,
        date: item.date,
        startTime: item.startTime,
      });
      stepsByGoal.set(goalId, list);
    }
  }
  return withReminders.map((g) => ({
    id: g.id,
    title: g.title,
    status: g.status,
    period: g.period,
    startDate: g.startDate,
    targetDate: g.targetDate,
    createdOn: localDateOf(new Date(g.createdAt)),
    reminders: g.reminders,
    steps: stepsByGoal.get(g.id) ?? [],
  }));
}

/**
 * Open tasks, occurrences and routine days of the window whose task or routine has a reminder. The day before the
 * window is included because a "1 day before" reminder of tomorrow's task fires today; items after the window are
 * not loaded, which is the bound on a repeating series.
 */
export async function loadItemReminderInputs(db: SqlDriver, ownerId: string, now: Date): Promise<ItemReminderInput[]> {
  const reminders = await listItemReminders(db, ownerId);
  if (reminders.length === 0) return [];
  const byTarget = new Map(reminders.map((r) => [`${r.targetType}:${r.targetId}`, r]));
  const today = localDateOf(now);
  const items = await getAgenda(db, ownerId, today, addDays(today, WINDOW_DAYS + 1), today);
  const out: ItemReminderInput[] = [];
  for (const item of items) {
    if (item.done) continue;
    const targetType = item.kind === 'routine' ? 'routine' : 'task';
    const reminder = byTarget.get(`${targetType}:${item.taskId}`);
    if (!reminder) continue;
    out.push({
      targetType,
      targetId: item.taskId,
      occurrenceId: item.occurrenceId,
      key: item.key,
      title: item.title,
      date: item.date,
      startTime: item.startTime,
      offsetMin: reminder.offsetMin,
      atTime: reminder.atTime,
    });
  }
  return out;
}

/** True when anything could be scheduled: a goal with a reminder on, or a task / routine reminder. */
export async function hasAnyReminder(db: SqlDriver, ownerId: string, now: Date): Promise<boolean> {
  if ((await listItemReminders(db, ownerId)).length > 0) return true;
  return (await loadReminderInputs(db, ownerId, now)).length > 0;
}

export interface RescheduleDeps {
  db: SqlDriver;
  ownerId: string;
  api: NotificationsApi;
  t: Translate;
  now?: () => Date;
  /** Formats a start time for the notification text (locale clock); HH:mm when missing. */
  formatTime?: (hhmm: string) => string;
  /** Exact-alarm access granted (Android); see ScheduleOptions. */
  exact?: boolean;
}

/** The whole wanted schedule: goal, task and routine reminders of the window, soonest first, capped together. */
export async function planReminders(deps: Omit<RescheduleDeps, 'api' | 'exact'>, now: Date) {
  const goals = await loadReminderInputs(deps.db, deps.ownerId, now);
  const items = await loadItemReminderInputs(deps.db, deps.ownerId, now);
  return capPlan([
    ...planGoalNotifications(goals, now, deps.t),
    ...planItemNotifications(items, now, deps.t, { formatTime: deps.formatTime }),
  ]);
}

let running: Promise<ReconcileReport> = Promise.resolve({ scheduled: 0, cancelled: 0, kept: 0 });

/** Plans and reconciles, one run at a time (later calls wait for the current run, then run on fresh data). */
export function rescheduleReminders(deps: RescheduleDeps): Promise<ReconcileReport> {
  const run = async () => {
    const now = deps.now?.() ?? new Date();
    return reconcile(deps.db, deps.api, await planReminders(deps, now), { exact: deps.exact ?? false });
  };
  running = running.then(run, run);
  return running;
}

/** Earlier name, kept for callers and tests written when only goals had reminders. */
export const rescheduleGoalReminders = rescheduleReminders;
