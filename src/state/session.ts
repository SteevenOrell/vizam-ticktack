import { create } from 'zustand';

import { LOCAL_OWNER } from '../domain/models';

/**
 * Session (who owns the local data) and sync status. Not persisted: Firebase Auth restores the user on start and
 * the session follows it. Guest mode = `ownerId 'local'`, no sync.
 */
export type SessionStatus = 'starting' | 'guest' | 'signedIn';

export interface SessionState {
  status: SessionStatus;
  uid: string | null;
  email: string | null;
  /** True while a sign-in / sign-up / sign-out / delete flow is moving data (screens show a busy state). */
  busy: boolean;
  setGuest: () => void;
  setSignedIn: (uid: string, email: string | null) => void;
  setBusy: (busy: boolean) => void;
}

export const useSession = create<SessionState>()((set) => ({
  status: 'starting',
  uid: null,
  email: null,
  busy: false,
  setGuest: () => set({ status: 'guest', uid: null, email: null }),
  setSignedIn: (uid, email) => set({ status: 'signedIn', uid, email }),
  setBusy: (busy) => set({ busy }),
}));

export const ownerIdOf = (s: Pick<SessionState, 'uid'>) => s.uid ?? LOCAL_OWNER;

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  failed: number;
  lastSuccessAt: number | null;
  set: (patch: Partial<Omit<SyncStatus, 'set'>>) => void;
}

export const useSyncStatus = create<SyncStatus>()((set) => ({
  state: 'disabled',
  pending: 0,
  failed: 0,
  lastSuccessAt: null,
  set: (patch) => set(patch),
}));
