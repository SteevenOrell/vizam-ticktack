# TickTack: release guide

Documentation only: no EAS build, submission or store action was run for this document. The EAS project is
`@vizam/ticktack` (owner `vizam`, Android package `com.vizam.ticktack`, see `app.config.ts`). Build profiles are in
`eas.json`: `development` (dev client, internal APK), `preview` (internal APK, no dev client), `production`
(auto-increment version).

## 1. Preview build (installable APK for testing)

The `EXPO_PUBLIC_FIREBASE_*` variables are already set in EAS for the `development` and `preview` environments (names
in `.env.example`; they are public identifiers, so "plain text" visibility is right). `.env` is git-ignored and is not
uploaded, which is why EAS needs its own copy.

```bash
npx eas-cli@latest login                                  # once
npx eas-cli@latest build --profile preview --platform android
```

- The build runs in the cloud and takes a while; follow it in the terminal or on the EAS dashboard.
- When it finishes, EAS prints a build page with a QR code and a link to the APK.
- Rebuild whenever native config or dependencies change (`app.config.ts`, a new native module, a changed
  `EXPO_PUBLIC_*` value). JS-only changes need a new build too, unless EAS Update is added (not configured).

### Install the APK

1. On the Android phone, open the build page link (or scan the QR code) and download the APK.
2. Allow installing from that source when Android asks ("Install unknown apps" for the browser).
3. Open the APK, install, then open TickTack. Play Protect may warn about an unreviewed app; this is normal for an
   internal build.
4. Alternative from a computer: `adb install <file>.apk`.

For the dev build (hot reload, tunnel) use `--profile development`, install the same way, then run
`npx expo start --tunnel --clear` and open the app from the dev client.

## 2. Phone checklist

Run in the development or preview build (reminders, exact alarms and the background task need a native build; the
Expo Go items can also be checked there). Tick each, note anything odd with the screen and language.

### Reminders and exact alarms (phase 4b)

- [ ] Android 14+: turn on a task reminder and allow notifications; the "Ring reminders on time?" dialog appears;
  "Open the setting" opens Alarms & reminders; allow TickTack, come back: the "may arrive late" note is gone.
- [ ] Same with "Not now": the note stays; the reminder still arrives (possibly a few minutes late).
- [ ] A task at now + 20 min with "10 min before": the notification arrives on time (exact access on); tap it with the
  app killed: the task's details open (for a repeating task, that day).
- [ ] A routine reminder: tapping opens the routine screen. A goal reminder still opens the goal.
- [ ] Move the task to tomorrow, mark it done, delete it: the pending notification moves or disappears.
- [ ] Background task: leave the phone a day; a daily task's reminder for the new 7th day was added without opening the
  app (iOS runs it at the system's discretion).
- [ ] Revoke Alarms & reminders in system settings: the app restarts; reminders keep arriving (inexact) and the note
  returns.

### Settings, categories, history (phase 4c)

- [ ] Me > Planning: week start Monday: Calendar week and month start on Monday; New task > Repeat weekly lists
  weekdays from Monday; a new weekly goal's period starts Monday. Change the daily capacity: Today's workload bar
  changes.
- [ ] Me > Categories: add, rename, recolour (Today rows and Calendar blocks update), delete one that has tasks (move
  them to another / none) and confirm the tasks changed.
- [ ] Me > Reminders on Android with exact alarms off: "Ring on time" explains and opens Alarms & reminders.
- [ ] Complete a routine (Today tick or the runner): History lists it under today.
- [ ] Long-press a timed task: "Move 15 minutes earlier / later" works; with TalkBack / VoiceOver on, the timeline
  block offers move earlier / later / Quick edit.
- [ ] Failed-sync list: only testable with a failing write; otherwise Me shows no "Review failed changes" button.

### Calendar and feel (feedback rounds)

- [ ] Swipe Day, Week and Month both ways several times: no blank flash, no old page coming back; after scrolling down
  in Week or Month and swiping, the new page is at the top; arrows and Today slide the same way.
- [ ] Long-press and drag a block on the day timeline moves it; vertical scroll still works when a drag starts a little
  sideways.
- [ ] Finger-scroll reaches the last row on Today and Calendar day, clear of the "+" button.
- [ ] Swipe a task row left: Edit / Delete appear; Delete shows Undo for 5 s.
- [ ] Keyboard: in the task editor, goal form, sign-in and the "New goal" field the focused field stays above the
  keyboard (also inside sheets).
- [ ] Task row preview expands in place with tickable subtasks; quick edit sheet saves.
- [ ] Goals: create one with a task; milestones tick; repeating tasks stop at the goal's end.
- [ ] Sign in / create account on a second device: tasks appear; sign out: data and reminders are gone from the first
  device; guest data made before sign-in is kept.
- [ ] Switch language (EN / FR) and theme (light / dark) and look at every tab; check large system font size.

## 3. Play Store production build (not done; steps only)

1. **Accounts and identity:** a Google Play Console developer account; keep `com.vizam.ticktack` (or decide the final
   package now: it cannot change after publishing). Fill the store listing (icon, screenshots, short and full
   description; label it clearly as it is).
2. **Signing:** let EAS manage the keystore (`npx eas-cli@latest credentials` shows it) and enable Play App Signing in
   the Console; back up the upload key. `eas.json` production uses `autoIncrement` with remote versions.
3. **Environment:** set the `EXPO_PUBLIC_FIREBASE_*` variables for the `production` environment in EAS.
4. **Build and submit:**
   ```bash
   npx eas-cli@latest build --profile production --platform android   # produces an AAB
   npx eas-cli@latest submit --profile production --platform android
   ```
   Submitting needs a Google service-account key; set it up in the Console and in EAS, never commit it.
5. **`SCHEDULE_EXACT_ALARM` justification:** the manifest declares `android.permission.SCHEDULE_EXACT_ALARM`.
   Google Play restricts exact alarms, so in Play Console > App content > Exact alarms (Permissions declaration) state
   the core feature: user-set task, routine and goal reminders that must ring at the chosen minute. Explain that the
   app asks for access in-app only after the user enables a reminder, works without it (inexact delivery), and does not
   use `USE_EXACT_ALARM`. If Google refuses, remove the permission from `app.config.ts`; reminders then stay inexact.
6. **Privacy policy:** required (the app uses Firebase Auth and Firestore). Publish a page that lists what is
   collected (email address, tasks, goals, routines, categories, settings), where it is stored (device; Firebase /
   Google Cloud), that data is not sold or used for ads, that Analytics is not used, how to delete the account
   (Me > Delete account removes the account and its data) and a contact address. Link it in the listing, and complete
   the Data safety form to match.
7. **Console hardening first:** deploy the Firestore rules, enable App Check, restrict the API key, set a budget alert
   and email enumeration protection ([`SECURITY_SUMMARY.md`](SECURITY_SUMMARY.md)).
8. **Test track:** release to internal testing, then closed testing. New personal developer accounts must meet Google's
   closed-testing requirements before production; check the current rules in the Console.
9. **Content rating and target audience** questionnaires, then roll out to production.

iOS: not built or tested. It would need an Apple Developer Program membership, an App Store Connect record and
`--platform ios` builds.
