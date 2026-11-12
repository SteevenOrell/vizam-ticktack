/**
 * App-wide sync controller: one runner (mutex) for the whole app session, fed with the current database, user and
 * remote by the SessionProvider. `syncNow()` updates the sync status store for the UI.
 */
import { useSyncStatus } from '../state/session';
import { createSyncRunner, outboxStats, type SyncDeps, type SyncReport } from './engine';
import { errorCode } from './types';

let current: SyncDeps | null = null;
const runner = createSyncRunner(() => current);

/** Null in guest mode or while signed out: sync is then disabled. */
export function setSyncDeps(deps: SyncDeps | null): void {
  current = deps;
  if (!deps) useSyncStatus.getState().set({ state: 'disabled' });
}

export async function syncNow(): Promise<SyncReport | null> {
  const deps = current;
  const status = useSyncStatus.getState();
  if (!deps) {
    status.set({ state: 'disabled' });
    return null;
  }
  status.set({ state: 'syncing' });
  try {
    const report = await runner.run();
    const stats = await outboxStats(deps.db);
    useSyncStatus.getState().set({ state: 'idle', lastSuccessAt: Date.now(), ...stats });
    return report;
  } catch (error) {
    const code = errorCode(error);
    const stats = await outboxStats(deps.db).catch(() => ({ pending: 0, failed: 0 }));
    useSyncStatus
      .getState()
      .set({ state: ['unavailable', 'deadline-exceeded'].includes(code) ? 'offline' : 'error', ...stats });
    return null;
  }
}
