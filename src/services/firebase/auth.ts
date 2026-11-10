import type { FirebaseApp } from 'firebase/app';
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, type Auth } from 'firebase/auth';

/** Web build (Expo web): IndexedDB with a localStorage fallback. Native builds use auth.native.ts. */
export const authPersistenceKind = 'browser-indexeddb';

export function createAuth(app: FirebaseApp): Auth {
  return initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
}
