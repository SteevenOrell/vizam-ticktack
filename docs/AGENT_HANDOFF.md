# Agent handoff — TickTack (VIZAM portfolio concept)

_Last updated: 2026-11-09 (local time) by vizam-fullstack-developer, phase 2 (Foundation)_

## Objective
Offline-first mobile planner (Today, calendar, recurring tasks, reminders, routines, goals) built with Expo, SQLite as
local source of truth and Firebase (Auth + Firestore) for sync. Portfolio concept with its own identity.

## Repository
- Path: `C:\Users\SteevenWemin\Documents\Projects\vizam-ticktack`. Phase 2 worked in the git worktree
  `.claude\worktrees\agent-aa3f200088831e809`. Remote: none (not pushed, no GitHub repo).
- Branch: `feat/phase-2-foundation`, based on `feat/phase-1-architecture` (`ae96048`). See `git log --oneline` for the
  phase 2 commits (scaffold, theme+i18n, data, UI, Firebase, tests, handoff).

## Approved decisions (Steeven)
- Name "TickTack" kept. Display name lives only in `app.config.ts` (`APP_NAME`) and `src/i18n/locales/*.json`
  (`app.name`).
- Stack: Firebase JS SDK, react-native-calendars, raw SQL migrations, guest mode.
- `docs/DESIGN.md` is the source of truth (day/night gradients, Manrope -0.4 tracking + Space Grotesk titles, EN/FR,
  ember-flow splash generated from code).

## Phase 2 decisions and deviations (to review)
1. **Routes live in `src/app/`** (Expo Router's convention when a `src/` folder exists), not root `app/` as
   ARCHITECTURE.md section 2 sketches. Everything else follows that structure.
2. **Migrations are TypeScript modules exporting raw SQL** (`src/data/db/migrations/001_initial.ts`) instead of
   `.sql` files, so Metro bundles them without a custom transformer. Still raw SQL, versioned by `PRAGMA user_version`.
3. **No COOP/COEP headers** (risk check 1). The headers are only needed for expo-sqlite's *synchronous* web API. Rule:
   use the async API only (`SqlDriver` enforces this).
4. **Native splash** = wordmark on charcoal `#17191B` (Android 12+ only allows a centred icon on a solid colour; iOS
   full-screen splash is a legacy option). The full ember image follows in-app (`src/features/splash/AppSplash.tsx`),
   day or night. So the PNG ember background in DESIGN.md is not produced; WebP backgrounds are.
5. **Preferences** (theme, language, day start/end) are stored on the device with Zustand persist + AsyncStorage
   (`src/state/preferences.ts`), validated with Zod on load. Phase 3 mirrors theme/day window into the synced profile.
6. Onboarding and auth routes were **not** scaffolded (they need real flows); phase 3 adds them. The `task/new` modal
   route exists as a placeholder.
7. Firebase is initialised at startup only when configured (`.env` or emulator); otherwise guest mode, no network.
8. Dev-only web flags: `?demo=1` seeds synthetic data into an empty web DB; `?holdSplash=1` keeps the splash on screen
   for screenshots. Both are disabled outside `__DEV__` and on native.

## Risk checks (phase 2)
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | expo-sqlite on web (COOP/COEP) | **Pass, no headers needed.** Async API works without cross-origin isolation; data persists across reloads | `node scripts/web-probe.mjs http://localhost:8084`: `crossOriginIsolated: false`, `state-success` before and after reload, no console errors. expo-sqlite only uses SharedArrayBuffer in `invokeWorkerSync` (sync API) |
| 2 | react-native-calendars Timeline on RN 0.88 | **Pass at bundle/JS level; native device render not verified** (no Android SDK or iOS device here) | `npx expo export --platform android --no-bytecode` bundles the Timeline; RNTL test renders Timeline with events and the month grid; Expo web screenshots show it. Fallback stays documented (own FlashList timeline) |
| 3 | Firebase Auth persistence under Metro | **Pass at bundle level.** Metro resolves the React Native build: the Android bundle contains `getReactNativePersistence` and no browser persistence; Jest test initialises Auth with AsyncStorage persistence | `auth.native.ts` / `auth.ts` platform split; `src/services/firebase/__tests__/auth.native.test.ts`. Runtime on a device not verified |

## Done (phase 2)
- Scaffold (Expo SDK 58, RN 0.88.1, React 19.3, TS 6.0 strict + `noUncheckedIndexedAccess`), ESLint (expo flat +
  prettier), Prettier, Jest (jest-expo) + RNTL 14 — `package.json`, `eslint.config.js`, `jest.config.js`.
- Design tokens incl. day/night header and chip gradients, splash stops, category colours; WCAG contrast tests that
  sample every gradient stop and midpoint — `src/ui/theme/`.
- Fonts (Space Grotesk 500/600/700, Manrope 300/400/500/600, -0.4 tracking) and `src/ui` components: Text, Button,
  RoundAction, Card, DeckPanel, Pill, SegmentedControl, GradientHeader (600 ms cross-fade, instant with Reduce Motion),
  ProgressBar, Icon, Skeleton/EmptyState/ErrorState/AsyncContent, HeaderScreen, Wordmark.
- Theme provider: system/dark/light × day/night from the user's day start/end, rechecked every minute and on foreground.
- i18n EN/FR (i18next, react-i18next, expo-localization, date-fns `fr`), typed keys, parity + plural + usage tests.
- Navigation: 5 tabs (Today, Calendar, Goals, Routines, Me), `task/new` modal, not-found. Each screen has loading,
  empty, error (with retry) and success states backed by SQLite queries.
- SQLite: `SqlDriver` interface, expo-sqlite driver, better-sqlite3 driver (Node only), migration runner with
  rollback, migration 001 (full ARCHITECTURE.md section 4 schema with CHECK constraints) — `src/data/db/`.
- Firebase: config module (Zod, emulator forces a `demo-` project), lazy init, emulator switch — `src/services/firebase/`;
  `firebase/firebase.json`, `firestore.rules` skeleton (owner-only, allowed collections, server timestamp, immutable
  id/owner, default deny), `tests/rules/` emulator harness.
- `.env.example` (names only), synthetic seed (`npm run seed`, `src/data/seed/demoData.ts`).
- Brand: `scripts/render-brand.mjs` renders the wordmark paths, ember splash WebPs (day/night), native splash PNG,
  icons and favicon from code (opentype.js + resvg + sharp). Previews: `docs/screenshots/phase-2/brand-preview-*.webp`.

## Last verified checks (2026-11-09)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx expo lint` | pass (0 problems) |
| Format | `npx prettier --check .` | pass |
| Unit/UI tests | `npx jest` | pass — 7 suites, 97 tests |
| Rules tests | `npm run test:rules` (Firestore emulator) | pass — 9 tests (needs the Java workaround below in this sandbox) |
| Expo doctor | `npx expo-doctor` | pass — 20/20 checks |
| Android bundle | `npx expo export --platform android` | pass |
| Web | Expo web + Playwright `scripts/screenshots.mjs` at 390 px | see screenshots below |
| npm audit | `npm audit --omit=dev` / `npm audit` | 0 high/critical after the `@grpc/grpc-js` override; 22 / 29 moderate+low kept (see Known issues) |
| Secret scan | `git grep` for key/token patterns; tracked env/credential files | none found (only `.env.example` with names) |

## Known issues and risks
- `npm audit` (before fix): 4 high in production deps — `@grpc/grpc-js@1.9.16` (GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4)
  pulled by `@firebase/firestore@4.19.1` (pins `~1.9.0`), reported up through `firebase`. grpc-js is only used by the
  Node build of Firestore (rules tests), never by the RN/web app. Fixed with `"overrides": {"@grpc/grpc-js": "^1.14.7"}`
  in `package.json`; rules tests re-run and pass. Remove the override once Firebase ships a newer pin.
- Kept moderate/low advisories (build tooling only, not in the app bundle): `glob` GHSA-3g3m-2fjr-6pw4, `minimatch`
  GHSA-g3hv-75wg-m249, `deepmerge` GHSA-gcqx-w48m-w2h4 (low) — transitive through Expo CLI/Jest; `npm audit fix
  --force` would downgrade major tooling, so not applied.
- On web, pills/segments show the focus ring after a mouse click too (RN 0.88 Pressable has no `focus-visible`).
  Cosmetic; revisit with a `:focus-visible` web style in phase 4.
- Week view is a "coming soon" placeholder (phase 3).
- Java/Firestore emulator in this sandbox failed with `java.net.SocketException: Invalid argument: connect`
  (Unix-domain pipe). Workaround: `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=<short writable dir>` before
  `npm run test:rules`. Likely not needed on a normal machine.
- npm 11 `allow-scripts` blocked install scripts of `@firebase/util`, `protobufjs`, `esbuild`, `@parcel/watcher`.
  Not needed: the Firebase postinstall stub files ship in the package, esbuild works through its optional binary.
- Native runtime (Timeline, Auth persistence, SQLite WAL) not verified on a device: needs a dev build (Expo account) or
  a local Android SDK.
- Name "TickTack" vs existing app "TickTick": confusion/trademark risk for a public store listing (accepted for now).
- Local SQLite unencrypted; Firebase refresh token in AsyncStorage (ARCHITECTURE.md section 9).
- Firestore rules are a skeleton: no per-collection field allowlists, size checks or sticky tombstones yet (phase 3).
- Several stale Expo dev servers may still be running on ports 8081–8086 from this session (the sandbox refused to stop
  them); close them if you see them.

## Setup
- `npm install` then `npx expo start --web` (or `npm start`). Seed: `npm run seed -- --date 2026-11-09 [--reset]`.
- Web demo data: open `http://localhost:8081/?demo=1` in development.
- Rules tests: `npm run test:rules` (Java 21; `firebase-tools@15.35.0` through npx).
- Brand assets: `npm run render:brand` (`-- --preview` also writes preview images).
- Screenshots: start Expo web, then `node scripts/screenshots.mjs --base http://localhost:8081`.
- Env var names (no values): `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`, `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`,
  `EXPO_PUBLIC_USE_FIREBASE_EMULATOR`, `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`.

## Screenshots (phase 2, 390 px wide, 2x)
`docs/screenshots/phase-2/`: `{dark-day-en, dark-night-en, light-day-en, dark-day-fr}-{splash, today, calendar, goals,
routines, me}.webp` (first-run, empty database) and `{demo-dark-day-en, demo-light-day-fr}-*.webp` (synthetic demo data,
including `calendar-month`).

## Pending (priority order)
1. Phase 3 Core per `docs/MILESTONES.md`: Zod domain models, repositories with outbox, recurrence generator, auth +
   guest migration, sync engine, full `firestore.rules` with the denial matrix, onboarding/auth routes, Today/task/
   calendar screens.
2. Phases 4–6.

## Next step
Start phase 3 on `feat/phase-3-core` from this branch: add `src/domain/models` (Zod schemas per entity from
ARCHITECTURE.md section 3) and the task repository (validate → transaction with `local_rev++`, `dirty=1`, outbox
upsert) with better-sqlite3 tests.

## Waiting for approval (Needs from Steeven)
1. Review the phase 2 deviations above (routes in `src/app`, TS-module migrations, no COOP/COEP, icon-style native
   splash, device-local preferences).
2. Firebase project (free Spark plan): Auth email/password, Firestore native mode (suggested
   `northamerica-northeast1`), Web app config into the local `.env` (names above). Needed by end of phase 3.
3. Expo account (free) for EAS dev builds — needed to verify Timeline, Auth persistence and notifications on a device
   (phase 4), or install the Android SDK locally.
4. Optional: Apple Developer Program (paid) for iOS device builds — phase 6.
5. Android exact-alarm approach — phase 4.
6. Optional: Firestore TTL policy for tombstone purge.
