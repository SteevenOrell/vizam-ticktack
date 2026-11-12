/**
 * Account flows tying Firebase Auth to the local database (ARCHITECTURE.md section 9). Kept free of React so they
 * can be tested with a fake gateway, better-sqlite3 and the in-memory remote.
 */
import { adoptGuestData, getBoundUid, setSyncValue, wipeLocalData } from '../data/account';
import type { SqlDriver } from '../data/db/driver';
import { useSyncStatus } from '../state/session';
import type { RemoteStore } from '../sync/types';
import type { AuthGateway, AuthUser } from './auth';

export interface FlowDeps {
  db: SqlDriver;
  gateway: AuthGateway;
  remote: RemoteStore | null;
  /** Best-effort final upload before sign-out. */
  syncNow?: () => Promise<unknown>;
  /**
   * Best-effort device cleanup after the local wipe: cancels the OS notifications this app scheduled (their titles
   * are the previous account's data). Wired to `cancelAllReminders` by the SessionProvider.
   */
  clearDevice?: () => Promise<unknown>;
}

/** In-memory stores that describe the previous account (sync counts, last success). */
function resetAccountStores(): void {
  useSyncStatus.getState().set({ state: 'disabled', pending: 0, failed: 0, lastSuccessAt: null });
}

/** Wipe + device cleanup shared by sign-out, account deletion and a signed-out start. */
async function clearAccountData(db: SqlDriver, clearDevice?: () => Promise<unknown>): Promise<void> {
  await wipeLocalData(db);
  if (clearDevice) await clearDevice().catch(() => undefined);
  resetAccountStores();
}

/**
 * Makes the local database belong to `user`. Called after sign-in / sign-up and when Auth restores a session:
 * - database bound to the same uid: nothing to do;
 * - bound to another uid: wipe (one account per device database), then bind;
 * - unbound: adopt the guest data (kept and uploaded).
 */
export async function attachUser(db: SqlDriver, user: AuthUser, options: { isNewAccount: boolean }): Promise<void> {
  const bound = await getBoundUid(db);
  if (bound === user.uid) return;
  if (bound && bound !== user.uid) await wipeLocalData(db);
  await adoptGuestData(db, user.uid, { keepGuestProfile: options.isNewAccount });
  await setSyncValue(db, 'bound_uid', user.uid);
}

export async function signUpFlow(deps: FlowDeps, email: string, password: string): Promise<AuthUser> {
  const user = await deps.gateway.signUp(email, password);
  await attachUser(deps.db, user, { isNewAccount: true });
  return user;
}

export async function signInFlow(deps: FlowDeps, email: string, password: string): Promise<AuthUser> {
  const user = await deps.gateway.signIn(email, password);
  await attachUser(deps.db, user, { isNewAccount: false });
  return user;
}

/**
 * Tries a last upload, signs out, then wipes local data (rows, outbox, sync cursors, the background task's owner),
 * cancels scheduled notifications and resets the sync status (the warning about unsynced changes is shown before).
 * Signing out first means no sync can pull the account back in after the wipe; if the app dies in between,
 * `clearSignedOutDevice` finishes the job on the next start.
 */
export async function signOutFlow(deps: FlowDeps): Promise<void> {
  if (deps.syncNow) await deps.syncNow().catch(() => undefined);
  await deps.gateway.signOut();
  await clearAccountData(deps.db, deps.clearDevice);
}

/**
 * Called when Auth reports no user. A database still bound to an account (sign-out interrupted, session revoked or
 * expired on another device) is wiped so a signed-out device never keeps or shows an account's data. Guest data is
 * never bound, so it is kept. Returns true when something was wiped.
 */
export async function clearSignedOutDevice(db: SqlDriver, clearDevice?: () => Promise<unknown>): Promise<boolean> {
  if (!(await getBoundUid(db))) return false;
  await clearAccountData(db, clearDevice);
  return true;
}

/**
 * Account deletion (store requirement): re-authenticate, delete every cloud document of the user, delete the Auth
 * user, wipe local data. No Cloud Functions needed. If a step fails, nothing after it runs.
 */
export async function deleteAccountFlow(deps: FlowDeps, password: string): Promise<void> {
  const user = deps.gateway.current();
  if (!user) throw new Error('Not signed in');
  await deps.gateway.reauthenticate(password);
  if (deps.remote) await deps.remote.deleteAll(user.uid);
  await deps.gateway.deleteUser();
  await clearAccountData(deps.db, deps.clearDevice);
}
