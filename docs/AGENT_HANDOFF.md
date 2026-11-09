# Agent handoff — TickTack (VIZAM portfolio concept)

_Last updated: 2026-11-09 (local time) by vizam-fullstack-developer, phase 1_

## Objective
Offline-first mobile planner (Today, calendar, recurring tasks, reminders, routines, goals) built with Expo, SQLite as
local source of truth and Firebase (Auth + Firestore) for sync. Portfolio concept with its own identity.

## Repository
- Path: `C:\Users\SteevenWemin\Documents\Projects\vizam-ticktack` (phase 1 worked in the git worktree
  `.claude\worktrees\agent-ac9c5458c94ea8fff`). Remote: none (not pushed, no GitHub repo created).
- Branch: `feat/phase-1-architecture`. Base: `main` (empty initial commit `506a435`).
- Commits: `a36fb3a` docs: phase 1 architecture, design direction and milestone plan; then the handoff commit.

## Approved decisions
- None yet. Proposals awaiting Steeven: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/MILESTONES.md`.
- Proposed stack: Expo SDK 58 (RN 0.88.1, React 19.3.0, TS ~6.0.3), Expo Router, expo-sqlite (raw SQL migrations),
  Zustand 5, Zod 4, Firebase JS SDK 13 (Auth email/password + Firestore, no Firestore persistence),
  react-native-calendars, expo-notifications, expo-background-task. Install native modules with `npx expo install`.
- Design references: `docs/references/ticktack-ref-orange-charcoal.jpg` (git-ignored, third-party). Principles and
  exclusions are written in `docs/DESIGN.md` section 2; work from that file.

## Done
- Phase 1 discovery and architecture — `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/MILESTONES.md`, `.gitignore`.

## Pending (priority order)
1. Steeven's approval of architecture, design, name (see Waiting for approval).
2. Phase 2 Foundation per `docs/MILESTONES.md`, including three spikes: expo-sqlite on web, calendars Timeline on
   RN 0.88, Firebase auth persistence under Metro.
3. Phases 3–6 per `docs/MILESTONES.md`.

## Last verified checks
| Check | Command | Result | When |
|---|---|---|---|
| Versions | `npm view <pkg> version`; `expo@58.0.23` `bundledNativeModules.json` | Read; recorded in ARCHITECTURE.md section 1 | 2026-11-09 |
| Palette contrast | WCAG formula via Node | Values recorded in DESIGN.md section 3 | 2026-11-09 |
| Java for Firestore emulator | `java -version` | OpenJDK 21.0.12 present | 2026-11-09 |
| Lint / typecheck / tests / build / expo-doctor / audit | — | not run (no code yet) | — |

## Known issues and risks
- Name "TickTack" is very close to the existing app "TickTick" (confusion/trademark risk for public listing).
- expo-sqlite on web needs COOP/COEP headers (unverified); calendars Timeline on RN 0.88 unverified; Firebase JS auth
  persistence entry under Metro unverified.
- Android exact alarms (Android 14 denies `SCHEDULE_EXACT_ALARM` by default); iOS 64 pending-notification cap; background
  tasks not guaranteed. Strategy in ARCHITECTURE.md section 8.
- Local SQLite is unencrypted; Firebase refresh token stored in AsyncStorage.
- Security findings: none (no code). No secrets in the repo.

## Setup
- Not scaffolded yet (phase 2). Tools present: Node 24.19.0, npm 11.17.0, Java 21. No Docker, no global Firebase CLI
  (use `npx firebase-tools`).
- Env var names (no values): `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`, `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`,
  `EXPO_PUBLIC_USE_FIREBASE_EMULATOR`, `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`.

## Next step
After approval: start phase 2 on branch `feat/phase-2-foundation` from this branch (or from `main` after merge): run
`npx create-expo-app@latest` with the SDK 58 TypeScript template in the repo root, then follow the phase 2 list in
`docs/MILESTONES.md`.

## Waiting for approval (Needs from Steeven)
1. Approve architecture and design docs (or request changes).
2. Name: keep "TickTack" or rename.
3. Stack choices: Firebase JS SDK instead of React Native Firebase; react-native-calendars; raw SQL (no ORM); guest mode.
4. Firebase project (free Spark plan): Auth email/password, Firestore native mode (suggested `northamerica-northeast1`),
   Web app config into local `.env` (names above). Needed by end of phase 3; emulator until then.
5. Expo account (free) for EAS dev/preview builds — phase 4.
6. Optional: Apple Developer Program (paid) for iOS device builds — phase 6.
7. Android exact-alarm approach — phase 4.
8. Optional: Firestore TTL policy for tombstone purge.
