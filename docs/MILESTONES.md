# TickTack — Milestone plan (phases 2–6)

_Phase 1 output, 2026-11-09. One fresh agent and one branch (`feat/phase-<n>-<name>`) per phase._

## Phase 2 — Foundation (`feat/phase-2-foundation`)
- `npx create-expo-app` (SDK 58, TypeScript template), strict TS, ESLint + Prettier, Jest (jest-expo) + RNTL.
- Install the stack in `docs/ARCHITECTURE.md` section 1 with `npx expo install`; `npx expo-doctor` clean.
- Spikes with a written verdict in the handoff: `expo-sqlite` on web (COOP/COEP), `react-native-calendars` Timeline on
  RN 0.88, Firebase JS SDK auth persistence under Metro.
- Design tokens (both themes) + contrast unit test; fonts; `src/ui` primitives from `docs/DESIGN.md` section 6.
- Expo Router skeleton: onboarding, auth, 5 tabs, modal routes, placeholder screens with real states.
- `SqlDriver` interface, expo-sqlite driver, `better-sqlite3` test driver, migration 001, migration test.
- Firebase config module reading `EXPO_PUBLIC_FIREBASE_*`, emulator switch, `firebase/` folder with `firebase.json`.
- `.env.example`, seed script with synthetic data.
- Exit: lint, typecheck, tests, expo-doctor pass; Expo web runs; screenshots of the shell (light/dark).

## Phase 3 — Core (`feat/phase-3-core`) — done 2026-11-10 (see docs/AGENT_HANDOFF.md)
- Domain models (Zod), repositories with outbox enqueue, recurrence generator + full edge-case tests. **Done.**
- Firebase Auth (email/password, reset), guest mode and guest-to-account migration, sign-out wipe, account
  deletion. **Done** (emulator-tested; real project needs Email/Password enabled and rules deployed).
- Sync engine: push, pull, LWW, sticky tombstones, retries; fake-remote scenario tests **and** emulator tests. **Done.**
- `firestore.rules` + emulator rules tests (cross-user denial matrix). **Done.**
- Screens: onboarding, sign-in/up/reset, Today, task create/edit (incl. recurrence editor and this / following /
  all), Calendar day + week + month (month moved forward from phase 4), Me account/sync section. **Done.**
- Not in phase 3 (moved to phase 4): separate read-only task details screen (the editor doubles as details),
  drag-to-reschedule, swipe actions, reminders/notifications, goals/routines editing.
- Exit: all checks pass; rules tests pass in the emulator; screenshots in `docs/screenshots/phase-3/`.

## Phase 4 — Feature completion (`feat/phase-4-features`)
- Drag-to-reschedule and swipe actions (Today: complete / Tomorrow / Pick date), task details screen, overdue
  view, history (done / missed / cancelled).
- Goals, milestones, linked tasks, derived progress; routines and routine runner.
- Reminders: permission flow, reconcile engine, deep links, background task; Android exact-alarm decision applied.
- Settings: theme, week start, capacity, categories, sync status/failed items, account deletion.
- All loading/empty/error/success states, validation messages, accessibility labels.
- Exit: all checks; notification tests (mocked) pass; device check in a dev build if available.

## Phase 5 — QA and security (`feat/phase-5-qa`)
- Full verification (Part 5 of the master prompt): typecheck, lint, tests, expo-doctor, `npm audit` review.
- Access-control tests re-run; review rules, logs, input limits, sign-out wipe, guest migration.
- Screens at phone size in light and dark (Expo web + Playwright), compared with `docs/DESIGN.md` and the reference
  principles; fix findings.
- Exit: report with real results and kept WARNs.

## Phase 6 — Delivery (`feat/phase-6-delivery`)
- README (setup, emulator, scripts), architecture/database docs refreshed, test results, security summary, known
  limitations, EAS preview-build instructions (not executed), portfolio summary and screenshots.

## Needs from Steeven

| # | What | Why | When needed | Env / config names (no values) |
|---|---|---|---|---|
| 1 | Approve this architecture and design (or request changes) | Gate to phase 2 | Now | — |
| 2 | Decide on the name: keep "TickTack" or rename | Very close to the existing app "TickTick" (trademark/confusion risk for any public listing) | Before phase 2 logo work | — |
| 3 | Approve the stack deviations/choices: Firebase **JS SDK** instead of React Native Firebase; `react-native-calendars`; raw SQL migrations (no ORM); guest mode | Recorded in ARCHITECTURE.md section 1 | Now | — |
| 4 | Create a Firebase project (free Spark plan), enable Auth email/password, create Firestore (native mode; suggested region `northamerica-northeast1`), register a Web app, put its config in the local `.env` | Real cloud sync; everything works on the emulator until then | **Config provided 2026-11-10** (root `.env`, mapped by `npm run env:from-root`). Still needed: confirm Email/Password is enabled, Firestore created, then deploy rules (see handoff) | `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`, `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`, `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`, `EXPO_PUBLIC_USE_FIREBASE_EMULATOR`, `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` |
| 5 | Expo account (free) and `eas init` sign-in | Development build to test notifications on a real device; preview builds in phase 6 | Phase 4 | EAS project ID in app config (`extra.eas.projectId`) |
| 6 | Optional: Apple Developer Program (paid) | iOS device/TestFlight builds | Phase 6, only if wanted | — |
| 7 | Decide Android exact-alarm approach (ask for `SCHEDULE_EXACT_ALARM` vs accept inexact reminders) | Play policy and UX | Phase 4 | — |
| 8 | Optional: Firestore TTL policy on `purgeAt` (console) | Server-side tombstone cleanup | Phase 6 or later | — |
