import type { AuthGateway, AuthUser } from '../../src/services/auth';

/** In-memory auth gateway with Firebase-like error codes (synthetic users only). */
export function createFakeAuth(initial: Record<string, string> = {}) {
  const users = new Map<string, { uid: string; password: string }>();
  for (const [email, password] of Object.entries(initial)) users.set(email, { uid: `uid-${users.size + 1}`, password });
  let current: AuthUser | null = null;
  const listeners = new Set<(u: AuthUser | null) => void>();
  const emit = () => listeners.forEach((l) => l(current));
  const fail = (code: string) => Object.assign(new Error(code), { code });

  const gateway: AuthGateway & { calls: string[] } = {
    calls: [],
    current: () => current,
    onChange(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    async signUp(email, password) {
      gateway.calls.push('signUp');
      if (users.has(email)) throw fail('auth/email-already-in-use');
      if (password.length < 8) throw fail('auth/weak-password');
      const uid = `uid-${users.size + 1}`;
      users.set(email, { uid, password });
      current = { uid, email };
      emit();
      return current;
    },
    async signIn(email, password) {
      gateway.calls.push('signIn');
      const u = users.get(email);
      if (!u || u.password !== password) throw fail('auth/invalid-credential');
      current = { uid: u.uid, email };
      emit();
      return current;
    },
    async signOut() {
      gateway.calls.push('signOut');
      current = null;
      emit();
    },
    async sendReset() {
      gateway.calls.push('sendReset');
    },
    async reauthenticate(password) {
      gateway.calls.push('reauthenticate');
      const u = [...users.values()].find((x) => x.uid === current?.uid);
      if (!u || u.password !== password) throw fail('auth/invalid-credential');
    },
    async deleteUser() {
      gateway.calls.push('deleteUser');
      for (const [email, u] of users) if (u.uid === current?.uid) users.delete(email);
      current = null;
      emit();
    },
  };
  return gateway;
}
