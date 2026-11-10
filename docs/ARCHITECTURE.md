# TickTack — Architecture

_VIZAM portfolio concept. Phase 1 (discovery and architecture), 2026-11-09. Status: proposal awaiting Steeven's approval._

TickTack is an offline-first mobile planner (daily planning, calendar, recurring tasks, reminders, routines, goals).
The device's SQLite database is the source of truth for the UI; Firebase Firestore is a per-user sync replica.

## 1. Stack and versions

Versions were read from the npm registry on 2026-11-09. Native module versions are the ones Expo SDK 58 pins in
`expo/bundledNativeModules.json` (checked in `expo@58.0.23`); install them with `npx expo install`, never with a bare
`npm install <pkg>@latest`, and keep `npx expo-doctor` clean.

| Concern | Choice | Version (SDK 58 compatible) | Notes |
|---|---|---|---|
| Runtime | Expo SDK 58, React Native, React | `expo ~58.0.23`, `react-native 0.88.1`, `react 19.3.0` | New Architecture (required by Reanimated 4). Continuous Native Generation: `ios/` and `android/` are generated, not committed. |
| Language | TypeScript, `strict: true` | `typescript ~6.0.3` (SDK 58 template pin) | TS 7.0 exists on npm but the Expo template pins 6.0; stay on the pin. |
| Navigation | Expo Router (file-based, typed routes) | `expo-router ~58.0.30` | Deep links from notifications (`ticktack://task/<id>`). |
| Local DB | `expo-sqlite` | `~58.0.15` | Source of truth. WAL mode, versioned SQL migrations (`PRAGMA user_version`). Web support needs COOP/COEP headers (see risks). |
| State | Zustand | `^5.1.0` | Session, UI and sync-status stores only. Data lives in SQLite; screens read through repository hooks. |
| Validation | Zod | `^4.6.x` | One schema per entity, used for local writes **and** for every document pulled from Firestore (remote data is untrusted). |
| Cloud | Firebase JS SDK (Auth + Firestore) | `firebase ^13.2.0` | Works in Expo Go, dev builds and Expo web. Firestore's own offline cache is **not** used (memory cache only); SQLite + our outbox own offline. |
| Auth persistence | `@react-native-async-storage/async-storage` with `getReactNativePersistence` | `2.2.0` | Verify the `firebase/auth` React Native entry resolves under Metro in phase 2. |
| Calendar UI | `react-native-calendars` (Wix) | `1.1314.0` (Jan 2026; pure JS) | `CalendarProvider`, `ExpandableCalendar`/`WeekCalendar`, `Timeline` for day view. `@howljs/calendar-kit` was considered but its last publish is Oct 2025. Fallback if Timeline misbehaves on RN 0.88: our own timeline on FlashList (see risks). |
| Lists | `@shopify/flash-list` | `2.3.2` | Today, history, goal lists. |
| Animation / gestures | `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler` | `4.7.1`, `0.13.0`, `~3.3.0` | Swipe to complete/reschedule, stacked card transitions. Respect reduced motion. |
| Notifications | `expo-notifications` | `~58.1.8` | Local notifications only (no push server in MVP). |
| Background | `expo-background-task` | `~58.0.12` | Opportunistic sync + reminder reconciliation; never relied on for correctness. |
| Network status | `@react-native-community/netinfo` | `12.0.1` | Triggers sync when back online. |
| IDs | `expo-crypto` `randomUUID()` | `~58.0.7` | Client-generated UUID v4 for every record. |
| Secure values | `expo-secure-store` | `~58.0.2` | Small device secrets (device ID, local DB key if SQLCipher is enabled later). |
| Dates | `date-fns` (+ `@date-fns/tz` if needed) | `^4.4.0` | Own recurrence generator (below); `rrule` is not used (old, larger than our needs). |
| Languages (EN, FR) | `i18next`, `react-i18next`, `date-fns` (`fr` locale) | latest compatible, checked in phase 2 | Device language by default, override in settings; key-parity test. See DESIGN.md section 9. |
| Gradients | `expo-linear-gradient` | per SDK 58 manifest | Day/night header gradients; splash backgrounds are pre-rendered images. |
| Fonts | `@expo-google-fonts/space-grotesk`, `@expo-google-fonts/manrope`, `expo-font` | `0.4.x`, `~58.0.11` | Both SIL Open Font License. |
| Haptics, locale, date picker | `expo-haptics`, `expo-localization`, `@react-native-community/datetimepicker` | `~58.0.7`, `~58.0.5`, `9.2.1` | |
| Tests | `jest-expo`, `@testing-library/react-native`, `better-sqlite3` (Node test driver), `@firebase/rules-unit-testing`, `firebase-tools` | `~58.0.14`, `^14.1.0`, latest, `^6.0.0`, `^15.35.0` | Firestore emulator needs Java 21 (installed on this machine: OpenJDK 21.0.12). Firebase CLI used through `npx`, no global install. |
| Lint / format | ESLint (`eslint-config-expo`), Prettier | per SDK 58 template | |

Not chosen, with reasons:
- `@react-native-firebase/*` (v27): better native performance and Firestore persistence, but needs a dev build and
  native config files (`google-services.json`, `GoogleService-Info.plist`), and does not run on Expo web, which we use
  for screenshots and fast review. We do not need Firestore persistence because SQLite is the source of truth.
- Drizzle ORM (0.45): pleasant typed queries, but adds a code generator and migration tool. Raw SQL migrations plus
  typed repositories validated with Zod keep the data layer small and transparent. Revisit if queries grow.
- Firestore offline persistence: would create a second offline store competing with SQLite.

## 2. Folder structure (created in phase 2)

```
app/                         Expo Router routes (thin: compose feature screens)
  _layout.tsx                providers: theme, db, session, notifications
  (onboarding)/              welcome, permissions primer
  (auth)/                    sign-in, sign-up, reset-password
  (tabs)/                    today, calendar, goals, routines, me
  task/new.tsx  task/[id].tsx  task/[id]/edit.tsx  task/[id]/repeat.tsx
  goal/new.tsx  goal/[id].tsx  routine/[id].tsx
  history.tsx  reminders.tsx  settings/
src/
  domain/                    pure TypeScript, no React or Expo imports
    models/                  Zod schemas + inferred types per entity
    recurrence/              generator, occurrence IDs, series edits
    progress.ts  overdue.ts  schedule.ts
  data/
    db/                      SqlDriver interface, expo-sqlite driver, migrations/NNN_*.sql
    repositories/            one per entity; all writes go through here (validation + outbox enqueue)
  sync/                      outbox, push, pull, mappers (SQLite row <-> Firestore doc), scheduler
  services/                  firebase.ts, auth.ts, notifications/ (permission, reconcile), background.ts
  state/                     Zustand stores: session, ui, syncStatus
  features/                  today/, calendar/, tasks/, goals/, routines/, history/, settings/
  ui/                        theme tokens, primitives (Text, Button, Card, Chip, Sheet, ...)
  lib/                       dates, ids, logger (no task content in logs)
firebase/
  firestore.rules  firestore.indexes.json  firebase.json
tests/                       rules tests (emulator), sync scenarios, seed
scripts/seed.ts              synthetic demo data into local DB and/or emulator
```

Dependency direction: `app -> features -> (ui, state, data, services) -> domain`. `domain` imports nothing from the
app. `sync` depends on `data` and `services/firebase`, never on UI.

## 3. Data model

### 3.1 Conventions (every synced entity)

| Field | Type | Meaning |
|---|---|---|
| `id` | UUID v4 string | Generated on the device. Also the Firestore document ID, so retries never duplicate. |
| `ownerId` | string | Firebase Auth uid (or `local` before sign-in, see auth). |
| `createdAt` | ISO 8601 UTC | Client clock, display only. |
| `clientUpdatedAt` | ISO 8601 UTC | Client clock, display and debugging only — **never** used for conflicts. |
| `serverUpdatedAt` | epoch ms, nullable | Firestore `request.time` of the last accepted write; null until first sync. |
| `deleted` | boolean | Tombstone. Rows are never hard-deleted while sync may still need them. |
| `schemaVersion` | int | Document shape version for forward-compatible pulls. |

Local-only columns on every synced table: `local_rev` (integer, +1 per local write) and `dirty` (0/1).

Dates are **floating local dates**: `date` is `YYYY-MM-DD`, `startTime` is `HH:mm` (24 h), interpreted in the device's
current time zone (what users expect from a planner when they travel). The profile stores the IANA time zone for
reference. Durations are integer minutes.

### 3.2 Entities

**User** (`profile`, one row; Firestore `users/{uid}`)
`id` (= uid), `displayName` (1–60), `timeZone` (IANA), `weekStartsOn` (0 Sun | 1 Mon | 6 Sat), `theme`
(`system|dark|light`), `dayStart`/`dayEnd` (`HH:mm`, workload bar), `dailyCapacityMin` (planned-time budget, default
480), `defaultReminderOffsetMin` (default 10), `onboardingCompletedAt`. Email lives only in Firebase Auth, never in
Firestore.

**Category** — `name` (1–40), `color` (one of the design-token category colours), `icon` (from an allowed icon set),
`sortOrder`, `archived`. One user has many categories.

**Task** — a one-off task, a subtask, or the template of a recurring series.
`title` (1–200), `notes` (0–5000), `status` (`open|done|cancelled`), `priority` (0 none, 1 low, 2 medium, 3 high),
`categoryId?`, `goalId?`, `milestoneId?`, `parentTaskId?` (subtask; one level deep only), `date?` (null = unscheduled
"Later" list), `startTime?` (null = all-day), `durationMin?`, `sortOrder` (within a day), `completedAt?`,
`recurrenceRuleId?` (set = series template; its instances are TaskOccurrences).
Relations: Task 1–n subtasks; Task n–1 Category / Goal / Milestone; Task 0..1 RecurrenceRule; Task 1–n Reminder.

**RecurrenceRule** — belongs to exactly one series (a Task or a Routine).
`seriesType` (`task|routine`), `seriesId`, `freq` (`daily|weekly|monthly`), `interval` (1–99; "every N"), `byWeekday`
(int[] 0–6, weekly only; "selected weekdays"), `byMonthDay` (1–31, monthly), `weekStartsOn` (copied from the profile at
creation so every device computes the same weeks), `startDate`, `endType` (`never|onDate|afterCount`), `endDate?`,
`count?` (1–999). Monthly on a day the month lacks (e.g. 31) clamps to the month's last day (documented, tested).

**TaskOccurrence** — one dated instance of a series.
`id` = `${seriesId}_${YYYYMMDD of originalDate}` (deterministic, see 5), `seriesType`, `seriesId`, `ruleId`,
`originalDate` (the date the rule produced; never changes), `date` (may be moved), `startTime?`/`durationMin?`/
`title?`/`notes?` (per-occurrence overrides, null = inherit), `status` (`scheduled|done|skipped`), `completedAt?`,
`completedStepIds` (string[]; subtasks or routine steps ticked for this day), `isException` (true once the user changed
anything on this occurrence). Only exceptions are synced; plain generated rows are a local, regenerable cache.

**Reminder** — `targetType` (`task|routine|goal`), `targetId`, `kind` (`relative|absolute`), `offsetMin` (relative:
minutes before the start time; all-day items use the profile's morning time), `atTime?` (absolute `HH:mm` on the item's
date, or deadline day for goals), `enabled`. A reminder on a series applies to each occurrence that is not done or
skipped. OS notification IDs are kept in a **local-only** `scheduled_notifications` table, never synced.

**Goal** — `title` (1–120), `description` (0–2000), `targetDate?` (deadline), `status` (`active|achieved|archived`),
`color`, `progressMode` (`milestones|tasks|manual`), `manualProgress` (0–100), `achievedAt?`. Progress is **derived**
(done milestones / all, or done linked tasks / all, or manual), never stored, so it cannot drift. History = timeline of
completed milestones and linked tasks (derived from their `completedAt`).

**Milestone** — `goalId`, `title` (1–120), `dueDate?`, `completedAt?`, `sortOrder`. Goal 1–n Milestone; Milestone 1–n
linked Task.

**Routine** — `title` (1–80), `partOfDay` (`morning|afternoon|evening|anytime`), `startTime?`, `steps`
(array ≤ 30 of `{id, title (1–80), durationMin?}`), `categoryId?`, `active`, `recurrenceRuleId`. Each day's instance is
a TaskOccurrence with `seriesType = routine`; ticked steps are in `completedStepIds`.

**SyncMetadata** (local-only tables)
- `outbox` — `entity_type`, `entity_id` (unique together, so repeated edits coalesce into one entry), `op`
  (`upsert|delete`), `enqueued_rev`, `attempts`, `next_attempt_at`, `last_error`, `state` (`pending|failed`).
- `sync_state` — per collection: `last_pulled_server_ms`, `last_full_sync_at`; global: `device_id`, `bound_uid`.
- `scheduled_notifications` — `notification_id` (deterministic, see 7), `reminder_id`, `occurrence_key`, `fire_at`.
- `occurrence_window` — per series: `generated_from`, `generated_through`.

### 3.3 Relationship sketch

```
User 1─n Category      User 1─n Goal 1─n Milestone
User 1─n Task ─n..1 Category / Goal / Milestone;  Task 1─n Task (subtasks, depth 1)
Task 0..1─1 RecurrenceRule 1─n TaskOccurrence      Routine 1─1 RecurrenceRule 1─n TaskOccurrence
Reminder n─1 (Task | Routine | Goal)                scheduled_notifications n─1 Reminder (local only)
```

## 4. SQLite schema (migration 001, abridged)

```sql
PRAGMA journal_mode = WAL;  PRAGMA foreign_keys = ON;
-- shared columns, written out in every synced table:
--   id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, client_updated_at TEXT NOT NULL,
--   server_updated_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1,
--   local_rev INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0

CREATE TABLE profile (/* shared */, display_name TEXT, time_zone TEXT NOT NULL, week_starts_on INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'system', day_start TEXT, day_end TEXT, daily_capacity_min INTEGER NOT NULL DEFAULT 480,
  default_reminder_offset_min INTEGER NOT NULL DEFAULT 10, onboarding_completed_at TEXT);
CREATE TABLE categories (/* shared */, name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40), color TEXT NOT NULL,
  icon TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE goals (/* shared */, title TEXT NOT NULL, description TEXT, target_date TEXT, status TEXT NOT NULL
  CHECK (status IN ('active','achieved','archived')), color TEXT, progress_mode TEXT NOT NULL, manual_progress INTEGER
  NOT NULL DEFAULT 0 CHECK (manual_progress BETWEEN 0 AND 100), achieved_at TEXT);
CREATE TABLE milestones (/* shared */, goal_id TEXT NOT NULL, title TEXT NOT NULL, due_date TEXT, completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tasks (/* shared */, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200), notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','done','cancelled')), priority INTEGER NOT NULL DEFAULT 0
  CHECK (priority BETWEEN 0 AND 3), category_id TEXT, goal_id TEXT, milestone_id TEXT, parent_task_id TEXT,
  date TEXT, start_time TEXT, duration_min INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
  recurrence_rule_id TEXT);
CREATE TABLE recurrence_rules (/* shared */, series_type TEXT NOT NULL, series_id TEXT NOT NULL UNIQUE, freq TEXT NOT NULL,
  interval INTEGER NOT NULL CHECK (interval BETWEEN 1 AND 99), by_weekday TEXT /* JSON int[] */, by_month_day INTEGER,
  week_starts_on INTEGER NOT NULL, start_date TEXT NOT NULL, end_type TEXT NOT NULL, end_date TEXT,
  count INTEGER CHECK (count IS NULL OR count BETWEEN 1 AND 999));
CREATE TABLE task_occurrences (/* shared */, series_type TEXT NOT NULL, series_id TEXT NOT NULL, rule_id TEXT NOT NULL,
  original_date TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT, duration_min INTEGER, title TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', completed_at TEXT, completed_step_ids TEXT NOT NULL DEFAULT '[]',
  is_exception INTEGER NOT NULL DEFAULT 0, UNIQUE (series_id, original_date));
CREATE TABLE reminders (/* shared */, target_type TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL,
  offset_min INTEGER, at_time TEXT, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE routines (/* shared */, title TEXT NOT NULL, part_of_day TEXT NOT NULL, start_time TEXT,
  steps TEXT NOT NULL DEFAULT '[]' /* JSON */, category_id TEXT, active INTEGER NOT NULL DEFAULT 1, recurrence_rule_id TEXT);

CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  op TEXT NOT NULL, enqueued_rev INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  last_error TEXT, state TEXT NOT NULL DEFAULT 'pending', UNIQUE (entity_type, entity_id));
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE scheduled_notifications (notification_id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL,
  occurrence_key TEXT NOT NULL, fire_at INTEGER NOT NULL);
CREATE TABLE occurrence_window (series_id TEXT PRIMARY KEY, generated_from TEXT NOT NULL, generated_through TEXT NOT NULL);

CREATE INDEX idx_tasks_day ON tasks (owner_id, date, deleted, status);
CREATE INDEX idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX idx_tasks_goal ON tasks (goal_id, milestone_id);
CREATE INDEX idx_occ_day ON task_occurrences (owner_id, date, deleted, status);
CREATE INDEX idx_milestones_goal ON milestones (goal_id, sort_order);
CREATE INDEX idx_reminders_target ON reminders (target_type, target_id);
CREATE INDEX idx_outbox_due ON outbox (state, next_attempt_at);
```

Foreign keys are not declared between synced tables on purpose: pulls can arrive in any order (a milestone before its
goal). Referential integrity is enforced in repositories and orphan rows are hidden, not crashed on. Every write is a
single SQLite transaction that updates the row, bumps `local_rev`, sets `dirty = 1` and upserts the outbox entry.

## 5. Recurrence: bounded generation with stable IDs

- **Pure generator** `occurrencesBetween(rule, from, to): LocalDate[]` in `src/domain/recurrence`. It jumps
  arithmetically to the first candidate at or after `from` (days/weeks/months since `startDate` divided by `interval`),
  so cost depends on the window, not on how old the series is. `afterCount` series count from the start (bounded by
  `count ≤ 999`).
- **Stable IDs:** `occurrenceId = seriesId + "_" + YYYYMMDD(originalDate)`. Any device generating the same rule produces
  the same IDs, so materialising is `INSERT OR IGNORE` and can never duplicate; the `UNIQUE (series_id, original_date)`
  constraint backs this up.
- **Bounded window:** occurrences are materialised only for `[today − 7 days, today + 21 days]` plus the range the user
  is viewing (a month grid is at most 42 days). Hard caps: one request covers at most 62 days and at most 400 rows per
  series. `occurrence_window` remembers what was generated. On app start, generated rows that are not exceptions and lie
  outside `[today − 30, today + 60]` are deleted (they are recomputable).
- **Edit one occurrence:** upsert the occurrence with overrides and `isException = 1` (synced). Moving it changes `date`
  but keeps `id` and `originalDate`. Deleting one occurrence sets `status = skipped` (exception).
- **Edit whole series:** update the template task/routine and/or rule. Untouched generated occurrences from today on are
  deleted and regenerated; past occurrences and completed history stay. Future exceptions whose `originalDate` the new
  rule no longer produces are listed in a confirmation ("2 changed occurrences will be removed") and tombstoned.
- **Stop repeating** sets `endType = onDate, endDate = yesterday` (keeps history). **Delete series** tombstones the
  template, rule, reminders and future exceptions.
- **Missed recurring occurrences** do not pile up as overdue; they show as "missed" in History. The Overdue view lists
  open one-off tasks with `date < today`.
- Edge cases covered by unit tests: DST start/end days, month-end clamping, leap day, interval > 1 across year end,
  `endDate` before `startDate`, `count` reached inside the window, week-start differences, regeneration idempotency.
- Later enhancement (not in MVP): "this and following" edits, implemented as a series split.

## 6. Offline sync: outbox and conflict policy

```
UI action -> repository (Zod validate) -> SQLite transaction [row + local_rev++ + dirty=1 + outbox upsert]
                                                    |
           triggers: app start, foreground, NetInfo online, 2 s after a write, pull-to-refresh, every 5 min in foreground,
                     background task (opportunistic)
                                                    v
     PUSH: due outbox entries -> read current row -> Firestore batch (<= 500 writes, set full doc,
           updatedAt = serverTimestamp()) -> on success clear entry if row.local_rev == enqueued_rev
     PULL: per collection, where updatedAt > (cursor - 60 s) orderBy updatedAt limit 500, page until done
           -> Zod-validate each doc -> apply rules below -> advance cursor to max updatedAt seen
```

- **Order:** push first, then pull, one sync run at a time (mutex). Signed-out or guest mode skips both.
- **Idempotency:** doc ID = record UUID and every push writes the full record, so a retried push is harmless.
- **Conflict policy: last write wins per record, by server timestamp.** Every accepted write carries
  `updatedAt = request.time` (enforced by rules). On pull: if the local row is not dirty, the remote doc replaces it when
  its `updatedAt` is newer than the local `serverUpdatedAt`. If the local row is dirty, the local version is kept; it is
  pushed next and receives a later server timestamp, so it is the last write. All devices converge on the version the
  server accepted last. Consequence (documented for users in Help): an edit made offline wins over an edit made earlier
  on another device once it reaches the server.
- **Tombstones are sticky:** delete = `deleted: true` upsert. Rules refuse any update that turns a tombstone back into
  a live document, so "delete" beats a concurrent edit. Locally, tombstoned rows are hidden immediately and purged 30
  days after their tombstone is confirmed by the server. Server-side purge (Firestore TTL policy on a `purgeAt` field)
  is optional and needs console setup; if enabled, a device whose last pull is older than the TTL does a full resync.
- **Cursor overlap:** the 60 s overlap and `(id, updatedAt)` deduplication cover commit-ordering skew of server
  timestamps.
- **In-flight edits:** an edit during a push bumps `local_rev`; the entry is not cleared and is pushed again.
- **Retries:** exponential backoff (2 s doubling, cap 15 min) for network/unavailable errors. `permission-denied` and
  `invalid-argument` move the entry to `failed` (record kept, sync banner in Me > Sync shows it, retry or discard).
- **Generated occurrences** are never pushed; only exceptions are.
- **Sync status** (Zustand): `idle|syncing|offline|error`, pending count, last success time; shown as a small chip.

## 7. Firestore layout and security rules plan

```
users/{uid}                         profile document
users/{uid}/categories/{id}
users/{uid}/tasks/{id}
users/{uid}/recurrenceRules/{id}
users/{uid}/occurrences/{id}        exceptions only; id = seriesId_YYYYMMDD
users/{uid}/reminders/{id}
users/{uid}/goals/{id}
users/{uid}/milestones/{id}
users/{uid}/routines/{id}
```

Every document stores `ownerId`, `updatedAt` (server timestamp), `clientUpdatedAt`, `deleted`, `schemaVersion` plus the
entity fields in camelCase. Pull queries use the automatic single-field index on `updatedAt`; no composite indexes and no
collection-group queries are needed.

Rules plan (`firebase/firestore.rules`, written in phase 3):
- Default deny for every path not listed.
- `users/{uid}` and `users/{uid}/{collection}/{id}`: `read` only when `request.auth.uid == uid`; `collection` must be
  one of the eight names above.
- `create`/`update`: signed in as `uid`; `request.resource.data.ownerId == uid`; `request.resource.data.id == id`;
  `request.resource.data.updatedAt == request.time`; `keys().hasOnly([...])` per collection; type and size checks
  (title lengths, notes ≤ 5000, enums, `steps.size() <= 30`, `byWeekday` values 0–6, `interval` 1–99); `update` may not
  change `ownerId` or `id`, and may not set `deleted` from true back to false.
- `delete`: owner only (needed for account deletion and tombstone purge).
- Emulator tests (`@firebase/rules-unit-testing` + `npx firebase-tools emulators:exec --only firestore`): owner CRUD
  allowed; user B cannot read, list, create in, update or delete user A's documents; unauthenticated denied; spoofed
  `ownerId`, wrong `id`, client-supplied `updatedAt`, unknown fields, oversized fields, unknown collection and tombstone
  resurrection all denied.

## 8. Notifications and OS limits

- **Permission flow:** an in-app primer explains reminders first; the OS prompt is shown only when the user enables
  reminders (onboarding step or first reminder). Denied: reminders stay saved, a banner links to system settings. Android
  13+ needs the `POST_NOTIFICATIONS` runtime permission; one Android channel `reminders` (high importance) is created at
  start.
- **Deterministic identifiers:** `notificationId = reminderId + "_" + occurrence date`, passed as `identifier` to
  `scheduleNotificationAsync`, so rescheduling is idempotent.
- **Rolling window + reconcile:** compute the desired set (enabled reminders whose fire time is in the next 7 days, items
  not done/skipped/deleted), keep the soonest 50, compare with `getAllScheduledNotificationsAsync()` and
  `scheduled_notifications`, cancel extras, schedule missing. Runs on app start, foreground, after any change to a
  task/occurrence/reminder/rule (delete cancels, edit reschedules), after each sync pull, and in the background task.
- **iOS limits:** at most 64 pending local notifications per app (hence the cap of 50); delivery time is reliable for
  scheduled local notifications, but background execution (`BGTaskScheduler` via `expo-background-task`) runs at the
  system's discretion, with a minimum interval of about 15 minutes, and not at all after the user force-quits the app.
  So the window must be correct whenever the app is foregrounded; reminders beyond the 7-day window appear only after the
  app is opened again (documented in Help).
- **Android limits:** exact alarms on Android 12+ need `SCHEDULE_EXACT_ALARM`, which Android 14+ denies by default for
  newly installed apps; `USE_EXACT_ALARM` is restricted by Google Play policy to alarm-clock and calendar apps. Without
  exact-alarm access, Doze and battery optimisation can delay reminders by several minutes. Plan: ask for exact-alarm
  access only from Reminder settings with an explanation, otherwise accept inexact delivery and tell the user. Phase 4
  verifies how `expo-notifications` on SDK 58 behaves with and without the permission. WorkManager (background task) has
  a 15-minute minimum and may be deferred.
- **Expo Go / web:** local notifications are tested in a development build (`expo-dev-client`), which needs an Expo
  account for EAS builds or a local Android SDK. On web, reminders are disabled with an explanatory empty state.
- Notification tap opens `ticktack://task/<id>?occ=<occurrenceId>` (or routine). Actions "Done" and "Snooze 10 min"
  are a phase 4 stretch goal.

## 9. Authentication and session

- Firebase Auth, **email and password** in the MVP: sign-up, sign-in, sign-out, password reset email. Google and Apple
  sign-in are later (need console setup and, for Apple, a paid developer account).
- **Guest mode (offline-first):** the app is usable without an account; records use `ownerId = local`. On first sign-in,
  the device's guest data is re-owned to the uid in one transaction and queued for upload (UUIDs never collide, so it
  merges with existing cloud data). The user is told this before it happens.
- One account per local database: `sync_state.bound_uid`. Signing in as a different user requires signing out, which
  warns about unsynced changes and then wipes local data (shared-device privacy).
- Session persistence by the Firebase SDK in AsyncStorage (refresh token). Not hardware-encrypted; listed as a risk with
  a possible SecureStore-backed persistence adapter later.
- Account deletion (store requirement): re-authenticate, delete all of the user's documents in batches, delete the Auth
  user, wipe local data. No Cloud Functions needed (they would require the paid Blaze plan).
- Firebase web config values (`EXPO_PUBLIC_FIREBASE_*`) are public identifiers, not secrets; protection comes from the
  rules (and App Check later). They still live in `.env`, never in git.

## 10. Security approach

- Authorization at the data layer: Firestore rules (owner-only, validated shapes, server timestamps), tested in the
  emulator; local repositories always filter by the bound owner.
- All input validated with Zod at the repository boundary; pulled documents validated before they touch SQLite; invalid
  remote docs are skipped and counted, never crash the app.
- Parameterised SQL only (no string-built queries).
- Logs: no titles, notes or emails; errors carry entity type and ID only.
- Local data is unencrypted SQLite in the app sandbox. Option for later: `expo-sqlite` SQLCipher build with a key in
  SecureStore.
- `npm audit` reviewed every phase; dependencies installed through `npx expo install`.
- Synthetic seed data only. The app is labelled "VIZAM portfolio concept" in onboarding and About.

## 11. Testing approach

| Layer | Tooling | What |
|---|---|---|
| Domain | Jest (jest-expo, node env) | Recurrence generator and edge cases, occurrence IDs, series edits, progress, overdue, workload |
| Data | Jest + `better-sqlite3` behind the `SqlDriver` interface | Migrations apply cleanly, repositories validate, transactions bump rev and enqueue |
| Sync | Jest with an in-memory fake remote and fake clock | Offline create then sync, retry idempotency, coalescing, LWW cases, sticky tombstones, in-flight edit, cursor overlap |
| Rules | `@firebase/rules-unit-testing` + Firestore emulator | Owner-only access and validation matrix from section 7 |
| Notifications | Jest with mocked `expo-notifications` | Reconcile diff, 50 cap, cancel on delete, reschedule on change |
| UI | React Native Testing Library | Today, task create/edit, recurrence sheet, goal detail: states (loading, empty, error, success) and accessibility labels |
| Visual | Expo web + Playwright screenshots at 390 x 844, light and dark | Every finished screen, looked at before reporting |
| Health | `npx expo-doctor`, `tsc --noEmit`, ESLint, `npm audit` | Every phase |

Contrast of every text/background token pair is asserted in a unit test (WCAG AA 4.5:1, large text 3:1).

## 12. Risks and open questions

1. **Name:** "TickTack" is very close to the existing to-do app "TickTick". Acceptable for an internal concept label,
   but a public store listing could cause confusion or a trademark complaint. Needs Steeven's decision.
2. `expo-sqlite` on web (used for screenshots) runs on WebAssembly and needs `Cross-Origin-Opener-Policy` /
   `Cross-Origin-Embedder-Policy` headers on the dev server; phase 2 verifies, fallback is an in-memory seeded DB on web.
3. `react-native-calendars` Timeline under RN 0.88 New Architecture is unverified; phase 2 spikes it. Fallback: a small
   own timeline (FlashList + absolute-positioned blocks).
4. Firebase JS SDK auth persistence entry point under Metro: verify in phase 2.
5. Android exact alarms (section 8): product decision on how hard to push the permission.
6. Firestore free-tier quotas are ample for a demo; the pull design (cursor queries, no listeners in MVP) keeps reads low.
