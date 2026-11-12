/**
 * Migration 001 — initial schema (docs/ARCHITECTURE.md section 4).
 * Raw SQL kept in a TypeScript module so Metro bundles it without a custom transformer.
 * Never edit a released migration; add a new one instead.
 */

// Shared columns of every synced table (ARCHITECTURE.md section 3.1).
const shared = `
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  client_updated_at TEXT NOT NULL,
  server_updated_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  schema_version INTEGER NOT NULL DEFAULT 1,
  local_rev INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1))`;

export const migration001 = `
CREATE TABLE profile (${shared},
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 60),
  time_zone TEXT NOT NULL,
  week_starts_on INTEGER NOT NULL DEFAULT 1 CHECK (week_starts_on IN (0, 1, 6)),
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'dark', 'light')),
  day_start TEXT,
  day_end TEXT,
  daily_capacity_min INTEGER NOT NULL DEFAULT 480 CHECK (daily_capacity_min BETWEEN 0 AND 1440),
  default_reminder_offset_min INTEGER NOT NULL DEFAULT 10 CHECK (default_reminder_offset_min BETWEEN 0 AND 10080),
  onboarding_completed_at TEXT
);

CREATE TABLE categories (${shared},
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

CREATE TABLE goals (${shared},
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  target_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'achieved', 'archived')),
  color TEXT,
  progress_mode TEXT NOT NULL CHECK (progress_mode IN ('milestones', 'tasks', 'manual')),
  manual_progress INTEGER NOT NULL DEFAULT 0 CHECK (manual_progress BETWEEN 0 AND 100),
  achieved_at TEXT
);

CREATE TABLE milestones (${shared},
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  due_date TEXT,
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (${shared},
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 5000),
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  category_id TEXT,
  goal_id TEXT,
  milestone_id TEXT,
  parent_task_id TEXT,
  date TEXT,
  start_time TEXT,
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 1440),
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  recurrence_rule_id TEXT
);

CREATE TABLE recurrence_rules (${shared},
  series_type TEXT NOT NULL CHECK (series_type IN ('task', 'routine')),
  series_id TEXT NOT NULL UNIQUE,
  freq TEXT NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly')),
  interval INTEGER NOT NULL CHECK (interval BETWEEN 1 AND 99),
  by_weekday TEXT,
  by_month_day INTEGER CHECK (by_month_day IS NULL OR by_month_day BETWEEN 1 AND 31),
  week_starts_on INTEGER NOT NULL CHECK (week_starts_on IN (0, 1, 6)),
  start_date TEXT NOT NULL,
  end_type TEXT NOT NULL CHECK (end_type IN ('never', 'onDate', 'afterCount')),
  end_date TEXT,
  count INTEGER CHECK (count IS NULL OR count BETWEEN 1 AND 999)
);

CREATE TABLE task_occurrences (${shared},
  series_type TEXT NOT NULL CHECK (series_type IN ('task', 'routine')),
  series_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  original_date TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  duration_min INTEGER,
  title TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'skipped')),
  completed_at TEXT,
  completed_step_ids TEXT NOT NULL DEFAULT '[]',
  is_exception INTEGER NOT NULL DEFAULT 0 CHECK (is_exception IN (0, 1)),
  UNIQUE (series_id, original_date)
);

CREATE TABLE reminders (${shared},
  target_type TEXT NOT NULL CHECK (target_type IN ('task', 'routine', 'goal')),
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('relative', 'absolute')),
  offset_min INTEGER,
  at_time TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE routines (${shared},
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  part_of_day TEXT NOT NULL CHECK (part_of_day IN ('morning', 'afternoon', 'evening', 'anytime')),
  start_time TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  category_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  recurrence_rule_id TEXT
);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  enqueued_rev INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'failed')),
  UNIQUE (entity_type, entity_id)
);

CREATE TABLE sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

CREATE TABLE scheduled_notifications (
  notification_id TEXT PRIMARY KEY NOT NULL,
  reminder_id TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  fire_at INTEGER NOT NULL
);

CREATE TABLE occurrence_window (
  series_id TEXT PRIMARY KEY NOT NULL,
  generated_from TEXT NOT NULL,
  generated_through TEXT NOT NULL
);

CREATE INDEX idx_tasks_day ON tasks (owner_id, date, deleted, status);
CREATE INDEX idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX idx_tasks_goal ON tasks (goal_id, milestone_id);
CREATE INDEX idx_occ_day ON task_occurrences (owner_id, date, deleted, status);
CREATE INDEX idx_milestones_goal ON milestones (goal_id, sort_order);
CREATE INDEX idx_reminders_target ON reminders (target_type, target_id);
CREATE INDEX idx_outbox_due ON outbox (state, next_attempt_at);
`;
