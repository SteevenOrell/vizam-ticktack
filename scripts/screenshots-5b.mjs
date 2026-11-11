#!/usr/bin/env node
/**
 * Phase 5b QA sweep of the running Expo web app: every main screen at 390 and 1440 px, light and dark, English and
 * French. For each shot it records horizontal overflow, console errors / warnings and truncated text (an element
 * whose text is wider than its box), then writes a webp per shot and one contact sheet per combination.
 * Start the web app with the emulator flag so nothing talks to a real Firebase project:
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8102
 *   node scripts/screenshots-5b.mjs [--base http://localhost:8102] [--only widths|shots] [--widths 390,1440]
 * Output: docs/screenshots/phase-5b/*.webp and docs/screenshots/phase-5b/report.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8102');
const OUT = arg('out', 'docs/screenshots/phase-5b');
const only = arg('only', '');
const WIDTHS = arg('widths', '390,1440').split(',').map(Number);
mkdirSync(OUT, { recursive: true });

const DAY = '2026-11-09T10:30:00';
const demo = '?demo=1';
const errors = [];
const truncated = [];
const overflows = [];
const taken = [];
const browser = await chromium.launch();

async function open({ theme, language, name }, width, height) {
  const mobile = width >= 250 && width < 700;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
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

/** Visible text elements whose text is wider than their box (ellipsis or clipped), as "text (scrollWidth/clientWidth)". */
const clipped = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 0 && !(el.childNodes.length === 1 && el.firstChild?.nodeType === 3)) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight * 3) continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        out.push(`${text.slice(0, 50)} (${el.scrollWidth}/${el.clientWidth})`);
      }
    }
    return out;
  });

async function shot(page, name, width, file) {
  const id = `${file}-${width}`;
  const o = await overflow(page);
  if (o > 0) overflows.push(`${id}: ${o}px`);
  for (const c of await clipped(page)) truncated.push(`${id}: ${c}`);
  const png = await page.screenshot();
  await sharp(png)
    .webp({ quality: 78 })
    .toFile(join(OUT, `${id}.webp`));
  taken.push({ combo: name, width, file, id });
}

/** Routes opened by URL, as [file, path, test id, optional step]. */
const ROUTES = [
  ['today', `/${demo}`, 'screen-today'],
  ['calendar-day', `/calendar${demo}`, 'screen-calendar'],
  [
    'calendar-week',
    `/calendar${demo}`,
    'screen-calendar',
    async (p, fr) => p.getByRole('tab', { name: fr ? 'Semaine' : 'Week' }).click(),
  ],
  [
    'calendar-month',
    `/calendar${demo}`,
    'screen-calendar',
    async (p, fr) => p.getByRole('tab', { name: fr ? 'Mois' : 'Month' }).click(),
  ],
  ['goals', `/goals${demo}`, 'screen-goals'],
  ['routines', `/routines${demo}`, 'screen-routines'],
  ['me', `/me${demo}`, 'screen-me'],
  ['history', `/history${demo}`, 'screen-history'],
  ['overdue', `/overdue${demo}`, 'screen-overdue'],
  ['categories', `/settings/categories${demo}`, 'screen-categories'],
  ['failed-sync', `/settings/sync${demo}`, 'screen-failed-sync'],
  ['task-new', `/task/new${demo}`, 'screen-task-editor'],
  ['goal-new', `/goal/new${demo}`, 'screen-goal-editor'],
  ['routine-new', `/routine/new${demo}`, 'screen-routine-editor'],
  ['delete-account', `/account/delete${demo}`, 'screen-delete-account'],
];

async function sweep() {
  for (const width of WIDTHS) {
    const height = width >= 700 ? 900 : 844;
    for (const [theme, language] of [
      ['light', 'en'],
      ['dark', 'en'],
      ['light', 'fr'],
      ['dark', 'fr'],
    ]) {
      const name = `${theme}-${language}`;
      const fr = language === 'fr';
      const { context, page } = await open({ theme, language, name }, width, height);
      for (const [file, path, testId, step] of ROUTES) {
        await page.goto(`${BASE}${path}`);
        await settle(page, testId);
        if (step) {
          await step(page, fr);
          await page.waitForTimeout(600);
        }
        await shot(page, name, width, `${name}-${file}`);
      }
      // Detail screens reached by tapping, as a user would: task, goal, routine, routine run.
      await page.goto(`${BASE}/${demo}`);
      await settle(page, 'screen-today');
      await page
        .getByTestId('group-scheduled')
        .getByRole('button')
        .first()
        .click()
        .catch(() => undefined);
      await page
        .getByTestId('screen-task-detail')
        .waitFor({ timeout: 8000 })
        .catch(() => errors.push(`${name}@${width}: task row did not open the details`));
      await page.waitForTimeout(600);
      await shot(page, name, width, `${name}-task-detail`);
      await page.goto(`${BASE}/goals${demo}`);
      await settle(page, 'screen-goals');
      await page
        .getByTestId(/^goal-card-/)
        .first()
        .click();
      await settle(page, 'screen-goal-detail');
      await shot(page, name, width, `${name}-goal-detail`);
      await page.goto(`${BASE}/routines${demo}`);
      await settle(page, 'screen-routines');
      await page
        .getByTestId(/^routine-card-/)
        .first()
        .click();
      await settle(page, 'screen-routine');
      await shot(page, name, width, `${name}-routine-detail`);
      await context.close();
    }
  }
  // Auth and onboarding need no demo data and a fresh preference set.
  for (const width of WIDTHS) {
    const height = width >= 700 ? 900 : 844;
    for (const [theme, language] of [
      ['light', 'en'],
      ['dark', 'fr'],
    ]) {
      const name = `${theme}-${language}`;
      const { context, page } = await open({ theme, language, name }, width, height);
      for (const [file, path, testId] of [
        ['sign-in', '/sign-in', 'screen-sign-in'],
        ['sign-up', '/sign-up', 'screen-sign-up'],
        ['reset', '/reset-password', 'screen-reset'],
      ]) {
        await page.goto(`${BASE}${path}`);
        await settle(page, testId);
        await shot(page, name, width, `${name}-${file}`);
      }
      await context.close();
      const fresh = await open({ theme, language, name }, width, height);
      await fresh.context.addInitScript(() =>
        window.localStorage.setItem(
          'ticktack.preferences',
          JSON.stringify({ state: { onboardingDone: false }, version: 1 }),
        ),
      );
      await fresh.page.goto(`${BASE}/onboarding`);
      await settle(fresh.page, 'screen-onboarding');
      await shot(fresh.page, name, width, `${name}-onboarding`);
      await fresh.context.close();
    }
  }
}

/** Overflow and the 240 px lock on the main routes, in both languages. */
async function widths() {
  const rows = [];
  for (const width of [240, 300, 390, 768, 1440]) {
    for (const language of ['en', 'fr']) {
      const { context, page } = await open({ theme: 'dark', language, name: 'widths' }, width, 900);
      for (const [file, path, testId, step] of ROUTES) {
        await page.goto(`${BASE}${path}`);
        await settle(page, testId);
        if (step) {
          await step(page, language === 'fr');
          await page.waitForTimeout(400);
        }
        const o = await overflow(page);
        const root = await page.evaluate(() =>
          Math.round(document.getElementById('root')?.getBoundingClientRect().width),
        );
        const fixedBad = await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter((e) => getComputedStyle(e).position === 'fixed')
            .map((e) => Math.round(e.getBoundingClientRect().width))
            .filter((w) => w > 505),
        );
        rows.push({ width, language, file, overflow: o, root, fixedBad });
        if (width >= 300 && o > 0) errors.push(`widths ${file} ${language}@${width}: overflow ${o}px`);
        if (width < 250 && root !== 500) errors.push(`widths ${file} ${language}@${width}: root ${root}, expected 500`);
        if (fixedBad.length)
          errors.push(`widths ${file} ${language}@${width}: fixed element wider than 500: ${fixedBad}`);
      }
      await context.close();
    }
  }
  return rows;
}

let widthRows = [];
try {
  if (!only || only === 'shots') await sweep();
  if (!only || only === 'widths') widthRows = await widths();
} finally {
  await browser.close();
}

// Contact sheets: one per combination and width, 5 columns of thumbnails.
if (taken.length) {
  const groups = new Map();
  for (const t of taken) groups.set(`${t.combo}-${t.width}`, [...(groups.get(`${t.combo}-${t.width}`) ?? []), t]);
  for (const [key, items] of groups) {
    const thumbW = items[0].width < 700 ? 260 : 480;
    const cols = items[0].width < 700 ? 6 : 4;
    const thumbs = await Promise.all(
      items.map((t) =>
        sharp(join(OUT, `${t.id}.webp`))
          .resize({ width: thumbW })
          .png()
          .toBuffer(),
      ),
    );
    const metas = await Promise.all(thumbs.map((b) => sharp(b).metadata()));
    const cellH = Math.max(...metas.map((m) => m.height ?? 0));
    const rows = Math.ceil(thumbs.length / cols);
    await sharp({
      create: { width: cols * (thumbW + 6), height: rows * (cellH + 6), channels: 3, background: '#888888' },
    })
      .composite(
        thumbs.map((input, i) => ({ input, left: (i % cols) * (thumbW + 6), top: Math.floor(i / cols) * (cellH + 6) })),
      )
      .webp({ quality: 80 })
      .toFile(join(OUT, `sheet-${key}.webp`));
  }
}

writeFileSync(
  join(OUT, 'report.json'),
  JSON.stringify(
    { shots: taken.length, overflows, truncated: [...new Set(truncated)], errors: [...new Set(errors)], widthRows },
    null,
    1,
  ),
);
console.log(
  `shots ${taken.length}, overflows ${overflows.length}, truncated ${new Set(truncated).size}, errors ${new Set(errors).size}`,
);
if (widthRows.length)
  console.log(
    `width rows ${widthRows.length}, with overflow>0 at >=300: ${widthRows.filter((r) => r.width >= 300 && r.overflow > 0).length}`,
  );
if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
}
