import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';

import { createAuth } from './auth';
import { EMULATOR_PORTS, readFirebaseEnv, resolveFirebaseSetup, type FirebaseSetup } from './config';

export interface FirebaseServices {
  setup: Exclude<FirebaseSetup, { mode: 'disabled' }>;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseServices | null | undefined;

/**
 * Lazily initialises Firebase. Returns null when no config is present: the app then runs in guest mode only
 * (offline-first; SQLite stays the source of truth). Firestore uses a memory cache on purpose — SQLite and our
 * outbox own offline storage (ARCHITECTURE.md section 1).
 */
export function getFirebase(setup: FirebaseSetup = resolveFirebaseSetup(readFirebaseEnv())): FirebaseServices | null {
  if (services !== undefined) return services;
  if (setup.mode === 'disabled') {
    services = null;
    return services;
  }

  const app = getApps()[0] ?? initializeApp(setup.options);
  const auth = createAuth(app);
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });

  if (setup.mode === 'emulator') {
    connectAuthEmulator(auth, `http://${setup.host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, setup.host, EMULATOR_PORTS.firestore);
  }

  services = { setup, app, auth, db };
  return services;
}
