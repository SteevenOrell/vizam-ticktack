import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AsyncState } from '../ui/states';
import { subscribeDataChanges } from './changes';
import { useDatabase } from './DatabaseProvider';
import type { SqlDriver } from './db/driver';

type Result<T> = { status: 'success'; data: T } | { status: 'error'; error: unknown };

/**
 * Runs a read against the local database and exposes loading / error / success. A database that failed to open
 * surfaces as the error state; `reload` retries the query (and reopens the database if needed).
 */
export function useQuery<T>(query: (db: SqlDriver) => Promise<T>): AsyncState<T> & { reload: () => void } {
  const database = useDatabase();
  const [attempt, setAttempt] = useState(0);
  const [version, setVersion] = useState(0);
  // Re-run after any committed local write or sync pull.
  useEffect(() => subscribeDataChanges(() => setVersion((v) => v + 1)), []);
  // A new token for every run; results from older runs are ignored.
  const token = useMemo(() => ({ database, query, attempt, version }), [database, query, attempt, version]);
  const [result, setResult] = useState<{ token: typeof token; value: Result<T> } | null>(null);

  useEffect(() => {
    if (token.database.status !== 'ready') return;
    let cancelled = false;
    token.query(token.database.db).then(
      (data) => !cancelled && setResult({ token, value: { status: 'success', data } }),
      (error: unknown) => !cancelled && setResult({ token, value: { status: 'error', error } }),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = useCallback(() => {
    if (database.status === 'error') database.retry();
    setAttempt((n) => n + 1);
  }, [database]);

  let state: AsyncState<T>;
  if (database.status === 'opening') state = { status: 'loading' };
  else if (database.status === 'error') state = { status: 'error', error: database.error };
  // While a refresh runs after a change, keep showing the previous result instead of flashing the skeleton.
  else if (result?.token === token) state = result.value;
  else if (result && result.token.query === query && result.token.database === database) state = result.value;
  else state = { status: 'loading' };

  return { ...state, reload };
}
