/**
 * Where a tapped reminder leads (pure, so it is tested without the OS module). The payload is untrusted: ids are
 * checked against the id alphabet before they reach the router, and anything unknown opens nothing.
 */
import type { PlannedNotification } from './plan';

export type ReminderRoute =
  | { pathname: '/goal/[id]'; params: { id: string } }
  | { pathname: '/task/details/[id]'; params: { id: string; occ?: string } }
  | { pathname: '/routine/[id]'; params: { id: string } };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** The data attached to a scheduled notification (read back by `reminderRoute`). */
export function reminderPayload(n: PlannedNotification): Record<string, string> {
  const data: Record<string, string> = { url: n.url, targetType: n.targetType, targetId: n.targetId };
  if (n.occurrenceId) data.occurrenceId = n.occurrenceId;
  // Kept for goal reminders scheduled by earlier versions, whose payload only had `goalId`.
  if (n.targetType === 'goal') data.goalId = n.targetId;
  return data;
}

export function reminderRoute(data: unknown): ReminderRoute | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const type = d.targetType ?? (d.goalId !== undefined ? 'goal' : undefined);
  const id = d.targetId ?? d.goalId;
  if (!isId(id)) return null;
  switch (type) {
    case 'goal':
      return { pathname: '/goal/[id]', params: { id } };
    case 'routine':
      return { pathname: '/routine/[id]', params: { id } };
    case 'task':
      // An occurrence id is `<seriesId>_YYYYMMDD`, so it must start with the task id.
      return isId(d.occurrenceId) && d.occurrenceId.startsWith(`${id}_`)
        ? { pathname: '/task/details/[id]', params: { id, occ: d.occurrenceId } }
        : { pathname: '/task/details/[id]', params: { id } };
    default:
      return null;
  }
}
