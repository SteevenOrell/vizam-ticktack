# TickTack

TickTack is an offline-first mobile planner: a Today view, a calendar, repeating tasks, goals with milestones, routines,
reminders and a history, in English and French, light and dark. It works fully without an account; signing in syncs
everything across devices through Firebase.

It is a **VIZAM concept / portfolio project** with its own identity (not a store product). Built with Expo SDK 58,
React Native, TypeScript, SQLite and Firebase.

## Features

- **Tasks:** title, date, start time, duration, priority, category, notes, subtasks, goal link, reminder. Repeats
  (daily, weekly, monthly, every N, with an end). Quick-edit sheet, task details screen, delete with Undo (for a
  series: this one, following or all).
- **Today:** the day's timeline-style list, workload bar against a daily capacity, and links to Overdue and History.
- **Calendar:** day (24 h timeline, long-press and drag to reschedule), week (agenda on phones, hour grid on tablet and
  desktop) and month views, swipe between periods.
- **Goals with milestones:** one-off or periodic goals (daily to yearly), linked tasks drive the percentage,
  milestones are a checklist beside it, repeating tasks end with the goal.
- **Routines and the runner:** ordered steps with optional timers, a step-by-step runner, completed runs appear in
  History.
- **Reminders and exact alarms:** local notifications for tasks, routines and goals (next 7 days, rebuilt when the app
  opens and by a background task). On Android the user is asked for exact alarms in-app; without them reminders still
  arrive, possibly a few minutes late.
- **Overdue and History:** a list of open items from before today with "Move to today / Mark done", and a history of
  done and missed items.
- **Settings (Me tab):** theme (system, dark, light), language (system, English, Francais), week start, daily
  capacity, categories (add, rename, recolour, delete), reminders state, failed-sync list, account (sign in, create,
  reset password, sign out, delete account).
- **EN / FR and light / dark:** every string exists in both languages (a test enforces it); dark is the default design,
  light is "paper".
- **Offline-first with Firestore sync:** everything is saved on the device first and uploaded when a connection is
  available. Guest data is kept when the user creates an account.

## Tech stack

| Concern                 | Choice                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| App                     | Expo SDK 58, React Native 0.88 (New Architecture), React 19, TypeScript (strict), Expo Router (typed routes)           |
| Local data              | `expo-sqlite` (source of truth), versioned SQL migrations, repositories validated with Zod                             |
| Cloud                   | Firebase Auth (email / password) and Firestore, through the JS SDK; Firestore's own offline cache is not used          |
| State                   | Zustand (session, UI, sync status only)                                                                                |
| Calendar, lists, motion | `react-native-calendars`, `@shopify/flash-list`, Reanimated 4, Gesture Handler                                         |
| Notifications           | `expo-notifications`, `expo-background-task`                                                                           |
| i18n                    | `i18next`, `react-i18next`, `date-fns`                                                                                 |
| Tests                   | Jest (`jest-expo`, Testing Library, `better-sqlite3` as the Node SQLite driver), Firestore rules tests on the emulator |

Exact versions and the reasoning: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Architecture in short

```
UI screens  ->  repositories (src/data)  ->  SQLite (source of truth)
                                                 |
                                   outbox table (every local write)
                                                 |
                       sync engine (src/sync): push, then pull  <->  Firestore
```

- **SQLite is the source of truth.** Screens read and write through repository hooks; nothing waits for the network.
- **Outbox sync.** Every write also queues an outbox entry. The sync engine pushes entries (with backoff, a retry cap
  and a "failed" state the user can review), then pulls changes by server time. Conflicts: last write wins by server
  `updatedAt`; deletes are sticky tombstones.
- **Remote data is untrusted.** Every pulled document is validated with the same Zod schema used for local writes.
- **Security rules.** [`firebase/firestore.rules`](firebase/firestore.rules) restrict each user to their own documents,
  check types, lengths, ISO timestamps and cross-field rules, and deny everything else.
- **Recurrence** is generated in a bounded window with stable IDs; **reminders** use a rolling 7-day window reconciled
  with the OS schedule.

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

Requirements: Node.js and npm. Java 21 only for the Firestore rules tests.

```bash
npm ci --ignore-scripts      # on machines without a C++ / Python toolchain; see note below
cp .env.example .env         # then fill in the values (never commit .env)
```

`npm ci --ignore-scripts` skips native build steps. `better-sqlite3` (used only by the tests) ships prebuilt Windows
binaries that load fine; on other systems run a plain `npm ci`.

### Environment variables

Names only, see [`.env.example`](.env.example). They are read at build time (`EXPO_PUBLIC_*`) and are public
identifiers; access is protected by the Firestore rules, not by hiding them.

| Name                                       | Purpose                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `EXPO_PUBLIC_FIREBASE_API_KEY`             | Firebase web app config                         |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`         | Firebase web app config                         |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID`          | Firebase web app config                         |
| `EXPO_PUBLIC_FIREBASE_APP_ID`              | Firebase web app config                         |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase web app config                         |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`      | Firebase web app config                         |
| `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`      | Optional; Analytics is not used                 |
| `EXPO_PUBLIC_USE_FIREBASE_EMULATOR`        | `true` to use the local Firebase Emulator Suite |
| `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`       | Emulator host (no scheme, no port)              |

`npm run env:from-root` maps a plain-named Firebase `.env` into these names.

## Running the app

### In Expo Go (fastest, most features)

```bash
npx expo start --tunnel --clear --go
```

Scan the QR code with Expo Go. `--tunnel` is used because many Wi-Fi networks block LAN mode. The first tunnel start
and the first bundle are slow: pre-warm it a few minutes before you need it. Expo Go cannot show everything: exact
alarms and the background task need the development build.

### In the development build (reminders, exact alarms, background task)

The EAS project is `@vizam/ticktack`. Build once, install the APK, then start the dev server:

```bash
npx eas-cli@latest build --profile development --platform android
npx expo start --tunnel --clear
```

The `EXPO_PUBLIC_FIREBASE_*` variables must exist in the EAS environment for the profile used. Preview (installable
APK without a dev server): see [`docs/RELEASE.md`](docs/RELEASE.md).

### On the web (for development and screenshots)

```bash
npx expo start --web
EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web   # without touching the real project
```

Demo data (development only): add `?demo=1` to the web URL. Emulators: `npm run emulators`; seed them with
`npm run seed:emulator`.

## Tests and checks

```bash
npx jest                 # 701 tests in 40 suites (unit, data, sync, UI)
npm run test:rules       # 71 Firestore rules tests on the emulator (needs Java 21)
npm run check            # typecheck, lint, format check and jest
```

On Windows sandboxes the rules emulator can fail to start its Unix socket; set a short socket directory first, for
example `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\t` (create the folder). The rules suites run one at a time
because they share one emulator.

## Deploying the Firestore rules

The rules are not deployed by the app or by CI; do it yourself after reviewing [`firebase/firestore.rules`](firebase/firestore.rules):

```bash
npx --yes firebase-tools@15.35.0 login
npx --yes firebase-tools@15.35.0 deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project <your project id>
```

Signed-in sync fails against a project that still has older rules, so redeploy whenever `firestore.rules` changes.

## Project structure

```
src/
  app/        Expo Router routes (tabs, task, goal, routine, settings, history, overdue, auth, onboarding)
  features/   screens and feature components (today, calendar, tasks, goals, routines, settings, auth, ...)
  data/       SQLite repositories, migrations, queries, demo seed
  domain/     pure logic and Zod models (recurrence, goals, timeline, rescheduling, routine runs)
  sync/       outbox sync engine, Firestore adapter, controller
  services/   auth, account flows (sign out wipe, migration), notifications, background task, Firebase
  state/      Zustand stores
  i18n/       i18next setup and the EN / FR locale files
  ui/         design-system primitives and theme tokens
firebase/     firestore.rules, indexes, emulator config
tests/        rules tests, UI tests, test support
scripts/      seed, screenshots, brand rendering, env helper
docs/         project documentation (below)
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): stack, data model, sync, rules, notifications
- [`docs/DESIGN.md`](docs/DESIGN.md): identity, colours, typography, components, screens
- [`docs/SECURITY_SUMMARY.md`](docs/SECURITY_SUMMARY.md) (plain language) and [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) (full)
- [`docs/QA_REPORT.md`](docs/QA_REPORT.md): UI QA and verification
- [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)
- [`docs/RELEASE.md`](docs/RELEASE.md): preview builds, phone checklist, Play Store steps
- [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md): case study and screenshots
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md), [`docs/MILESTONES.md`](docs/MILESTONES.md),
  [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md): plan and working notes
