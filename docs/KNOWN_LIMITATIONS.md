# TickTack: known limitations

What is open or not verified at the end of phase 6 (2026-11-11), gathered from `AGENT_HANDOFF.md`, `QA_REPORT.md` and
`SECURITY_REVIEW.md`. TickTack is a concept / portfolio project; nothing here blocks a demo.

## Not checked on a real device

Everything was verified with unit, data and UI tests and with Chromium (web). The first run on a phone is still to do
(checklist in [`RELEASE.md`](RELEASE.md)). In particular, reasoned or tested only on web:

- Drag to reschedule on iOS and Android (relies on the scroll view being disabled while the finger is down).
- Local notification delivery, notification taps (including with the app killed), exact alarms, and the background
  task (Expo Go cannot show these; needs the development build).
- Keyboard avoidance in sheets and editors, especially inside Android `Modal` windows.
- Swipe feel (calendar paging, row Edit / Delete), Dynamic Type / large fonts, Android edge-to-edge insets.
- SQLite, Firebase Auth persistence and sync on a native runtime.
- The failed-sync list with real items (covered by tests only; no way to make a failed write in the web demo).
- Expo Go logs two expo-notifications warnings (push not available) the first time reminders are used; push is not used.

## Product gaps (left on purpose or by instruction)

- **Swipe actions "Tomorrow" and "Pick date"** on task rows were skipped; the "⋯" menu, quick edit and drag cover them.
- **Haptics:** none (`expo-haptics` is installed but unused), including a tick when a drag starts.
- **Day start and end are read-only:** they are a device preference with no editor.
- **Drag changes the time only**, not the day (week grid included); the screen does not auto-scroll while dragging, so
  a move beyond the visible hours needs two drags or Quick edit; no keyboard shortcut to move a block on desktop.
- **Reminders** cover the next 7 days and are rebuilt when the app opens and by the background task (about hourly at
  best; iOS decides when). On Android without exact-alarm access delivery can be a few minutes late. The goal
  reminders editor does not show the exact-alarm note.
- **History** has no "cancelled" filter (nothing can be cancelled); missed items go back 30 days only (local prune
  limit). The demo seed stamps completed items with the seeding time, so demo History files them under today.
- **No quick edit, swipe or menu for routines;** routines are edited on their own screen.
- **A "this occurrence" quick edit cannot change the category** (it belongs to the series).
- **A periodic goal whose only tasks repeat** has nothing to count in the next period (the series ended with the
  period). Open product question: keep, or let a periodic goal's repeats roll forward.
- **Goal rules:** a goal that is achieved or archived is not in the editor's goal list, so the editor shows no end limit
  for it; linking a task that belongs to another goal moves it, and the other goal can end up with no tasks.
- **Month view** shows a dot on every day when a daily routine exists (correct, but not very informative).
- **Duplicate category names** made by two devices offline are merged the next time a device signs in, not at once.
- A pending delete runs after 5 s or when the app goes to the background; if the app is killed inside that window the
  task is kept.
- Notification actions "Done" and "Snooze" were a stretch goal and do not exist.

## Layout

- **Desktop web: the bottom tab bar is not clamped to the 720 px content column** and spreads its 5 items over the
  full width at 1440 px (cosmetic; Expo Router has no supported max width for its tab bar). The undo bar behaves the
  same way.
- **At 240 px the layout is locked at 500 px and pans sideways**, as the VIZAM rule requires.
- Ellipsised text kept on purpose: one-line note excerpt on task previews, titles in narrow week-grid blocks (full text
  in the accessibility label and details).
- Long screens (Me, forms) were shot at the top only in the phase 5b sheets.

## Security and data (see `SECURITY_REVIEW.md`)

- **Local SQLite is not encrypted** and the Firebase refresh token is in AsyncStorage; protected by the OS sandbox and
  screen lock, and wiped on sign-out. SQLCipher is a possible later step.
- **No per-user write quota and the API key is unrestricted** until App Check, key restriction, a budget alert and
  email enumeration protection are set in the console (open, for Steeven).
- **Firestore rules are not deployed** to the real project; sync against older rules fails for goals and timestamps.
- Rules cannot check every list element (routine steps, completed step ids, goal history); the owner can hard-delete
  documents, bypassing sticky tombstones (needed for in-app account deletion without Cloud Functions).
- Changes not yet uploaded when a session is revoked elsewhere (password change, disabled account) are lost, because
  the device can no longer upload them.
- No tombstone clean-up: an optional Firestore TTL policy could remove old ones.
- **Moderate audit items in tooling:** `npm audit --omit=dev` reports 21 moderate and 1 low (`glob`, `minimatch`,
  `deepmerge`, reached through Expo CLI, Jest and typescript-eslint). Not in the app bundle; the only fixes offered are
  major downgrades (`expo@52`, `jest@29`), so they are accepted. An `@grpc/grpc-js` override from phase 2 stays.

## Build and tooling

- `npm ci` can fail at `better-sqlite3`'s node-gyp fallback on machines without Python; use
  `npm ci --ignore-scripts` (Windows prebuilds load fine).
- Metro's watcher did not see edits inside the `.claude` worktree; restart with `npx expo start --clear`.
- Rules tests need Java 21 and, in some sandboxes, `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=<short dir>`.
- A fresh CRLF checkout plus `prettier --write .` rewrites line endings of many files; stage by path.
- One flaky Jest failure seen earlier could not be reproduced (4 of 4 and then 3 of 3 runs green); timeouts were
  raised (`waitFor` 15 s, per test 60 s). The cause is inferred, not observed.
- Apple platforms: no iOS build was made or tested; the Apple Developer Program is not set up.
