/**
 * Milestones: an ordered checklist inside a goal (title, optional date, done). They are a second, separate measure
 * next to the task-based completion percentage, which stays the goal's main number: a goal's percent is still
 * "done linked tasks / all linked tasks", and the milestones show as "n of m" beside it.
 * Synced like every entity (`milestones` collection, `writeEntity` -> outbox).
 */
import { z } from 'zod';

import { idSchema, localDateSchema, type Milestone } from '../domain/models';
import type { SqlDriver } from './db/driver';
import { getEntity, listEntities, mutate, nowIso, tombstone, writeEntity, type DataContext } from './store';

export const MILESTONES_MAX = 30;

export const milestoneDraftSchema = z.object({
  /** Missing for a milestone added in the form. */
  id: idSchema.optional(),
  title: z.string().trim().min(1, 'milestoneTitleRequired').max(120, 'milestoneTitleTooLong'),
  dueDate: localDateSchema.nullable(),
  done: z.boolean(),
});
export type MilestoneDraft = z.infer<typeof milestoneDraftSchema>;
export const milestoneDraftsSchema = z.array(milestoneDraftSchema).max(MILESTONES_MAX);

export async function listMilestones(db: SqlDriver, ownerId: string, goalId: string): Promise<Milestone[]> {
  return listEntities(db, 'milestones', ownerId, 'goal_id = ?', [goalId], 'sort_order, created_at');
}

export const milestoneDraftOf = (m: Milestone): MilestoneDraft => ({
  id: m.id,
  title: m.title,
  dueDate: m.dueDate,
  done: m.completedAt !== null,
});

export interface MilestoneProgress {
  done: number;
  total: number;
  /** 0-100, rounded down so 100 means every milestone is done. */
  percent: number;
}

export function milestoneProgress(list: readonly { completedAt: string | null }[]): MilestoneProgress {
  const total = list.length;
  const done = list.filter((m) => m.completedAt !== null).length;
  return { done, total, percent: total === 0 ? 0 : Math.floor((done / total) * 100) };
}

/**
 * Makes the stored milestones of a goal match the form: list order becomes `sortOrder`, new ones are created,
 * missing ones are tombstoned, unchanged ones are not rewritten. Must run inside `mutate`.
 */
export async function syncMilestones(ctx: DataContext, goalId: string, drafts: readonly MilestoneDraft[]) {
  const parsed = milestoneDraftsSchema.parse(drafts);
  const existing = await listMilestones(ctx.db, ctx.ownerId, goalId);
  const byId = new Map(existing.map((m) => [m.id, m]));
  const keep = new Set<string>();
  for (const [index, d] of parsed.entries()) {
    const current = d.id ? byId.get(d.id) : undefined;
    const completedAt = d.done ? (current?.completedAt ?? nowIso(ctx)) : null;
    if (current) {
      keep.add(current.id);
      const same =
        current.title === d.title &&
        current.dueDate === d.dueDate &&
        current.sortOrder === index &&
        (current.completedAt !== null) === d.done;
      if (!same) {
        await writeEntity(ctx, 'milestones', {
          ...current,
          title: d.title,
          dueDate: d.dueDate,
          completedAt,
          sortOrder: index,
        });
      }
      continue;
    }
    await writeEntity(ctx, 'milestones', {
      id: ctx.newId(),
      goalId,
      title: d.title,
      dueDate: d.dueDate,
      completedAt,
      sortOrder: index,
    });
  }
  for (const m of existing) if (!keep.has(m.id)) await tombstone(ctx, 'milestones', m.id);
}

/** Checks a milestone off (or reopens it) from the goal screen. */
export async function setMilestoneDone(ctx: DataContext, milestoneId: string, done: boolean): Promise<void> {
  await mutate(ctx, async () => {
    const m = await getEntity(ctx.db, 'milestones', milestoneId, ctx.ownerId);
    if (!m) throw new Error('Milestone not found');
    if ((m.completedAt !== null) === done) return;
    await writeEntity(ctx, 'milestones', { ...m, completedAt: done ? nowIso(ctx) : null });
  });
}

/** Tombstones every milestone of a deleted goal. Must run inside `mutate`. */
export async function removeMilestones(ctx: DataContext, goalId: string): Promise<void> {
  for (const m of await listMilestones(ctx.db, ctx.ownerId, goalId)) await tombstone(ctx, 'milestones', m.id);
}

/** Moves the item at `index` one place up or down (form helper; an out-of-range move returns a plain copy). */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  const next = [...list];
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}
