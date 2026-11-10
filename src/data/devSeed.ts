import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import type { SqlDriver } from './db/driver';
import { buildDemoData, insertDemoData } from './seed/demoData';

/** Reads a dev-only flag from the web URL (`?demo=1`, `?holdSplash=1`). Always false in production and on native. */
export function devWebFlag(name: string): boolean {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(name) === '1';
}

/** Dev web only: fills an empty local database with the synthetic demo data for screenshots. */
export async function maybeSeedDemo(db: SqlDriver): Promise<void> {
  if (!devWebFlag('demo')) return;
  const existing = await db.first<{ n: number }>('SELECT count(*) AS n FROM tasks');
  if ((existing?.n ?? 0) > 0) return;
  await insertDemoData(db, buildDemoData({ today: new Date(), newId: randomUUID }));
}
