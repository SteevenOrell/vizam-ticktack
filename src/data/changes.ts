/**
 * Tiny change notifier: repositories call `notifyDataChanged()` after a committed write or a sync pull; screens
 * re-run their queries and the sync scheduler pushes 2 s later. Plain TypeScript so Node tests can use it.
 */
export type ChangeSource = 'local' | 'sync';
type Listener = (source: ChangeSource) => void;

const listeners = new Set<Listener>();
let version = 0;

export function subscribeDataChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDataChanged(source: ChangeSource = 'local'): void {
  version += 1;
  for (const l of [...listeners]) l(source);
}

export function dataVersion(): number {
  return version;
}
