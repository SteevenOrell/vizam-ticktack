/**
 * Email/password auth over Firebase Auth (ARCHITECTURE.md section 9). Error messages never reveal whether an
 * account exists (no enumeration): sign-in failures share one message and reset always reports "sent".
 */
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8).max(128);

export type AuthErrorKey =
  | 'invalidCredentials'
  | 'signUpFailed'
  | 'weakPassword'
  | 'invalidEmail'
  | 'network'
  | 'tooManyRequests'
  | 'requiresRecentLogin'
  | 'unavailable'
  | 'unknown';

export class AuthFlowError extends Error {
  constructor(public readonly key: AuthErrorKey) {
    super(key);
    this.name = 'AuthFlowError';
  }
}

/** Maps Firebase error codes to message keys (`auth.errors.<key>`). */
export function authErrorKey(error: unknown, flow: 'signIn' | 'signUp' | 'reset' | 'delete'): AuthErrorKey {
  if (error instanceof AuthFlowError) return error.key;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'invalidEmail';
    case 'auth/weak-password':
      return 'weakPassword';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/too-many-requests':
      return 'tooManyRequests';
    case 'auth/requires-recent-login':
      return 'requiresRecentLogin';
    case 'auth/email-already-in-use':
      return 'signUpFailed'; // same message as any other sign-up failure
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/user-disabled':
    case 'auth/invalid-login-credentials':
      return flow === 'signUp' ? 'signUpFailed' : 'invalidCredentials';
    default:
      return flow === 'signUp' ? 'signUpFailed' : 'unknown';
  }
}

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface AuthGateway {
  current(): AuthUser | null;
  onChange(listener: (user: AuthUser | null) => void): () => void;
  signUp(email: string, password: string): Promise<AuthUser>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  sendReset(email: string): Promise<void>;
  /** Re-authenticates with the password; must be called right before deleting data and the user. */
  reauthenticate(password: string): Promise<void>;
  deleteUser(): Promise<void>;
}

const toUser = (u: User | null): AuthUser | null => (u ? { uid: u.uid, email: u.email } : null);

export function createFirebaseAuthGateway(auth: Auth): AuthGateway {
  return {
    current: () => toUser(auth.currentUser),
    onChange: (listener) => onAuthStateChanged(auth, (u) => listener(toUser(u))),
    async signUp(email, password) {
      const cred = await createUserWithEmailAndPassword(auth, emailSchema.parse(email), passwordSchema.parse(password));
      return toUser(cred.user) as AuthUser;
    },
    async signIn(email, password) {
      const cred = await signInWithEmailAndPassword(auth, emailSchema.parse(email), password);
      return toUser(cred.user) as AuthUser;
    },
    signOut: () => firebaseSignOut(auth),
    async sendReset(email) {
      try {
        await sendPasswordResetEmail(auth, emailSchema.parse(email));
      } catch (error) {
        // Only transport problems surface; "no such user" is reported as sent (no enumeration).
        const key = authErrorKey(error, 'reset');
        if (key === 'network' || key === 'tooManyRequests' || key === 'invalidEmail') throw new AuthFlowError(key);
      }
    },
    async reauthenticate(password) {
      const user = auth.currentUser;
      if (!user?.email) throw new AuthFlowError('requiresRecentLogin');
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    },
    async deleteUser() {
      const user = auth.currentUser;
      if (!user) throw new AuthFlowError('requiresRecentLogin');
      await deleteUser(user);
    },
  };
}
