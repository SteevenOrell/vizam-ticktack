# TickTack — Design direction

_VIZAM portfolio concept. Phase 1, 2026-11-09. Proposal awaiting approval._

## 1. Identity

- **Product:** TickTack — "Plan the day you mean to have." An intentional planner: you choose what fits today, see how
  full the day is, and close it with a short review. Calm, confident, a little bold.
- **Personality:** a well-made wristwatch, not a productivity dashboard. Big numerals, few colours, warm orange used
  sparingly as the "now" signal.
- **Logo idea (to draw in phase 2, SVG):** the wordmark `ticktack` in Space Grotesk Medium, lowercase, with the dot-less
  `i` replaced by a short orange bar tilted like a watch hand. App icon: that orange hand plus a check stroke on charcoal.
  No emoji, no clock clip-art.
- **Signature elements (ours, not the reference's):**
  1. **Day face** — the Today header shows the date as huge numerals (`09` over `Nov`, weekday beside it) with a thin
     orange arc underneath that fills as planned minutes are completed.
  2. **Workload bar** — planned minutes vs the user's daily capacity (Sunsama-style), turning orange-strong when the day
     is over-planned.
  3. **Deck panels** — content sits on rounded panels stacked over the header; the active panel overlaps the previous
     one by 24 px, giving the layered depth of the reference without its layouts.
  4. **Now line** — an orange line with a pill showing the current time across the timeline.
- The app shows "VIZAM portfolio concept" in onboarding and in Me > About.

## 2. What we take from the reference (principles only)

The reference (`docs/references/ticktack-ref-orange-charcoal.jpg`, a travel-booking concept, git-ignored) shows:
oversized date/time numerals as the main hierarchy, charcoal and muted sage surfaces with a warm gradient, one bright
orange accent for the primary action, rounded stacked cards whose lower card peeks out, compact pill controls on dark
chips, a round accent action button, and a date strip with a large "today" label.

We keep: numeral-led hierarchy, dark muted surfaces, single orange accent, rounded stacked cards, layered panels, large
primary actions, compact contextual pills. We do **not** reuse: any booking content (routes, seats, prices, drivers),
people photos or avatars from the reference, its screen compositions, its full-orange screen, or its type face.
Accessibility changes: the reference puts white text on orange (2.6:1, fails AA); TickTack puts charcoal text on orange.

## 3. Colour

### Dark theme (default)

| Token | Hex | Use | Contrast checked |
|---|---|---|---|
| `bg` | `#17191B` | App background | — |
| `surface` | `#25282A` | Cards, panels, sheets | — |
| `surfaceMuted` | `#70807D` | Decorative fills, header gradient end, large numerals only | white on it 4.14 (large text only) |
| `chip` | `#4E5B58` | Pills and chips with text | white 7.09 |
| `accent` | `#FF7A24` | Primary action fill, now line, progress, selected date | on `bg` 6.77, on `surface` 5.69 |
| `onAccent` | `#17191B` | Text and icons on orange | 6.77 |
| `text` | `#FFFFFF` | Primary text | on `bg` 17.63, on `surface` 14.83 |
| `textSecondary` | `#B9C2C0` | Secondary text | on `bg` 9.69, on `surface` 8.15 |
| `textTertiary` | `#8A9491` | Hints, timestamps | on `bg` 5.65, on `surface` 4.75 |
| `danger` | `#FF5A4E` | Overdue, destructive | on `bg` 5.73 |
| `success` | `#4FD1A5` | Done, achieved | on `bg` 9.23 |
| `border` | `#FFFFFF` at 8% | Hairlines, input outlines (inputs also get a 3:1 focus ring in `accent`) | — |

**Sage is never a flat fill (Steeven, 2026-11-09).** Every sage/grey surface is a gradient from sage into a warm clay:

- `gradientSage` (dark): `linear-gradient(165deg, #5F6F6C 0%, #966848 100%)`. Used for headers (Day face, calendar
  headers, settings header), the splash screen and highlight cards. The start is a slightly deeper sage than
  `#70807D` so white text passes AA everywhere on it (white on `#5F6F6C` 5.27, on `#966848` 4.79).
- `gradientChip` (dark): `linear-gradient(135deg, #4E5B58 0%, #6A5444 100%)` for pills and chips (white text 7.09 at
  the sage end, 7.08 at the clay end).
- Phase 2 adds a unit test sampling both ends and the midpoint of every gradient against the text colours used on it.

**Day and night (Steeven, 2026-11-09).** The warm end of every gradient follows the time of day; the theme (dark /
light) is a separate choice.

| Period | When | Dark theme | Light theme |
|---|---|---|---|
| Day | from the user's *day start* (default 06:00) to *day end* (default 19:00) | gray first, orange lower band: `linear-gradient(165deg, #5F6F6C 0%, #5F6F6C 48%, #6E5A4E 70%, #9A4418 88%, #B83D0B 100%)`, chips `linear-gradient(135deg, #4E5B58 0%, #4E5B58 50%, #8A3E14 100%)` | `linear-gradient(165deg, #E3E8E6 0%, #E3E8E6 50%, #EDE3DA 78%, #FFDCC4 100%)`, chips `#DCE3E1` 0–50% → `#F2D3BD` |
| Night | the rest | sage → dusk blue `#5F6F6C → #3F5F8A`, chips `#4E5B58 → #3E4F6B` | `#E3E8E6 → #D6E2F2` |

**Morning reads gray first, orange second (Steeven, phase 3 feedback, 2026-11-10)** — replaces the 2026-11-09 "day
orange" gradient (`#5F6F6C → #B83D0B 62% → #C9480F`). Sage holds the top half, a warm gray-brown bridges, orange is
only the lower band. Contrast (day, every stop and midpoint, asserted in `src/ui/theme/__tests__/contrast.test.ts`):
white on `#5F6F6C` 5.28, midpoint `#67655D` 5.84, `#6E5A4E` 6.49, midpoint `#844F33` 6.67, `#9A4418` 6.53, midpoint
`#A94112` 6.08, `#B83D0B` 5.66 (minimum 5.28; the test floor is 5.0); chips white on `#4E5B58` 7.09, midpoint `#6C4D36`
7.63, `#8A3E14` 7.55; light day `#17191B` 14.23 → 13.67 and `#5A6664` 4.82 → 4.63 (end `#FFDCC4`); light chips
`#17191B` 13.53 → 12.45. Because the bottom of the day header is now orange, elements sitting on it change: the round action (bell), the selected
segment and the selected date become charcoal `#17191B` with orange text or icon, and the workload bar / progress fills on the header are white on a 35% charcoal track.

Contrast (night): white on `#5F6F6C` 5.28, midpoint 5.90, `#3F5F8A` 6.53; chips 7.09 / 7.67 / 8.28; light night
`#17191B` 14.23 → 13.45, `#5A6664` 4.82 → 4.55. The orange accent stays the same day and night. The switch is checked
when the app comes to the foreground and once a minute while open, and cross-fades over 600 ms (instant with Reduce
Motion). Day start/end are the existing settings in Me > Planning.

**Splash (Steeven, 2026-11-09, revised; day revised again in the phase 3 feedback, 2026-11-10).**

- **Day:** a light white → orange gradient, orange at the bottom: `#FFFFFF` 0% → `#FFF1E6` 42% → `#FFC9A1` 74% →
  `#FF7A24` 100%, with soft warm blooms near the bottom and faint grain. Because the background is light, the wordmark
  is charcoal `#17191B` with the orange hand over the ı, and the tagline is charcoal (Manrope 500; same size and centre
  as before). Charcoal contrast: on `#FFFFFF` 17.63, `#FFF1E6` 15.93, `#FFC9A1` 11.85, `#FF7A24` 6.77 (midpoints are
  tested too), so "VIZAM portfolio concept" on the orange bottom stays readable. Native splash: the charcoal wordmark
  on cream `#FFF1E6` (the colour of the in-app splash centre).
- **Night (unchanged):** the blue "ember" flow: near-black charcoal at the top bending diagonally through deep blue
  into a pale glow at the bottom right. Kept as approved: light morning / dark evening matches the header's day/night
  logic, so the pair does not look inconsistent.
- Night stops: `#0B0B0C` → `#17191B` → `#1E3A8A` → `#2B4FB0` → `#5B8FD6` → `#9DBEEA` → `#E6F0FF`.
- Night: the `ticktack` wordmark (white, orange hand, Space Grotesk 500 at 68 pt, about 75% of the screen width) and the
  tagline sit together at the exact centre of the screen; the tagline is 8 pt under the wordmark in Manrope 400, 13 pt, -0.4 tracking, white. The flow is placed so the centre
  falls on the deep blue zone: white on `#1E3A8A` 10.36, on `#2B4FB0` 7.37.
- Night: "VIZAM portfolio concept" sits at the bottom in charcoal on the pale glow (`#17191B` on `#E6F0FF` 15.34).
- The backgrounds are pre-rendered images (day and night, 1290 x 2796, WebP for the in-app
splash, PNG for the native one), not drawn live. Limitation: the native splash is a single static image shown before
any code runs, so it is always the cream day version; the in-app splash that follows picks day or night (at night
the cream native splash hands over to the dark blue one).

**Language.** English and French (`fr-CA` wording, works for `fr-FR`). See section 8.

### Light theme ("paper")

| Token | Hex | Use | Contrast checked |
|---|---|---|---|
| `bg` | `#F4F1EC` | Warm paper background | — |
| `surface` | `#FFFFFF` | Cards, panels | — |
| `surfaceMuted` | `#E3E8E6` | Sage-tinted panels, header — always as `gradientSageLight`: `linear-gradient(165deg, #E3E8E6 0%, #F6E0CD 100%)` | `#17191B` 14.23 → 13.82; `#5A6664` 4.82 → 4.68 |
| `chip` | `#DCE3E1` | Pills with text | `#17191B` on it 13.53 |
| `accent` | `#FF7A24` | Fills only (buttons, arcs, now line, selected date) | not used for text on light |
| `onAccent` | `#17191B` | Text on orange | 6.77 |
| `accentText` | `#B34700` | Orange links and labels on light | on white 5.50, on `bg` 4.88 (not on `surfaceMuted`: 4.44) |
| `text` | `#17191B` | Primary text | on `bg` 15.65, on white 17.63 |
| `textSecondary` | `#5A6664` | Secondary text | on `bg` 5.30, on white 5.97, on `surfaceMuted` 4.82 |
| `danger` | `#C0352B` | Overdue, destructive | on white 5.55 |
| `success` | `#1C7F5A` | Done | on white 4.96 |

Contrast values were computed with the WCAG 2.x formula; phase 2 adds a unit test asserting every token pair actually
used. Colour is never the only signal: priority, overdue and done states also use an icon or label.

**Category colours** (8, tuned for both themes, used as small dots/bars, not text): ember `#FF7A24`, sage `#70807D`,
sky `#5AA9E6`, plum `#A77BD8`, moss `#7DB46C`, sand `#D9B26F`, rose `#E57A8F`, slate `#8E9AAF`.

## 4. Typography

- **Display / numerals:** Space Grotesk (OFL) — Medium 500 and Bold 700. Tight tracking (-2%) above 34 pt. Tabular
  figures (`fontVariant: ['tabular-nums']`) for times and counters.
- **Text:** Manrope (OFL, `@expo-google-fonts/manrope`) — Light 300 for body copy, Regular 400 and Medium 500 for small
  sizes and labels, SemiBold 600 for task titles. **Letter spacing -0.4 on every Manrope style** (Steeven, 2026-11-09).
  Light 300 is not used below 14 pt, where it gets too faint on dark surfaces. Full Latin coverage, so French accents
  (é, è, ê, à, ç, œ, «») render correctly; Space Grotesk covers them too.

| Style | Font | Size / line | Tracking | Use |
|---|---|---|---|---|
| `dayFace` | Space Grotesk 500 | 72 / 72 | -2% | Today date numerals |
| `display` | Space Grotesk 500 | 48 / 52 | -2% | Goal %, big times, onboarding |
| `title1` | Space Grotesk 600 | 30 / 34 | 0 | Screen titles |
| `title2` | Space Grotesk 600 | 22 / 28 | 0 | Section and card titles |
| `title3` | Manrope 600 | 17 / 22 | -0.4 | Task titles |
| `body` | Manrope 300 | 16 / 23 | -0.4 | Body, inputs |
| `bodySm` | Manrope 300 | 14 / 20 | -0.4 | Secondary lines |
| `label` | Manrope 500 | 13 / 16 | -0.4 | Pills, tabs, buttons small |
| `caption` | Manrope 400 | 12 / 16 | -0.4 | Timestamps (minimum size) |

Dynamic Type is honoured: body styles scale up to 2x, `dayFace`/`display` cap at 1.3x so layouts hold.

## 5. Layout, shape, motion

- Spacing scale (4-based): 4, 8, 12, 16, 20, 24, 32, 40, 56. Screen padding 20.
- Radii: panel 28, card 20, input 14, pill 999, round action 28 (56 px button).
- Elevation: on dark, depth comes from surface steps and a 24 px overlap, not shadows; light theme uses a soft shadow
  (y 6, blur 20, 8% black) on cards.
- Touch targets at least 44 x 44 pt. Bottom tab bar 5 items with labels.
- Wide screens (phase 4a): backgrounds (header gradient, deck panel) stay full width, the content sits in a centred
  column of at most **720 pt** (`contentWidth.text`); the week hour grid gets **1120 pt** (`contentWidth.grid`). The
  tablet / desktop layout starts at **768 pt** (`WIDE_BREAKPOINT`). The floating "+" stays with the column.
- Motion: 200–280 ms ease-out; cards expand from their position; check-off draws the tick and slides the card to the
  "Done" group; the day arc animates. With Reduce Motion on, all of it becomes instant cross-fades.
- Haptics: light impact on complete, selection tick on date strip.

## 6. Components (phase 2 builds these as `src/ui` primitives)

`Text` (style variants above), `Button` (primary orange with charcoal label, secondary chip, ghost, destructive; large
56 px and compact 40 px), `RoundAction` (56 px circular accent button, e.g. add, bell), `Card`, `DeckPanel` (overlapping
panel), `Pill`/`Chip` (filter, category, priority, toggle), `DayFace`, `DateStrip` (horizontal week/day selector with
completion dots), `WorkloadBar`, `ProgressArc`, `ProgressBar`, `TaskRow` (checkbox, title, time, category dot, priority
flag, swipe actions), `TimelineBlock`, `NowLine`, `Sheet` (bottom sheet for quick add, recurrence, reschedule),
`SegmentedControl` (Day / Week / Month), `TextField`, `DateTimeField`, `Toggle`, `EmptyState` (icon + one line + action),
`ErrorState` (message + retry), `Skeleton` (loading), `Banner` (offline, sync error, permissions), `SyncChip`, `Toast`,
`ConfirmDialog`, `Avatar` (initials only, no photos).

Every screen has explicit loading (skeleton), empty, error and success states.

## 7. Screens and layout notes

1. **Onboarding** (3 cards + permissions primer) — each card a big numeral headline (`06:30`, `3 of 5`, `92%`) with one
   sentence: plan your day, keep routines, reach goals. Last step: optional reminder primer, "Continue as guest" or
   "Create account". "VIZAM portfolio concept" note at the bottom.
2. **Sign in / Sign up / Reset** — dark panel, title1, two fields, large orange button, ghost link; inline field errors,
   no account enumeration in messages.
3. **Today** (tab) — gradient header with `DayFace`, workload bar and round bell action (reminders); `DeckPanel`
   below with groups: *Overdue* (collapsible, danger label), *Scheduled* (timed tasks in time order), *Anytime*,
   *Routines* (compact routine cards with step count), *Done* (collapsed). Floating `RoundAction` "+" opens quick add.
   Pull to sync. **Task row (phase 3 feedback):** a 64 pt left time column with the start time in Space Grotesk 600
   17 pt (`8:30` + small `AM` in English, `08:30` in French) and the duration under it; untimed rows show "Anytime" /
   "N’importe quand". Then the check, the title, a meta line (category dot + name, subtask count, goal with the goals
   icon, priority flag, repeat icon) and a compact preview: the first two subtasks with their state, "+N more" in
   accent text and a one-line note excerpt. Tapping the preview expands it in place (every subtask tickable, full
   note, "Hide"); no navigation. A "⋯" button (and long press) opens the row menu: Mark done, Quick edit, Open full
   editor, Delete. Swipe right = complete, swipe left = Edit / Delete. Deletes are held 5 s behind an "Undo" snackbar
   above the tab bar and the "+" button; series ask This / Following / All first. **Quick edit** is a bottom sheet:
   title, date (No date / Today / Tomorrow + stepper), start time and duration dropdowns, category field, "Save task"
   and "Open full editor". Every screen keeps room under its last row for the "+" button and the undo bar.
   **Phase 4a:** tapping a row opens the task details (the editor stays in the "⋯" menu and on the details screen).
   Under the workload line the header has two link chips on the action fill: "Overdue · n" (alert icon) and
   "History" (check icon); they open the overdue and history screens.
4. **Calendar** (tab) — `SegmentedControl` Day / Week / Month. *Day (phase 3 feedback):* 24 hour rows of 60 pt that
   grow inside the screen's single scroll (no nested scroller), timed tasks at their start with a height proportional
   to their duration (44 pt minimum), overlapping tasks side by side in equal columns, a category-coloured left bar, an
   orange "now" line with a knob on today and an all-day strip of chips above the grid; the screen scrolls to one hour
   before now (today) or before the first task. **Drag to move (phase 4a):** long-press a block (350 ms), then drag
   it up or down; the block lifts (accent border, chip fill), shows the new time while it moves and snaps to
   5 minutes; the screen scroll is frozen during the drag and a normal drag over a block still scrolls. A repeating
   task asks This / Following / All. A long press without a move opens the row menu. Without dragging: the
   "Move 15 minutes earlier / later" accessibility actions, or Quick edit. *Week:* on phones, `DateStrip` with big
   numerals plus the stacked 7-day agenda whose rows show the time column, in time order. **From 768 pt (phase
   4a)** the week is a 7-column hour grid: a header of weekday + date per column (tap selects the day, today in
   accent text), a row of small chips for untimed items, then the same hour grid and blocks as the day view (title
   only, start time when the block is tall); blocks drag the same way (time only, not across days). *Month:* grid with load dots per day; tapping a day previews its items in a deck panel
   (upcoming preview).
5. **Task create / edit** (sheet that expands to full screen) — title field large, date pills, then **start time and
   duration dropdowns** side by side (a field-like button with a chevron that opens a bottom-sheet list on phones and a
   centred panel on wide web, scrolled to the selected value or around now; web keyboard: Tab / arrows / Home / End,
   Enter, Escape). Start time: "All day", then every 15 min across 24 h (24 h clock in French). Duration: None, 5, 10,
   15, 20, 30, 45 min, every 15 min to 4 h, every 30 min to 8 h, then 9–12 h. Priority pills; **category as free text**
   with suggestion pills (dot + name) and a "New category … will be created" hint (trimmed, case-insensitive de-dup,
   40 characters; a new category takes the least-used palette colour in the order ember, sky, moss, plum, sand, rose,
   sage, slate); **goal dropdown** (No goal, active goals, and a "New goal" name field in the sheet); repeat; notes;
   subtasks checklist. Save is the large orange button, pinned in a footer (above the keyboard when it is open).
6. **Task details** — header with big start time numerals and date; status toggle; pills; notes; subtasks; linked goal
   card; reminder list; for series: "This occurrence / Whole series" choice on edit and delete.
   **As built (phase 4a):** pushed screen with a back chevron and a compact "Edit" button; start time in `display`
   numerals ("Anytime" when untimed) over the date and duration (danger "Overdue ·" prefix when late); title1
   (struck through when done); chips for Done, category and priority; large "Mark done" / "Mark not done"; repeat
   card with a one-line summary ("Every 2 weeks on Mon, Thu · until Sun, Dec 20"); tickable subtasks; notes; goal
   card that opens the goal; reminders card (placeholder until task reminders exist); "Reschedule" (quick-edit
   sheet) and destructive "Delete" (series ask This / Following / All; Undo 5 s after the screen closes).
7. **Recurrence settings** (sheet) — frequency segmented (Daily / Weekly / Monthly), "Every [n]" stepper, weekday pill
   row (weekly), day-of-month picker (monthly), ends (**Never** by default, "Repeats with no end date." / On date /
   After n times), live preview "Next: Tue 10, Thu
   12, Tue 17".
8. **Goals dashboard** (tab) — sections *Overdue* (danger label), *Active*, *Completed*, each "Label · count". Cards:
   title (title3), period chip (chip fill, colour dot when set), "Due Sun, Dec 20 · 41 days left" (or "Period ends …"
   for periodic goals; danger text when overdue), Space Grotesk 600 34 pt `%` numeral with a smaller `%`, orange
   `ProgressBar` on the chip track, "1 of 37 done". "New goal" compact secondary button in the header; empty state
   with "Create goal".
9. **Goal details** (goals round) — back chevron + "Edit"; title1 + description; hero card with a 132 pt
   `ProgressArc` (accent, success at 100 %) and the 40 pt `%` numeral, period chip, countdown (title3), due line and
   "done of total" (periodic: "This period (range): …"); "Mark goal as done" / "Reopen"; linked tasks as Today rows
   (time column, tick, preview; goal name left out) with a × to unlink (never the last task); "Add or remove tasks"
   (task picker sheet); reminders summary card; history rows (range · thin bar · %) for periodic goals; destructive
   "Delete goal" with a confirm that says the tasks are kept and unlinked, then Undo 5 s. Milestones stay phase 4.
   **Goal form** (modal): title (large), description, period pills, due date (quick pills 1 week / 1 month /
   3 months + day stepper) or start date with "Current period: …", colour swatches, tasks (linked rows with ×,
   "Link existing tasks" → searchable multi-select sheet, "Or create a task for this goal" card with title, date
   pills, time and duration dropdowns), reminders (switch rows; options appear under a switch that is on). Pinned
   footer: hint "Link or create at least one task…" while there is none, and the large Save (disabled until then).
   **Reminder primer**: dialog "Turn on reminders?" before the OS prompt; denied → banner with "Open settings";
   web → note that reminders ring in the mobile app.
   **Swipe (goals round):** month grid, week strip and day page follow a horizontal finger drag and slide to the
   next / previous page (150 ms out, spring in); vertical drags keep scrolling; arrows stay; ←/→ on web.
   **Keyboard (goals round):** every form pads above the keyboard and scrolls the focused field (with its
   suggestions) into view; Save is pinned in a footer above the keyboard on the task editor and goal form; sheets
   rise above the keyboard with their footer.
10. **Routines** (tab) — routines grouped by part of day; each a card with step count, total minutes, repeat summary,
    today's completion; detail screen runs the routine as a step checklist with big step numerals.
11. **Reminders / notifications** — permission status banner, upcoming scheduled reminders (next 7 days), default
    offset, exact-alarm explanation (Android), test reminder button.
12. **Completed / history** — grouped by day, with done, missed (recurring) and cancelled filters, and a per-week
    count numeral; restore (un-complete) action.
    **As built (phase 4a):** pushed screen "History": a card with the number done this week (`display` numeral),
    filter pills All / Done / Missed, then day groups ("Today · 2", "Sat, Nov 7 · 3") of task rows filed under the
    day they were completed; missed occurrences of repeating tasks carry a danger "Missed" label; unticking a row
    restores it. Covers 60 days (missed: 30). No "cancelled" filter (nothing can be cancelled yet).
    **Overdue (phase 4a):** pushed screen "Overdue": count line, "Move all to today", then the open one-off tasks
    from before today, oldest first, each with compact "Move to today" and "Mark done" buttons under the row.
13. **Profile and settings** (Me tab) — account (or guest + "Create account"), theme (System / Dark / Light), week
    start, day start/end and capacity, categories manager, sync status and failed items, data export (later), About (concept
    label, licences), sign out, delete account.

## 8. Language (English and French)

- Every user-visible string goes through `i18next` / `react-i18next` with `en.json` and `fr.json`; no hard-coded text
  in components. A unit test fails when a key exists in one file but not the other.
- Default follows the device language (`expo-localization`); Me > Language offers System / English / Français.
- Dates, times, weekday names and numbers use the locale (`Intl` and the `date-fns` `fr` locale): 24 h clock and
  "lun. 9 nov." in French; week starts Monday in French by default.
- Plurals use i18next plural rules ("1 tâche", "3 tâches").
- French runs about 20% longer: buttons and pills wrap or shrink rather than truncate, and every screen is checked in
  French before a phase is reported done. Reminder notification text is localised at scheduling time.
- Onboarding, store listing and the "VIZAM portfolio concept" note exist in both languages.

## 9. Imagery

The UI is type- and data-led and needs no photos. Onboarding uses abstract shapes drawn in SVG (arcs, bars) in the
palette. If a photo is wanted later (store listing, portfolio), use the `site-media` workflow (stock first, audited,
WebP only, no people from the reference).
