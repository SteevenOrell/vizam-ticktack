import { z } from 'zod';

/**
 * Firebase web config. These values are public identifiers (protection comes from security rules), but they still
 * live in the local `.env`, never in git. `EXPO_PUBLIC_*` variables must be read with literal `process.env.X`
 * access so Expo can inline them at build time.
 */
export interface FirebaseEnv {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
  messagingSenderId?: string;
  useEmulator?: string;
  emulatorHost?: string;
}

export function readFirebaseEnv(): FirebaseEnv {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    useEmulator: process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR,
    emulatorHost: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
  };
}

/** Demo project IDs (prefix `demo-`) can only talk to the emulator, never to a real project. */
export const EMULATOR_PROJECT_ID = 'demo-ticktack';

const nonEmpty = z.string().trim().min(1);
const host = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9.-]+$/, 'host name only, no scheme or port');

export type FirebaseSetup =
  | { mode: 'disabled'; reason: 'missing-config' }
  | {
      mode: 'cloud';
      options: { apiKey: string; authDomain: string; projectId: string; appId: string; messagingSenderId?: string };
    }
  | {
      mode: 'emulator';
      host: string;
      options: { apiKey: string; projectId: string; appId: string; authDomain: string };
    };

export function resolveFirebaseSetup(env: FirebaseEnv): FirebaseSetup {
  if (env.useEmulator === 'true') {
    const parsedHost = host.safeParse(env.emulatorHost ?? '127.0.0.1');
    const projectId = env.projectId?.startsWith('demo-') ? env.projectId : EMULATOR_PROJECT_ID;
    return {
      mode: 'emulator',
      host: parsedHost.success ? parsedHost.data : '127.0.0.1',
      options: { apiKey: 'demo-api-key', projectId, appId: 'demo-app', authDomain: `${projectId}.firebaseapp.com` },
    };
  }

  const parsed = z
    .object({
      apiKey: nonEmpty,
      authDomain: nonEmpty,
      projectId: nonEmpty,
      appId: nonEmpty,
      messagingSenderId: nonEmpty.optional(),
    })
    .safeParse(env);
  if (!parsed.success) return { mode: 'disabled', reason: 'missing-config' };
  return { mode: 'cloud', options: parsed.data };
}

export const EMULATOR_PORTS = { auth: 9099, firestore: 8080 } as const;
