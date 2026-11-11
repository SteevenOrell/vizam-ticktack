#!/usr/bin/env node
/**
 * Phase 4c: screenshots of Settings (Me), the categories manager, an empty state and History with a routine run,
 * in light and dark. Start the web app with the emulator flag so nothing talks to a real Firebase project:
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8097
 *   node scripts/screenshots-4c.mjs [--base http://localhost:8097]
 * Output: docs/screenshots/phase-4c/*.webp (390 px wide at 2x).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8097');
const OUT = arg('out', 'docs/screenshots/phase-4c');
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const demo = '?demo=1';
const errors = [];
const notes = [];
const browser = await chromium.launch();

async function open({ theme, language = 'en', name }, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: language === 'fr' ? 'fr-CA' : 'en-CA',
    isMobile: true,
    hasTouch: true,
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
  await page.clock.setFixedTime(new Date(DAY));
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

for (const [theme, language] of [
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'fr'],
]) {
  const name = `${theme}-${language}`;
  const fr = language === 'fr';

  // Settings: planning section (week start, capacity), then reminders.
  {
    const { context, page } = await open({ theme, language, name });
    await page.goto(`${BASE}/me${demo}`);
    await settle(page, 'screen-me');
    await page.getByTestId('week-start-1').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot(page, `${name}-settings-planning`);
    // Switch the week start to Monday and the capacity up one step: the choice is kept.
    await page.getByTestId('week-start-1').click();
    await page.getByTestId('capacity-stepper-next').click();
    await page.waitForTimeout(600);
    await shot(page, `${name}-settings-planning-changed`);
    await page.getByTestId('settings-reminders').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, `${name}-settings-reminders`);
    notes.push(`${name}: settings overflow ${await overflow(page)} px`);
    await context.close();
  }

  // Categories manager, with the edit sheet open.
  {
    const { context, page } = await open({ theme, language, name });
    await page.goto(`${BASE}/settings/categories${demo}`);
    await settle(page, 'screen-categories');
    await shot(page, `${name}-categories`);
    await page
      .getByTestId(/^category-row-/)
      .first()
      .click();
    await page.getByTestId('category-name').waitFor();
    await page.waitForTimeout(500);
    await shot(page, `${name}-categories-edit`);
    notes.push(`${name}: categories overflow ${await overflow(page)} px`);
    await context.close();
  }

  // Empty state (no demo data).
  {
    const { context, page } = await open({ theme, language, name });
    await page.goto(`${BASE}/history`);
    await settle(page, 'screen-history');
    await shot(page, `${name}-history-empty`);
    await page.goto(`${BASE}/settings/sync`);
    await settle(page, 'screen-failed-sync');
    await shot(page, `${name}-failed-sync-empty`);
    await context.close();
  }

  // History with a completed routine run: tick the routine on Today, then open History.
  {
    const { context, page } = await open({ theme, language, name });
    await page.goto(`${BASE}/${demo}`);
    await settle(page, 'screen-today');
    const routineCheck = page.getByTestId('group-routines').getByRole('checkbox').first();
    await routineCheck.click();
    await page.waitForTimeout(600);
    await page.getByTestId('today-history').click();
    await settle(page, 'screen-history');
    await shot(page, `${name}-history-routine`);
    notes.push(`${name}: history overflow ${await overflow(page)} px (${fr ? 'fr' : 'en'})`);
    await context.close();
  }
}

await browser.close();
console.log(notes.join('\n'));
if (errors.length) {
  console.log('--- console errors ---');
  console.log([...new Set(errors)].join('\n'));
}
