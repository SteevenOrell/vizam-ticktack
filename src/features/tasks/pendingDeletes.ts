import { create } from 'zustand';

import type { LocalDate } from '../../domain/localDate';

/**
 * Delete with undo. Tombstones are sticky (they never come back, by design for sync), so a delete is held for
 * UNDO_MS: the rows are hidden at once, the snackbar offers Undo, and the real delete runs when the time is up (or
 * when another delete replaces the snackbar). Undo simply cancels the pending delete; nothing was written yet.
 * If the app is killed inside the window the task stays (the safe side).
 */
export const UNDO_MS = 5000;

/** Which rows a pending delete hides: one row (`key`), a whole series, or a series from a date on. */
export interface HideMatch {
  key?: string;
  taskId?: string;
  fromDate?: LocalDate;
  /** A goal (goal deletes). */
  goalId?: string;
}

export interface PendingDelete {
  id: string;
  label: string;
  /** What was deleted (snackbar text). */
  kind?: 'task' | 'goal';
  hide: HideMatch;
  /** The delete has run; the rows stay hidden briefly while screens refresh. */
  committed?: boolean;
}

interface Store {
  pending: PendingDelete[];
}

export const usePendingDeletes = create<Store>()(() => ({ pending: [] }));

const runners = new Map<string, { run: () => Promise<void>; timer: ReturnType<typeof setTimeout> }>();
let counter = 0;

function drop(id: string) {
  usePendingDeletes.setState((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
}

/** Runs a pending delete now. Errors are reported to `onError`; the rows come back on the next refresh. */
async function commit(id: string, onError?: (e: unknown) => void) {
  const entry = runners.get(id);
  if (!entry) return;
  runners.delete(id);
  clearTimeout(entry.timer);
  usePendingDeletes.setState((st) => ({
    pending: st.pending.map((x) => (x.id === id ? { ...x, committed: true } : x)),
  }));
  try {
    await entry.run();
    // Keep the rows hidden while the screens re-query after the write, so they do not flash back.
    setTimeout(() => drop(id), 800);
  } catch (e) {
    drop(id);
    onError?.(e);
  }
}

/** Hides the rows and schedules the delete. A newer delete commits the older ones (one snackbar at a time). */
export function scheduleDelete(
  input: { label: string; hide: HideMatch; run: () => Promise<void>; kind?: 'task' | 'goal' },
  onError?: (e: unknown) => void,
): string {
  for (const id of [...runners.keys()]) void commit(id, onError);
  counter += 1;
  const id = `del-${counter}`;
  const timer = setTimeout(() => void commit(id, onError), UNDO_MS);
  runners.set(id, { run: input.run, timer });
  usePendingDeletes.setState((s) => ({
    pending: [...s.pending, { id, label: input.label, hide: input.hide, kind: input.kind ?? 'task' }],
  }));
  return id;
}

/** Cancels a pending delete: nothing is written and the rows show again. */
export function undoDelete(id: string) {
  const entry = runners.get(id);
  if (entry) clearTimeout(entry.timer);
  runners.delete(id);
  drop(id);
}

/** Commits every pending delete now (app going to the background). */
export async function flushDeletes() {
  await Promise.all([...runners.keys()].map((id) => commit(id)));
}

export function isHidden(item: { key: string; taskId: string; date: LocalDate }, pending: readonly PendingDelete[]) {
  return pending.some(({ hide }) => {
    if (hide.key && hide.key === item.key) return true;
    if (hide.taskId && hide.taskId === item.taskId) return !hide.fromDate || item.date >= hide.fromDate;
    return false;
  });
}

/** True while a goal delete is pending (the goal is hidden from lists until it commits or is undone). */
export function isGoalHidden(goalId: string, pending: readonly PendingDelete[]) {
  return pending.some(({ hide }) => hide.goalId === goalId);
}
