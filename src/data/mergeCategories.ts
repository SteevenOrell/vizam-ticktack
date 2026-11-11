/**
 * Guest -> existing account: the guest's starter categories ("Health", "Home", ...) and the account's own can end up
 * side by side after the first pull. Category names are unique per owner (case-insensitive, see categoryName.ts),
 * so twins are merged: the oldest copy is kept (deterministic: created first, then smallest id), tasks and routines pointing at a
 * twin are moved to it, and the twin is tombstoned. Every change is queued like a normal local write.
 */
import { categoryKey } from '../domain/categoryName';
import type { SqlDriver, SqlValue } from './db/driver';
import type { EntityType } from './entities';
import { enqueue } from './store';

interface CategoryRow {
  id: string;
  name: string;
  archived: number;
  created_at: string;
}

const REFERENCING = [
  { type: 'tasks', table: 'tasks' },
  { type: 'routines', table: 'routines' },
] as const;

/** Returns the number of rows changed (twins tombstoned + references moved). */
export async function mergeDuplicateCategories(
  db: SqlDriver,
  ownerId: string,
  now: () => number = Date.now,
): Promise<number> {
  const rows = await db.all<CategoryRow>(
    `SELECT id, name, archived, created_at FROM categories WHERE owner_id = ? AND deleted = 0`,
    [ownerId],
  );
  const groups = new Map<string, CategoryRow[]>();
  for (const row of rows) {
    const key = categoryKey(row.name);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const twins = [...groups.values()].filter((g) => g.length > 1);
  if (twins.length === 0) return 0;

  const at = new Date(now()).toISOString();
  const nowDate = () => new Date(now());
  let changed = 0;
  await db.transaction(async () => {
    const bump = async (type: EntityType, table: string, id: string, set: string, params: SqlValue[]) => {
      await db.run(
        `UPDATE ${table} SET ${set}, client_updated_at = ?, dirty = 1, local_rev = local_rev + 1 WHERE id = ?`,
        [...params, at, id],
      );
      const rev = await db.first<{ local_rev: number; deleted: number }>(
        `SELECT local_rev, deleted FROM ${table} WHERE id = ?`,
        [id],
      );
      await enqueue(db, type, id, rev?.deleted ? 'delete' : 'upsert', rev?.local_rev ?? 1, nowDate);
      changed += 1;
    };
    for (const group of twins) {
      // Keep: active over archived, then the oldest, then the smallest id.
      const [keep, ...drop] = [...group].sort(
        (a, b) => a.archived - b.archived || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
      if (!keep) continue;
      for (const twin of drop) {
        for (const { type, table } of REFERENCING) {
          const refs = await db.all<{ id: string }>(
            `SELECT id FROM ${table} WHERE owner_id = ? AND category_id = ? AND deleted = 0`,
            [ownerId, twin.id],
          );
          for (const ref of refs) await bump(type, table, ref.id, 'category_id = ?', [keep.id]);
        }
        await bump('categories', 'categories', twin.id, 'deleted = 1', []);
      }
    }
  });
  return changed;
}
