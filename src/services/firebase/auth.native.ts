import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';

/**
 * `firebase/auth` re-exports `@firebase/auth`; under Metro the `react-native` export condition resolves the React
 * Native build, which adds `getReactNativePersistence`. The public typings do not declare it, hence the narrow
 * type below (verified in phase 2: see docs/AGENT_HANDOFF.md, risk check 3).
 */
type RnAuthModule = typeof firebaseAuth & {
  getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
};

export const authPersistenceKind = 'react-native-async-storage';

export function createAuth(app: FirebaseApp): Auth {
  const { getReactNativePersistence, initializeAuth } = firebaseAuth as RnAuthModule;
  if (typeof getReactNativePersistence !== 'function') {
    throw new Error('Firebase Auth React Native build was not resolved (getReactNativePersistence missing)');
  }
  return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
}
