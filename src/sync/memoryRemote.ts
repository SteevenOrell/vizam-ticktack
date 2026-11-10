/**
 * In-memory RemoteStore for sync scenario tests and offline demos. Behaves like Firestore + our rules where it
 * matters for sync: per-user scoping, a monotonic server clock stamping `updatedAt`, sticky tombstones
 * (permission-denied on resurrection), ordered paging, and an `online` switch that makes calls fail as unavailable.
 */
import type { EntityType } from '../data/entities';
import {
  RemoteError,
  type PullPage,
  type PushOutcome,
  type PushWrite,
  type RemoteStore,
  type RemoteDoc,
} from './types';

export interface MemoryRemote extends RemoteStore {
  online: boolean;
  /** Next server time in ms (each accepted write gets a strictly later time). */
  clock: number;
  docs(uid: string, type: EntityType): RemoteDoc[];
  /** Writes a raw document as another device or a malicious client would (bypasses checks). */
  inject(uid: string, type: EntityType, doc: RemoteDoc): void;
  pushCalls: number;
}

export function createMemoryRemote(startMs = 1_800_000_000_000): MemoryRemote {
  const store = new Map<string, RemoteDoc>(); // key: uid/type/id

  const key = (uid: string, type: EntityType, id: string) => `${uid}/${type}/${id}`;
  const remote: MemoryRemote = {
    online: true,
    clock: startMs,
    pushCalls: 0,

    async push(uid: string, writes: PushWrite[]): Promise<PushOutcome[]> {
      remote.pushCalls += 1;
      if (!remote.online) throw new RemoteError('unavailable');
      return writes.map((w) => {
        if (w.data.ownerId !== uid || w.data.id !== w.id) return { ok: false, code: 'permission-denied' };
        const existing = store.get(key(uid, w.type, w.id));
        if (existing?.data.deleted === true && w.data.deleted !== true) {
          return { ok: false, code: 'permission-denied' };
        }
        remote.clock += 1000;
        store.set(key(uid, w.type, w.id), { id: w.id, data: { ...w.data }, updatedAtMs: remote.clock });
        return { ok: true };
      });
    },

    async pull(uid: string, type: EntityType, sinceMs: number, after: unknown, limit: number): Promise<PullPage> {
      if (!remote.online) throw new RemoteError('unavailable');
      const all = remote
        .docs(uid, type)
        .filter((d) => d.updatedAtMs > sinceMs)
        .sort((a, b) => a.updatedAtMs - b.updatedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const start = typeof after === 'number' ? after : 0;
      const docs = all.slice(start, start + limit);
      return { docs, next: start + limit < all.length ? start + limit : null };
    },

    async deleteAll(uid: string): Promise<number> {
      if (!remote.online) throw new RemoteError('unavailable');
      let n = 0;
      for (const k of [...store.keys()]) {
        if (k.startsWith(`${uid}/`)) {
          store.delete(k);
          n += 1;
        }
      }
      return n;
    },

    docs(uid: string, type: EntityType): RemoteDoc[] {
      return [...store.entries()].filter(([k]) => k.startsWith(`${uid}/${type}/`)).map(([, d]) => d);
    },

    inject(uid: string, type: EntityType, doc: RemoteDoc) {
      store.set(key(uid, type, doc.id), doc);
    },
  };
  return remote;
}
