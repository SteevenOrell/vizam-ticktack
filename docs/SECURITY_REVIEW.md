# TickTack security and data review (Phase 5a)

_2026-11-11, branch `feat/phase-5a-security` (from `12950a3`), vizam-fullstack-developer (Opus)._

Scope: Firestore rules, client input limits, sign-out wipe, guest to account migration, sync robustness, dependencies
and secrets. UI screens and Settings were out of scope (Phase 4c ran in parallel). Synthetic data only; the real
Firebase project was not touched (emulator with the `demo-ticktack` project ID).

Severity: High = cross-user exposure or silent loss of user data; Medium = one user's data damaged or shown to the
next person on a shared device; Low = hardening, owner-only effect.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Signing in to an existing account on a new device overwrote the cloud profile with device defaults | Medium | Fixed |
| 2 | Scheduled notifications (task titles) survived sign-out and account deletion | Medium | Fixed |
| 3 | An interrupted sign-out left the previous account's data on the device | Medium | Fixed |
| 4 | Guest starter categories duplicated the account's after sign-in | Low | Fixed |
| 5 | One unreadable local row stopped every sync run (poison entry) | Medium | Fixed |
| 6 | Non-network push errors were retried forever | Low | Fixed |
| 7 | A device clock moved backwards could park an outbox entry far in the future | Low | Fixed |
| 8 | Timestamps (`createdAt`, `clientUpdatedAt`, `completedAt`...) were length-checked only | Low | Fixed (rules changed) |
| 9 | Client models were looser than the rules on goals and category names | Low | Fixed |
| 10 | Sync status counts of the previous account stayed in memory after sign-out | Low | Fixed |
| 11 | No per-user write quota; Firebase API key usable from any client | Medium | Open (console) |
| 12 | Rules cannot check every list element (routine steps, completed step ids, goal history) | Low | Accepted |
| 13 | The owner can hard-delete documents, which bypasses sticky tombstones | Low | Accepted |
| 14 | Local SQLite unencrypted; Auth refresh token in AsyncStorage | Low | Accepted (known) |
| 15 | `npm audit --omit=dev`: 21 moderate + 1 low, all build/test tooling | Low | Accepted |

Verified with no finding: cross-user get / list / create / update / delete on every collection, the profile and
`users` itself; collection-group queries across users; anonymous access; spoofed `ownerId`; `id` not matching the
path; client `updatedAt`; unknown and privilege fields (`role`, `isAdmin`, `plan`, `serverUpdatedAt`); nested and
unknown paths; tombstone resurrection; secrets in tracked files and in git history.

## Findings

### 1. Cloud profile overwritten on first sign-in on a device (Medium, fixed)
- **What:** after sign-in on a device, start-up housekeeping (`ensureProfile`) creates a profile with this device's
  defaults (time zone, week start, capacity 480, onboarding not done). Sync pushed before it pulled, so that new
  local row replaced the account's real profile in Firestore for every device.
- **Fix:** `src/sync/engine.ts`. Until the first pull finished on the device (`sync_state.pulled_once`), a profile
  the server has never confirmed is held back from the push; on pull, a profile never seen by the server loses to
  the cloud one (outbox entry dropped). A held profile (new account) is pushed right after that first pull.
- **Tests:** `src/sync/__tests__/robustness.test.ts`, "keeps the account's profile..." and "uploads a new account's
  profile right after the first pull".

### 2. Notifications survived sign-out and account deletion (Medium, fixed)
- **What:** the wipe emptied `scheduled_notifications` but not the OS schedule. Reminders with the previous
  account's task, routine and goal titles kept firing for whoever used the device next (cleanup only happened if
  the foreground upkeep ran later with permission, and the background task does nothing once its owner is wiped).
- **Fix:** `cancelAllReminders` (`src/services/notifications/maintenance.ts`) cancels every `tt_` notification (no
  permission needed, never throws); `FlowDeps.clearDevice` runs it after the wipe in `signOutFlow`,
  `deleteAccountFlow` and `clearSignedOutDevice`; wired in `SessionProvider` (`useFlowDeps`).
- **Tests:** `src/services/__tests__/accountSecurity.test.ts` ("empties every local table, cancels this app's
  notifications...", "account deletion also cancels...").

### 3. Interrupted sign-out kept the account's data (Medium, fixed)
- **What:** `signOutFlow` signs out, then wipes. If the app died in between, or the session was revoked elsewhere
  (password change, account disabled or deleted), the device started signed out with the account's rows still in
  SQLite (hidden from the guest views, but on disk), and a later sign-in to a different account wiped any guest data
  made in between.
- **Fix:** `clearSignedOutDevice` (`src/services/accountFlows.ts`): when Auth reports no user and the database is
  still bound to an account, wipe it (and cancel notifications). Guest data is never bound, so it is kept.
  Called from `SessionProvider` when Auth reports no user and no flow is running. Trade-off: changes not yet uploaded
  when a session is revoked elsewhere are lost (the device can no longer upload them anyway).
- **Tests:** `accountSecurity.test.ts`, "a signed-out start wipes a database still bound to an account...".

### 4. Duplicate starter categories after sign-in (Low, fixed)
- **What:** a guest gets the four starter categories; the account already has its own. After sign-in both sets
  synced, so "Health" etc. appeared twice and tasks were split between the twins.
- **Fix:** `src/data/mergeCategories.ts`, run once after the first pull on a device: live categories with the same
  name (case-insensitive, as the editor matches them) are merged into the oldest (then smallest id); tasks and
  routines are moved to it and the twins tombstoned, all queued like normal edits. This also cleans twins made by
  two offline devices (an open item from phase 3) the next time a device signs in.
- **Tests:** `robustness.test.ts`, "merges the guest's starter categories into the account's and moves their tasks".

### 5. Poison outbox entry blocked sync (Medium, fixed)
- **What:** `pushOutbox` turned each row into a document without checks. A row that no longer parsed (unreadable
  JSON column) threw and aborted the whole run, every time; a row breaking a rule was sent and refused.
- **Fix:** each row is parsed with its Zod schema before upload; a failure marks only that entry `failed` with
  `last_error = 'invalid-local'` and the rest of the queue continues.
- **Tests:** `robustness.test.ts`, "marks a row that no longer passes its schema..." and "does not let unreadable
  JSON in a row stop the sync run".

### 6. Endless retries (Low, fixed)
- **What:** every non-fatal code (`internal`, `resource-exhausted`, `unknown`...) was retried forever, every 15 min.
- **Fix:** after `MAX_RETRY_ATTEMPTS` (10) a non-network error marks the entry `failed` with its code. Network codes
  (`unavailable`, `deadline-exceeded`, `unauthenticated`; `NETWORK_CODES` in `src/sync/types.ts`) keep retrying with
  backoff, since being offline for days is normal.
- **Tests:** `robustness.test.ts`, "gives up on a write the server keeps refusing..." and "keeps retrying network
  errors...".

**Failed-entry shape for the Phase 4c list (unchanged):** `outbox.state = 'failed'`, `outbox.last_error` = a
Firestore code (`permission-denied`, `invalid-argument`, `failed-precondition`, `out-of-range`, or any non-network
code after 10 tries) or the new value `'invalid-local'` (the local row is damaged and was never sent; retrying
cannot help until the item is edited or discarded). `retryFailed` and `outboxStats` are unchanged.

### 7. Clock moved backwards (Low, fixed)
- **What:** `next_attempt_at` uses the device clock. If the clock jumped back (manual change, bad NTP), an entry
  could wait for hours or days.
- **Fix:** an entry due later than now + 15 min (the backoff cap) is treated as due. Conflict resolution never used
  device clocks (last write wins by server `updatedAt`; pull cursors are server times with a 60 s overlap).
- **Tests:** `robustness.test.ts`, "pushes an entry scheduled by a clock that later moved back a day" and "orders
  conflicting edits by server time, whatever the device clocks say".

### 8. Timestamps only length-checked (Low, fixed; rules changed)
- **What:** `createdAt`, `clientUpdatedAt`, `completedAt`, `achievedAt`, `onboardingCompletedAt` accepted any 10-40
  character string.
- **Fix:** `isIso` in `firebase/firestore.rules` and `ISO_DATETIME_RE` in `src/domain/models/index.ts` (the same
  pattern: `Date.toISOString()` output, offsets accepted). Every writer in the app uses `toISOString()`.
- **Tests:** rules "accepts ISO timestamps as the app writes them and denies anything else"; models
  `src/domain/__tests__/limits.test.ts`, "timestamps...".

### 9. Client models looser than the rules (Low, fixed)
- **What:** the goal model lacked the rules' cross-field checks (periodic goals need a start and no stored due date;
  due date not before start; history entries `start <= end`, `done <= total`), and category names could contain a
  line break (the rules' `^\S(.*\S)?$` refuses it). A local write passing Zod but failing the rules would sit in the
  failed list forever.
- **Fix:** `goalSchema.superRefine` and a single-line check on category names. All other lengths and ranges already
  matched and are now pinned by tests (Zod counts UTF-16 units, the rules count characters, so the client is never
  looser: verified in the emulator with 200 `é` and 100 emoji titles).
- **Tests:** `limits.test.ts` (38 cases: every limit at and past its value); rules "counts characters, not bytes".

### 10. Sync status after sign-out (Low, fixed)
- The in-memory `useSyncStatus` kept the previous account's pending / failed counts and last success time. Reset in
  the shared wipe path. Device preferences (`usePreferences`: theme, language, day window, onboarding seen,
  reminders used) are device settings, not account data, and are kept on purpose. `expo-secure-store` is installed
  but not used by the app, so there is nothing to clear there; the Firebase session itself is removed by
  `signOut()`. Firestore's cache is memory-only (nothing on disk).

### 11. No write quota, open API key (Medium, open: needs the Firebase console)
- Rules cannot count writes. A signed-in user (anyone can create an account) can write unlimited valid documents in
  their own space, which costs money; the web API key is public by design.
- **Steeven:** enable App Check (Play Integrity / App Attest) and enforce it for Firestore and Auth; restrict the
  API key to the Android/iOS app IDs and the Firebase APIs in Google Cloud; set a budget alert; turn on email
  enumeration protection in Firebase Auth (the app already shows one message for every sign-in failure).

### 12. List elements not checked one by one (Low, accepted)
- Rules have no loops: `routines.steps` (at most 30), `occurrences.completedStepIds` (at most 60) and goal `history`
  (at most 60, newest entry checked) are bounded in size and type, but older elements are not shape-checked. Owner
  data only; the client validates every pulled document with Zod and drops invalid ones, and Firestore caps a
  document at 1 MiB.

### 13. Owner hard-delete (Low, accepted)
- `allow delete` for the owner is required by in-app account deletion (no Cloud Functions). A hard-deleted document
  could then be re-created live, bypassing the sticky tombstone, and other devices would not learn of the delete.
  The app itself only hard-deletes during account deletion. Cross-user delete is denied (tested).

### 14. Local storage not encrypted (Low, accepted; ARCHITECTURE.md section 9)
- SQLite is plain on the device's app sandbox; the Firebase refresh token is in AsyncStorage. Protected by the OS
  sandbox and device lock; the wipe on sign-out covers shared devices.

### 15. Dependencies (Low, accepted)
- `npm audit --omit=dev` (2026-11-11): 0 critical, 0 high, 21 moderate, 1 low. All come from `glob` GHSA-3g3m-2fjr-6pw4
  and `minimatch` GHSA-g3hv-75wg-m249 (via `@expo/cli`, `@expo/fingerprint` and Jest) and `deepmerge`
  GHSA-gcqx-w48m-w2h4 (low, via `jest-config`). Jest counts as production because `expo-router` declares
  `@testing-library/react-native` as a peer. None of them is in the app bundle. The only fixes offered are major
  downgrades (`expo@52`, `jest@29`), so nothing was changed.

## Secrets
- `.env` and `.env*` are git-ignored (`.gitignore` line 15; only `.env.example` is allowed and holds names without
  values). `git ls-files` lists no key, certificate or service-account file.
- Pattern scan of the tracked tree and of every commit in history (`git log --all -p`) for Google API keys, private
  keys, Stripe, Slack and GitHub tokens: 0 matches. The only env-like file ever committed is `.env.example`.

## Rules changed: redeploy needed
`firebase/firestore.rules` changed (timestamp format, finding 8). Documents written by the app already comply. Steeven
must redeploy the rules to the real project (the rules were never deployed so far, see AGENT_HANDOFF "Waiting").

## Tests added
- `tests/rules/firestore.rules.test.ts`: "phase 5a" block, 7 tests (users listing and collection groups, privilege
  fields, profile identity and values, ISO timestamps, character counting, multi-line names and type confusion,
  hard-delete owner-only).
- `src/domain/__tests__/limits.test.ts`: 38 tests, client limits = rules limits.
- `src/sync/__tests__/robustness.test.ts`: 9 tests (poison, retry cap, network retries, clock skew, server-time
  ordering, first sync on an existing account, category merge).
- `src/services/__tests__/accountSecurity.test.ts`: 8 tests (sign-out wipe of every table, notifications, sync
  status, next user sees nothing, failures during sign-out, account deletion, signed-out start, migration rollback,
  no duplicates on retry, bound device).
- Already covered before: deleted on another device beats a concurrent edit (`engine.test.ts`, "applies a remote
  tombstone over a concurrent local edit"), cross-user access per collection (rules suite).
