/**
 * Firestore implementation of RemoteStore (ARCHITECTURE.md section 7). Layout: `users/{uid}` (profile) and
 * `users/{uid}/{collection}/{id}`. Every write sets the full document with `updatedAt = serverTimestamp()`; the rules
 * reject anything else. Firestore's own cache is memory-only, so a commit that cannot reach the server would wait
 * forever: pushes time out and are retried by the outbox instead.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { ENTITY_TYPES, type EntityType } from '../data/entities';
import {
  errorCode,
  FATAL_CODES,
  RemoteError,
  type PullPage,
  type PushOutcome,
  type PushWrite,
  type RemoteStore,
} from './types';

export const PUSH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RemoteError('deadline-exceeded')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof RemoteError ? e : new RemoteError(errorCode(e)));
      },
    );
  });
}

function ref(db: Firestore, uid: string, type: EntityType, id: string): DocumentReference {
  return type === 'profile' ? doc(db, 'users', uid) : doc(db, 'users', uid, type, id);
}

function toMs(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

export function createFirestoreRemote(db: Firestore, options: { timeoutMs?: number } = {}): RemoteStore {
  const timeout = options.timeoutMs ?? PUSH_TIMEOUT_MS;

  const writeOne = async (uid: string, w: PushWrite): Promise<PushOutcome> => {
    try {
      await withTimeout(setDoc(ref(db, uid, w.type, w.id), { ...w.data, updatedAt: serverTimestamp() }), timeout);
      return { ok: true };
    } catch (e) {
      return { ok: false, code: errorCode(e) };
    }
  };

  return {
    async push(uid, writes) {
      if (writes.length === 0) return [];
      const batch = writeBatch(db);
      for (const w of writes) batch.set(ref(db, uid, w.type, w.id), { ...w.data, updatedAt: serverTimestamp() });
      try {
        await withTimeout(batch.commit(), timeout);
        return writes.map(() => ({ ok: true }) as const);
      } catch (e) {
        const code = errorCode(e);
        // A batch is atomic: one rejected document fails all. Isolate it by writing one at a time.
        if (FATAL_CODES.has(code) && writes.length > 1) {
          const out: PushOutcome[] = [];
          for (const w of writes) out.push(await writeOne(uid, w));
          return out;
        }
        throw e instanceof RemoteError ? e : new RemoteError(code);
      }
    },

    async pull(uid, type, sinceMs, after, limit): Promise<PullPage> {
      try {
        if (type === 'profile') {
          const snap = await getDoc(doc(db, 'users', uid));
          const ms = snap.exists() ? toMs(snap.get('updatedAt')) : null;
          if (!snap.exists() || ms === null || ms <= sinceMs) return { docs: [], next: null };
          const { updatedAt: _u, ...data } = snap.data();
          return { docs: [{ id: snap.id, data, updatedAtMs: ms }], next: null };
        }
        const base = [
          where('updatedAt', '>', Timestamp.fromMillis(sinceMs)),
          orderBy('updatedAt'),
          ...(after ? [startAfter(after as QueryDocumentSnapshot)] : []),
          limitTo(limit),
        ];
        const snap = await getDocs(query(collection(db, 'users', uid, type), ...base));
        const docs = snap.docs.flatMap((d) => {
          const ms = toMs(d.get('updatedAt'));
          if (ms === null) return [];
          const { updatedAt: _u, ...data } = d.data();
          return [{ id: d.id, data, updatedAtMs: ms }];
        });
        return { docs, next: snap.docs.length === limit ? (snap.docs[snap.docs.length - 1] ?? null) : null };
      } catch (e) {
        throw e instanceof RemoteError ? e : new RemoteError(errorCode(e));
      }
    },

    async deleteAll(uid) {
      let deleted = 0;
      try {
        for (const type of ENTITY_TYPES) {
          if (type === 'profile') continue;
          for (;;) {
            const snap = await getDocs(query(collection(db, 'users', uid, type), limitTo(400)));
            if (snap.empty) break;
            const batch = writeBatch(db);
            for (const d of snap.docs) batch.delete(d.ref);
            await withTimeout(batch.commit(), timeout);
            deleted += snap.size;
          }
        }
        const profile = await getDoc(doc(db, 'users', uid));
        if (profile.exists()) {
          const batch = writeBatch(db);
          batch.delete(profile.ref);
          await withTimeout(batch.commit(), timeout);
          deleted += 1;
        }
        return deleted;
      } catch (e) {
        throw e instanceof RemoteError ? e : new RemoteError(errorCode(e));
      }
    },
  };
}
