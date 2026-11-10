/**
 * Minimal SQL driver used by migrations, repositories and the seed script. The app uses the expo-sqlite driver;
 * Node tests and scripts use better-sqlite3 behind the same interface. Always pass values as parameters; never
 * build SQL from user input.
 */
export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlDriver {
  /** Runs one or more statements without parameters (schema only, never user data). */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  /** Runs `fn` inside a transaction; rolls back if it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
