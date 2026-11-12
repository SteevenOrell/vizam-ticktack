/**
 * SQLite entity <-> Firestore document. Documents carry the entity fields in camelCase plus `ownerId`, `id`,
 * `deleted`, `schemaVersion`, `createdAt`, `clientUpdatedAt`; `updatedAt` is added by the remote as server time.
 * `serverUpdatedAt` is local bookkeeping and never sent. Pulled documents are validated with the entity schema.
 */
import { entities, type EntityDef, type EntityOf, type EntityType } from '../data/entities';
import type { RemoteDoc } from './types';

export function toRemote(type: EntityType, entity: Record<string, unknown>): Record<string, unknown> {
  const def = entities[type] as EntityDef;
  const data: Record<string, unknown> = {};
  for (const field of Object.keys(def.fields)) {
    if (field === 'serverUpdatedAt') continue;
    data[field] = entity[field] ?? null;
  }
  return data;
}

/** Returns the validated entity, or null when the document is malformed or belongs to someone else. */
export function fromRemote<K extends EntityType>(type: K, doc: RemoteDoc, uid: string): EntityOf<K> | null {
  const parsed = (entities[type] as EntityDef).schema.safeParse({ ...doc.data, serverUpdatedAt: doc.updatedAtMs });
  if (!parsed.success) return null;
  const entity = parsed.data as EntityOf<K> & { id: string; ownerId: string };
  if (entity.ownerId !== uid || entity.id !== doc.id) return null;
  return entity;
}
