#!/usr/bin/env node
/**
 * Screenshots and layout checks of the running Expo web app (start it first, with the emulator flag so nothing
 * talks to a real Firebase project):
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8091
 *   node scripts/screenshots.mjs [--base http://localhost:8091] [--out docs/screenshots/phase-3] [--only <set>]
 *   node scripts/screenshots.mjs --sweep        # widths 240/300/390/768/1440: horizontal overflow + console errors
 * Theme/language/onboarding come from the persisted preferences; the time of day from Playwright's clock.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8091');
const OUT = arg('out', 'docs/screenshots/phase-3');
const only = arg('only', '');
const sweep = process.argv.includes('--sweep');
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const NIGHT = '2026-11-09T21:30:00';
const L = {
  en: { week: 'Week', month: 'Month', next: 'Next', skip: 'Skip', outline: 'Draft the project outline' },
  fr: { week: 'Semaine', month: 'Mois', next: 'Suivant', skip: 'Passer', outline: 'Ébaucher le plan du projet' },
};

const errors = [];
const browser = await chromium.launch();

async function open(set, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: set.theme,
    locale: set.language === 'fr' ? 'fr-CA' : 'en-CA',
    // 240 px runs as a narrow desktop window: mobile emulation widens the layout viewport to the content instead.
    isMobile: width >= 250 && width < 700,
    hasTouch: width >= 250 && width < 700,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    (prefs) => {
      window.localStorage.setItem('ticktack.preferences', JSON.stringify({ state: prefs, version: 1 }));
    },
    {
      theme: set.theme,
      language: set.language,
      dayStart: '06:00',
      dayEnd: '19:00',
      onboardingDone: set.onboarded !== false,
    },
  );
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(180000); // the first request after a cold Metro start bundles the app
  page.on('pageerror', (e) => errors.push(`${set.name}@${width}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${set.name}@${width} console: ${m.text()}`));
  await page.clock.setFixedTime(new Date(set.time ?? DAY));
  return { context, page };
}

async function settle(page, testId) {
  await page.getByTestId(testId).waitFor({ timeout: 60000 });
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
  await page.waitForTimeout(500);
}

/** The app scrolls inside a ScrollView, not the document: scroll it with the mouse wheel. */
async function scrollMain(page, dy = 900) {
  await page.mouse.move(195, 560);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(500);
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function shot(page, file, { fullPage = false } = {}) {
  const png = await page.screenshot({ fullPage });
  await sharp(png)
    .webp({ quality: 82 })
    .toFile(join(OUT, `${file}.webp`));
  const o = await overflow(page);
  if (o > 0) errors.push(`${file}: horizontal overflow ${o}px`);
}

const demo = '?demo=1';
const sets = [
  {
    name: 'dark-day-en',
    theme: 'dark',
    language: 'en',
    run: async (page) => {
      await page.goto(`${BASE}/${demo}`);
      await settle(page, 'screen-today');
      await shot(page, 'dark-day-en-today');
      await scrollMain(page);
      await shot(page, 'dark-day-en-today-scrolled');
      await page.getByRole('button', { name: new RegExp(`^${L.en.outline},`) }).click();
      await settle(page, 'screen-task-editor');
      await shot(page, 'dark-day-en-task-edit');
      await scrollMain(page);
      await shot(page, 'dark-day-en-task-edit-scrolled');
      await page.goto(`${BASE}/task/new${demo}`);
      await settle(page, 'screen-task-editor');
      await page.getByTestId('field-title').fill('Team check-in');
      await page.getByRole('radio', { name: 'Weekly' }).click();
      await page.waitForTimeout(300);
      await scrollMain(page, 1200);
      await shot(page, 'dark-day-en-task-new-repeat');
      await page.goto(`${BASE}/calendar${demo}`);
      await settle(page, 'screen-calendar');
      await shot(page, 'dark-day-en-calendar-day');
      await page.getByRole('tab', { name: L.en.week }).click();
      await page.waitForTimeout(600);
      await shot(page, 'dark-day-en-calendar-week');
      await page.getByRole('tab', { name: L.en.month }).click();
      await page.waitForTimeout(600);
      await shot(page, 'dark-day-en-calendar-month');
      await page.goto(`${BASE}/me${demo}`);
      await settle(page, 'screen-me');
      await shot(page, 'dark-day-en-me');
    },
  },
  {
    name: 'dark-night-en',
    theme: 'dark',
    language: 'en',
    time: NIGHT,
    run: async (page) => {
      await page.goto(`${BASE}/${demo}`);
      await settle(page, 'screen-today');
      await shot(page, 'dark-night-en-today');
      await page.goto(`${BASE}/calendar${demo}`);
      await settle(page, 'screen-calendar');
      await shot(page, 'dark-night-en-calendar-day');
    },
  },
  {
    name: 'light-day-en',
    theme: 'light',
    language: 'en',
    run: async (page) => {
      await page.goto(`${BASE}/${demo}`);
      await settle(page, 'screen-today');
      await shot(page, 'light-day-en-today');
      await page.goto(`${BASE}/calendar${demo}`);
      await settle(page, 'screen-calendar');
      await page.getByRole('tab', { name: L.en.week }).click();
      await page.waitForTimeout(600);
      await shot(page, 'light-day-en-calendar-week');
    },
  },
  {
    name: 'dark-day-fr',
    theme: 'dark',
    language: 'fr',
    run: async (page) => {
      await page.goto(`${BASE}/${demo}`);
      await settle(page, 'screen-today');
      await shot(page, 'dark-day-fr-today');
      await page.goto(`${BASE}/task/new${demo}`);
      await settle(page, 'screen-task-editor');
      await shot(page, 'dark-day-fr-task-new');
      await page.goto(`${BASE}/calendar${demo}`);
      await settle(page, 'screen-calendar');
      await page.getByRole('tab', { name: L.fr.month }).click();
      await page.waitForTimeout(600);
      await shot(page, 'dark-day-fr-calendar-month');
      await page.goto(`${BASE}/me${demo}`);
      await settle(page, 'screen-me');
      await shot(page, 'dark-day-fr-me');
    },
  },
  {
    name: 'light-day-fr',
    theme: 'light',
    language: 'fr',
    run: async (page) => {
      await page.goto(`${BASE}/${demo}`);
      await settle(page, 'screen-today');
      await shot(page, 'light-day-fr-today');
      await page.goto(`${BASE}/sign-up`);
      await settle(page, 'screen-sign-up');
      await shot(page, 'light-day-fr-sign-up');
    },
  },
  {
    name: 'first-run-en',
    theme: 'dark',
    language: 'en',
    onboarded: false,
    run: async (page) => {
      await page.goto(`${BASE}/`);
      await settle(page, 'screen-onboarding');
      await shot(page, 'dark-day-en-onboarding-1');
      await page.getByTestId('onboarding-next').click();
      await page.waitForTimeout(300);
      await shot(page, 'dark-day-en-onboarding-2');
      await page.getByRole('button', { name: L.en.skip }).click();
      await page.waitForTimeout(300);
      await shot(page, 'dark-day-en-onboarding-ready');
      await page.goto(`${BASE}/sign-in`);
      await settle(page, 'screen-sign-in');
      await shot(page, 'dark-day-en-sign-in');
      await page.getByTestId('auth-submit').click();
      await page.waitForTimeout(300);
      await shot(page, 'dark-day-en-sign-in-errors');
    },
  },
  {
    name: 'first-run-fr-night',
    theme: 'dark',
    language: 'fr',
    onboarded: false,
    time: NIGHT,
    run: async (page) => {
      await page.goto(`${BASE}/`);
      await settle(page, 'screen-onboarding');
      await shot(page, 'dark-night-fr-onboarding-1');
    },
  },
];

const sweepRoutes = [
  ['screen-today', `/${demo}`],
  ['screen-calendar', `/calendar${demo}`],
  ['screen-me', `/me${demo}`],
  ['screen-task-editor', `/task/new${demo}`],
  ['screen-sign-in', '/sign-in'],
];

try {
  if (sweep) {
    for (const width of [240, 300, 390, 768, 1440]) {
      const set = { name: `sweep`, theme: 'dark', language: 'fr' };
      const { context, page } = await open(set, width);
      for (const [testId, path] of sweepRoutes) {
        await page.goto(`${BASE}${path}`);
        await settle(page, testId);
        const o = await overflow(page);
        const rootWidth = await page.evaluate(() => document.getElementById('root')?.getBoundingClientRect().width);
        console.log(
          `${String(width).padStart(4)} px ${path.padEnd(18)} overflow=${o} root=${Math.round(rootWidth ?? 0)}`,
        );
        if (width >= 300 && o > 0) errors.push(`sweep ${path} at ${width}px: horizontal overflow ${o}px`);
        if (width < 250 && Math.round(rootWidth ?? 0) !== 500)
          errors.push(`sweep ${path} at ${width}px: root not locked to 500px`);
        if (width < 250) {
          const panned = await page.evaluate(() => {
            window.scrollTo(400, 0);
            const x = window.scrollX;
            window.scrollTo(0, 0);
            return x;
          });
          console.log(`      pan check: scrollX after scrollTo(400) = ${panned}`);
          if (panned <= 0) errors.push(`sweep ${path} at ${width}px: cannot pan horizontally`);
        }
        if ([240, 1440].includes(width) && path === `/${demo}`) {
          await shot(page, `sweep-${width}-today`);
        }
      }
      await context.close();
    }
  } else {
    for (const set of sets.filter((s) => !only || s.name === only)) {
      const { context, page } = await open(set);
      await set.run(page);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const unexpected = errors.filter((e) => !(sweep && /sweep-240-today: horizontal overflow/.test(e)));
if (unexpected.length) {
  console.error(`Problems found:\n${unexpected.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(sweep ? 'Sweep passed' : `Screenshots written to ${OUT}`);
}
