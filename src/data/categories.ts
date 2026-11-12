/**
 * Free-text categories: the task editor sends a name; saving finds the category case-insensitively or creates it
 * with the next palette colour. Runs inside the caller's `mutate` transaction.
 */
import { categoryKey, CATEGORY_NAME_MAX, normalizeCategoryName, pickCategoryColor } from '../domain/categoryName';
import { listEntities, writeEntity, type DataContext } from './store';

export class CategoryNameError extends Error {
  constructor() {
    super('Category name too long');
    this.name = 'CategoryNameError';
  }
}

/**
 * Returns the id of the category called `name` (trimmed, case-insensitive), creating it when it does not exist.
 * An archived match is reused and unarchived. Empty name -> null (no category). Must run inside `mutate`.
 */
export async function resolveCategoryName(ctx: DataContext, name: string | null): Promise<string | null> {
  const clean = normalizeCategoryName(name);
  if (!clean) return null;
  if (clean.length > CATEGORY_NAME_MAX) throw new CategoryNameError();
  const all = await listEntities(ctx.db, 'categories', ctx.ownerId);
  const key = categoryKey(clean);
  const match =
    all.find((c) => categoryKey(c.name) === key && !c.archived) ?? all.find((c) => categoryKey(c.name) === key);
  if (match) {
    if (match.archived) await writeEntity(ctx, 'categories', { ...match, archived: false });
    return match.id;
  }
  const created = await writeEntity(ctx, 'categories', {
    id: ctx.newId(),
    name: clean,
    color: pickCategoryColor(all.filter((c) => !c.archived).map((c) => c.color)),
    icon: 'dot',
    sortOrder: Math.min(10000, all.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1),
    archived: false,
  });
  return created.id;
}
