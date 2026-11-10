#!/usr/bin/env node
/**
 * Phone-size screenshots of the running Expo web app (start it first: `npx expo start --web --port 8081`).
 *   node scripts/screenshots.mjs [--base http://localhost:8081] [--out docs/screenshots/phase-2]
 * Sets theme/language through the persisted preferences and the time of day through Playwright's clock.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8081');
const OUT = arg('out', 'docs/screenshots/phase-2');
const WIDTH = Number(arg('width', '390'));
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const NIGHT = '2026-11-09T21:30:00';

const sets = [
  { name: 'dark-day-en', theme: 'dark', language: 'en', time: DAY },
  { name: 'dark-night-en', theme: 'dark', language: 'en', time: NIGHT },
  { name: 'light-day-en', theme: 'light', language: 'en', time: DAY },
  { name: 'dark-day-fr', theme: 'dark', language: 'fr', time: DAY },
  { name: 'demo-dark-day-en', theme: 'dark', language: 'en', time: DAY, demo: true },
  { name: 'demo-light-day-fr', theme: 'light', language: 'fr', time: DAY, demo: true },
];
const only = arg('only', '');

const screens = [
  ['today', '/'],
  ['calendar', '/calendar'],
  ['goals', '/goals'],
  ['routines', '/routines'],
  ['me', '/me'],
];

const browser = await chromium.launch();
const errors = [];
try {
  for (const set of sets.filter((s) => !only || s.name === only)) {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: set.theme,
      locale: set.language === 'fr' ? 'fr-CA' : 'en-CA',
      isMobile: true,
      hasTouch: true,
      // The clock is frozen for day/night, which also freezes animations; reduced motion makes them instant.
      reducedMotion: 'reduce',
    });
    await context.addInitScript(
      (prefs) => {
        window.localStorage.setItem('ticktack.preferences', JSON.stringify({ state: prefs, version: 1 }));
      },
      { theme: set.theme, language: set.language, dayStart: '06:00', dayEnd: '19:00' },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${set.name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${set.name} console: ${m.text()}`));
    await page.clock.setFixedTime(new Date(set.time));
    const q = set.demo ? '?demo=1' : '';

    const shot = async (file) => {
      const png = await page.screenshot({ fullPage: false });
      await sharp(png)
        .webp({ quality: 82 })
        .toFile(join(OUT, `${file}.webp`));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) errors.push(`${file}: horizontal overflow ${overflow}px`);
    };

    if (!set.demo) {
      await page.goto(`${BASE}/?holdSplash=1`);
      await page.getByTestId('app-splash').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      await shot(`${set.name}-splash`);
    }

    for (const [name, path] of screens) {
      await page.goto(`${BASE}${path}${q}`);
      await page.getByTestId(`screen-${name}`).waitFor();
      await page.getByTestId('app-splash').waitFor({ state: 'detached', timeout: 15000 });
      await page
        .getByTestId('state-loading')
        .waitFor({ state: 'detached', timeout: 15000 })
        .catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await shot(`${set.name}-${name}`);
      if (name === 'calendar' && set.demo) {
        await page.getByRole('tab', { name: set.language === 'fr' ? 'Mois' : 'Month' }).click();
        await page.waitForTimeout(400);
        await shot(`${set.name}-calendar-month`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`Problems found:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Screenshots written to ${OUT}`);
}
