# TickTack security summary

A one-page, plain-language version of [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) (phase 5a, 2026-11-11). TickTack is a
concept / portfolio project; the review used synthetic data and the local Firebase emulator, never the real project.

## What is protected, and how

| What | How |
|---|---|
| **Each person's data stays theirs.** | Firestore security rules let a signed-in user read and write only their own documents. Other users, anonymous visitors, collection-wide searches and unknown paths are refused. |
| **Nobody can fake ownership or add powers.** | The rules check that the owner field and the document ID match the signed-in user, ignore client-set server timestamps, and refuse fields such as `role`, `isAdmin` or `plan`. |
| **Bad or oversized data is refused.** | Every field has a type and a length limit (counted in characters, not bytes), timestamps must be real ISO dates, and lists have a size cap. The app checks the same limits before it sends anything, so a normal user never hits the server's refusal. |
| **Data coming from the cloud is not trusted.** | Every downloaded document is validated again on the device; an invalid one is dropped. |
| **Deleted stays deleted.** | Deletions are kept as markers ("tombstones") that an edit from another device cannot bring back. |
| **A shared phone does not leak.** | Signing out or deleting the account wipes the local database, cancels every scheduled reminder (they contain task titles) and clears the sync status. If the app dies mid sign-out, the next start finishes the wipe. |
| **Signing in on a new device does not damage the account.** | The device's default profile can no longer overwrite the real one in the cloud, and the starter categories of a guest are merged instead of duplicated. |
| **One broken item cannot block syncing.** | A row that fails validation is set aside and listed in Me > "Review failed changes"; the rest keeps syncing. Server refusals stop being retried after 10 tries; being offline is retried without limit. |
| **Secrets.** | No keys, certificates or service-account files are tracked; the repository and its full git history were scanned (0 matches). The Firebase web config is public by design and protected by the rules. |

## What was tested

- **Rules:** 71 tests on the Firebase emulator, covering get / list / create / update / delete across users on every
  collection, anonymous access, spoofed owners, privilege fields, tombstone resurrection, timestamps, character
  counting and hard delete.
- **App tests:** 701 tests in 40 suites cover limits (38 cases, each at and past its value), sync robustness (poison
  entry, retry cap, clock moved backwards, server-time ordering, first sync on an existing account, category merge)
  and the account flows (wipe of every table, notifications, sign-out failures, account deletion, migration rollback).
- **Dependencies:** `npm audit --omit=dev` showed 0 critical, 0 high, 21 moderate and 1 low; all in build and test
  tooling, none in the app bundle.

Findings: 10 were fixed (4 medium on data exposure and sync, 6 low), 1 medium is open (below), 4 low ones are
accepted with reasons.

## Remaining risks

| Risk | Why it remains |
|---|---|
| **No per-user write quota; the API key is usable from any client.** Anyone can create an account and write many valid documents in their own space, which costs money. | Rules cannot count writes. Needs console settings (next section). Medium, open. |
| **Local data is not encrypted.** The SQLite file and the sign-in refresh token sit in the app's private storage. | Protected by the phone's app sandbox and screen lock; the wipe on sign-out covers shared devices. Accepted. |
| **Rules cannot check every list element** (routine steps, completed step ids, goal history). | Size and type are bounded, only the owner's own data is affected, and the app re-validates on download. Accepted. |
| **The owner can hard-delete their own documents,** which bypasses the deletion markers. | Needed so the app can delete an account without Cloud Functions; other users cannot delete anyone's data. Accepted. |
| **Moderate advisories in build tooling** (`glob`, `minimatch`, `deepmerge`). | Not shipped in the app; the only offered fixes are major downgrades. Accepted. |

## To do in the console (Steeven)

1. **Deploy the current Firestore rules** to the real project. They were never deployed; the latest version adds the
   ISO timestamp check and the goal fields. Command in the README.
2. **App Check:** enable Play Integrity (Android) and App Attest (iOS) and enforce it for Firestore and Authentication,
   so only the real app can call the project.
3. **Restrict the API key** in Google Cloud (Credentials): limit it to the app's Android / iOS identity and to the
   Firebase APIs the app uses.
4. **Budget alert:** set a billing budget with email alerts on the Firebase / Google Cloud project, so abuse shows up
   as a notification instead of a bill.
5. **Email enumeration protection:** turn it on in Firebase Authentication settings (the app already shows one
   message for every sign-in failure).
6. If the app ever goes to the Play Store, the production steps (privacy policy, exact-alarm justification) are in
   [`RELEASE.md`](RELEASE.md).
