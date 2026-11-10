/**
 * Synthetic seed: creates a local SQLite file with migration 001 applied and demo data (no real people or data).
 *
 *   npm run seed                      -> .seed/ticktack-demo.db (git-ignored), dated today
 *   npm run seed -- --out path.db --date 2026-11-09 --reset
 *
 * The app itself can load the same data on Expo web in development with `?demo=1` (src/data/devSeed.ts).
 * Phase 3 adds `--emulator` to push the same rows to the Firestore emulator through the sync layer.
 */
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';

import { openBetterSqliteDriver } from '../src/data/db/betterSqliteDriver';
import { migrate } from '../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../src/data/seed/demoData';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const out = resolve(arg('out') ?? '.seed/ticktack-demo.db');
  const dateArg = arg('date');
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
    const rows = await insertDemoData(db, buildDemoData({ today, newId: randomUUID }));
    console.log(`Seeded ${rows} synthetic rows into ${out} (migrations applied: ${applied.join(', ') || 'none'})`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
