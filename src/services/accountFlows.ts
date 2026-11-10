/**
 * Account flows tying Firebase Auth to the local database (ARCHITECTURE.md section 9). Kept free of React so they
 * can be tested with a fake gateway, better-sqlite3 and the in-memory remote.
 */
import { adoptGuestData, getBoundUid, setSyncValue, wipeLocalData } from '../data/account';
import type { SqlDriver } from '../data/db/driver';
import type { RemoteStore } from '../sync/types';
import type { AuthGateway, AuthUser } from './auth';

export interface FlowDeps {
  db: SqlDriver;
  gateway: AuthGateway;
  remote: RemoteStore | null;
  /** Best-effort final upload before sign-out. */
  syncNow?: () => Promise<unknown>;
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

/** Tries a last upload, signs out and wipes local data (the warning about unsynced changes is shown before). */
export async function signOutFlow(deps: FlowDeps): Promise<void> {
  if (deps.syncNow) await deps.syncNow().catch(() => undefined);
  await deps.gateway.signOut();
  await wipeLocalData(deps.db);
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
  await wipeLocalData(deps.db);
}
