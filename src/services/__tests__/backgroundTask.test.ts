import { context, freshDb } from '../../../tests/support/db';
import type { SqlDriver } from '../../data/db/driver';
import {
  backgroundTasksSupported,
  defineMaintenanceTask,
  MAINTENANCE_INTERVAL_MIN,
  MAINTENANCE_TASK,
  recordedOwner,
  registerMaintenanceTask,
  rememberOwner,
  runMaintenance,
  type MaintenanceRunDeps,
} from '../background/maintenanceTask';

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn(() => false) }));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
}));

const TaskManager = jest.requireMock<Record<string, jest.Mock>>('expo-task-manager');
const BackgroundTask = jest.requireMock<Record<string, jest.Mock> & { BackgroundTaskResult: object }>(
  'expo-background-task',
);

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
  jest.clearAllMocks();
});
afterEach(async () => {
  await db.close();
});

const deps = (over: Partial<MaintenanceRunDeps> = {}): MaintenanceRunDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    live: () => null,
    openDb: async () => db,
    newId: () => 'id',
    sync: async () => {
      calls.push('sync');
    },
    maintain: async (ctx) => {
      calls.push(`maintain:${ctx.ownerId}`);
    },
    ...over,
  };
};

describe('background maintenance pass', () => {
  it('with the app alive: syncs first, then tops up the reminders of the live context', async () => {
    const d = deps({ live: () => context(db, 'user-1') });
    expect(await runMaintenance(d)).toBe(true);
    expect(d.calls).toEqual(['sync', 'maintain:user-1']);
  });

  it('a failed sync (offline) still tops up the reminders', async () => {
    const d = deps({ live: () => context(db, 'user-1'), sync: async () => Promise.reject(new Error('offline')) });
    expect(await runMaintenance(d)).toBe(true);
    expect(d.calls).toEqual(['maintain:user-1']);
  });

  it('cold run: plans for the owner recorded on this device, without sync', async () => {
    await rememberOwner(db, 'user-2');
    await rememberOwner(db, 'user-3'); // the latest owner wins
    expect(await recordedOwner(db)).toBe('user-3');
    const d = deps();
    expect(await runMaintenance(d)).toBe(true);
    expect(d.calls).toEqual(['maintain:user-3']);
  });

  it('cold run with no owner yet does nothing; a failure is reported, not thrown', async () => {
    const d = deps();
    expect(await runMaintenance(d)).toBe(true);
    expect(d.calls).toEqual([]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await runMaintenance(deps({ openDb: async () => Promise.reject(new Error('locked')) }))).toBe(false);
    warn.mockRestore();
  });
});

describe('task definition and registration', () => {
  it('Expo Go and web: nothing is defined or registered, no native module is called', async () => {
    expect(backgroundTasksSupported('android', true)).toBe(false);
    expect(backgroundTasksSupported('web', false)).toBe(false);
    expect(backgroundTasksSupported('ios', false)).toBe(true);
    expect(defineMaintenanceTask(async () => true, false)).toBe(false);
    expect(await registerMaintenanceTask(false)).toBe('unavailable');
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('defines the task once; its result maps to Success / Failed', async () => {
    let ok = true;
    expect(defineMaintenanceTask(async () => ok, true)).toBe(true);
    const [name, body] = TaskManager.defineTask!.mock.calls[0] as [string, () => Promise<number>];
    expect(name).toBe(MAINTENANCE_TASK);
    expect(await body()).toBe(1);
    ok = false;
    expect(await body()).toBe(2);
    TaskManager.isTaskDefined!.mockReturnValueOnce(true);
    defineMaintenanceTask(async () => true, true);
    expect(TaskManager.defineTask).toHaveBeenCalledTimes(1);
  });

  it('registers once with the interval, skips when restricted, never throws', async () => {
    expect(await registerMaintenanceTask(true)).toBe('registered');
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(MAINTENANCE_TASK, {
      minimumInterval: MAINTENANCE_INTERVAL_MIN,
    });
    TaskManager.isTaskRegisteredAsync!.mockResolvedValueOnce(true);
    expect(await registerMaintenanceTask(true)).toBe('alreadyRegistered');
    BackgroundTask.getStatusAsync!.mockResolvedValueOnce(1);
    expect(await registerMaintenanceTask(true)).toBe('restricted');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    BackgroundTask.getStatusAsync!.mockRejectedValueOnce(new Error('native module missing'));
    expect(await registerMaintenanceTask(true)).toBe('unavailable');
    warn.mockRestore();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(1);
  });
});
