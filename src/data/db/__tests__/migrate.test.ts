import { randomUUID } from 'crypto';

import { buildDemoData, insertDemoData } from '../../seed/demoData';
import { openBetterSqliteDriver } from '../betterSqliteDriver';
import type { SqlDriver } from '../driver';
import { getSchemaVersion, migrate, migrations, type Migration } from '../migrate';

let db: SqlDriver;

beforeEach(() => {
  db = openBetterSqliteDriver(':memory:');
});
afterEach(async () => {
  await db.close();
});

const tables = async () =>
  (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(
    (r) => r.name,
  );

describe('migration runner', () => {
  it('applies 001 on an empty database and sets user_version', async () => {
    expect(await getSchemaVersion(db)).toBe(0);
    expect(await migrate(db)).toEqual([1]);
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    expect(await tables()).toEqual(
      expect.arrayContaining([
        'categories',
        'goals',
        'milestones',
        'occurrence_window',
        'outbox',
        'profile',
        'recurrence_rules',
        'reminders',
        'routines',
        'scheduled_notifications',
        'sync_state',
        'task_occurrences',
        'tasks',
      ]),
    );
  });

  it('is idempotent', async () => {
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
  });

  it('rolls back a failing migration and keeps the previous version', async () => {
    const broken: Migration[] = [
      ...migrations,
      { version: migrations.length + 1, name: 'broken', sql: 'CREATE TABLE ok_table (id TEXT); SELECT * FROM nope;' },
    ];
    await expect(migrate(db, broken)).rejects.toThrow();
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    expect(await tables()).not.toContain('ok_table');
  });

  it('refuses a database newer than the app', async () => {
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });

  it('rejects a non-contiguous migration list', async () => {
    await expect(migrate(db, [{ version: 2, name: 'gap', sql: '' }])).rejects.toThrow(/contiguous/);
  });
});

describe('schema constraints', () => {
  beforeEach(async () => {
    await migrate(db);
  });

  const taskRow = (overrides: Record<string, string | number | null> = {}) => {
    const row: Record<string, string | number | null> = {
      id: randomUUID(),
      owner_id: 'local',
      created_at: '2026-11-09T10:00:00.000Z',
      client_updated_at: '2026-11-09T10:00:00.000Z',
      title: 'Synthetic task',
      status: 'open',
      ...overrides,
    };
    const cols = Object.keys(row);
    return db.run(
      `INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => row[c] ?? null),
    );
  };

  it('accepts a valid task', async () => {
    await expect(taskRow()).resolves.toMatchObject({ changes: 1 });
  });

  it.each([
    ['empty title', { title: '' }],
    ['oversized title', { title: 'x'.repeat(201) }],
    ['unknown status', { status: 'archived' }],
    ['priority out of range', { priority: 4 }],
  ])('rejects %s', async (_name, overrides) => {
    await expect(taskRow(overrides)).rejects.toThrow(/CHECK constraint failed/);
  });

  it('prevents duplicate occurrences of the same series date', async () => {
    const insert = (id: string) =>
      db.run(
        `INSERT INTO task_occurrences (id, owner_id, created_at, client_updated_at, series_type, series_id, rule_id,
          original_date, date) VALUES (?, 'local', 'x', 'x', 'task', 'series-1', 'rule-1', '2026-11-09', '2026-11-09')`,
        [id],
      );
    await insert('series-1_20261109');
    await expect(insert('other-id')).rejects.toThrow(/UNIQUE/);
  });

  it('coalesces outbox entries per entity', async () => {
    const enqueue = () =>
      db.run(
        `INSERT INTO outbox (entity_type, entity_id, op, enqueued_rev, next_attempt_at) VALUES ('tasks', 'a', 'upsert', 1, 0)
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET enqueued_rev = enqueued_rev + 1`,
      );
    await enqueue();
    await enqueue();
    expect(await db.all('SELECT * FROM outbox')).toHaveLength(1);
  });
});

describe('synthetic seed', () => {
  it('inserts demo data that satisfies every constraint', async () => {
    await migrate(db);
    const data = buildDemoData({ today: new Date(2026, 10, 9), newId: randomUUID });
    const inserted = await insertDemoData(db, data);
    expect(inserted).toBeGreaterThan(15);
    const today = await db.first<{ n: number }>(
      "SELECT count(*) AS n FROM tasks WHERE owner_id = 'local' AND date = ? AND deleted = 0",
      ['2026-11-09'],
    );
    expect(today?.n).toBe(6); // five one-off tasks plus the overlapping "Team check-in"
  });
});
