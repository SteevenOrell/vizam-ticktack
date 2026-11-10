# Agent handoff — TickTack (VIZAM portfolio concept)

_Last updated: 2026-11-10 (local time) by vizam-fullstack-developer, phase 3 feedback round_

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

## Last verified checks (2026-11-10, feedback round, branch feat/phase-3-feedback)
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
- Desktop widths stretch the phone layout full width (usable, no overflow); a max content width is phase 4 polish.
- Month view shows a dot on every day when a daily routine exists (correct, but less informative).
- Native runtime still unverified on a device (Timeline, Auth persistence, SQLite); needs a dev build (phase 4).
- Local SQLite unencrypted; refresh token in AsyncStorage (ARCHITECTURE.md section 9).

## Deviations from the spec (for review)
1. Week view = DateStrip (7 columns with load dots) + stacked 7-day agenda instead of a 7-column agenda grid
   (unreadable at 390 px).
2. No separate read-only task details screen yet: tapping a task opens the editor (phase 4 adds details).
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

## Pending (priority order)
1. Phase 4 per `docs/MILESTONES.md`: reminders/notifications (permission flow, reconcile, Android exact-alarm
   decision), task details, swipe + drag reschedule, history/overdue views, goals + milestones + routines editing and
   runner, settings (week start, capacity, categories, failed-sync list), desktop max width.
2. Phases 5–6.

## Next step
Steeven re-tests `feat/phase-3-feedback` on his phone (Expo Go; restart Metro with `--clear` from this worktree).
After his OK, start phase 4 on `feat/phase-4-features` from `feat/phase-3-feedback`: build `src/services/notifications` (reconcile engine with
mocked `expo-notifications` tests per ARCHITECTURE.md section 8), then the task details screen.

## Waiting for approval (Needs from Steeven)
1. In the Firebase console: confirm **Authentication → Email/Password** is enabled and **Firestore** (native mode,
   suggested `northamerica-northeast1`) is created.
2. Review and deploy the rules and indexes to the real project (not done by the agent):
   `npx --yes firebase-tools@15.35.0 login` then
   `npx --yes firebase-tools@15.35.0 deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project <your project id>`.
3. Expo account (free) for EAS dev builds — needed in phase 4 for notifications and on-device checks.
4. Android exact-alarm approach (phase 4); optional Firestore TTL for tombstones; optional Apple Developer Program.
5. Review the phase 3 deviations above.
