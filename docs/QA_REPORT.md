# TickTack: QA report, phase 5b (UI QA and verification)

_2026-11-11, branch `feat/phase-5b-qa` (from `1d52b91`). Scope: screens, components, i18n, design tokens, UI tests.
Firestore rules, input limits, sign-out wipe, guest migration and sync robustness are phase 5a (separate branch)._

All numbers below come from runs made on this branch. The web app was served with the emulator flag
(`EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true`), so nothing talked to a real Firebase project, and Chromium (Playwright)
drove it with the demo data (`?demo=1`) and a fixed clock (Mon 9 Nov 2026, 10:30).

## 1. What was checked

| Area | Method | Result |
|---|---|---|
| Screens vs `docs/DESIGN.md` | `node scripts/screenshots-5b.mjs`: 20 screens x 390 and 1440 px x light / dark x EN / FR (160 shots, webp in `docs/screenshots/phase-5b/`, plus one contact sheet per theme / language / width). Every sheet and a set of full-size shots were looked at. | 4 deviations found and fixed (section 3). The rest matches tokens, spacing, radii and states. |
| Horizontal scroll | Same script: `scrollWidth - innerWidth` on every shot, and on 15 routes x 5 widths x 2 languages (150 page loads) | 0 px at 300, 390, 768 and 1440 in both languages |
| 240 px lock | Same 150 loads at 240 px | `#root` is 500 px on all 30 loads, no fixed element wider than 500 px, the page pans (overflow 260 px, as designed) |
| Console | Every page error, `console.error` and `console.warn` during the 160 shots and 150 width loads | 0 (the dev-only Reanimated "reduced motion" warning is filtered, it is emitted because the script asks for reduced motion) |
| Truncated text | Script lists every text element wider than its box | 46 candidates left, all intended (section 4) |
| i18n completeness | `src/i18n/__tests__/parity.test.ts` (8 tests) | Same keys in EN and FR (plural bases), every plural category each language needs, same `{{variables}}`, every `t('key')` in the source exists. New: no value identical to English in FR unless on a 20-entry allow-list of words that are the same in both languages (names, "Routines", "Notes", "OK"...), and the allow-list cannot rot. New: French goal progress agrees in number. |
| Flaky tests | Full `npx jest` 3 times before changes (parallel, parallel, `--runInBand`) plus one run with all 8 cores kept busy by 8 spinning processes | 4 of 4 green (646 tests, 37 suites). The one earlier failure could not be reproduced. Hardened anyway (section 5). |
| Final gate | see section 6 | |

## 2. Screens covered

Today, Calendar (day, week, month), Goals, Routines, Me, History, Overdue, Categories, Sync problems, New task,
New goal, New routine, Delete account, task details, goal details, routine details, Sign in, Create account, Reset
password and Onboarding (first step), each in light-en, dark-en, light-fr and dark-fr at 390 x 844 (2x) and 1440 x 900.
Auth and onboarding were shot in light-en and dark-fr only (the other two combinations use the same components).

## 3. Fixes made

| # | Finding (where) | Fix | Commit |
|---|---|---|---|
| 1 | Tab bar labels lost the descender of "j" / "g" ("Aujourd'hui", "Objectifs") at the bottom edge (every screen, 390 px) | label line height 16 to 20, bar height 58 to 62 dp plus the safe-area inset (the FAB and the Undo bar position follow the same variable) | `fix(ui): tab labels...` |
| 2 | Task row meta line was one non-wrapping line: on History in French the category and goal were cut to "Sa..." and "Courir un 1..." | meta line wraps to a second line; a part that is longer than the whole line still truncates | `fix(ui): wrap task meta line...` |
| 3 | "Toute la journée" cut to "Toute la journ..." in the half-width start-time field (New task, French, 390 px) | select field value may use two lines; the two side-by-side fields stay the same height (`alignItems: stretch`, `flexGrow`); same in the goal form | same commit |
| 4 | Edit / action button on pushed screens (task, goal, routine details) ended 12 px from the screen edge while all content uses the 20 px screen padding | action lines up with the 20 px padding (the back button keeps its centred 44 px target) | same commit |
| 5 | French goal progress read "0 sur 1 faites" | plural forms `doneOfTotal_one/_many/_other` and `thisPeriod_*`, counted on the total ("1 faite", "6 sur 12 faites"), with a test | `fix(i18n): French goal progress...` |
| 6 | `scripts/screenshots-feedback.mjs` shot two identical splash images (`splash-day`, `splash-night`; the splash became one charcoal design in the phase 4 feedback) | one `splash` shot, the duplicate image removed | `fix(screenshots): one splash shot` |

## 4. Remaining WARNs (kept, with a reason)

| WARN | Reason |
|---|---|
| One-line note excerpt in the task preview ("Keep it to two pages and share it with the team on...", the run note) is ellipsised on Today and the week agenda | Intended: DESIGN.md section 7 specifies a one-line excerpt; tapping the preview expands the full note |
| Week hour grid at 1440 px: block titles are ellipsised in narrow or overlapping lanes ("Point d'...", "Ébauch...") | Intended: DESIGN.md says blocks show the title only in the 7-column grid; overlapping items share a lane. The full text is in the accessibility label and task details |
| The bottom tab bar spreads its 5 items over the whole width at 1440 px | The content column is 720 px (DESIGN.md section 5, backgrounds stay full width) but the tab bar is not clamped to it. Cosmetic on desktop web only, left because Expo Router's tab bar has no supported "max width" and a custom bar is out of scope for a QA phase |
| 240 px layout needs a horizontal pan (overflow 260 px) | Required by the project rule (lock the layout at 500 px below 250 px and let visitors pan) |
| Long screens (Me, forms) are shot at the top only; their lower halves are not in the phase 5b sheets | The 4c screenshots cover the Me sections, and the layout sweep checks overflow on the full page; a scrolled shot of every long screen would double the run time |
| Real devices: drag, haptics, notifications, fonts under Dynamic Type and Android edge-to-edge insets are not covered by web screenshots | Needs the EAS development build (waiting for Steeven's go-ahead, see `docs/AGENT_HANDOFF.md`) |
| `npm audit`: the three build-tooling advisories listed in the handoff (`glob`, `minimatch`, `deepmerge`) are unchanged | Not in the app bundle; the fix would downgrade major tooling. Phase 5a owns dependency and security review |
| Flaky failure not reproduced | See section 5; the cause is inferred, not observed |

## 5. Flaky-test hunt

- Baseline (before any change): run 1 parallel 182 s, run 2 parallel 75 s, run 3 `--runInBand` 169 s, run 4 parallel
  with 8 busy-loop processes on the 8 cores: all 646 tests passed, 37 suites.
- Suspects read: only three suites use fake timers (`feedback`, `goals`, `SwipePager`; they restore real timers in
  `afterEach` or `finally`); UI tests use an injected clock (`NOW`), so they do not depend on the wall clock or on
  midnight. The documented failure pattern (handoff, phase 4b: `routines.test.tsx` failing 4 tests on timeouts when run
  in parallel with another suite) points at the `waitFor` limit (5 s) and the 30 s per-test limit being hit by slow
  SQLite-backed renders on a loaded machine, not at a logic race.
- Change: `asyncUtilTimeout` 5 s to 15 s (`jest.setup.ts`) and `testTimeout` 30 s to 60 s (`jest.config.js`). They only
  cost time when a test is really failing. Not changed: worker count.
- After the change: see section 6.

## 6. Final results on the tip of the branch

See "Phase 5b" in `docs/AGENT_HANDOFF.md` for the commit list and the exact check output summary.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx expo lint` | exit 0, no errors, no warnings (one `import/no-named-as-default-member` warning in the new test was fixed) |
| `npx prettier --check --end-of-line auto src tests scripts jest.config.js jest.setup.ts docs/QA_REPORT.md` | clean |
| `npx jest`, run 1 (parallel) | 37 suites, 646 tests passed, 166 s |
| `npx jest --runInBand`, run 2 | 37 suites, 646 tests passed, 280 s |
| `npx jest`, run 3 (parallel, 8 processes keeping all 8 cores busy) | 37 suites, 646 tests passed, 462 s |

## 7. How to repeat

1. `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8102` (restart with `--clear` after edits: Metro
   does not see edits inside this `.claude` worktree).
2. `node scripts/screenshots-5b.mjs` (about 25 minutes cold; `--only shots|widths`, `--widths 390,1440`).
3. Read `docs/screenshots/phase-5b/report.json` (overflows, console errors, truncated text, width rows) and the
   `sheet-*.webp` contact sheets.
