/**
 * Synthetic seed: creates a local SQLite file with the migrations applied and demo data (no real people or data).
 *
 *   npm run seed                                   -> .seed/ticktack-demo.db (git-ignored), dated today, English
 *   npm run seed -- --out path.db --date 2026-11-09 --lang fr --reset
 *   npm run seed:emulator                          -> also signs up a demo user in the Auth emulator and uploads
 *                                                     the data to the Firestore emulator through the sync engine
 *
 * `--emulator` only ever talks to the Firebase Emulator Suite (demo- project; it refuses to run without the
 * emulator host variables), never to a real project. The app loads the same data on Expo web in development with
 * `?demo=1` (src/data/devSeed.ts).
 */
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';

import { adoptGuestData } from '../src/data/account';
import { openBetterSqliteDriver } from '../src/data/db/betterSqliteDriver';
import { migrate } from '../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../src/data/seed/demoData';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function uploadToEmulator(db: ReturnType<typeof openBetterSqliteDriver>, language: string) {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!firestoreHost || !authHost) {
    throw new Error(
      '--emulator needs FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (use npm run seed:emulator)',
    );
  }
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, inMemoryPersistence, setPersistence } =
    await import('firebase/auth');
  const { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } = await import('firebase/firestore');
  const { syncOnce } = await import('../src/sync/engine');
  const { createFirestoreRemote } = await import('../src/sync/firestoreRemote');

  const projectId = 'demo-ticktack'; // demo- IDs cannot reach a real project
  const app = initializeApp({
    projectId,
    apiKey: 'demo-api-key',
    appId: 'demo-app',
    authDomain: `${projectId}.firebaseapp.com`,
  });
  try {
    const auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const fs = initializeFirestore(app, { localCache: memoryLocalCache() });
    const [host, port] = firestoreHost.split(':');
    connectFirestoreEmulator(fs, host ?? '127.0.0.1', Number(port ?? 8080));
    const email = `demo-${randomUUID().slice(0, 8)}@example.test`;
    const password = `Demo-${randomUUID()}`;
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await adoptGuestData(db, user.uid, { keepGuestProfile: true });
    const report = await syncOnce({ db, remote: createFirestoreRemote(fs), uid: user.uid });
    // Synthetic emulator-only credentials, printed so the demo account can be used in the emulator.
    console.log(`Emulator: uploaded ${report.pushed} documents (${language}) for ${email} / ${password}`);
  } finally {
    await deleteApp(app);
  }
}

async function main() {
  const out = resolve(arg('out') ?? '.seed/ticktack-demo.db');
  const dateArg = arg('date');
  const language = arg('lang') === 'fr' ? 'fr' : 'en';
  if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) throw new Error('--date must be YYYY-MM-DD');
  const today = dateArg ? new Date(`${dateArg}T12:00:00`) : new Date();

  if (existsSync(out)) {
    if (!process.argv.includes('--reset')) throw new Error(`${out} exists; pass --reset to recreate it`);
    rmSync(out);
    rmSync(`${out}-wal`, { force: true });
    rmSync(`${out}-shm`, { force: true });
  }
  mkdirSync(dirname(out), { recursive: true });

  const db = openBetterSqliteDriver(out);
  try {
    const applied = await migrate(db);
    const rows = await insertDemoData(db, buildDemoData({ today, newId: randomUUID, language }));
    console.log(
      `Seeded ${rows} synthetic rows (${language}) into ${out} (migrations applied: ${applied.join(', ') || 'none'})`,
    );
    if (process.argv.includes('--emulator')) await uploadToEmulator(db, language);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
