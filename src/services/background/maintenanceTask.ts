/**
 * Periodic background task (expo-background-task, SDK 58): tops up the 7-day reminder window and runs sync while
 * the app is closed, so a repeating task keeps its reminders even when the app is not opened for days.
 *
 * - The task is defined at module scope (imported by src/app/_layout.tsx), as TaskManager requires, and registered
 *   once the data context is ready. The OS decides when it runs (15 min minimum; usually much less often).
 * - Expo Go and web have no background tasks: nothing is defined or registered there (no native call, no crash) and
 *   the foreground upkeep (useGoalMaintenance) keeps working as before.
 * - When the app is alive in the background the pass reuses its data context and sync controller. A cold run (the
 *   OS started the JS runtime only for the task) opens the database itself and plans reminders for the last owner
 *   recorded on this device; sync then has no signed-in session and is skipped until the app is opened.
 */
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import type { SqlDriver } from '../../data/db/driver';
import type { DataContext } from '../../data/store';

export const MAINTENANCE_TASK = 'ticktack-maintenance';
/** Minutes; the OS treats it as a lower bound. Hourly is plenty for a 7-day window and light on the battery. */
export const MAINTENANCE_INTERVAL_MIN = 60;
/** Local-only key (sync_state is never synced): whose reminders a cold background run should plan. */
export const OWNER_KEY = 'device.maintenanceOwner';

export const backgroundTasksSupported = (platform: string = Platform.OS, expoGo: boolean = isRunningInExpoGo()) =>
  (platform === 'ios' || platform === 'android') && !expoGo;

/** Called by the foreground upkeep whenever the data context changes. */
export async function rememberOwner(db: SqlDriver, ownerId: string): Promise<void> {
  await db.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [OWNER_KEY, ownerId]);
}

export async function recordedOwner(db: SqlDriver): Promise<string | null> {
  const row = await db.first<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [OWNER_KEY]);
  return row?.value ?? null;
}

let foreground: DataContext | null = null;
/** The live data context while the app process runs (null when signed out or not ready). */
export function setMaintenanceContext(ctx: DataContext | null): void {
  foreground = ctx;
}

export interface MaintenanceRunDeps {
  /** Live context, if the app process is running. */
  live: () => DataContext | null;
  /** Opens the database for a cold run (migrated). */
  openDb: () => Promise<SqlDriver>;
  newId: () => string;
  sync: () => Promise<unknown>;
  maintain: (ctx: DataContext) => Promise<void>;
}

/** One background pass. True when it ran (or had nothing to do), false when it failed. Never throws. */
export async function runMaintenance(deps: MaintenanceRunDeps): Promise<boolean> {
  try {
    let ctx = deps.live();
    if (ctx) {
      // Pull first, so reminders reflect edits made on another device.
      await deps.sync().catch(() => null);
    } else {
      const db = await deps.openDb();
      const ownerId = await recordedOwner(db);
      if (!ownerId) return true;
      ctx = { db, ownerId, newId: deps.newId };
    }
    await deps.maintain(ctx);
    return true;
  } catch (e) {
    console.warn('Background maintenance failed', e instanceof Error ? e.name : 'unknown');
    return false;
  }
}

type TaskManagerModule = typeof import('expo-task-manager');
type BackgroundTaskModule = typeof import('expo-background-task');

function nativeModules(): { TaskManager: TaskManagerModule; BackgroundTask: BackgroundTaskModule } {
  return {
    // Required lazily so Expo Go and web never load the native modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    TaskManager: require('expo-task-manager') as TaskManagerModule,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackgroundTask: require('expo-background-task') as BackgroundTaskModule,
  };
}

/** Defines the task (module scope of an early-loaded file). Returns false where background tasks do not exist. */
export function defineMaintenanceTask(run: () => Promise<boolean>, supported = backgroundTasksSupported()): boolean {
  if (!supported) return false;
  const { TaskManager, BackgroundTask } = nativeModules();
  if (TaskManager.isTaskDefined(MAINTENANCE_TASK)) return true;
  TaskManager.defineTask(MAINTENANCE_TASK, async () =>
    (await run()) ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed,
  );
  return true;
}

export type RegisterResult = 'registered' | 'alreadyRegistered' | 'unavailable' | 'restricted';

/** Registers the periodic task once (kept across launches by the OS). Never throws. */
export async function registerMaintenanceTask(supported = backgroundTasksSupported()): Promise<RegisterResult> {
  if (!supported) return 'unavailable';
  try {
    const { TaskManager, BackgroundTask } = nativeModules();
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return 'restricted';
    if (await TaskManager.isTaskRegisteredAsync(MAINTENANCE_TASK)) return 'alreadyRegistered';
    await BackgroundTask.registerTaskAsync(MAINTENANCE_TASK, { minimumInterval: MAINTENANCE_INTERVAL_MIN });
    return 'registered';
  } catch (e) {
    console.warn('Background task registration failed', e instanceof Error ? e.name : 'unknown');
    return 'unavailable';
  }
}

export function liveMaintenanceContext(): DataContext | null {
  return foreground;
}
