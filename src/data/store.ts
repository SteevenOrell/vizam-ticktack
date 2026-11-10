/**
 * Write path (ARCHITECTURE.md section 4 and 6): validate with Zod -> one SQLite transaction that writes the row,
 * bumps `local_rev`, sets `dirty = 1` and upserts the outbox entry. Every write in the app goes through
 * `writeEntity` inside `mutate`. Reads always filter by the bound owner.
 */
import { LOCAL_OWNER, SCHEMA_VERSION } from '../domain/models';
import { notifyDataChanged } from './changes';
import type { SqlDriver, SqlValue } from './db/driver';
import {
  entities,
  entityToColumns,
  parseEntity,
  rowToEntity,
  type EntityDef,
  type EntityOf,
  type EntityType,
  type SqlRow,
} from './entities';

export interface DataContext {
  db: SqlDriver;
  /** Firebase uid when signed in, `local` in guest mode. */
  ownerId: string;
  newId: () => string;
  now?: () => Date;
}

export class OwnershipError extends Error {
  constructor(type: EntityType, id: string) {
    super(`Refusing to overwrite ${type}/${id} owned by another account`);
    this.name = 'OwnershipError';
  }
}

export const nowIso = (ctx: Pick<DataContext, 'now'>) => (ctx.now?.() ?? new Date()).toISOString();

const IDENT = /^[a-z_]+$/;
function checkIdent(...names: string[]) {
  for (const n of names) if (!IDENT.test(n)) throw new Error('Invalid identifier');
}

/** Runs `fn` in one transaction, then tells screens and the sync scheduler that local data changed. */
export async function mutate<T>(ctx: DataContext, fn: () => Promise<T>): Promise<T> {
  const result = await ctx.db.transaction(fn);
  notifyDataChanged('local');
  return result;
}

export type EntityInput<K extends EntityType> = Omit<
  EntityOf<K>,
  'ownerId' | 'clientUpdatedAt' | 'serverUpdatedAt' | 'schemaVersion' | 'createdAt' | 'deleted'
> &
  Partial<Pick<EntityOf<K>, 'createdAt' | 'deleted'>>;

/**
 * Upserts one entity. Must run inside `mutate` (the driver's transactions do not nest). `sync: false` writes a
 * local-only cache row (generated occurrences) that is neither dirty nor queued.
 */
export async function writeEntity<K extends EntityType>(
  ctx: DataContext,
  type: K,
  input: EntityInput<K>,
  options: { sync?: boolean } = {},
): Promise<EntityOf<K>> {
  const sync = options.sync ?? true;
  const def = entities[type] as EntityDef;
  const now = nowIso(ctx);
  const existing = await ctx.db.first<{ owner_id: string; created_at: string; server_updated_at: number | null }>(
    `SELECT owner_id, created_at, server_updated_at FROM ${def.table} WHERE id = ?`,
    [input.id],
  );
  if (existing && existing.owner_id !== ctx.ownerId) throw new OwnershipError(type, input.id);

  const entity = parseEntity(type, {
    ...input,
    ownerId: ctx.ownerId,
    createdAt: existing?.created_at ?? input.createdAt ?? now,
    clientUpdatedAt: now,
    serverUpdatedAt: existing?.server_updated_at ?? null,
    deleted: input.deleted ?? false,
    schemaVersion: SCHEMA_VERSION,
  });
  const cols = entityToColumns(type, entity as Record<string, unknown>);
  const names = Object.keys(cols);
  checkIdent(def.table, ...names);
  const updatable = names.filter((c) => !['id', 'owner_id', 'created_at', 'server_updated_at'].includes(c));
  const dirty = sync ? 1 : 0;
  await ctx.db.run(
    `INSERT INTO ${def.table} (${names.join(', ')}, local_rev, dirty) VALUES (${names.map(() => '?').join(', ')}, 1, ?)
     ON CONFLICT(id) DO UPDATE SET ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')},
       local_rev = ${def.table}.local_rev + 1, dirty = MAX(${def.table}.dirty, excluded.dirty)`,
    [...names.map((c) => cols[c] ?? null), dirty],
  );
  if (sync) {
    const rev = await ctx.db.first<{ local_rev: number }>(`SELECT local_rev FROM ${def.table} WHERE id = ?`, [
      entity.id,
    ]);
    await enqueue(ctx.db, type, entity.id, entity.deleted ? 'delete' : 'upsert', rev?.local_rev ?? 1, ctx.now);
  }
  return entity as EntityOf<K>;
}

/** Tombstones an entity (sticky: it is never revived). Returns false when it does not exist. */
export async function tombstone(ctx: DataContext, type: EntityType, id: string): Promise<boolean> {
  const current = await getEntity(ctx.db, type, id, ctx.ownerId, { includeDeleted: true });
  if (!current) return false;
  if (current.deleted) return true;
  await writeEntity(ctx, type, { ...(current as EntityInput<typeof type>), deleted: true });
  return true;
}

/** Coalescing outbox upsert: one entry per (type, id); a newer edit replaces the queued revision and resets retries. */
export async function enqueue(
  db: SqlDriver,
  type: EntityType,
  id: string,
  op: 'upsert' | 'delete',
  rev: number,
  now?: () => Date,
): Promise<void> {
  const at = (now?.() ?? new Date()).getTime();
  await db.run(
    `INSERT INTO outbox (entity_type, entity_id, op, enqueued_rev, attempts, next_attempt_at, state)
     VALUES (?, ?, ?, ?, 0, ?, 'pending')
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET op = excluded.op, enqueued_rev = excluded.enqueued_rev,
       attempts = 0, next_attempt_at = excluded.next_attempt_at, state = 'pending', last_error = NULL`,
    [type, id, op, rev, at],
  );
}

export async function getEntity<K extends EntityType>(
  db: SqlDriver,
  type: K,
  id: string,
  ownerId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<EntityOf<K> | null> {
  const def = entities[type] as EntityDef;
  checkIdent(def.table);
  const row = await db.first<SqlRow>(
    `SELECT * FROM ${def.table} WHERE id = ? AND owner_id = ?${options.includeDeleted ? '' : ' AND deleted = 0'}`,
    [id, ownerId],
  );
  return row ? rowToEntity(type, row) : null;
}

/** Lists live entities of the owner; `where` is a fixed SQL fragment from our code with bound `params`. */
export async function listEntities<K extends EntityType>(
  db: SqlDriver,
  type: K,
  ownerId: string,
  where = '',
  params: readonly SqlValue[] = [],
  orderBy = 'created_at',
): Promise<EntityOf<K>[]> {
  const def = entities[type] as EntityDef;
  checkIdent(def.table);
  const rows = await db.all<SqlRow>(
    `SELECT * FROM ${def.table} WHERE owner_id = ? AND deleted = 0${where ? ` AND (${where})` : ''} ORDER BY ${orderBy}`,
    [ownerId, ...params],
  );
  return rows.map((r) => rowToEntity(type, r));
}

export const isGuest = (ownerId: string) => ownerId === LOCAL_OWNER;
