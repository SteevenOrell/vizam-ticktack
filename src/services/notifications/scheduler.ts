/**
 * Goal reminder scheduler: plans the rolling window, then reconciles it with what the OS has scheduled and with the
 * local-only `scheduled_notifications` table (never synced). Idempotent: a second run with the same data schedules
 * and cancels nothing. Runs on app start, on foreground and after local or synced changes (see useReminderScheduler).
 */
import { localDateOf, addDays } from '../../domain/localDate';
import type { SqlDriver } from '../../data/db/driver';
import { listEntities } from '../../data/store';
import { getAgenda } from '../../data/queries/agenda';
import {
  ID_PREFIX,
  planGoalNotifications,
  WINDOW_DAYS,
  type GoalReminderInput,
  type GoalStep,
  type PlannedNotification,
  type Translate,
} from './plan';

/** The subset of expo-notifications the scheduler needs (mocked in tests). */
export interface NotificationsApi {
  getScheduledIds(): Promise<string[]>;
  schedule(n: PlannedNotification): Promise<void>;
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

/** Makes the OS schedule match `desired`: cancels ours that are extra or changed, schedules missing or changed. */
export async function reconcile(
  db: SqlDriver,
  api: NotificationsApi,
  desired: readonly PlannedNotification[],
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
    if (!next || stored.get(id) !== next.fingerprint) {
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
    await api.schedule(n);
    report.scheduled += 1;
  }

  await db.transaction(async () => {
    await db.run('DELETE FROM scheduled_notifications');
    for (const n of desired) {
      await db.run(
        `INSERT INTO scheduled_notifications (notification_id, reminder_id, occurrence_key, fire_at, fingerprint)
         VALUES (?, ?, ?, ?, ?)`,
        [n.id, n.goalId, `${n.kind}:${n.key}`, n.fireAt, n.fingerprint],
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

let running: Promise<ReconcileReport> = Promise.resolve({ scheduled: 0, cancelled: 0, kept: 0 });

/** Plans and reconciles, one run at a time (later calls wait for the current run, then run on fresh data). */
export function rescheduleGoalReminders(deps: {
  db: SqlDriver;
  ownerId: string;
  api: NotificationsApi;
  t: Translate;
  now?: () => Date;
}): Promise<ReconcileReport> {
  const run = async () => {
    const now = deps.now?.() ?? new Date();
    const inputs = await loadReminderInputs(deps.db, deps.ownerId, now);
    return reconcile(deps.db, deps.api, planGoalNotifications(inputs, now, deps.t));
  };
  running = running.then(run, run);
  return running;
}
