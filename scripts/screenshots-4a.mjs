#!/usr/bin/env node
/**
 * Phase 4a: screenshots, drag-to-reschedule probe and width sweep of the running Expo web app (start it with the
 * emulator flag so nothing talks to a real Firebase project):
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8096
 *   node scripts/screenshots-4a.mjs [--base http://localhost:8096] [--only shots|drag|sweep]
 * Output: docs/screenshots/phase-4a/*.webp (390 px wide at 2x unless named sweep-<width>-* or wide-*).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8096');
const OUT = arg('out', 'docs/screenshots/phase-4a');
const only = arg('only', '');
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const demo = '?demo=1';
const errors = [];
const notes = [];
const browser = await chromium.launch();

async function open({ theme = 'dark', language = 'en', name, fixedTime = true, touch }, width = 390, height = 844) {
  const mobile = touch ?? (width >= 250 && width < 700);
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
  // A frozen clock also freezes timers that read Date.now, so gesture probes run on the real clock.
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
  console.log('saved', file);
}

const tab = (page, label) => page.getByRole('tab', { name: label }).click();
const blockOf = (page, title) => page.getByRole('button', { name: new RegExp(`^${title},`) }).first();

async function shots() {
  // Today header links, then details of a task, in English (dark) and French (light).
  for (const [theme, language] of [
    ['dark', 'en'],
    ['light', 'fr'],
  ]) {
    const name = `${theme}-day-${language}`;
    const { context, page } = await open({ theme, language, name });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await shot(page, `${name}-today-links`);

    await blockOf(page, language === 'fr' ? 'Ébaucher le plan du projet' : 'Draft the project outline').click();
    await settle(page, 'task-detail');
    await shot(page, `${name}-task-detail`);
    await page.getByTestId('screen-task-detail-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);
    await shot(page, `${name}-task-detail-end`);
    await page.getByTestId('detail-reschedule').click();
    await page.getByTestId('quick-title').waitFor();
    await page.waitForTimeout(400);
    await shot(page, `${name}-task-detail-quick-edit`);
    await page.keyboard.press('Escape');
    await page.getByTestId('screen-task-detail-back').click();
    await settle(page, 'screen-today');

    await page.getByTestId('today-overdue').click();
    await settle(page, 'screen-overdue');
    await shot(page, `${name}-overdue`);
    notes.push(`${name}: overdue overflow ${await overflow(page)} px`);
    await page.getByTestId('screen-overdue-back').click();
    await settle(page, 'screen-today');

    await page.getByTestId('today-history').click();
    await settle(page, 'screen-history');
    await shot(page, `${name}-history`);
    notes.push(`${name}: history overflow ${await overflow(page)} px`);
    await context.close();
  }

  // Details of a repeating occurrence, delete -> scope -> undo bar on the previous screen.
  {
    const name = 'dark-day-en';
    const { context, page } = await open({ name });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    await page.getByRole('button', { name: /^Stretch break,/ }).click();
    await settle(page, 'task-detail');
    await shot(page, `${name}-task-detail-repeat`);
    await page.getByTestId('detail-delete').click();
    await page.getByTestId('delete-scope-this').waitFor();
    await shot(page, `${name}-task-detail-delete-scope`);
    await page.getByTestId('delete-scope-this').click();
    await settle(page, 'screen-today');
    const undo = await page
      .getByTestId('undo-snackbar')
      .waitFor({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    notes.push(`details delete -> back on Today with undo bar: ${undo}`);
    await shot(page, `${name}-task-detail-deleted-undo`);
    if (undo) await page.getByTestId('undo-delete').click();
    await context.close();
  }

  // Empty states on a database without demo data.
  {
    const name = 'dark-day-en';
    const { context, page } = await open({ name });
    await page.goto(`${BASE}/overdue`);
    await settle(page, 'screen-overdue');
    await shot(page, `${name}-overdue-empty`);
    await page.goto(`${BASE}/history`);
    await settle(page, 'screen-history');
    await shot(page, `${name}-history-empty`);
    await context.close();
  }

  // Week hour grid on tablet and desktop.
  for (const [width, height] of [
    [768, 1024],
    [1440, 900],
  ]) {
    const name = `wide-${width}`;
    const { context, page } = await open({ name }, width, height);
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await tab(page, 'Week');
    await settle(page, 'week-grid');
    await shot(page, `${name}-calendar-week-grid`);
    notes.push(
      `${name}: week grid overflow ${await overflow(page)} px, lanes ${await page.getByTestId(/^timeline-lane-/).count()}`,
    );
    await context.close();
  }
  {
    const name = 'wide-1440-fr-light';
    const { context, page } = await open({ name, theme: 'light', language: 'fr' }, 1440, 900);
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await tab(page, 'Semaine');
    await settle(page, 'week-grid');
    await shot(page, `${name}-calendar-week-grid`);
    await context.close();
  }
  // Phone keeps the stacked week.
  {
    const name = 'dark-day-en';
    const { context, page } = await open({ name });
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await tab(page, 'Week');
    await page.waitForTimeout(600);
    notes.push(`phone week: grid present ${await page.getByTestId('week-grid').count()} (expected 0)`);
    await context.close();
  }
}

/** Long-press a block and drag it: with the mouse (desktop) and with a finger (phone). */
async function drag() {
  // Desktop mouse, day view.
  {
    const name = 'drag-mouse';
    const { context, page } = await open({ name, fixedTime: false }, 1024, 900);
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    const block = blockOf(page, 'Read one chapter');
    await block.scrollIntoViewIfNeeded();
    const before = await block.getAttribute('aria-label');
    const box = await block.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(600); // long press
    await page.mouse.move(x, y + 20, { steps: 4 });
    await page.mouse.move(x, y + 47, { steps: 6 }); // 47 px = 47 min -> snaps to 45
    const live = await page
      .getByTestId('drag-time')
      .textContent({ timeout: 2000 })
      .catch(() => null);
    await shot(page, 'wide-1024-calendar-day-dragging');
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const after = await blockOf(page, 'Read one chapter').getAttribute('aria-label');
    notes.push(`mouse drag +47 px: "${before}" -> live "${live}" -> "${after}"`);

    // Long press without moving opens the menu (quick edit stays reachable).
    const again = blockOf(page, 'Read one chapter');
    const b2 = await again.boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const menu = await page
      .getByTestId('menu-quick-edit')
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    notes.push(`long press without a move opens the menu with Quick edit: ${menu}`);
    if (menu) await page.getByTestId('task-menu').getByRole('button', { name: 'Close' }).click();

    // A repeating task asks this / following / all.
    await page.waitForTimeout(500);
    const rep = blockOf(page, 'Stretch break');
    await rep.scrollIntoViewIfNeeded();
    const rb = await rep.boundingBox();
    const rx = rb.x + rb.width / 2;
    const ry = rb.y + rb.height / 2;
    await page.mouse.move(rx, ry);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(rx, ry - 30, { steps: 6 });
    await page.mouse.up();
    const asked = await page
      .getByTestId('move-scope-this')
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    notes.push(`repeating task drag asks this / following / all: ${asked}`);
    if (asked) {
      await shot(page, 'wide-1024-calendar-day-move-scope');
      await page.getByTestId('move-scope-this').click();
      await page.waitForTimeout(1000);
      notes.push(`after "this": "${await blockOf(page, 'Stretch break').getAttribute('aria-label')}"`);
    }
    await context.close();
  }

  // Week grid, mouse.
  {
    const name = 'drag-week';
    const { context, page } = await open({ name, fixedTime: false }, 1440, 900);
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    await tab(page, 'Week');
    await settle(page, 'week-grid');
    const block = blockOf(page, 'Draft the project outline');
    await block.scrollIntoViewIfNeeded();
    const before = await block.getAttribute('aria-label');
    const box = await block.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + 20;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(x, y - 62, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    notes.push(
      `week grid drag -62 px: "${before}" -> "${await blockOf(page, 'Draft the project outline').getAttribute('aria-label')}"`,
    );
    await context.close();
  }

  // Phone, finger: a plain drag over a block still scrolls; long press then drag moves the block.
  {
    const name = 'drag-touch';
    const { context, page } = await open({ name, fixedTime: false });
    await page.goto(`${BASE}/calendar${demo}`);
    await settle(page, 'screen-calendar');
    const scroller = page.getByTestId('screen-calendar-scroll');
    const block = blockOf(page, 'Read one chapter');
    await block.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const client = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });

    let box = await block.boundingBox();
    let x = box.x + box.width / 2;
    let y = box.y + box.height / 2;
    const top0 = await scroller.evaluate((el) => el.scrollTop);
    const before = await block.getAttribute('aria-label');
    await touch('touchStart', x, y);
    for (let i = 1; i <= 8; i += 1) {
      await touch('touchMove', x, y + i * 15);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', x, y + 120);
    await page.waitForTimeout(500);
    const top1 = await scroller.evaluate((el) => el.scrollTop);
    notes.push(
      `touch: quick drag over a block scrolls the screen ${top0} -> ${top1}, block unchanged: ${
        (await blockOf(page, 'Read one chapter').getAttribute('aria-label')) === before
      }`,
    );

    box = await blockOf(page, 'Read one chapter').boundingBox();
    x = box.x + box.width / 2;
    y = box.y + box.height / 2;
    const top2 = await scroller.evaluate((el) => el.scrollTop);
    await touch('touchStart', x, y);
    await page.waitForTimeout(600); // long press
    for (let i = 1; i <= 6; i += 1) {
      await touch('touchMove', x, y + i * 10);
      await page.waitForTimeout(30);
    }
    await shot(page, 'dark-day-en-calendar-day-dragging');
    await touch('touchEnd', x, y + 60);
    await page.waitForTimeout(1200);
    const top3 = await scroller.evaluate((el) => el.scrollTop);
    notes.push(
      `touch: long press + drag 60 px: "${before}" -> "${await blockOf(page, 'Read one chapter').getAttribute('aria-label')}", screen scroll ${top2} -> ${top3}`,
    );
    await context.close();
  }
}

async function sweep() {
  const pages = [
    ['today', `/${demo}`, 'screen-today'],
    ['overdue', `/overdue${demo}`, 'screen-overdue'],
    ['history', `/history${demo}`, 'screen-history'],
    ['calendar-week', `/calendar${demo}`, 'screen-calendar'],
    ['task-new', `/task/new${demo}`, 'screen-task-editor'],
  ];
  for (const width of [240, 300, 390, 768, 1440]) {
    for (const [label, path, testId] of pages) {
      const name = `sweep-${width}-${label}`;
      const { context, page } = await open({ name }, width, 900);
      await page.goto(`${BASE}${path}`);
      await settle(page, testId);
      if (label === 'calendar-week') {
        await tab(page, 'Week');
        await page.waitForTimeout(800);
      }
      const over = await overflow(page);
      const root = await page.evaluate(() => document.getElementById('root')?.getBoundingClientRect().width);
      // Widest content element (the centred column) on wide screens.
      const column = await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return null;
        let widest = 0;
        for (const n of el.querySelectorAll('[data-testid^="task-"], [data-testid="week-grid"], input')) {
          widest = Math.max(widest, n.getBoundingClientRect().width);
        }
        return Math.round(widest);
      }, testId);
      notes.push(`${name}: overflow ${over} px, root ${root}, widest content ${column}`);
      if (width === 240 || width === 768 || width === 1440) await shot(page, name);
      await context.close();
    }
  }
}

try {
  if (!only || only === 'shots') await shots();
  if (!only || only === 'drag') await drag();
  if (!only || only === 'sweep') await sweep();
} finally {
  await browser.close();
}
console.log('\nNotes:');
for (const n of notes) console.log(' -', n);
console.log(errors.length ? `\nConsole errors/warnings (${errors.length}):` : '\nNo console errors or warnings.');
for (const e of errors) console.log(' -', e);
