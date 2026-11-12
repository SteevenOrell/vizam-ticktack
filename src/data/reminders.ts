/**
 * Task and routine reminders. One synced `reminders` row per task or routine (ARCHITECTURE.md section 3): the
 * reminder fires `offsetMin` minutes before the start time on days the item has one, and at `atTime` on days it has
 * none. `kind` records which of the two applied when it was saved (`relative` = timed). The OS schedule itself is
 * local and rebuilt by the reminder scheduler (src/services/notifications).
 */
import { z } from 'zod';

import { hhmmSchema } from '../domain/models';
import type { SqlDriver } from './db/driver';
import { listEntities, writeEntity, type DataContext } from './store';

/** Offsets offered in the editor, in minutes before the start time. */
export const REMINDER_OFFSETS: readonly number[] = Object.freeze([0, 5, 10, 15, 30, 60, 120, 1440]);

export const itemReminderSchema = z.object({
  offsetMin: z.number().int().min(0).max(10080),
  atTime: hhmmSchema,
});
export type ItemReminder = z.infer<typeof itemReminderSchema>;

export const DEFAULT_ITEM_REMINDER: ItemReminder = { offsetMin: 10, atTime: '09:00' };

export type ReminderTarget = 'task' | 'routine';

async function rowsFor(db: SqlDriver, ownerId: string, type: ReminderTarget, targetId: string) {
  return listEntities(db, 'reminders', ownerId, 'target_type = ? AND target_id = ?', [type, targetId]);
}

/** The reminder of a task or routine, or null when it has none (or it is switched off). */
export async function getItemReminder(
  db: SqlDriver,
  ownerId: string,
  type: ReminderTarget,
  targetId: string,
): Promise<ItemReminder | null> {
  const row = (await rowsFor(db, ownerId, type, targetId)).find((r) => r.enabled);
  return row ? { offsetMin: row.offsetMin ?? 0, atTime: row.atTime ?? DEFAULT_ITEM_REMINDER.atTime } : null;
}

/**
 * Saves (or, with null, switches off) the reminder of a task or routine. Reuses the existing row and writes nothing
 * when nothing changed. Must run inside `mutate`.
 */
export async function saveItemReminder(
  ctx: DataContext,
  type: ReminderTarget,
  targetId: string,
  value: ItemReminder | null,
  timed: boolean,
): Promise<void> {
  const rows = await rowsFor(ctx.db, ctx.ownerId, type, targetId);
  const [first, ...extra] = rows;
  // Older or merged data could hold several rows: one is kept, the rest are switched off.
  for (const r of extra) if (r.enabled) await writeEntity(ctx, 'reminders', { ...r, enabled: false });
  if (!value) {
    if (first?.enabled) await writeEntity(ctx, 'reminders', { ...first, enabled: false });
    return;
  }
  const parsed = itemReminderSchema.parse(value);
  const kind = timed ? 'relative' : 'absolute';
  if (
    first &&
    first.enabled &&
    first.kind === kind &&
    first.offsetMin === parsed.offsetMin &&
    first.atTime === parsed.atTime
  ) {
    return;
  }
  await writeEntity(ctx, 'reminders', {
    ...(first ?? { id: ctx.newId(), targetType: type, targetId }),
    kind,
    offsetMin: parsed.offsetMin,
    atTime: parsed.atTime,
    enabled: true,
  });
}

/** Copies the reminder of one item to another (a series split creates a new task). Must run inside `mutate`. */
export async function copyItemReminder(
  ctx: DataContext,
  type: ReminderTarget,
  fromId: string,
  toId: string,
  timed: boolean,
): Promise<void> {
  const value = await getItemReminder(ctx.db, ctx.ownerId, type, fromId);
  if (value) await saveItemReminder(ctx, type, toId, value, timed);
}

/** Tombstones every reminder of a deleted item. Must run inside `mutate`. */
export async function removeItemReminders(ctx: DataContext, type: ReminderTarget, targetId: string): Promise<void> {
  for (const r of await rowsFor(ctx.db, ctx.ownerId, type, targetId)) {
    await writeEntity(ctx, 'reminders', { ...r, deleted: true });
  }
}

export interface EnabledReminder extends ItemReminder {
  targetType: ReminderTarget;
  targetId: string;
}

/** Every enabled task / routine reminder of the owner (scheduler input), one per item. */
export async function listItemReminders(db: SqlDriver, ownerId: string): Promise<EnabledReminder[]> {
  const rows = await listEntities(db, 'reminders', ownerId, "enabled = 1 AND target_type IN ('task', 'routine')");
  const seen = new Set<string>();
  const out: EnabledReminder[] = [];
  for (const r of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    if (seen.has(key) || r.targetType === 'goal') continue;
    seen.add(key);
    out.push({
      targetType: r.targetType,
      targetId: r.targetId,
      offsetMin: r.offsetMin ?? 0,
      atTime: r.atTime ?? DEFAULT_ITEM_REMINDER.atTime,
    });
  }
  return out;
}
