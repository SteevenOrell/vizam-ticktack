# Agent handoff — TickTack (VIZAM portfolio concept)

_Last updated: 2026-11-11 (local time) by vizam-fullstack-developer, phase 6_

## Objective
Offline-first mobile planner (Today, calendar, recurring tasks, reminders, routines, goals) built with Expo, SQLite as
local source of truth and Firebase (Auth + Firestore) for sync. Portfolio concept with its own identity.

## Repository
- Path: `C:\Users\SteevenWemin\Documents\Projects\vizam-ticktack`. Phase 3 worked in the git worktree
  `.claude\worktrees\agent-aba205330a87c29fb`. Remote: none (not pushed, no GitHub repo).
- Branch: `feat/phase-3-core`, based on `feat/phase-2-foundation` (`70e1b00`). Commits: domain/data layer, sync +
  rules, app screens, then QA fixes + screenshots + docs (see `git log --oneline 70e1b00..`).
- **Feedback round:** branch `feat/phase-3-feedback` from `feat/phase-3-core` (`7b87309`), worked in worktree
  `.claude\worktrees\agent-afa7a168a88ba218c`. Commits: data layer, theme/splash, task UI, then fixes + docs +
  screenshots (`git log --oneline 7b87309..`). Not pushed, not merged.
- **Goals round (second feedback):** branch `feat/phase-3-goals` from `feat/phase-3-feedback` (`136967d`), worked in
  worktree `.claude\worktrees\agent-a976d2411a03e53b9`. Commits: goal data layer + rules, goals UI + reminders + swipe
  + keyboard, docs + screenshots (`git log --oneline 136967d..`). Not pushed, not merged.
- **Step 0, goal repeats must end:** based on `feat/phase-3-goals` (`76dfedd`). The agent's harness pinned it to its
  own worktree `.claude\worktrees\agent-ab6e3c45cb9a9e728`, so the commits are on the branch
  `worktree-agent-ab6e3c45cb9a9e728` (`git log --oneline 76dfedd..`), not yet on `feat/phase-3-goal-repeats` (still at
  `76dfedd`, checked out in worktree `agent-a976d2411a03e53b9`). To bring it over, in that worktree: delete its
  untracked `docs/PROJECT_PLAN.md` (the committed copy replaces it), then
  `git merge --ff-only worktree-agent-ab6e3c45cb9a9e728`. Not pushed, not merged.
- **Phase 4a, task views:** based on the step 0 tip (`5f656be`). Worked in worktree
  `.claude\worktrees\agent-a0945abd2988561f4`, commits on its branch `worktree-agent-a0945abd2988561f4`
  (`git log --oneline 5f656be..`); the orchestrating session moves them onto `feat/phase-4a-task-views`. Not pushed.
- `docs/PROJECT_PLAN.md` is the approved remaining plan (step 0 and 4a ticked).

## Phase 6: delivery (2026-11-11) — done
Branch `feat/phase-6-delivery` from `a0c4d6b` (phases 4c, 5a, 5b merged), worktree `.claude\worktrees\phase-6`. Not
pushed, not merged. Documentation only; no code, rules or EAS command touched or run.
- **New:** `README.md` (features, stack, architecture, setup with env var names, Expo Go and dev build commands, tests,
  rules deploy, structure, doc links), `docs/SECURITY_SUMMARY.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/RELEASE.md` (EAS
  preview, APK install, merged phone checklist, Play Store steps), `docs/PORTFOLIO.md` (case study, numbers, screenshots).
- **Numbers used:** jest 701 tests / 40 suites and rules 71 tests come from the phase 6 brief (not rerun here).
- **Left for Steeven:** (1) phone checks in the dev build (`docs/RELEASE.md` section 2); (2) console hardening: deploy
  the Firestore rules, App Check, API key restriction, budget alert, email enumeration protection
  (`docs/SECURITY_SUMMARY.md`); (3) review and merge the branches into main.

## Phase 5b: UI QA and verification (2026-11-11) — done
Branch `feat/phase-5b-qa` from `1d52b91`, worktree `.claude\worktrees\phase-5b`. Not pushed. Phase 5a (rules, limits,
sign-out wipe, guest migration, sync) is a separate branch; this one touches no `firebase/`, `src/data/sync*`, auth,
migration or Zod model files. Full report: `docs/QA_REPORT.md`.
- **Screens vs DESIGN.md:** `scripts/screenshots-5b.mjs` shoots 20 screens x 390 / 1440 px x light / dark x EN / FR
  (160 webp + contact sheets + `report.json` in `docs/screenshots/phase-5b/`). Fixed: tab labels lost their descenders
  (line height 20, bar 62 dp), task meta line wraps instead of cutting French names, select fields take two lines
  ("Toute la journée"), stack-screen action lines up with the 20 px padding, French goal progress plural ("1 faite").
- **Layout sweep:** 150 page loads (15 routes x 5 widths x EN / FR): 0 px horizontal overflow at 300 / 390 / 768 / 1440,
  `#root` is 500 px at 240 px on all 30 loads, no console error or warning in 160 shots + 150 loads.
- **i18n:** parity test already existed; added "no English left in French" (allow-list of 20 identical words) and the
  French plural check. No missing key and no untranslated value was found.
- **Flaky hunt:** 4 green baseline runs (parallel x2, `--runInBand`, 8 busy cores), the earlier failure did not
  reproduce. Hardened `waitFor` 5 to 15 s and per-test 30 to 60 s. Final: 3 green runs of 646 tests / 37 suites
  (parallel 166 s, `--runInBand` 280 s, parallel under 8 busy cores 462 s).
- **`screenshots-feedback.mjs`:** one `splash` shot (the day / night pair was identical since the logo splash).
- **Checks run here:** `npx tsc --noEmit` exit 0; full `npx jest` 3 of 3 green; `npx expo lint` and Prettier see
  `docs/QA_REPORT.md` section 6.
- **Kept WARNs (reasons in the report):** wide-screen tab bar not clamped to the 720 px column, intended ellipses
  (note excerpt, week-grid block titles), 240 px pan by design, no real-device check yet.
- **Machine notes:** the Metro watcher still misses edits in this worktree (restart with `--clear`); the screenshot run
  takes about 25 minutes cold; a bash `sleep` over 170 s is moved to the background by the tool.

## Phase 4c: settings, states, accessibility (2026-11-11) — done
Branch `worktree-agent-a53e11d683f610f2a`, stacked on `e1101bc` (tip of `feat/phase-4-feedback`). Not pushed.
- **Settings (Me tab):** week start (Monday / Sunday) and daily capacity (stepper, 30 min, 0-24 h) are saved in the
  synced `profile` row (`weekStartsOn`, `dailyCapacityMin`; they follow the account). `usePlanning()` /
  `useWeekStartsOn()` (`src/features/settings/usePlanning.ts`) replace the language default in the calendar, week
  views, task / routine / goal editors and History; the language default (fr Monday, en Sunday) only applies until
  the profile is read. Capacity was already read by the Today workload bar. Day start / end stay a read-only device
  preference. Data layer: `src/data/settings.ts`.
- **Categories:** pushed screen `/settings/categories` (`CategoriesScreen`): add, rename, recolour, delete.
  Duplicate names (case-insensitive) and empty names are refused; delete asks where the tasks and routines go
  (another category or "No category") and then tombstones the category (synced).
- **Failed sync:** pushed screen `/settings/sync` (`FailedSyncScreen`), linked from Me > Account when `failed > 0`:
  entity type, title, error text, Retry (one or all) and Discard (confirm). Discard drops the outbox entry and clears
  the row's `dirty` flag; the item stays on the device and a newer server copy may replace it on the next pull.
- **Reminders section in Me:** notification state, and on Android the exact-alarm note with "Ring on time" (explains,
  then opens the system "Alarms & reminders" screen through the existing `requestExactAlarm`); denied notifications
  get "Open settings".
- **History:** `getHistory` now includes completed routine runs (a not-done routine run is never "missed").
  Routine rows on Today now open the routine screen when tapped (they had no press action, so a screen reader could
  not reach them).
- **States:** the main screens already used `AsyncContent` / `EmptyState` / `ErrorState`; `tests/ui/states4c.test.tsx`
  now proves loading, error-with-retry-that-recovers and empty for 8 screens. Editors whose item is gone show
  "Close" instead of "Try again" (`ErrorState actionLabel`).
- **Accessibility:** long-press menu has "Move 15 minutes earlier / later" for timed tasks (`nudgedTime` in
  `src/domain/reschedule.ts`; the timeline's screen-reader actions use the same helper); compact buttons are now
  44 px tall (was 40); contrast tests extended (more pairs on the page background, category swatch check marks);
  `tests/ui/a11y4c.test.tsx` checks that every pressable on 8 screens has a role and a name.
- **Demo seed:** its profile week start now follows the language (it was always Monday).
- **Not done (by instruction):** "Tomorrow / Pick date" swipe actions, haptics. Day start / end editing.
- **Screenshots:** `docs/screenshots/phase-4c/` (390 px, 2x, light-en, dark-en, light-fr: settings planning / changed /
  reminders, categories, categories edit sheet, history empty, failed sync empty, history with a routine run).
  Script `scripts/screenshots-4c.mjs`. The failed-sync list with items is covered by tests only (no way to create a
  failed outbox row in the web demo).

### Phase 4c checks (run here, 2026-11-11)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Tests | `npx jest` | 37 suites, 644 tests passed |
| Lint | `npx expo lint` | no output (clean) after fixing one error and one warning |
| Format | `npx prettier --check --end-of-line auto src tests scripts` | clean |
| Web screenshots | `node scripts/screenshots-4c.mjs` | 24 images, 0 px horizontal overflow, no console errors printed |
New tests: `src/data/__tests__/settings.test.ts` (12), `tests/ui/phase4c.test.tsx` (9), `tests/ui/states4c.test.tsx`
(24), `tests/ui/a11y4c.test.tsx` (9), `nudgedTime` (2), history routine (1), contrast (+13).
Known gap: `.expo/types/router.d.ts` is not generated in this worktree, so `router.push('/settings/...')` is not
route-type checked here; regenerate with `CI=1 timeout 90 npx expo start --port 8097` and rerun `npx tsc --noEmit`.

### Check on the phone (Expo Go, Steeven)
1. Me > Planning: switch week start to Monday: Calendar week / month start on Monday; New task > Repeat weekly lists
   weekdays from Monday; a new weekly goal's period starts Monday. Change capacity: Today's workload bar changes.
2. Me > Categories: add, rename, recolour (check Today rows and Calendar blocks update), delete one that has tasks
   (move to another / none) and confirm the tasks changed.
3. Me > Reminders on Android: with exact alarms off, "Ring on time" explains and opens Alarms & reminders.
4. Complete a routine (Today tick or the runner): History lists it under today.
5. Long-press a timed task: "Move 15 minutes earlier / later" works; with TalkBack / VoiceOver on, the timeline block
   offers move earlier / later / Quick edit in the actions menu.
6. Failed-sync list: only testable with a failing write (needs the real project with old rules); otherwise Me shows
   no "Review failed changes" button.

## Phase 5a: security and data QA (2026-11-11) — done
Branch `feat/phase-5a-security` from `12950a3`, worktree `.claude\worktrees\phase-5a` (Opus). Commits:
`05dfd55` rules + models, `8a6a089` sync, `34d7b6c` account flows, then docs. Not pushed. Full write-up with
finding / severity / fix / test: `docs/SECURITY_REVIEW.md`. Ran in parallel with 4c (UI, Settings untouched; the
only shared file is `src/features/session/SessionProvider.tsx`, two small additions).
- **Rules changed: Steeven must redeploy `firebase/firestore.rules`.** Timestamps (`createdAt`, `clientUpdatedAt`,
  `completedAt`, `achievedAt`, `onboardingCompletedAt`) must be ISO date-times (`isIso`). App data already complies.
- Models (`src/domain/models/index.ts`): `ISO_DATETIME_RE`; goal cross-field checks (`superRefine`, same as the
  rules); category names single-line. `limits.test.ts` pins every limit against the rules.
- Sync (`src/sync/engine.ts`): rows failing their schema are marked `failed` with `last_error = 'invalid-local'`
  and no longer abort the run; non-network errors give up after `MAX_RETRY_ATTEMPTS` (10); network codes
  (`NETWORK_CODES`) retry forever; entries scheduled by a clock that moved back are due now; the profile is held back
  until the first pull on the device (`sync_state.pulled_once`) and a never-synced local profile loses to the cloud
  one (fixes the account profile being overwritten by device defaults on sign-in); after that first pull
  `src/data/mergeCategories.ts` merges same-name categories (guest starters vs the account's).
- **For 4c's failed-sync list:** shape unchanged (`outbox.state = 'failed'`, `last_error` = Firestore code), one new
  `last_error` value `'invalid-local'` (local row damaged, never sent; retry cannot help, discard or edit).
- Account (`src/services/accountFlows.ts`): `FlowDeps.clearDevice` (wired to `cancelAllReminders` in
  `useFlowDeps`) cancels every `tt_` OS notification after the wipe on sign-out and account deletion; the sync status
  store is reset; `clearSignedOutDevice` wipes a database still bound to an account when Auth reports no user
  (called by `SessionProvider`; guest data is never bound, so kept).
- Open (console, Steeven): App Check, API key restrictions, budget alert, email enumeration protection.
- npm audit `--omit=dev`: 0 high / 0 critical, 21 moderate + 1 low, all tooling (glob, minimatch, deepmerge via Expo
  CLI and Jest); fixes are major downgrades, none applied. Secrets: none tracked, none in history, `.env` ignored.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass (exit 0) |
| Lint | `npx expo lint` | pass (exit 0) |
| Format | `npx prettier --check --end-of-line auto <changed files>` | pass |
| Tests | `npx jest` | pass, 36 suites, 629 tests (574 before; +55) |
| Rules + sync | `npm run test:rules` (`JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\t`) | pass, 2 suites, 71 tests (64 before; +7). Flaky under load: the first sync test (`uploads from one device...`) timed out / pushed 0 in 3 runs while other agents were using the machine; the same suite passed alone and the final full run passed |

## New logo and splash (2026-11-11, on top of `86f6514`)
Concept A "dart in the bullseye" (see `docs/DESIGN.md` section 1 and Splash). Source `assets/brand/logo-target.svg`;
`npm run render:brand` renders `icon`, `android-icon-foreground`, `android-icon-monochrome`, `favicon`, `splash-icon`
(PNG, Expo needs PNG). `src/ui/brand/LogoMark.tsx` replaces the old `Wordmark`/`wordmarkData` (deleted, with the day
and night splash images and `splash-wordmark.png`). `AppSplash` is charcoal + logo + "TickTack" text (no `period`
prop, no tagline); native splash is the logo alone (`app.config.ts`). Onboarding header shows the mark on a charcoal
tile plus the name. The splash colour tokens `splashInk`/`splashStops` were removed. Screenshots:
`scripts/screenshots-brand.mjs` -> `docs/screenshots/phase-4-feedback/`. Only a phone or dev build can confirm the
native splash (Expo Go shows its own).

## Calendar swipe fix (Steeven's phone test, 2026-11-11), on top of `86f6514`
- **Bug:** swiping day / week / month "glitches" and the new page does not come back to the top.
- **Cause 1 (glitch):** `useQuery` went to `loading` on every new range, so `AsyncContent` swapped the pager for the
  skeleton mid-slide (pager unmounted, fresh offset 0) and then remounted it. The slide-in also set its offset before
  React had rendered the new page, so the old page flashed back from the other side.
- **Fix:** `useQuery(query, { keepPrevious: true })` keeps the last result (flag `stale`); `CalendarScreen` renders the
  loaded page (`shown`) until the next page's data is in; `SwipePager` slides the old page out, swaps the content off
  screen and enters only when the parent renders a new `pageKey` (layout effect; 2 s safety timer). Arrows, Today and
  taps outside the page go through `pagerRef.go()`, so they slide the same way. Paging maths in
  `src/features/calendar/paging.ts`.
- **Cause 2 (scroll):** week and month never reset the scroll, and `KeyboardAwareScrollView` re-created its
  imperative handle every render, so the header's scroll ref was empty in a child's layout effect. Handle now made
  once (`[]` deps). Week and month pagers pass `resetScroll` (screen to top); day and the tablet week grid keep their
  own scroll: to now on today, otherwise one hour above the first item (8:00 if none).
- **Changed behaviour:** the week agenda and the month day preview are now inside the pager (they slide with the
  strip / grid). A horizontal swipe on a task row still opens the row's Edit / Delete, not the next page.
- **Check on the phone (Expo Go):** swipe day, week and month both ways several times: no blank flash, no old page
  coming back; scroll down in week or month, swipe: the screen is at the top; arrows and Today slide the same way;
  long-press drag a block on the day timeline still moves it; vertical scroll still works when the drag starts
  sideways a little.

## Phase 4b: DONE (2026-11-10), except the on-phone check, which needs a dev build
Three rounds: groundwork (worktree `agent-a342ec3a40fcf3473`), screens (`agent-a05dd6cfd6764550f`, tip `76dff9b` on
`feat/phase-4b-routines-reminders`), then the native and security round (worktree `agent-afdbc8d116b636c6b`, branch
`worktree-agent-afdbc8d116b636c6b`, six commits on `76dff9b`: `git log --oneline 76dff9b..`; the orchestrating
session moves them onto the feature branch). Not pushed.

**Screens round (Sonnet).** Milestones editor + checklist ("n of m"; the goal percentage stays task-based), routine
routes `src/app/routine/{new,[id],edit/[id]}.tsx`, `RoutinesScreen`, `RoutineScreen`, `RoutineRunner`,
`RoutineEditorScreen` (delete with Undo), `features/goals/ItemReminderField.tsx` in the task and routine editors,
`TaskDetail.reminder`; tests in `src/data/__tests__/{milestones,routines}.test.ts`,
`src/domain/__tests__/routineRun.test.ts`, `tests/ui/{milestones,routines}.test.tsx`. Cosmetic: `TimeSelect` shows
"All day" as the empty option for a routine start time.

**Native and security round (Opus).**
- Reminders at runtime: `maintainGoals` moved to `src/services/notifications/maintenance.ts` (no router import, so
  the background task reuses it) and now runs `hasAnyReminder` + `rescheduleReminders` with the locale clock
  (`formatClock`) and the exact-alarm state; task and routine reminders are scheduled, replaced (moved / edited) and
  cancelled (done / deleted) within the 7-day window and the 50 cap. `useGoalMaintenance.ts` keeps the hook.
- Taps: `tapRoute.ts` (`reminderPayload` / `reminderRoute`, ids checked against the id alphabet, an occurrence must
  start with `<taskId>_`); `/task/details/[id]?occ=`, `/routine/[id]`, `/goal/[id]`; old payloads with only `goalId`
  still route; the cold-start response opens once per process. Strings `notifications.task*` / `routine*` (EN/FR).
- Exact alarms (Steeven: ask users): `android.permissions: [SCHEDULE_EXACT_ALARM]` in `app.config.ts` (confirmed
  in the introspected manifest); adapter `getExactAlarmState` / `requestExactAlarm` in `expoNotifications.ts` around
  `resolveExactAlarm`; `ItemReminderField` explains "Alarms & reminders" (EN/FR, `reminders.exact*`) right after
  notifications are allowed, and keeps a note with "Ring on time" while access is missing. Fallback: same
  `bestEffort` trigger, approximate delivery; Expo Go and builds without the permission never open the setting.
  The goal reminders editor (`RemindersEditor`) does not show the exact-alarm note (goal reminders use the same
  scheduler, so they become exact once access is granted from a task or routine).
- Background task: `expo-background-task` ~58.0.12 + `expo-task-manager` ~58.0.13 (`npx expo install`), plugin
  `expo-background-task` in `app.config.ts`. `src/services/background/maintenanceTask.ts` (pure parts, tested) and
  `defineTasks.ts` (module-scope `defineTask`, imported first thing in `src/app/_layout.tsx`). Registered once the
  data context is ready (`minimumInterval` 60 min). Alive app: sync, then maintenance on the live context. Cold run:
  opens and migrates the database, plans for the owner recorded locally (`sync_state` key
  `device.maintenanceOwner`, never synced); no sync without a signed-in session. Expo Go and web: nothing defined or
  registered, foreground upkeep unchanged. `jest.setup.ts` mocks both modules as "restricted".
- Rules: 19 new emulator tests (owner writes as the app makes them, 15 malformed documents, cross-user get / query /
  create / edit / delete / spoofed owner for `milestones`, `routines`, `reminders`). **`firestore.rules` unchanged,
  no redeploy needed for this round.** Note: routine step entries are only counted (≤ 30), not shape-checked; owner
  data only, not a cross-user gap.
- Dev build prep: `eas.json` (development = dev client, internal APK; preview; production) and `expo-dev-client`
  ~58.0.18. No `eas` command was run. A cloud build needs the `EXPO_PUBLIC_FIREBASE_*` values as EAS environment
  variables ("plain text"/config visibility), because `.env` is git-ignored and not uploaded.
- Not done: routine runs in History (`getHistory` still filters `series_type = 'task'`); screenshots of the new
  note and dialog (web shows reminders as unavailable, so they only appear on a phone).

**Verify on the phone (dev build only; Expo Go cannot show these).**
1. Android 14+: turn on a task reminder, allow notifications; the "Ring reminders on time?" dialog appears; "Open
   the setting" opens Alarms & reminders; allow TickTack, come back: the "may arrive late" note is gone.
2. Same with "Not now": the note stays; the reminder still arrives (possibly a few minutes late).
3. A task at now + 20 min with "10 min before": the notification arrives on time (exact access on); tap it with the
   app killed: the task's details open (for a repeating task, that day).
4. A routine reminder: tap opens the routine screen. A goal reminder still opens the goal.
5. Move the task to tomorrow / mark it done / delete it: the pending notification moves / disappears
   (`adb shell dumpsys alarm | grep ticktack` or wait for the old time).
6. Background task: no in-app trigger exists yet; `BackgroundTask.triggerTaskWorkerForTestingAsync()` (debug builds
   only) can be called from a temporary dev button, or leave the phone a day and check that a daily task's reminder
   for the new 7th day was added without opening the app. iOS runs it at the system's discretion.
7. Revoke Alarms & reminders in system settings: Android restarts the app; reminders keep arriving (inexact) and
   the note returns.

**Checks this round (2026-11-10, worktree `agent-afdbc8d116b636c6b`).**
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` (typed routes regenerated with `CI=1 timeout 90 npx expo start --port 8098`) | pass |
| Lint | `npx expo lint` | pass (0 problems) |
| Format | `npx prettier --check --end-of-line auto .` | pass |
| Tests | `npx jest` | pass, 31 suites, 578 tests (547 before; +31) |
| Rules + sync | `npm run test:rules` (`JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\t`) | pass, 2 suites, 64 tests (45 before) |
| Expo doctor | `npx expo-doctor` | pass, 20/20 |
| Android bundle | `npx expo export --platform android` (to a temp dir) | pass, 9.5 MB Hermes bundle |
| npm audit | `npm audit --json` | 0 high / 0 critical; 28 moderate + 1 low (same tooling advisories) |
**Incident (agent error, reported to Steeven).** While editing this handoff, a shell quoting mistake made bash run
two commands quoted in the text: `npx eas-cli@latest build --profile development --platform android\` and
`npx expo start --tunnel --clear\`. Both stopped on argument parsing before doing anything ("Expected
--platform=android\ to be one of: android, ios, all", "Error: build command failed"; "unknown or unexpected option:
--clear\"). No build was queued, no EAS project was created or linked, `git status` showed no config change. npx
downloaded eas-cli 27.7.2 into its cache.

Flaky once: running `tests/ui/routines.test.tsx` in parallel with another suite on this machine failed 4 tests on
timeouts; alone and in the full run it passes.

**Finding: no migration is needed.** Migration 001 already has `milestones`, `routines`, `reminders` tables, the
entity map, Zod models and Firestore rules (`milestoneOk`, `routineOk`, `reminderOk`) for them. A routine run is
stored on the day's occurrence (`seriesType = 'routine'`, `status`, `completedAt`, `completedStepIds`).

**Groundwork round (data and scheduler; tested in the later rounds).**
- `src/data/milestones.ts`: drafts, `syncMilestones` (order = `sortOrder`, create / update / tombstone),
  `setMilestoneDone`, `removeMilestones`, `milestoneProgress`, `moveItem`. `src/data/goals.ts`: `GoalDraft.milestones`
  (optional, undefined keeps), saved in `createGoal` / `updateGoal`, removed in `deleteGoal`, loaded by
  `loadGoalForm`, `GoalDetail.milestones` + `milestoneProgress`. Decision: the percentage stays task-based;
  milestones are a separate "n of m".
- `src/data/reminders.ts`: one `reminders` row per task or routine (`offsetMin` before the start time, `atTime` on
  untimed days; `kind` = relative when timed). `src/data/tasks.ts`: `TaskDraft.reminder` (null = none, undefined
  keeps), written by `insertTask` and every `updateTask` branch except "this occurrence"; a split or
  stop-repeating copy inherits it; `loadTaskForm` returns it. `deleteTask` already tombstoned reminders.
- `src/data/routines.ts`: `routineDraftSchema` (a routine always repeats, at least one step), `createRoutine`,
  `updateRoutine` (regenerates from today, keeps days that hold a run), `deleteRoutine`, `recordRoutineRun` (done
  when at least one step was done; an unplanned day gets its own occurrence), `getRoutineList`,
  `getRoutineDetail` (last 7 runs), `loadRoutineForm`.
- `src/domain/routineRun.ts`: pure run state machine (start, pause, resume, done, skip, back, finish; time derived
  from event timestamps), `summarizeRun`, `formatTimer`.
- `src/services/notifications/plan.ts`: `PlannedNotification.goalId` replaced by `targetType` / `targetId` /
  `occurrenceId`; `planItemNotifications` (ids `tt_<itemKey>_<task|routine>`, so a moved item replaces its
  notification), `capPlan`. `scheduler.ts`: `loadItemReminderInputs`, `planReminders` (goals + items capped
  together at 50 in the 7-day window), `rescheduleReminders` (`rescheduleGoalReminders` kept as an alias),
  `hasAnyReminder`, `exact` recorded in the stored fingerprint so a permission change reschedules.
  `exactAlarm.ts`: `resolveExactAlarm` (notNeeded / granted / askable / unavailable). `expoNotifications.ts`: only
  the data payload changed.

**SDK 58 facts already checked (versioned docs + installed types), so the next agent need not refetch.**
- Exact alarms: declare `android.permission.SCHEDULE_EXACT_ALARM` with `android.permissions` in the app config;
  `Notifications.getExactAlarmPermissionsAsync()` (`canAskAgain: false` when the build does not declare it; always
  granted on iOS) and `requestExactAlarmPermissionsAsync()` (opens the system screen, rejects when not declared; if
  the user revokes there Android restarts the app and the promise never resolves). Keep `delivery: 'bestEffort'`
  (default): it is exact once access is granted; `'alarmClock'` shows an alarm icon per pending reminder.
- Play policy note for delivery: `SCHEDULE_EXACT_ALARM` is user-granted and denied by default on Android 14+, and
  Play expects the Console declaration to justify it; `USE_EXACT_ALARM` is auto-granted but restricted by Play to
  alarm-clock, timer and calendar apps, so it was not chosen.
- Background: `expo-background-task` (`registerTaskAsync(name, { minimumInterval })` in minutes, 15 min minimum,
  `BackgroundTaskResult.Success / Failed`), task defined with `TaskManager.defineTask` at module scope in an
  early-loaded file. Not available in Expo Go (it warns): guard with `isRunningInExpoGo()` from `expo`.


## Phase 4a: task views (2026-11-10) — done
1. **Task details** (`src/features/tasks/TaskDetailScreen.tsx`, route `src/app/task/details/[id].tsx`, `?occ=` for an
   occurrence; read model `getTaskDetail` in `src/data/queries/agenda.ts`). Tapping a row or a calendar block now
   opens details (`TaskActionsApi.open`); the editor is `TaskActionsApi.edit` ("Open full editor" in the "⋯" menu,
   "Edit" on the details screen). Shows time, date, duration, status, category, priority, repeat summary
   (`repeatSummary.ts`), tickable subtasks, notes, goal card (opens the goal), reminders placeholder. Actions: Edit,
   Mark done / not done, Reschedule (quick-edit sheet), Delete (scope dialog for series, Undo 5 s). After a delete
   the screen closes itself; it also closes when an edit moved the occurrence to another series.
2. **Drag to reschedule** (`src/features/calendar/DayTimeline.tsx`, pure maths in `src/domain/reschedule.ts`, write
   in `rescheduleTime` in `src/data/tasks.ts`). Long press (350 ms) arms the drag, the block then captures the moves
   (`PanResponder` capture phase) and `HeaderScreen` freezes its scroll (`useHeaderScroll().setScrollEnabled`);
   before the long press nothing is claimed, so scrolling over a block still works. Snaps to 5 minutes, stays inside
   the day. Repeating tasks ask this / following / all (`move-scope-*`). A long press without a move opens the row
   menu as before. Non-drag ways: accessibility actions "Move 15 minutes earlier / later" and "Quick edit" on every
   block, the row menu, and Reschedule on the details screen.
   - `rescheduleTime` goes through `updateTask` (validation, outbox, step 0 rule). It never changes the repeat
     settings and leaves the goal link as stored, so a goal-linked series that breaks the rule (older data) is
     refused with `GoalRepeatError` for "following" / "all" and the calendar shows the message; "this occurrence"
     stays possible. "All" also clears the dragged occurrence's own start time so it follows the series.
3. **Overdue and history** (`OverdueScreen.tsx`, `HistoryScreen.tsx`, routes `/overdue` and `/history`, read models
   `getOverdue` and `getHistory`). **Entry points: two link chips in the Today header** ("Overdue · n", "History");
   DESIGN.md and MILESTONES.md did not name any. Overdue = open one-off tasks before today (same definition as the
   Today group), oldest first, with "Move to today", "Mark done" and "Move all to today". History = tasks and
   occurrences completed in the last 60 days, filed under the local day they were completed, plus occurrences of
   repeating tasks missed in the last 30 days (label "Missed"); filters All / Done / Missed; "done this week"
   numeral; unticking restores. Both screens have their own undo bar (`UndoSnackbar` is otherwise in the tab layout).
4. **Week hour grid** from 768 pt (`WeekGrid` in `DayTimeline.tsx`, `useWide()` in `src/ui/Centered.tsx`;
   `CalendarScreen` takes a `wide` prop for tests): seven lanes on the shared hour grid, header of weekday + date
   per column, untimed chips row, same blocks and drag. Phones keep the stacked week.
5. **Desktop maximum width** (`src/ui/Centered.tsx`, tokens `contentWidth` and `WIDE_BREAKPOINT` in
   `src/ui/theme/layout.ts`): 720 pt column, 1120 for the week grid; applied in `HeaderScreen` (all tab and auth
   screens), `StackScreen` (new pushed screens), task editor, goal editor, goal detail, onboarding. DESIGN.md had no
   number; the values are recorded there now (section 5).
No migration, no Firestore rules change, no sync change, no new dependency.

## Step 0: repeating tasks in a goal must end (2026-11-10) — done
**Rule.** A repeating task linked to a goal may not repeat forever and may not run past the goal's _limit_: the due
date of a one-time goal, the end of the current period of a periodic goal (`repeatLimitOf` = `dueDateOf`). A one-time
goal without a due date (created by name in the task editor) has no limit, but the repeat still needs an end.
Pure logic in `src/domain/goals.ts`: `lastRepeatDate`, `goalRepeatIssue`, `clampRuleToGoal`, `defaultRepeatEnd`.

**Decisions (simplest consistent behaviour).**
1. Task side validates, goal side clamps, nothing prompts.
   - Saving a task (`createTask` / `updateTask` in `src/data/tasks.ts`): "never" on a goal-linked draft is a Zod issue
     (`repeatNeverInGoal`); an end after the limit throws `GoalRepeatError` (`issue: 'repeatNeverInGoal' |
     'repeatAfterGoalEnd'`, in `src/data/goalBase.ts`) inside the transaction, so nothing is written. Checked also
     when the draft leaves the goal untouched (`goalId: undefined`, quick edit) and when the schedule is unchanged
     but the goal link is new. "This occurrence" edits do not touch the rule and are not checked.
   - Linking from the goal side (`createGoal`, `updateGoal`, `linkTasks` in `src/data/goals.ts`) and changing a
     goal's due date or period: every linked series with no end or a too-late end is ended on the limit
     (`clampSeriesToGoal`): rule becomes "on date", occurrences after it are dropped, the change is queued for sync.
   - An end that is already allowed is kept. **A later due date never extends a series** (the user chose that end).
   - "This and following" on a linked series: the new series starts later, so an "after n times" end that would now
     pass the limit is clamped instead of refused.
2. Bound is `max(limit, series start)`: a series starting after the due date keeps its first occurrence, like a
   one-off task dated after the due date. The edit is never impossible to save.
3. No goal limit (goal without due date): default end = one month after the start, or after today for an old series.
4. Periodic goals: the series ends with the **current** period. In the next period the old end is still valid and
   new repeats may reach the new period end, but nothing is extended automatically, so a weekly goal fed only by a
   repeating task shows 0 tasks next week until the user extends or re-adds the repeat (see Known issues).
5. Older data and data pulled from another device: `enforceGoalRepeats` (repair pass, idempotent, write-free when
   clean) runs with the goal maintenance (`useGoalMaintenance`: start, foreground, 1.5 s after changes), before the
   history roll. **No SQL migration** (period ends cannot be computed in SQL and the fix has to go through the
   outbox). **No Firestore rules change**: a rule document does not know its task's goal; checking it would need two
   `get()` calls per write, would depend on push order (rule before task) and on the client's "today" for periodic
   goals. Nothing to redeploy for this step.
6. Progress needed no formula change: `computeProgress` already counts a series only inside the goal range and the
   rule's own end; with every linked rule ended by the limit the count stops there (tests added).

**UI.** `RepeatEditor` takes `goal?: GoalRepeatBound`: "Never" is disabled (hint for screen readers), a caption
explains why and names the date (`repeat.goalEndHint` / `goalEndHintOpen`), a new repeat starts with the end on the
limit, the end-date stepper and the "after n times" stepper stop at the limit, "After" starts with a count that fits.
`TaskEditorScreen` derives the shown and saved repeat from the draft and the selected goal (`getGoalOptions` now
returns `repeatEnd`), so picking a goal for a forever task ends it on the limit and removing the goal restores what
the user had. The quick-edit sheet has no repeat or goal controls; it shows the specific error if a save is refused.
Goal form and task picker show `goals.repeatEndNote` when repeating tasks are involved. Inline tasks in the goal form
cannot repeat. EN/FR strings added.

**Demo data.** The stretch series of "Run a 10 km race" is a two-week block (ends today + 6) and last week's five
breaks are seeded as done occurrences (`task_occurrences` added to `DemoData`): the goal reads 6 of 12 (50 %).

## Phase 3 goals round (Steeven's second phone test, 2026-11-10) — done
1. **Swipe between pages** (`src/ui/SwipePager.tsx`, used in `CalendarScreen.tsx`): month grid, week strip and day
   page follow a horizontal drag and slide to the next / previous page; arrows stay; ←/→ on web. Claims only clearly
   horizontal drags in the bubbling phase, so vertical scroll and row swipes keep working (probe below).
2. **Keyboard avoidance** (`src/ui/keyboard.tsx`): `KeyboardSafeView` pads by the measured keyboard overlap (window
   coordinates, so modals and page sheets are right; 0 when a window already resized) and `KeyboardAwareScrollView`
   scrolls the focused field — or a `RevealTarget` group such as the category field with its suggestions — above the
   keyboard. Used by `HeaderScreen` (sign-in/up/reset), `Sheet` (quick edit, dropdowns, task picker, goal "New goal"
   field), task editor and goal form; Save pinned in a footer on both editors. No library (react-native-keyboard-
   controller is not in Expo Go). `TextField` reveals itself on focus.
3. **Goals** — data: migration 002 (`period`, `start_date`, `reminders`, `history` on goals; `fingerprint` on the
   local notification table), Zod (`goalSchema` defaults keep old docs valid), `src/domain/goals.ts` (periods,
   due date, countdown, progress, sections), `src/data/goals.ts` (create/update with linked + inline tasks, ≥ 1 task
   enforced, link/unlink, mark done, archive, delete = unlink + tombstone, history roll, list/detail read models,
   linkable-task search), `src/data/goalBase.ts`. Editor "New goal" is now created together with its task
   (`newGoalTitle` on the task draft). UI: `src/features/goals/` (GoalsScreen list with sections, GoalDetailScreen,
   GoalEditorScreen, TaskPickerSheet, RemindersEditor, useLastTaskGuard), routes `src/app/goal/new.tsx`,
   `goal/[id].tsx`, `goal/edit/[id].tsx`; `src/ui/ProgressArc.tsx`. Delete has Undo (pending deletes gained
   `kind: 'goal'`); deleting the last task of a goal asks "archive goal / keep goal / cancel".
4. **Goal reminders** (`src/services/notifications/`): planner (7-day window, cap 50, deterministic `tt_` ids,
   fingerprints), reconcile against the OS + local table, expo-notifications adapter (lazy, `DATE` trigger, channel
   `reminders`, inexact), `useGoalMaintenance` (start, foreground, 1.5 s after changes; history roll first; tap opens
   the goal). Permission primer only when a reminder is turned on; denied → "Open settings". Web: unavailable note.
   `remindersUsed` device preference keeps cleaning up after a wipe. EN/FR notification texts.
5. **Rules/sync**: `goalOk` validates period, start/due dates (periodic: start required, no stored due date),
   reminders map, history size and its newest entry; emulator tests incl. cross-user denial and a goal sync round
   trip (schedule state stays local). Demo data: 3 goals (one weekly with history), every goal has tasks.
Also fixed: `ConfirmDialog` nested a button inside a button on web (console error) — backdrop and card are siblings.

## Phase 3 feedback round (Steeven's phone test, 2026-11-10) — done
1. Duration + start-time dropdowns (`src/ui/SelectField.tsx`, `src/ui/Sheet.tsx`, `src/features/tasks/fields.tsx`,
   lists in `src/domain/timeOptions.ts`): 5 min … 12 h; "All day" + every 15 min, opens at selection / around now.
2. Free-text category with suggestions; find-or-create on save, case-insensitive, trimmed, ≤ 40, palette colour
   (`src/domain/categoryName.ts`, `src/data/categories.ts`, draft field `categoryName`); rules require trimmed names.
3. Row preview: two subtasks + "+N more" + note line; expands in place with tickable subtasks (`TaskRow.tsx`;
   agenda rows now carry `notes`, `categoryName`, `goalTitle`, `subtaskItems`).
4. Calendar day = own 24 h timeline (`DayTimeline.tsx`, layout in `src/domain/timeline.ts`); week rows show times.
5. Scroll: react-native-calendars `Timeline` was a fixed-height (520 px) vertical ScrollView nested in the screen
   ScrollView: on Android it did not scroll (no `nestedScrollEnabled`), on iOS it trapped the gesture, so tasks
   below the box were unreachable and the page looked stuck. Replaced by a timeline inside the single screen scroll;
   bottom padding keeps the last row clear of the "+" and undo bar. Probe: finger drags reach the end on Today and
   Calendar; last row bottom 666 px vs "+" top 702 px.
6. Repeat "Never" (default, hint text) confirmed; never-ending series tests across window edges and years ahead.
7. Goal selector with "New goal" (name only) in the editor; goal shown on rows (`src/data/goals.ts`).
8. Day header gray first, orange lower band (light theme and chips too). 9. Day splash white → orange, charcoal
   wordmark; native splash charcoal on cream; night unchanged.
10. Delete from the row: "⋯" menu / long press / swipe left; Undo 5 s (`pendingDeletes.ts`: deletes are delayed,
    not reverted, because tombstones are sticky); series ask this / following / all.
11. Quick-edit sheet (`QuickEditSheet.tsx`) via `updateTask`. 12. Start-time column on rows.
Demo data gained notes, a third subtask, a goal link and an overlapping "Team check-in" (workload now 3h 55m).

## Approved decisions (Steeven)
- Name "TickTack"; stack Firebase JS SDK, react-native-calendars, raw SQL migrations, guest mode; `docs/DESIGN.md` is
  the source of truth. Phase 2 deviations (routes in `src/app`, TS-module migrations, no COOP/COEP, icon-style native
  splash, device-local preferences) were approved with phase 2.
- Firebase project config provided by Steeven in the root `.env` (plain names). `npm run env:from-root` maps it to
  `EXPO_PUBLIC_FIREBASE_*` in a checkout's git-ignored `.env` without printing values.

## Done (phase 3)
- **Domain** (`src/domain`): Zod models for every entity; DST-proof local-date arithmetic (`localDate.ts`); bounded
  recurrence generator (`recurrence/generator.ts`: arithmetic jump, 62-day window cap, 400 rows/series, IDs
  `seriesId_YYYYMMDD`, month-end clamping, afterCount) and series edits (`seriesEdit.ts`: split for "this and
  following", orphan detection, stop repeating). 160+ tests incl. 150 randomised cases against a day-by-day reference.
- **Data** (`src/data`): entity map shared by repos and sync (`entities.ts`); validated writes with `local_rev++`,
  `dirty`, coalescing outbox and an ownership guard (`store.ts`); occurrence materialiser with `INSERT OR IGNORE`,
  `occurrence_window`, prune (`occurrences.ts`); task use cases incl. this / following / all edits and deletes
  (`tasks.ts`); Today/agenda read models (`queries/agenda.ts`); profile + localized starter categories
  (`profile.ts`); guest adoption, binding, wipe (`account.ts`); transaction queue on both drivers (`db/driver.ts`).
- **Sync** (`src/sync`): engine (push with per-doc isolation, backoff 2 s→15 min, failed state + retry; pull with
  60 s overlap, opaque page cursors, Zod validation, LWW by server time, sticky tombstones, regeneration after remote
  rule changes), Firestore remote (timeouts, batch→per-doc fallback, deleteAll), in-memory remote, app-wide
  controller (`controller.ts`).
- **Rules** (`firebase/firestore.rules`): exact key sets, types/sizes/enums per collection, deterministic occurrence
  IDs, server timestamps, immutable identity, no tombstone resurrection, default deny.
- **Auth/session** (`src/services`, `src/features/session`): email/password gateway without account enumeration,
  sign-up keeps guest data, sign-in binds/wipes, sign-out wipe with unsynced warning, account deletion (re-auth →
  cloud docs → Auth user → local wipe); sync triggers (start, foreground, online, 2 s after writes, 5 min, pull to refresh).
- **Screens**: onboarding (3 cards + guest/account), sign-in / sign-up / reset, Today (overdue, scheduled, anytime,
  routines, done; checkboxes, category dots, priority flags, workload), task create/edit modal with recurrence editor
  and live preview, subtasks and series scope dialog, Calendar day (timeline + all-day row) / week (DateStrip + 7-day
  agenda) / month (load dots + day preview), Me (account, sync status, retry, sign out, delete account), delete-account
  screen. EN/FR everywhere; demo seed localized (EN/FR) with a recurring task.
- Web: 250 px lock (`src/ui/webLayout.ts`, pans at 500 px), focus ring only for keyboard focus on web (fixes the
  phase 2 known issue).

## Last verified checks (2026-11-10, phase 4a, branch worktree-agent-a0945abd2988561f4)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx expo lint` | pass (0 problems) |
| Format | `npx prettier --check .` | pass (after `npx prettier --write .` for the CRLF checkout, see Known issues) |
| Unit/data/sync/UI tests | `npx jest` | pass — 23 suites, 496 tests (460 before; +6 domain, +12 data, +18 UI) |
| Rules + sync on emulators | `npm run test:rules` | not run (rules and sync untouched) |
| Browser probe, screenshots, sweep | `node scripts/screenshots-4a.mjs` (web :8096, emulator flag, Chromium) | pass — mouse drag +47 px moves 8:00 PM → 8:45 PM with the live label; long press without a move opens the menu; a repeating task asks this / following / all; week grid drag works; emulated touch: a quick drag over a block scrolls the screen (1073 → 962), long press + 60 px moves the block one hour and the screen does not scroll; delete from details returns to Today with the undo bar; 0 px overflow at 300 / 390 / 768 / 1440 on Today, Overdue, History, Calendar week, New task; 240 px locked at 500; content column 720 (week grid 1120 at 1440); no console errors or warnings |
| Expo doctor, Android bundle, npm audit | | not run (no dependency or config change) |

### Previous round (step 0, branch worktree-agent-ab6e3c45cb9a9e728)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx expo lint` | pass (0 problems) |
| Format | `npx prettier --check .` | pass (a fresh worktree checks out CRLF; `npx prettier --write .` first, it leaves no content diff) |
| Unit/data/sync/UI tests | `npx jest` | pass — 20 suites, 460 tests (439 before; +7 domain, +11 data, +3 UI) |
| Rules + sync on emulators | `npm run test:rules` | pass — 2 suites, 45 tests (rules unchanged) |
| Emulator seed | `npm run seed:emulator` | pass — 34 rows seeded, 34 documents uploaded through the rules (incl. the 5 done stretch occurrences) |
| Screenshots / browser sweep | `node scripts/screenshots-goals.mjs` | not run (needs the web bundle and the root `.env`; editor state is covered by `tests/ui/goals.test.tsx`) |
| Expo doctor, Android bundle, npm audit | | not run in this step (no dependency or config change) |

### Previous round (goals, branch feat/phase-3-goals)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx expo lint` | pass (0 problems) |
| Format | `npx prettier --check .` | pass |
| Unit/data/sync/UI tests | `npx jest` (after `--clearCache`) | pass — 20 suites, 439 tests |
| Rules + sync on emulators | `npm run test:rules` | pass — 2 suites, 45 tests (goal fields, cross-user, goal sync round trip) |
| Expo doctor | `npx expo-doctor` | pass — 20/20 (first try failed on a network TLS error, retry passed) |
| Android bundle | `npx expo export --platform android` | pass (9.3 MB Hermes bundle, 3339 modules) |
| Goals probe + sweep | `node scripts/screenshots-goals.mjs` (web :8095, emulator flag) | pass — month swipe → next month, ← key back, vertical drag still scrolls (0 → 225), week swipe → next week; create-goal Save disabled without tasks; delete → Undo restores; short viewport (390×470) keeps Save visible; 0 px overflow at 300/390/768/1440 on Goals / Calendar month / goal detail, 240 px locked at 500; no console errors or warnings (Reanimated reduced-motion notice from the probe's own setting ignored) |
| npm audit | `npm audit --json` | 0 high / 0 critical; 28 moderate + 1 low (same tooling advisories) |
| Secret scan | staged-diff grep before each commit; `.env` git-ignored | none found |

### Previous round (feedback, branch feat/phase-3-feedback)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx expo lint` | pass (0 problems) |
| Format | `npx prettier --check .` | pass |
| Unit/data/sync/UI tests | `npx jest` | pass — 16 suites, 389 tests (after `--clearCache`) |
| Rules + sync on emulators | `npm run test:rules` (Firestore + Auth emulators) | pass — 2 suites, 39 tests (incl. trimmed category names) |
| Emulator seed | `npm run seed:emulator` | not rerun in the feedback round (phase 3: pass) |
| Expo doctor | `npx expo-doctor` | pass — 20/20 |
| Android bundle | `npx expo export --platform android` | pass (9.1 MB Hermes bundle) |
| Web probe | `node scripts/web-probe.mjs http://localhost:8091` | no console errors/warnings; data persists after reload; 240 px → root 500, `overflow-x: auto` |
| Feedback probe + sweep | `node scripts/screenshots-feedback.mjs` (web on :8093, emulator flag) | pass — finger-drag scroll reaches the end on Today and Calendar day, last row clear of the "+"; timeline auto-scrolls; finger swipe reveals Edit/Delete; Today / Calendar day / week: 0 px overflow at 300/390/768/1440, 240 px locked at 500; no console errors |
| npm audit | `npm audit --json` | 0 high / 0 critical; 29 moderate + 1 low (see below) |
| Secret scan | staged-diff grep for key/token patterns before each commit; `.env` git-ignored (`git check-ignore`) | none found |

## Known issues and risks
- Kept advisories (build/test tooling only, not in the app bundle): `glob` GHSA-3g3m-2fjr-6pw4 and `minimatch`
  GHSA-g3hv-75wg-m249 (moderate, via Expo CLI / Jest / typescript-eslint), `deepmerge` GHSA-gcqx-w48m-w2h4 (low).
  `npm audit fix --force` would downgrade major tooling. `@grpc/grpc-js` override from phase 2 still in place.
- Install: `npm ci` fails at better-sqlite3's node-gyp fallback on this machine (Python unavailable); use
  `npm ci --ignore-scripts` — better-sqlite3 ships Windows prebuilds that load fine.
- Metro's file watcher did not pick up edits in this `.claude` worktree; restart `expo start --clear` after edits.
- Rules/emulator tests: set `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=<short dir>` on this sandbox; suites
  run serially (`maxWorkers: 1`) because the rules suite clears the shared emulator.
- Real Firebase project not touched: no users created, no data written, rules/indexes not deployed (see Waiting).
- Phase 4a, not verified on a device: the drag gesture on iOS and Android (verified in Chromium with mouse and
  emulated touch only; on native it relies on `scrollEnabled={false}` reaching the scroll view while the finger is
  down). No haptic tick at drag start yet (DESIGN.md asks for haptics; expo-haptics is installed but unused).
- Phase 4a limits: a drag changes the time only, not the day (week grid included); the screen does not auto-scroll
  while dragging, so a move beyond the visible hours needs two drags or Quick edit; no keyboard shortcut to move a
  block on desktop web (menu / Quick edit / details cover it); history has no "cancelled" filter (nothing can be
  cancelled) and leaves routines out (4b); missed occurrences only go back 30 days (the local prune limit); the
  demo seed stamps its completed items with the seeding time, so the demo history files them under today.
- Git: a fresh worktree checks out CRLF and `prettier --write .` rewrites every file as LF; `git status` then lists
  ~150 files although `git diff` is empty for them. Stage by path, never `git add -A`.
- The tab bar and the undo bar are not limited to the content column on wide screens (tab bar full width by choice).
- Month view shows a dot on every day when a daily routine exists (correct, but less informative).
- Native runtime still unverified on a device (Timeline, Auth persistence, SQLite); needs a dev build (phase 4).
- Local SQLite unencrypted; refresh token in AsyncStorage (ARCHITECTURE.md section 9).
- Goals round, reasoned but not device-verified: keyboard padding/reveal on iOS and Android (measured with
  `measureInWindow` + keyboard events; inside RN `Modal` on Android it relies on keyboard events reaching the modal
  window — if they do not and the window does not resize, sheets would not lift); local notifications delivery in
  Expo Go and a dev build; swipe feel on a real phone. Expo Go logs two expo-notifications warnings (push not
  available in Expo Go) the first time reminders are used — expected, push is not used.
- Reminders only cover the next 7 days and are rebuilt when the app is opened (no background task yet); timing is
  inexact on Android without the exact-alarm permission.
- Linking a task that belongs to another goal moves it (the picker shows "In “X”"); that other goal can end up with
  no tasks. Changing a task's goal in the task editor is not blocked by the ≥ 1 task rule (only deletes warn).
- Step 0: a periodic goal whose only tasks repeat has nothing to count in the next period (the series ended with the
  period it was linked in). Product question for Steeven: keep, or let a periodic goal's repeats roll forward.
- Step 0: a goal that is not active (achieved / archived) is not in the editor's goal list, so the editor shows no
  limit for it; the repository still refuses a too-late end and the editor shows that message.
- Step 0: not verified in a browser or on a device (no screenshots taken); covered by unit, data and UI tests.

## Deviations from the spec (for review)
1. Week view = DateStrip (7 columns with load dots) + stacked 7-day agenda instead of a 7-column agenda grid
   (unreadable at 390 px).
2. (Resolved in phase 4a) tapping a task opens the read-only details screen; the editor opens from there.
3. (Replaced in the feedback round) time entry is now a 15-minute dropdown; `parseTimeInput` stays exported but
   unused by the UI.
6. Feedback round: quick edit / swipe / menu are not offered for routines (routine editing is phase 4); a
   "this occurrence" quick edit cannot change the category (it belongs to the series); swipe works with touch, not
   with a mouse drag on desktop web (the "⋯" menu covers web); no 7-column hour grid in week view at ≥ 768 px;
   two devices creating the same category name offline can still produce twins (de-dup is local).
7. A pending delete runs after 5 s or when the app goes to the background; if the app is killed inside the window
   the task is kept.
4. Sticky tombstones also win over a dirty local edit on pull (delete beats a concurrent edit, as ARCHITECTURE.md
   intends); the rejected local edit is dropped.
5. Calendar month view (planned for phase 4) was built in phase 3.
8. Goals round: Save is pinned in a footer on the task editor (was at the end of the scroll); one-time goals created
   from the task editor ("New goal" by name) have no due date (the goal form requires one); periodic goals store no
   due date (derived); a change of period or start clears the history; on web the reminder switches are shown
   disabled with a note; notification ids are `tt_<goalId>_<kind>_<key>` (ARCHITECTURE.md said
   `reminderId_date`); milestones remain phase 4.

## Setup
- `npm ci --ignore-scripts`; `npm run env:from-root` (or copy `.env.example`); `npx expo start --web`.
- Web without touching the real project: `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8091`;
  demo data with `?demo=1` (dev only). Emulators: `npm run emulators`; seed into them: set
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` then
  `npm run seed -- --emulator --reset [--lang fr]` (or one-shot check `npm run seed:emulator`).
- Screenshots: `node scripts/screenshots.mjs [--only <set>]`, sweep: `--sweep`. Feedback set, touch-scroll probe
  and sweep: `node scripts/screenshots-feedback.mjs [--base http://localhost:8093] [--only shots|scroll|sweep]`.
- Brand assets: `npm run render:brand` (`-- --preview` also writes `docs/screenshots/phase-3-feedback/brand-preview-*`).
- Shell edits on Windows: PowerShell 5.1 `Get-Content`/`Set-Content` re-encode UTF-8 (mojibake + BOM); avoid them
  for source files.
- Env var names (no values): `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`, `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`,
  `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`, `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`, `EXPO_PUBLIC_USE_FIREBASE_EMULATOR`,
  `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`.

## Screenshots (phase 3, 390 px, 2x) — `docs/screenshots/phase-3/`
Onboarding (`dark-day-en-onboarding-1/2/ready`, `dark-night-fr-onboarding-1`), sign-in (+ errors), sign-up
(`light-day-fr-sign-up`), Today (`dark-day-en-today`, `-scrolled`, `dark-night-en-today`, `light-day-en-today`,
`dark-day-fr-today`, `light-day-fr-today`), task edit (`dark-day-en-task-edit`, `-scrolled`), new task with repeat
(`dark-day-en-task-new-repeat`, `dark-day-fr-task-new`), calendar day/week/month (`dark-day-en-calendar-*`,
`dark-night-en-calendar-day`, `light-day-en-calendar-week`, `dark-day-fr-calendar-month`), Me (`dark-day-en-me`,
`dark-day-fr-me`), sweep (`sweep-240-today`, `sweep-1440-today`).

Feedback round — `docs/screenshots/phase-3-feedback/`: `splash-day`, `splash-night`, `dark-day-en-today`
(`-expanded`, `-end`), `dark-night-en-today`, `dark-day-en-row-swipe`, `-row-menu`, `-undo-snackbar`, `-quick-edit`,
`-duration-open`, `-time-open`, `-category-autocomplete`, `-repeat-never`, `-calendar-day` (`-end`),
`-calendar-week`, `dark-day-fr-today`, `dark-day-fr-calendar-day`, `light-day-en-today`, `light-day-en-calendar-day`,
`sweep-{240,768,1440}-{today,calendar-day,calendar-week}`, `brand-preview-{day,night}`.

Goals round — `docs/screenshots/phase-3-goals/` (`node scripts/screenshots-goals.mjs [--only shots|calendar|sweep]`):
`dark-day-en-calendar-month-mid-swipe`, `-after-swipe`, `dark-day-en-goals`, `dark-day-fr-goals`,
`dark-day-en-goal-new-disabled-save`, `-link-tasks`, `-with-tasks`, `-reminders-web`, `-goal-created-detail`,
`-goal-detail`, `-goal-detail-reminders`, `-goal-edit`, `-goal-edit-reminders`, `-goal-weekly-history`,
`-goal-delete-confirm`, `-goal-deleted-undo`, `dark-day-en-task-editor-keyboard-space` (short viewport standing in
for the keyboard), `light-day-en-goal-detail`, `sweep-{240,768,1440}-{goals,calendar-month,goal-detail}`.

Phase 4a — `docs/screenshots/phase-4a/` (`node scripts/screenshots-4a.mjs [--only shots|drag|sweep]`):
`{dark-day-en,light-day-fr}-{today-links,task-detail,task-detail-end,task-detail-quick-edit,overdue,history}`,
`dark-day-en-task-detail-repeat`, `-task-detail-delete-scope`, `-task-detail-deleted-undo`, `-overdue-empty`,
`-history-empty`, `-calendar-day-dragging`, `wide-{768,1440}-calendar-week-grid`,
`wide-1440-fr-light-calendar-week-grid`, `wide-1024-calendar-day-dragging`, `wide-1024-calendar-day-move-scope`,
`sweep-{240,768,1440}-{today,overdue,history,calendar-week,task-new}`.

## Pending (priority order)
0. Done: goal repeats must end (see "Step 0" above).
1. Done: phase 4a (see "Phase 4a" above).
2. Done: phase 4b (see "Phase 4b" above), apart from the on-phone check in a dev build.
3. Done: phase 4c (see "Phase 4c" above). Still open from it: "Tomorrow / Pick date" swipe actions, a haptic tick when
   a drag starts, editing the day start / end, on-phone check of the 4c checklist.
4. Phase 5b done (see "Phase 5b" above); phase 5a (rules, limits, wipe, migration, sync) on its own branch; then phase 6.

## Next step
1. **Phase 5 (QA and security)** on top of this branch: full verification, access-control tests, rules, input
   limits, sign-out wipe, guest migration, screens compared with `docs/DESIGN.md`. Include the Firestore rules for
   the profile fields now edited in Settings (`weekStartsOn`, `dailyCapacityMin`) and category deletes.
2. Only after Steeven approves EAS: `npx eas-cli@latest build --profile development --platform android` (set the
   `EXPO_PUBLIC_FIREBASE_*` EAS environment variables first), install the APK, run the "Verify on the phone"
   checklist in the Phase 4b section.
3. Expo Go phone test of 4a/4b screens (tunnel: `npx expo start --tunnel --clear`; his Wi-Fi blocks LAN mode).

## Waiting for approval (Needs from Steeven)
1. In the Firebase console: confirm **Authentication → Email/Password** is enabled and **Firestore** (native mode,
   suggested `northamerica-northeast1`) is created.
2. Review and deploy the rules and indexes to the real project (not done by the agent). **The goals round changed
   `firestore.rules` (goal fields): signed-in sync of goals fails against the real project until it is redeployed.
   Phase 5a changed it again (ISO timestamps): deploy the 5a version.** Also from 5a: App Check, API key
   restrictions, a budget alert and email enumeration protection (`docs/SECURITY_REVIEW.md` finding 11).
   `npx --yes firebase-tools@15.35.0 login` then
   `npx --yes firebase-tools@15.35.0 deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project <your project id>`.
3. Expo account: **done**. **EAS dev build: needs his go-ahead** (`eas.json` development profile is ready; no build
   was started — see the incident note in the Phase 4b section).
4. Android exact alarms: decided (ask users; done in 4b). For a Play release, the Console must justify
   `SCHEDULE_EXACT_ALARM`. Optional Firestore TTL for tombstones; optional Apple Developer Program.
5. Review the phase 3 deviations above.
