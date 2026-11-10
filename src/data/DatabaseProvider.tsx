import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type { SqlDriver } from './db/driver';
import { openExpoDriver } from './db/expoDriver';
import { migrate } from './db/migrate';

export type DatabaseState =
  { status: 'opening' } | { status: 'ready'; db: SqlDriver } | { status: 'error'; error: unknown; retry: () => void };

const DatabaseContext = createContext<DatabaseState>({ status: 'opening' });

/** Opens the local SQLite database and applies migrations before screens query it. */
export function DatabaseProvider({
  children,
  open = openExpoDriver,
}: {
  children: ReactNode;
  open?: () => Promise<SqlDriver>;
}) {
  const [state, setState] = useState<DatabaseState>({ status: 'opening' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'opening' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let opened: SqlDriver | undefined;
    (async () => {
      opened = await open();
      await migrate(opened);
      if (!cancelled) setState({ status: 'ready', db: opened });
    })().catch((error: unknown) => {
      // No task content in logs: only the error class and message.
      console.warn('Database open failed', error instanceof Error ? error.message : 'unknown');
      if (!cancelled) setState({ status: 'error', error, retry });
    });
    return () => {
      cancelled = true;
      void opened?.close().catch(() => undefined);
    };
  }, [open, attempt, retry]);

  return <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseState {
  return useContext(DatabaseContext);
}
