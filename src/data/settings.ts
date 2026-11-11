/**
 * Settings data (phase 4c): planning preferences kept in the synced profile row (week start, daily capacity), the
 * categories manager, and the failed-sync list. Preferences that are per device (theme, language) stay in
 * `state/preferences.ts`; week start and capacity live in the profile so they follow the account.
 */
import { categoryKey, CATEGORY_NAME_MAX, normalizeCategoryName, pickCategoryColor } from '../domain/categoryName';
import type { Category, CategoryColor } from '../domain/models';
import { CategoryNameError } from './categories';
import { notifyDataChanged } from './changes';
import type { SqlDriver } from './db/driver';
import { entities, type EntityType } from './entities';
import { updateProfile } from './profile';
import { getEntity, listEntities, mutate, tombstone, writeEntity, type DataContext } from './store';

export type WeekStart = 0 | 1 | 6;
export const CAPACITY_STEP_MIN = 30;
export const CAPACITY_MAX_MIN = 1440;
export const DEFAULT_CAPACITY_MIN = 480;

export interface PlanningSettings {
  /** Null while the profile row does not exist yet (the caller falls back to the language default). */
  weekStartsOn: WeekStart | null;
  dailyCapacityMin: number;
}

export async function getPlanningSettings(db: SqlDriver, ownerId: string): Promise<PlanningSettings> {
  const row = await db.first<{ week_starts_on: number; daily_capacity_min: number }>(
    'SELECT week_starts_on, daily_capacity_min FROM profile WHERE owner_id = ? AND deleted = 0 LIMIT 1',
    [ownerId],
  );
  const week = row?.week_starts_on;
  return {
    weekStartsOn: week === 0 || week === 1 || week === 6 ? week : null,
    dailyCapacityMin: row?.daily_capacity_min ?? DEFAULT_CAPACITY_MIN,
  };
}

export const setWeekStart = (ctx: DataContext, weekStartsOn: WeekStart) => updateProfile(ctx, { weekStartsOn });

/** Capacity is clamped to 0-1440 minutes and rounded to whole minutes. */
export const clampCapacity = (minutes: number) =>
  Math.min(CAPACITY_MAX_MIN, Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : DEFAULT_CAPACITY_MIN)));

export const setDailyCapacity = (ctx: DataContext, minutes: number) =>
  updateProfile(ctx, { dailyCapacityMin: clampCapacity(minutes) });

// --- Categories -------------------------------------------------------------------------------------------------

export type CategoryNameProblem = 'empty' | 'duplicate';

export class CategoryProblemError extends Error {
  constructor(readonly problem: CategoryNameProblem) {
    super(`Category name: ${problem}`);
    this.name = 'CategoryProblemError';
  }
}

export interface CategoryUsage {
  category: Category;
  /** Live tasks (one-off or series) and routines filed under it. */
  usedBy: number;
}

export async function listCategoryUsage(db: SqlDriver, ownerId: string): Promise<CategoryUsage[]> {
  const categories = await listEntities(db, 'categories', ownerId, 'archived = 0', [], 'sort_order, created_at');
  const rows = await db.all<{ category_id: string; n: number }>(
    `SELECT category_id, COUNT(*) AS n FROM (
       SELECT category_id FROM tasks WHERE owner_id = ? AND deleted = 0 AND parent_task_id IS NULL AND category_id IS NOT NULL
       UNION ALL
       SELECT category_id FROM routines WHERE owner_id = ? AND deleted = 0 AND category_id IS NOT NULL
     ) GROUP BY category_id`,
    [ownerId, ownerId],
  );
  const counts = new Map(rows.map((r) => [r.category_id, r.n]));
  return categories.map((category) => ({ category, usedBy: counts.get(category.id) ?? 0 }));
}

async function checkName(ctx: DataContext, name: string, exceptId?: string): Promise<string> {
  const clean = normalizeCategoryName(name);
  if (!clean) throw new CategoryProblemError('empty');
  if (clean.length > CATEGORY_NAME_MAX) throw new CategoryNameError();
  const all = await listEntities(ctx.db, 'categories', ctx.ownerId, 'archived = 0');
  if (all.some((c) => c.id !== exceptId && categoryKey(c.name) === categoryKey(clean))) {
    throw new CategoryProblemError('duplicate');
  }
  return clean;
}

export async function addCategory(ctx: DataContext, name: string, color?: CategoryColor): Promise<Category> {
  return mutate(ctx, async () => {
    const clean = await checkName(ctx, name);
    const all = await listEntities(ctx.db, 'categories', ctx.ownerId);
    return writeEntity(ctx, 'categories', {
      id: ctx.newId(),
      name: clean,
      color: color ?? pickCategoryColor(all.filter((c) => !c.archived).map((c) => c.color)),
      icon: 'dot',
      sortOrder: Math.min(10000, all.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1),
      archived: false,
    });
  });
}

export async function updateCategory(
  ctx: DataContext,
  id: string,
  patch: { name?: string; color?: CategoryColor },
): Promise<Category | null> {
  return mutate(ctx, async () => {
    const current = await getEntity(ctx.db, 'categories', id, ctx.ownerId);
    if (!current) return null;
    const name = patch.name === undefined ? current.name : await checkName(ctx, patch.name, id);
    const color = patch.color ?? current.color;
    if (name === current.name && color === current.color) return current;
    return writeEntity(ctx, 'categories', { ...current, name, color });
  });
}

/**
 * Deletes a category. Its tasks and routines move to `reassignTo` (another live category) or lose their category
 * (`null`). Returns how many items were moved; false when the category does not exist.
 */
export async function deleteCategory(
  ctx: DataContext,
  id: string,
  reassignTo: string | null,
): Promise<{ moved: number } | false> {
  return mutate(ctx, async () => {
    const current = await getEntity(ctx.db, 'categories', id, ctx.ownerId);
    if (!current) return false;
    if (reassignTo !== null) {
      const target = await getEntity(ctx.db, 'categories', reassignTo, ctx.ownerId);
      if (!target || target.archived || target.id === id) throw new CategoryProblemError('empty');
    }
    let moved = 0;
    for (const task of await listEntities(ctx.db, 'tasks', ctx.ownerId, 'category_id = ?', [id])) {
      await writeEntity(ctx, 'tasks', { ...task, categoryId: reassignTo });
      moved += 1;
    }
    for (const routine of await listEntities(ctx.db, 'routines', ctx.ownerId, 'category_id = ?', [id])) {
      await writeEntity(ctx, 'routines', { ...routine, categoryId: reassignTo });
      moved += 1;
    }
    await tombstone(ctx, 'categories', id);
    return { moved };
  });
}

// --- Failed sync --------------------------------------------------------------------------------------------------

export interface FailedSyncItem {
  entityType: EntityType;
  entityId: string;
  op: 'upsert' | 'delete';
  attempts: number;
  /** Error code recorded by the sync engine (for example `permission-denied`). */
  error: string | null;
  /** Title or name of the item when it still exists locally. */
  label: string | null;
}

const LABEL_COLUMN: Partial<Record<EntityType, string>> = {
  tasks: 'title',
  goals: 'title',
  milestones: 'title',
  routines: 'title',
  categories: 'name',
  occurrences: 'title',
};

export async function listFailedSync(db: SqlDriver, ownerId: string): Promise<FailedSyncItem[]> {
  const rows = await db.all<{
    entity_type: EntityType;
    entity_id: string;
    op: 'upsert' | 'delete';
    attempts: number;
    last_error: string | null;
  }>(`SELECT entity_type, entity_id, op, attempts, last_error FROM outbox WHERE state = 'failed' ORDER BY id`);
  const items: FailedSyncItem[] = [];
  for (const row of rows) {
    const def = entities[row.entity_type];
    if (!def) continue;
    const owned = await db.first<{ label: string | null }>(
      `SELECT ${LABEL_COLUMN[row.entity_type] ? `${LABEL_COLUMN[row.entity_type]} AS label` : 'NULL AS label'}
       FROM ${def.table} WHERE id = ? AND owner_id = ?`,
      [row.entity_id, ownerId],
    );
    if (!owned) continue; // another account's leftover or an item that is gone
    items.push({
      entityType: row.entity_type,
      entityId: row.entity_id,
      op: row.op,
      attempts: row.attempts,
      error: row.last_error,
      label: owned.label,
    });
  }
  return items;
}

/** Puts one failed item back in the queue for the next sync run. */
export async function retryFailedItem(db: SqlDriver, type: EntityType, id: string, now = Date.now()): Promise<void> {
  await db.run(
    `UPDATE outbox SET state = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL
     WHERE state = 'failed' AND entity_type = ? AND entity_id = ?`,
    [now, type, id],
  );
  notifyDataChanged('local');
}

/**
 * Stops trying to upload one failed change. The item stays on this device; its "needs upload" flag is cleared so a
 * newer server copy, if there is one, replaces it on the next pull.
 */
export async function discardFailedItem(db: SqlDriver, type: EntityType, id: string): Promise<void> {
  const def = entities[type];
  if (!def) return;
  await db.transaction(async () => {
    const removed = await db.run(`DELETE FROM outbox WHERE state = 'failed' AND entity_type = ? AND entity_id = ?`, [
      type,
      id,
    ]);
    if (removed.changes > 0) await db.run(`UPDATE ${def.table} SET dirty = 0 WHERE id = ?`, [id]);
  });
  notifyDataChanged('local');
}
