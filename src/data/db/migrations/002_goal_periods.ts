/**
 * Migration 002 — goal periods, goal reminder settings and period history (synced), plus a fingerprint on the
 * local-only notification schedule so a changed reminder text or time is rescheduled. Never edit a released
 * migration; add a new one instead.
 */
const defaultReminders = JSON.stringify({
  beforeDue: [],
  beforeDueTime: '09:00',
  eachStep: false,
  monthlyDay: null,
  monthlyTime: '09:00',
  periodic: false,
  periodicTime: '09:00',
  periodicWeekday: 1,
});

export const migration002 = `
ALTER TABLE goals ADD COLUMN period TEXT NOT NULL DEFAULT 'once'
  CHECK (period IN ('once', 'daily', 'weekly', 'monthly', 'yearly'));
ALTER TABLE goals ADD COLUMN start_date TEXT;
ALTER TABLE goals ADD COLUMN reminders TEXT NOT NULL DEFAULT '${defaultReminders}';
ALTER TABLE goals ADD COLUMN history TEXT NOT NULL DEFAULT '[]';

ALTER TABLE scheduled_notifications ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_goals_owner ON goals (owner_id, deleted, status);
`;
