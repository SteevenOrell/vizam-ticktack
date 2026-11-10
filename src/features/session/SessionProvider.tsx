/**
 * App services: follows Firebase Auth into the session store, binds the local database to the signed-in user,
 * runs start-up housekeeping, and schedules sync (ARCHITECTURE.md section 6 triggers: start, foreground, back
 * online, 2 s after a local write, every 5 min while open, manual).
 */
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getBoundUid } from '../../data/account';
import { subscribeDataChanges } from '../../data/changes';
import { useDatabase } from '../../data/DatabaseProvider';
import type { SqlDriver } from '../../data/db/driver';
import { pruneOccurrences } from '../../data/occurrences';
import { ensureProfile, updateProfile } from '../../data/profile';
import type { DataContext } from '../../data/store';
import { localDateOf } from '../../domain/localDate';
import { createFirebaseAuthGateway, type AuthGateway } from '../../services/auth';
import { attachUser, type FlowDeps } from '../../services/accountFlows';
import { getFirebase } from '../../services/firebase';
import { usePreferences } from '../../state/preferences';
import { ownerIdOf, useSession, useSyncStatus } from '../../state/session';
import { setSyncDeps, syncNow } from '../../sync/controller';
import { createFirestoreRemote } from '../../sync/firestoreRemote';
import type { RemoteStore } from '../../sync/types';

export const SYNC_DEBOUNCE_MS = 2_000;
export const SYNC_INTERVAL_MS = 5 * 60_000;

interface Services {
  gateway: AuthGateway | null;
  remote: RemoteStore | null;
  syncNow: () => Promise<unknown>;
}

const ServicesContext = createContext<Services>({ gateway: null, remote: null, syncNow: async () => null });

export function useServices(): Services {
  return useContext(ServicesContext);
}

/** Data context for repositories: the open database and the current owner. Null while the database opens. */
export function useDataContext(): DataContext | null {
  const database = useDatabase();
  const uid = useSession((s) => s.uid);
  return useMemo(
    () => (database.status === 'ready' ? { db: database.db, ownerId: ownerIdOf({ uid }), newId: randomUUID } : null),
    [database, uid],
  );
}

/** Flow dependencies for the auth screens; null until the database is open. */
export function useFlowDeps(): FlowDeps | null {
  const database = useDatabase();
  const services = useServices();
  return useMemo(
    () =>
      database.status === 'ready' && services.gateway
        ? { db: database.db, gateway: services.gateway, remote: services.remote, syncNow: services.syncNow }
        : null,
    [database, services],
  );
}

function deviceDefaults(language: string) {
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // keep UTC
  }
  return { timeZone, weekStartsOn: (language === 'fr' ? 1 : 0) as 0 | 1 };
}

export function SessionProvider({
  children,
  gateway: injectedGateway,
  remote: injectedRemote,
}: {
  children: ReactNode;
  gateway?: AuthGateway | null;
  remote?: RemoteStore | null;
}) {
  const database = useDatabase();
  const db: SqlDriver | null = database.status === 'ready' ? database.db : null;
  const session = useSession();
  const { theme, dayStart, dayEnd, language } = usePreferences();

  const { gateway, remote } = useMemo(() => {
    if (injectedGateway !== undefined) return { gateway: injectedGateway, remote: injectedRemote ?? null };
    const firebase = getFirebase();
    return firebase
      ? { gateway: createFirebaseAuthGateway(firebase.auth), remote: createFirestoreRemote(firebase.db) }
      : { gateway: null, remote: null };
  }, [injectedGateway, injectedRemote]);

  // Feed the app-wide sync controller (one runner and mutex for the whole session).
  useEffect(() => {
    setSyncDeps(db && session.uid && remote ? { db, uid: session.uid, remote } : null);
  }, [db, session.uid, remote]);

  // Auth state -> session (+ database binding).
  useEffect(() => {
    if (!db) return;
    if (!gateway) {
      useSession.getState().setGuest();
      return;
    }
    let cancelled = false;
    const unsubscribe = gateway.onChange((user) => {
      void (async () => {
        if (!user) {
          if (!cancelled) useSession.getState().setGuest();
          return;
        }
        const bound = await getBoundUid(db);
        if (bound !== user.uid && !useSession.getState().busy) {
          // A session restored by Firebase on a database that was not bound to it (first start after sign-in).
          await attachUser(db, user, { isNewAccount: false });
        }
        if (!cancelled) useSession.getState().setSignedIn(user.uid, user.email);
      })().catch((error: unknown) => {
        console.warn('Session restore failed', error instanceof Error ? error.name : 'unknown');
        if (!cancelled) useSession.getState().setGuest();
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [db, gateway]);

  // Start-up housekeeping and profile for the current owner (mirrors device preferences into it).
  const ownerId = ownerIdOf(session);
  useEffect(() => {
    if (!db || session.status === 'starting') return;
    const ctx = { db, ownerId, newId: randomUUID };
    void (async () => {
      await pruneOccurrences(db, localDateOf(new Date()));
      await ensureProfile(ctx, { ...deviceDefaults(language), theme, dayStart, dayEnd });
      await updateProfile(ctx, { theme, dayStart, dayEnd });
    })().catch((error: unknown) =>
      console.warn('Housekeeping failed', error instanceof Error ? error.name : 'unknown'),
    );
  }, [db, ownerId, session.status, theme, dayStart, dayEnd, language]);

  // Sync triggers while signed in.
  const signedIn = session.status === 'signedIn' && !!remote;
  useEffect(() => {
    if (!signedIn) {
      useSyncStatus.getState().set({ state: 'disabled' });
      return;
    }
    void syncNow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeChanges = subscribeDataChanges((source) => {
      if (source !== 'local') return;
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void syncNow();
    }, SYNC_INTERVAL_MS);
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow();
    });
    let wasOnline = true;
    const unsubscribeNet = NetInfo.addEventListener((net) => {
      const online = net.isConnected !== false;
      if (online && !wasOnline) void syncNow();
      if (!online) useSyncStatus.getState().set({ state: 'offline' });
      wasOnline = online;
    });
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribeChanges();
      appState.remove();
      unsubscribeNet();
    };
  }, [signedIn]);

  const value = useMemo(() => ({ gateway, remote, syncNow }), [gateway, remote]);
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}
