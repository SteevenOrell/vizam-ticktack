# TickTack: portfolio case study

_A VIZAM concept / portfolio project. Not a store product; the demo data shown in the screenshots is synthetic._

## Problem

Planner apps tend to break at exactly the moments people use them: on a train without signal, on a shared phone, or
when a reminder has to ring at the minute it was set. TickTack explores what a small planner looks like when it is
built offline-first, treats the user's data as private by default, and still stays pleasant: one place for the day's
tasks, a calendar, goals that count real progress, and routines you can run step by step, in English and French.

## Approach

- **Local first.** SQLite on the device is the source of truth, so every screen works instantly and offline. An outbox
  queues each change and a sync engine uploads it to Firestore when a connection exists, with retries, a visible list
  of changes the server refused, and last-write-wins by server time.
- **Untrusted by default.** Firestore rules scope every document to its owner and check types, lengths, timestamps and
  cross-field rules; the app validates everything it pulls down; sign-out wipes the device, including scheduled
  reminders.
- **Honest about the platform.** Android exact alarms are asked for in-app with an explanation and degrade to inexact
  reminders; reminders use a rolling 7-day window reconciled with the OS schedule.
- **Built in verified slices.** Each phase (foundation, core, feedback rounds from phone tests, task views,
  routines and reminders, settings, QA, security) ended with tests, screenshots and a written handoff.

## Highlights

- Today view with a workload bar against a daily capacity, overdue and history screens.
- Calendar day (24 h timeline with drag to reschedule), week (agenda on phones, hour grid on wide screens) and month,
  with swipe paging.
- Goals with milestones: progress comes from linked tasks, repeating tasks end with the goal.
- Routines with a step runner and timers; routine runs appear in History.
- Local reminders and Android exact alarms, plus a background task that keeps the reminder window current.
- Guest mode that migrates into an account without duplicating data.
- Full English and French, light and dark, accessibility roles and names on every pressable, 44 px targets, contrast
  tests.
- Layout verified at 240, 300, 390, 768 and 1440 px.

## Stack

Expo SDK 58, React Native 0.88, React 19, TypeScript (strict), Expo Router, `expo-sqlite`, Zod, Zustand, Firebase Auth
and Firestore (JS SDK), Reanimated 4, `react-native-calendars`, `expo-notifications`, `expo-background-task`, i18next,
Jest, Firebase Emulator Suite, EAS Build.

## Numbers (from the project docs)

| Measure | Value | Source |
|---|---|---|
| Jest tests | 701 tests in 40 suites | latest full run on the merged phase 4c / 5a / 5b tip (not rerun here) |
| Firestore rules tests | 71 | `npm run test:rules` (not rerun here) |
| Client limit tests | 38 cases (each limit at and past its value) | SECURITY_REVIEW |
| Screens shot for UI QA | 20 screens x 390 / 1440 px x light / dark x EN / FR = 160 shots | QA_REPORT |
| Layout sweep | 150 page loads (15 routes x 5 widths x 2 languages), 0 px horizontal overflow at 300 / 390 / 768 / 1440 | QA_REPORT |
| Security findings | 15: 10 fixed, 1 open (console settings), 4 accepted | SECURITY_REVIEW |
| Secret scan | 0 matches in the tree and full git history | SECURITY_REVIEW |
| Dependency audit (production) | 0 critical, 0 high, 21 moderate, 1 low; all in tooling | SECURITY_REVIEW |

## Screenshots to use

All paths are under `docs/screenshots/` (webp, 390 px wide at 2x unless noted). Chosen from phase 5b and 4c after
looking at them; the demo date is fixed at Mon 9 Nov 2026.

| # | File | Shows |
|---|---|---|
| 1 | `phase-5b/light-en-today-390.webp` | Today, light, English: workload bar, overdue, timeline-style list |
| 2 | `phase-5b/dark-fr-today-390.webp` | Today, dark, French ("Aujourd'hui") |
| 3 | `phase-5b/dark-en-calendar-day-390.webp` | Calendar day: 24 h timeline with overlapping items |
| 4 | `phase-5b/light-fr-calendar-week-390.webp` | Calendar week, light, French |
| 5 | `phase-5b/light-en-calendar-month-390.webp` | Calendar month with day preview |
| 6 | `phase-5b/dark-en-goal-detail-390.webp` | Goal details: progress arc, milestones, linked tasks, reminders |
| 7 | `phase-5b/light-en-routine-detail-390.webp` | Routine details with the Start routine button and steps |
| 8 | `phase-5b/dark-en-goals-390.webp` | Goals list with progress bars |
| 9 | `phase-4c/dark-en-categories.webp` | Categories settings |
| 10 | `phase-5b/sheet-light-en-390.webp` and `sheet-dark-fr-390.webp` | Contact sheets of all 20 screens: good for an overview strip |

Also available: every screen in light and dark, EN and FR, at 1440 px (`phase-5b/*-1440.webp`) for a desktop framing.
Capture a phone-frame video or fresh shots only after the dev build is checked on a real device (see `RELEASE.md`).
