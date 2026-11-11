# TickTack: remaining plan (approved 2026-11-10)

All rounds run on Fable 5.2 with the `vizam-fullstack-developer` agent, one fresh agent per step or slice, each on a
branch stacked on the previous one. Details and machine quirks: `docs/AGENT_HANDOFF.md`.

Usage figures are estimates against the weekly Fable window (about 6% per 100k tokens, coarse; recalibrated after
step 0). Usage before step 0: 5-hour 9%, weekly all-models 94%, weekly Fable 2%.

- [x] **Step 0: goal-repeat fix** (`feat/phase-3-goal-repeats`), 150-250k tokens, ~10-15%. Done 2026-11-10.
  A repeating task linked to a goal must end by the goal's due date, or by the end of the period for periodic goals.
  Block "Never" for these tasks, count progress only up to that end, fix the demo goal showing "1 of 37".
- [ ] **Phase 4: features**, 700k-1M tokens, ~40-60%, in three slices:
  - [x] 4a: task details screen, drag to reschedule, overdue and history views, week hour grid on tablet and desktop,
    desktop maximum width. Done 2026-11-10.
  - [x] 4b: milestones in goals, routine editing and the routine runner; task and routine reminders, background task,
    exact alarms (asked in-app, inexact fallback), `eas.json` dev profile. Done 2026-11-10. Still open: the
    on-phone check in a dev build (needs Steeven's EAS approval; checklist in AGENT_HANDOFF.md), routine runs in
    History.
  - [x] 4c: settings (week start, capacity, categories, failed-sync list); empty, error and loading states;
    accessibility. Done 2026-11-11. Model: mixed models per vizam-model-efficiency (Opus architecture/security,
    Sonnet routine UI, Haiku mechanical). Skipped on purpose: "Tomorrow / Pick date" swipe actions and haptics.
- [ ] **Phase 5: QA and security**, 400-600k tokens, ~25-35%. Full verification, access-control tests, rules, input
  limits, sign-out wipe, guest migration, screens compared with `DESIGN.md`.
  - [x] 5b: UI QA and verification (screens vs `DESIGN.md` at 390 / 1440, light / dark, EN / FR; layout sweep; i18n
    completeness; flaky-test hunt). Done 2026-11-11, results in `docs/QA_REPORT.md`, branch `feat/phase-5b-qa`.
  - [ ] 5a: rules, input limits, sign-out wipe, guest migration, sync robustness (parallel agent, own branch).
- [ ] **Phase 6: delivery**, 300-500k tokens, ~20-30%. README, refreshed docs, security summary, known limitations,
  EAS preview-build instructions, portfolio summary and screenshots.
- [ ] Checking between rounds (tsc, jest, screenshots), 200-300k tokens, ~12-18%.

Total: about 1.7-2.6M tokens, ~100-160% of one weekly Fable window, so two windows. Suggested split: step 0 and
Phase 4 before the reset on 2026-11-12 12:00 UTC, Phases 5 and 6 after it. Hand off after every step.

Needed from Steeven: deploy the Firestore rules, exact-alarm decision, EAS dev build approval.
