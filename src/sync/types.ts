import type { EntityType } from '../data/entities';

/** A document as read from the server: entity fields plus the server's accept time in epoch ms. */
export interface RemoteDoc {
  id: string;
  data: Record<string, unknown>;
  updatedAtMs: number;
}

/** A full-document write; the remote adds `updatedAt = server time` (enforced by the rules). */
export interface PushWrite {
  type: EntityType;
  id: string;
  data: Record<string, unknown>;
}

export type PushOutcome = { ok: true } | { ok: false; code: string };

export interface PullPage {
  docs: RemoteDoc[];
  /** Opaque cursor for the next page, null when this was the last page. */
  next: unknown;
}

/**
 * The sync engine's view of the cloud. Implemented by Firestore (`firestoreRemote`) and by an in-memory fake for
 * scenario tests. All paths are scoped to one user.
 */
export interface RemoteStore {
  /** Writes each document; returns one outcome per write, in order. Throws `RemoteError` when nothing was written. */
  push(uid: string, writes: PushWrite[]): Promise<PushOutcome[]>;
  /** Documents of `type` with `updatedAt > sinceMs`, oldest first. */
  pull(uid: string, type: EntityType, sinceMs: number, after: unknown, limit: number): Promise<PullPage>;
  /** Deletes every document of the user (account deletion). Returns the number deleted. */
  deleteAll(uid: string): Promise<number>;
}

export class RemoteError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** Errors that will not succeed on retry: the entry moves to `failed` (ARCHITECTURE.md section 6). */
export const FATAL_CODES = new Set(['permission-denied', 'invalid-argument', 'failed-precondition', 'out-of-range']);

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.replace(/^firestore\//, '');
  }
  return 'unknown';
}
