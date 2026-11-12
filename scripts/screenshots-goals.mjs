#!/usr/bin/env node
/**
 * Phase 3 goals round: screenshots and width sweep of the running Expo web app (start it with the emulator flag so
 * nothing talks to a real Firebase project):
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8095
 *   node scripts/screenshots-goals.mjs [--base http://localhost:8095] [--only shots|sweep]
 * Output: docs/screenshots/phase-3-goals/*.webp (390 px wide at 2x unless named sweep-<width>-*).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8095');
const OUT = arg('out', 'docs/screenshots/phase-3-goals');
const only = arg('only', '');
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const demo = '?demo=1';
const errors = [];
const notes = [];
const browser = await chromium.launch();

async function open({ theme = 'dark', language = 'en', name, fixedTime = true }, width = 390, height = 844) {
  const mobile = width >= 250 && width < 700;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: language === 'fr' ? 'fr-CA' : 'en-CA',
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    (prefs) => window.localStorage.setItem('ticktack.preferences', JSON.stringify({ state: prefs, version: 1 })),
    { theme, language, dayStart: '06:00', dayEnd: '19:00', onboardingDone: true, remindersUsed: false },
  );
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(180000);
  page.on('pageerror', (e) => errors.push(`${name}@${width}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && !/Reduced motion setting/.test(m.text())))
      errors.push(`${name}@${width} console.${m.type()}: ${m.text()}`);
  });
  // A frozen clock also freezes Animated timings (Date.now), so swipe animations run on the real clock.
  if (fixedTime) await page.clock.setFixedTime(new Date(DAY));
  return { context, page };
}

async function settle(page, testId) {
  await page.getByTestId(testId).first().waitFor({ timeout: 120000 });
  await page
    .getByTestId('app-splash')
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => undefined);
  await page
    .getByTestId('state-loading')
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function shot(page, file) {
  const png = await page.screenshot();
  await sharp(png)
    .webp({ quality: 82 })
    .toFile(join(OUT, `${file}.webp`));
  const o = await overflow(page);
  if (o > 0 && !file.startsWith('sweep-240')) errors.push(`${file}: horizontal overflow ${o}px`);
}

/** Finger drag across x (touch events through the responder system); `release: false` leaves it mid-swipe. */
async function touchSwipe(page, { x0, x1, y, release = true }) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x) => [{ x, y, id: 3 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0) });
  for (let i = 1; i <= 16; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) / 16) * i) });
    await page.waitForTimeout(16);
  }
  if (release) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(900);
  }
  return cdp;
}

async function openGoal(page, title) {
  await page.goto(`${BASE}/goals${demo}`);
  await settle(page, 'screen-goals');
  await page.getByRole('button', { name: new RegExp(`^${title},`) }).click();
  await settle(page, 'goal-hero');
}

async function shots({ calendarOnly = false } = {}) {
  // Calendar month: mid-swipe, then after the swipe (next month).
  {
    const { context, page } = await open({ name: 'calendar-swipe', fixedTime: false });
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await page
      .getByRole('tab', { name: 'Month' })
      .or(page.getByText('Month', { exact: true }))
      .first()
      .click();
    await settle(page, 'calendar-pager-month');
    const box = await page.getByTestId('calendar-pager-month').boundingBox();
    const y = box.y + box.height / 2;
    const cdp = await touchSwipe(page, { x0: 330, x1: 170, y, release: false });
    await page.waitForTimeout(150);
    await shot(page, 'dark-day-en-calendar-month-mid-swipe');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1000);
    const label = await page.getByTestId('calendar-nav').innerText();
    if (!/December 2026/.test(label)) errors.push(`month swipe: expected December 2026, got "${label}"`);
    else notes.push('month swipe → December 2026');
    await shot(page, 'dark-day-en-calendar-month-after-swipe');
    // Keyboard ← back to November (web). Focus is off the tab list (arrows there move between tabs).
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(800);
    const back = await page.getByTestId('calendar-nav').innerText();
    if (!/November 2026/.test(back)) errors.push(`ArrowLeft: expected November 2026, got "${back}"`);
    else notes.push('ArrowLeft → November 2026');
    // Vertical drag on the month page still scrolls the screen.
    const before = await page.getByTestId('screen-calendar-scroll').evaluate((el) => el.scrollTop);
    const v = await page.context().newCDPSession(page);
    await v.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 700, id: 4 }] });
    for (let i = 1; i <= 16; i += 1) {
      await v.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 200, y: 700 - 15 * i, id: 4 }],
      });
      await page.waitForTimeout(16);
    }
    await v.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
    const after = await page.getByTestId('screen-calendar-scroll').evaluate((el) => el.scrollTop);
    notes.push(`month vertical drag scrollTop ${before} → ${after}`);
    if (after <= before) errors.push('month view: vertical drag did not scroll');
    // Week strip swipe → next week.
    // scrollTop, not el.scrollTo(): react-native-web patches the DOM node's scrollTo with its deprecated signature.
    await page.getByTestId('screen-calendar-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.getByText('Week', { exact: true }).first().click();
    await settle(page, 'calendar-pager-week');
    const wb = await page.getByTestId('calendar-pager-week').boundingBox();
    await touchSwipe(page, { x0: 330, x1: 90, y: wb.y + wb.height / 2 });
    notes.push(`week swipe → ${await page.getByTestId('calendar-nav').innerText()}`);
    await context.close();
  }

  if (calendarOnly) return;

  // Goals list (EN dark and FR dark).
  for (const [theme, language, file] of [
    ['dark', 'en', 'dark-day-en-goals'],
    ['dark', 'fr', 'dark-day-fr-goals'],
  ]) {
    const { context, page } = await open({ name: file, theme, language });
    await page.goto(`${BASE}/goals${demo}`);
    await settle(page, 'screen-goals');
    await shot(page, file);
    await context.close();
  }

  // Create goal: disabled Save with the message, task picker, then with tasks linked / created.
  {
    const { context, page } = await open({ name: 'goal-new' });
    await page.goto(`${BASE}/goals${demo}`);
    await settle(page, 'screen-goals');
    await page.getByTestId('new-goal').click();
    await settle(page, 'screen-goal-editor');
    await page.getByTestId('goal-title').fill('Learn to swim');
    await page.waitForTimeout(300);
    const disabled = await page.getByTestId('save-goal').getAttribute('aria-disabled');
    if (disabled !== 'true') errors.push(`create goal: save not disabled without tasks (aria-disabled=${disabled})`);
    await shot(page, 'dark-day-en-goal-new-disabled-save');
    await page.getByTestId('link-tasks').click();
    await settle(page, 'task-picker');
    await page.getByTestId('task-search').fill('a');
    await page.waitForTimeout(500);
    await page.getByRole('checkbox', { name: /^Water the plants/ }).click();
    await page.getByRole('checkbox', { name: /^Review the weekly plan/ }).click();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-goal-new-link-tasks');
    await page.getByTestId('task-picker-done').click();
    await page.waitForTimeout(400);
    await page.getByTestId('new-task-title').fill('Book a swimming lesson');
    await page.getByTestId('add-new-task').click();
    await page.waitForTimeout(300);
    await page.getByTestId('goal-tasks-section').scrollIntoViewIfNeeded();
    await shot(page, 'dark-day-en-goal-new-with-tasks');
    await page.getByTestId('reminders-editor').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-goal-new-reminders-web');
    await page.getByTestId('save-goal').click();
    await settle(page, 'goal-hero');
    await shot(page, 'dark-day-en-goal-created-detail');
    await context.close();
  }

  // Goal detail (with %), reminders summary, history, edit, delete confirm, undo.
  {
    const { context, page } = await open({ name: 'goal-detail' });
    await openGoal(page, 'Run a 10 km race');
    await shot(page, 'dark-day-en-goal-detail');
    await page.getByTestId('goal-reminders').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-goal-detail-reminders');
    await page.getByTestId('edit-goal').click();
    await settle(page, 'screen-goal-editor');
    await shot(page, 'dark-day-en-goal-edit');
    await page.getByTestId('reminders-editor').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-goal-edit-reminders');
    await context.close();
  }
  {
    const { context, page } = await open({ name: 'goal-weekly' });
    await openGoal(page, 'Keep the home tidy');
    await page.getByTestId('goal-history').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-goal-weekly-history');
    await page.getByTestId('delete-goal').click();
    await page.getByTestId('confirm-delete-goal').waitFor();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-goal-delete-confirm');
    await page.getByTestId('confirm-delete-goal').click();
    await settle(page, 'screen-goals');
    await page.getByTestId('undo-snackbar').waitFor({ timeout: 5000 });
    await shot(page, 'dark-day-en-goal-deleted-undo');
    await page.getByTestId('undo-delete').click();
    await page.waitForTimeout(800);
    if (!(await page.getByText('Keep the home tidy').count())) errors.push('undo: goal did not come back');
    else notes.push('goal delete undo → goal back in the list');
    await context.close();
  }
  {
    const { context, page } = await open({ name: 'light-detail', theme: 'light' });
    await openGoal(page, 'Run a 10 km race');
    await shot(page, 'light-day-en-goal-detail');
    await context.close();
  }

  // Keyboard layout (web has no virtual keyboard: a short viewport stands in for the space left above it).
  {
    const { context, page } = await open({ name: 'keyboard' }, 390, 470);
    await page.goto(`${BASE}/task/new${demo}`);
    await settle(page, 'screen-task-editor');
    await page.getByTestId('field-category').scrollIntoViewIfNeeded();
    await page.getByTestId('field-category').fill('H');
    await page.waitForTimeout(500);
    await shot(page, 'dark-day-en-task-editor-keyboard-space');
    const save = await page.getByTestId('save-task').boundingBox();
    if (!save || save.y + save.height > 470) errors.push('keyboard layout: Save not visible in the short viewport');
    else
      notes.push(
        `short viewport: Save pinned at y=${Math.round(save.y)} (bottom ${Math.round(save.y + save.height)} / 470)`,
      );
    await context.close();
  }
}

async function sweep() {
  const targets = [
    ['goals', `/goals${demo}`, 'screen-goals'],
    ['calendar-month', `/calendar${demo}`, 'screen-calendar'],
    ['goal-detail', null, 'goal-hero'],
  ];
  for (const width of [240, 300, 390, 768, 1440]) {
    for (const [name, path, testId] of targets) {
      const { context, page } = await open({ name: `sweep-${name}` }, width, 900);
      if (path) {
        await page.goto(`${BASE}${path}`);
        await settle(page, testId);
        if (name === 'calendar-month') {
          await page.getByText('Month', { exact: true }).first().click();
          await settle(page, 'calendar-pager-month');
        }
      } else {
        await openGoal(page, 'Run a 10 km race');
      }
      const o = await overflow(page);
      if (width === 240) {
        const root = await page.evaluate(() => document.getElementById('root')?.getBoundingClientRect().width);
        notes.push(`240 px ${name}: root ${root}, overflow ${o} (locked layout pans)`);
        if (root !== 500) errors.push(`240 px ${name}: root width ${root}, expected 500`);
      } else {
        notes.push(`${width} px ${name}: overflow ${o}`);
        if (o > 0) errors.push(`${width} px ${name}: horizontal overflow ${o}px`);
      }
      if ([240, 768, 1440].includes(width)) await shot(page, `sweep-${width}-${name}`);
      await context.close();
    }
  }
}

try {
  if (!only || only === 'shots') await shots();
  if (only === 'calendar') await shots({ calendarOnly: true });
  if (!only || only === 'sweep') await sweep();
} finally {
  await browser.close();
}
for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log('\nno problems found');
}
