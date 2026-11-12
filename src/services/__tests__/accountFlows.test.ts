import { context, count, freshDb, TODAY } from '../../../tests/support/db';
import { createFakeAuth } from '../../../tests/support/fakeAuth';
import { getBoundUid } from '../../data/account';
import type { SqlDriver } from '../../data/db/driver';
import { createTask, emptyDraft } from '../../data/tasks';
import { syncOnce } from '../../sync/engine';
import { createMemoryRemote } from '../../sync/memoryRemote';
import { attachUser, deleteAccountFlow, signInFlow, signOutFlow, signUpFlow } from '../accountFlows';
import { authErrorKey } from '../auth';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const guestTask = () => createTask(context(db, 'local'), { ...emptyDraft(TODAY), title: 'Guest task' });

describe('account flows', () => {
  it('sign-up keeps guest data and binds the device to the new account', async () => {
    const gateway = createFakeAuth();
    const remote = createMemoryRemote();
    await guestTask();
    const user = await signUpFlow({ db, gateway, remote }, 'new@example.test', 'long-enough-1');
    expect(await getBoundUid(db)).toBe(user.uid);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks WHERE owner_id = ?', [user.uid])).toBe(1);
    await syncOnce({ db, remote, uid: user.uid, now: () => Date.now() + 1000 });
    expect(remote.docs(user.uid, 'tasks')).toHaveLength(1);
  });

  it('sign-in on a device bound to another account wipes the other account’s data first', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1', 'b@example.test': 'password-b1' });
    const a = await signInFlow({ db, gateway, remote: null }, 'a@example.test', 'password-a1');
    await createTask(context(db, a.uid), { ...emptyDraft(TODAY), title: 'A’s private task' });
    await gateway.signOut(); // signed out elsewhere without the wipe
    const b = await signInFlow({ db, gateway, remote: null }, 'b@example.test', 'password-b1');
    expect(await getBoundUid(db)).toBe(b.uid);
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(0);
  });

  it('restoring the same session is a no-op', async () => {
    await guestTask();
    await attachUser(db, { uid: 'u1', email: null }, { isNewAccount: true });
    await attachUser(db, { uid: 'u1', email: null }, { isNewAccount: false });
    expect(await count(db, "SELECT count(*) AS n FROM tasks WHERE owner_id = 'u1'")).toBe(1);
  });

  it('sign-out tries a last sync, signs out and wipes the device', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1' });
    const user = await signInFlow({ db, gateway, remote: null }, 'a@example.test', 'password-a1');
    await createTask(context(db, user.uid), { ...emptyDraft(TODAY), title: 'Mine' });
    const syncNow = jest.fn().mockRejectedValue(new Error('offline'));
    await signOutFlow({ db, gateway, remote: null, syncNow });
    expect(syncNow).toHaveBeenCalled();
    expect(gateway.current()).toBeNull();
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(0);
    expect(await getBoundUid(db)).toBeNull();
  });

  it('deletes cloud data, the account and local data — after re-authentication only', async () => {
    const gateway = createFakeAuth({ 'a@example.test': 'password-a1' });
    const remote = createMemoryRemote();
    const user = await signInFlow({ db, gateway, remote }, 'a@example.test', 'password-a1');
    await createTask(context(db, user.uid), { ...emptyDraft(TODAY), title: 'To delete' });
    await syncOnce({ db, remote, uid: user.uid, now: () => Date.now() + 1000 });
    expect(remote.docs(user.uid, 'tasks')).toHaveLength(1);

    await expect(deleteAccountFlow({ db, gateway, remote }, 'wrong-password')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
    });
    expect(remote.docs(user.uid, 'tasks')).toHaveLength(1); // nothing deleted

    await deleteAccountFlow({ db, gateway, remote }, 'password-a1');
    expect(gateway.calls.slice(-2)).toEqual(['reauthenticate', 'deleteUser']);
    expect(remote.docs(user.uid, 'tasks')).toHaveLength(0);
    expect(gateway.current()).toBeNull();
    expect(await count(db, 'SELECT count(*) AS n FROM tasks')).toBe(0);
  });
});

describe('auth error messages', () => {
  it('never reveal whether an account exists', () => {
    const err = (code: string) => ({ code });
    expect(authErrorKey(err('auth/user-not-found'), 'signIn')).toBe('invalidCredentials');
    expect(authErrorKey(err('auth/wrong-password'), 'signIn')).toBe('invalidCredentials');
    expect(authErrorKey(err('auth/invalid-credential'), 'signIn')).toBe('invalidCredentials');
    expect(authErrorKey(err('auth/email-already-in-use'), 'signUp')).toBe('signUpFailed');
    expect(authErrorKey(err('auth/network-request-failed'), 'signIn')).toBe('network');
    expect(authErrorKey(err('auth/too-many-requests'), 'signIn')).toBe('tooManyRequests');
  });
});
