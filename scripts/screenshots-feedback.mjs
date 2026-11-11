#!/usr/bin/env node
/**
 * Phase 3 feedback round: screenshots, touch-scroll probe and width sweep of the running Expo web app (start it
 * with the emulator flag so nothing talks to a real Firebase project):
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8093
 *   node scripts/screenshots-feedback.mjs [--base http://localhost:8093] [--only shots|scroll|sweep]
 * Output: docs/screenshots/phase-3-feedback/*.webp (390 px wide at 2x unless named sweep-<width>-*).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8093');
const OUT = arg('out', 'docs/screenshots/phase-3-feedback');
const only = arg('only', '');
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const NIGHT = '2026-11-09T21:30:00';
const demo = '?demo=1';
const errors = [];
const notes = [];
const browser = await chromium.launch();

async function open({ theme = 'dark', language = 'en', time = DAY, name }, width = 390, height = 844) {
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
    { theme, language, dayStart: '06:00', dayEnd: '19:00', onboardingDone: true },
  );
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(180000);
  page.on('pageerror', (e) => errors.push(`${name}@${width}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}@${width} console: ${m.text()}`));
  await page.clock.setFixedTime(new Date(time));
  return { context, page };
}

async function settle(page, testId) {
  await page.getByTestId(testId).first().waitFor({ timeout: 90000 });
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
  await page.waitForTimeout(600);
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

/** Scroll position of the screen's single ScrollView (RN web renders it as a scrollable div). */
const scrollState = (page, testId) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el ? { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight } : null;
  }, testId);

/** A finger drag (touchStart, 20 touchMoves, touchEnd) starting on the list; goes through the responder system. */
async function touchScroll(page, dy, y = 640) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (yy) => [{ x: 195, y: yy, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y) });
  for (let i = 1; i <= 20; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y - (dy / 20) * i) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
}

async function shots() {
  // Splash (held on screen with the dev-only flag). One design since the phase 4 feedback (charcoal, the same by
  // day and by night), so one shot; the old splash-day / splash-night pair was two identical images.
  {
    const { context, page } = await open({ name: 'splash' });
    await page.goto(`${BASE}/${demo}&holdSplash=1`);
    await page.getByTestId('app-splash').waitFor({ timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await shot(page, 'splash');
    await context.close();
  }

  {
    const { context, page } = await open({ name: 'dark-day-en' });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await shot(page, 'dark-day-en-today');
    const preview = page.getByRole('button', { name: /^Show subtasks and notes of “Draft the project outline”/ });
    await preview.scrollIntoViewIfNeeded();
    await preview.click();
    await page.waitForTimeout(300);
    await page.getByTestId('screen-today-scroll').evaluate((el) => el.scrollBy(0, -140));
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-today-expanded');

    // Swipe left on a row with the mouse (touch-style drag) to reveal Edit / Delete.
    const plants = page.getByRole('button', { name: /^Water the plants,/ });
    await plants.scrollIntoViewIfNeeded();
    const box = await plants.boundingBox();
    if (box) {
      // Finger swipe to the left (touch events, as on a phone).
      const cdp = await page.context().newCDPSession(page);
      const y = box.y + box.height / 2;
      const pt = (x) => [{ x, y, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(box.x + box.width - 10) });
      for (let i = 1; i <= 15; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: pt(box.x + box.width - 10 - i * 14),
        });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(600);
      await shot(page, 'dark-day-en-row-swipe');
      notes.push(
        `swipe reveal visible: ${await page
          .getByTestId('swipe-delete')
          .isVisible()
          .catch(() => false)}`,
      );
    }
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await page.getByRole('button', { name: 'More actions for “Water the plants”' }).click();
    await page.getByTestId('task-menu').waitFor();
    await page.waitForTimeout(400);
    await shot(page, 'dark-day-en-row-menu');
    await page.getByTestId('menu-quick-edit').click();
    await page.getByTestId('quick-title').waitFor();
    await page.waitForTimeout(500);
    await shot(page, 'dark-day-en-quick-edit');
    await page.getByTestId('quick-edit').getByRole('button', { name: 'Close' }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'More actions for “Water the plants”' }).click();
    await page.getByTestId('menu-delete').click();
    await page.getByTestId('undo-snackbar').waitFor();
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-undo-snackbar');
    await page.getByTestId('undo-delete').click();

    await page.goto(`${BASE}/task/new${demo}`);
    await settle(page, 'screen-task-editor');
    await page.getByTestId('field-title').fill('Deep work block');
    await page.getByTestId('field-duration').click();
    await page.getByTestId('field-duration-sheet').waitFor();
    await page.waitForTimeout(500);
    await shot(page, 'dark-day-en-duration-open');
    await page.getByTestId('field-duration-option-150').click();
    await page.getByTestId('field-time').click();
    await page.getByTestId('field-time-sheet').waitFor();
    await page.waitForTimeout(500);
    await shot(page, 'dark-day-en-time-open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const category = page.getByTestId('field-category');
    await category.scrollIntoViewIfNeeded();
    await category.fill('h');
    await page.waitForTimeout(300);
    await category.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await shot(page, 'dark-day-en-category-autocomplete');
    await category.fill('Garden');
    await page.getByRole('radio', { name: 'Weekly' }).click();
    await page.getByTestId('repeat-editor').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    await shot(page, 'dark-day-en-repeat-never');

    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await page.waitForTimeout(500);
    await shot(page, 'dark-day-en-calendar-day');
    await page.getByRole('tab', { name: 'Week' }).click();
    await page.waitForTimeout(700);
    await shot(page, 'dark-day-en-calendar-week');
    await context.close();
  }

  {
    const { context, page } = await open({ name: 'dark-night-en', time: NIGHT });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await shot(page, 'dark-night-en-today');
    await context.close();
  }
  {
    const { context, page } = await open({ name: 'dark-day-fr', language: 'fr' });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await shot(page, 'dark-day-fr-today');
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await shot(page, 'dark-day-fr-calendar-day');
    await context.close();
  }
  {
    const { context, page } = await open({ name: 'light-day-en', theme: 'light' });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await shot(page, 'light-day-en-today');
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await shot(page, 'light-day-en-calendar-day');
    await context.close();
  }
}

/** Item 5: touch-scroll each screen to its end and check the last row is not under the FAB / tab bar / undo bar. */
async function scrollProbe() {
  const { context, page } = await open({ name: 'scroll' });
  for (const [path, id] of [
    [`/${demo}`, 'screen-today'],
    [`/calendar${demo}`, 'screen-calendar'],
  ]) {
    await page.goto(`${BASE}${path}`);
    await settle(page, id);
    const before = await scrollState(page, `${id}-scroll`);
    for (let i = 0; i < 6; i += 1) await touchScroll(page, 500);
    const after = await scrollState(page, `${id}-scroll`);
    const atEnd = after && after.top + after.client >= after.height - 2;
    const overlap = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="task-"], [data-testid^="block-"]')];
      const last = rows.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
      const fab = document.querySelector('[data-testid="fab-add"]');
      const tabs = document.querySelector('[role="tablist"]:last-of-type');
      if (!last) return 'no rows';
      const r = last.getBoundingClientRect();
      const f = fab?.getBoundingClientRect();
      const t = tabs?.getBoundingClientRect();
      return {
        lastBottom: Math.round(r.bottom),
        fabTop: f ? Math.round(f.top) : null,
        tabTop: t ? Math.round(t.top) : null,
        coveredByFab: f ? r.bottom > f.top && r.right > f.left : false,
      };
    });
    notes.push(
      `${path}: scrollTop ${before?.top} -> ${after?.top} of ${after?.height} (end=${atEnd}) ${JSON.stringify(overlap)}`,
    );
    if (!atEnd) errors.push(`${path}: touch scroll did not reach the end`);
    if (typeof overlap === 'object' && overlap.coveredByFab) errors.push(`${path}: last row under the FAB`);
    if (id === 'screen-calendar') {
      // The day timeline auto-scrolled before the touch scroll (now / first item), and 23:00 is reachable.
      if (!before || before.top <= 0) errors.push('calendar day: no auto-scroll to now / first item');
      await shot(page, 'dark-day-en-calendar-day-end');
    } else {
      await shot(page, 'dark-day-en-today-end');
    }
  }
  await context.close();
}

async function sweep() {
  const routes = [
    ['today', `/${demo}`, 'screen-today', null],
    ['calendar-day', `/calendar${demo}`, 'screen-calendar', null],
    ['calendar-week', `/calendar${demo}`, 'screen-calendar', 'Semaine'],
  ];
  for (const width of [240, 300, 390, 768, 1440]) {
    const { context, page } = await open({ name: 'sweep', language: 'fr' }, width, 900);
    for (const [name, path, testId, tab] of routes) {
      await page.goto(`${BASE}${path}`);
      await settle(page, testId);
      if (tab) {
        await page.getByRole('tab', { name: tab }).click();
        await page.waitForTimeout(600);
      }
      const o = await overflow(page);
      const root = await page.evaluate(() =>
        Math.round(document.getElementById('root')?.getBoundingClientRect().width),
      );
      notes.push(`${String(width).padStart(4)} px ${name.padEnd(14)} overflow=${o} root=${root}`);
      if (width >= 300 && o > 0) errors.push(`sweep ${name} at ${width}: overflow ${o}px`);
      if (width < 250 && root !== 500) errors.push(`sweep ${name} at ${width}: root ${root}, expected 500`);
      if ([240, 768, 1440].includes(width)) await shot(page, `sweep-${width}-${name}`);
    }
    await context.close();
  }
}

try {
  if (!only || only === 'shots') await shots();
  if (!only || only === 'scroll') await scrollProbe();
  if (!only || only === 'sweep') await sweep();
} finally {
  await browser.close();
}
console.log(notes.join('\n'));
if (errors.length) {
  console.error(`Problems found:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`OK, written to ${OUT}`);
}
