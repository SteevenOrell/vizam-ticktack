/**
 * Materialises recurring occurrences into SQLite for a bounded window (ARCHITECTURE.md section 5):
 * `[today - 7, today + 21]` plus the range on screen, at most 62 days per request and 400 rows per series.
 * Rows are a local, regenerable cache (`dirty = 0`, never queued); `INSERT OR IGNORE` on the deterministic ID means
 * regeneration can never duplicate and never overwrites an exception.
 */
import { addDays, maxDate, minDate, type LocalDate } from '../domain/localDate';
import { clampWindow, MAX_ROWS_PER_SERIES, occurrenceId, occurrencesBetween } from '../domain/recurrence/generator';
import type { SqlDriver } from './db/driver';
import { rowToEntity, type SqlRow } from './entities';

export const WINDOW_BEFORE = 7;
export const WINDOW_AFTER = 21;
export const PRUNE_BEFORE = 30;
export const PRUNE_AFTER = 60;

export function defaultWindow(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: addDays(today, -WINDOW_BEFORE), to: addDays(today, WINDOW_AFTER) };
}

interface WindowRow {
  generated_from: string;
  generated_through: string;
}

/**
 * Ensures occurrences exist for every live series of the owner in `[from, to]` (clamped to 62 days). Returns the
 * number of rows inserted. Pass `seriesId` to limit the work to one series (after an edit).
 */
export async function ensureOccurrences(
  db: SqlDriver,
  ownerId: string,
  range: { from: LocalDate; to: LocalDate },
  options: { now?: Date; seriesId?: string } = {},
): Promise<number> {
  const window = clampWindow(range.from, range.to);
  if (!window) return 0;
  const { from, to } = window;
  const nowIso = (options.now ?? new Date()).toISOString();

  const rules = await db.all<SqlRow>(
    `SELECT rr.* FROM recurrence_rules rr
     WHERE rr.owner_id = ? AND rr.deleted = 0 ${options.seriesId ? 'AND rr.series_id = ?' : ''}
       AND (
         (rr.series_type = 'task' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = rr.series_id AND t.owner_id = rr.owner_id
           AND t.deleted = 0 AND t.recurrence_rule_id = rr.id))
         OR (rr.series_type = 'routine' AND EXISTS (SELECT 1 FROM routines r WHERE r.id = rr.series_id
           AND r.owner_id = rr.owner_id AND r.deleted = 0 AND r.active = 1))
       )`,
    options.seriesId ? [ownerId, options.seriesId] : [ownerId],
  );

  let inserted = 0;
  await db.transaction(async () => {
    for (const row of rules) {
      const rule = rowToEntity('recurrenceRules', row);
      const known = await db.first<WindowRow>(
        'SELECT generated_from, generated_through FROM occurrence_window WHERE series_id = ?',
        [rule.seriesId],
      );
      if (known && known.generated_from <= from && known.generated_through >= to) continue;

      for (const date of occurrencesBetween(rule, from, to, MAX_ROWS_PER_SERIES)) {
        const r = await db.run(
          `INSERT OR IGNORE INTO task_occurrences (id, owner_id, created_at, client_updated_at, server_updated_at,
             deleted, schema_version, local_rev, dirty, series_type, series_id, rule_id, original_date, date,
             status, completed_step_ids, is_exception)
           VALUES (?, ?, ?, ?, NULL, 0, 1, 0, 0, ?, ?, ?, ?, ?, 'scheduled', '[]', 0)`,
          [
            occurrenceId(rule.seriesId, date),
            ownerId,
            nowIso,
            nowIso,
            rule.seriesType,
            rule.seriesId,
            rule.id,
            date,
            date,
          ],
        );
        inserted += r.changes;
      }

      // Remember the generated span; join with the previous one when they touch, otherwise keep the new one.
      const touches = known && known.generated_from <= addDays(to, 1) && known.generated_through >= addDays(from, -1);
      const next = touches
        ? { from: minDate(known.generated_from, from), to: maxDate(known.generated_through, to) }
        : { from, to };
      await db.run(
        `INSERT INTO occurrence_window (series_id, generated_from, generated_through) VALUES (?, ?, ?)
         ON CONFLICT(series_id) DO UPDATE SET generated_from = excluded.generated_from,
           generated_through = excluded.generated_through`,
        [rule.seriesId, next.from, next.to],
      );
    }
  });
  return inserted;
}

/**
 * Forgets generated rows of one series from `fromDate` on (after a series edit), so they are regenerated from the
 * new rule. Exceptions and dirty rows are kept; callers decide what happens to them.
 */
export async function resetGenerated(db: SqlDriver, seriesId: string, fromDate: LocalDate): Promise<void> {
  await db.run(
    `DELETE FROM task_occurrences WHERE series_id = ? AND original_date >= ? AND is_exception = 0 AND dirty = 0`,
    [seriesId, fromDate],
  );
  await db.run('DELETE FROM occurrence_window WHERE series_id = ?', [seriesId]);
}

/** On app start: drop recomputable rows outside `[today - 30, today + 60]` (never exceptions or unsynced rows). */
export async function pruneOccurrences(db: SqlDriver, today: LocalDate): Promise<number> {
  const r = await db.run(
    `DELETE FROM task_occurrences WHERE is_exception = 0 AND dirty = 0 AND (original_date < ? OR original_date > ?)`,
    [addDays(today, -PRUNE_BEFORE), addDays(today, PRUNE_AFTER)],
  );
  if (r.changes > 0) await db.run('DELETE FROM occurrence_window');
  return r.changes;
}
