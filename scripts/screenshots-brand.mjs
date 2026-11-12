#!/usr/bin/env node
/**
 * Brand screenshots: the app icon, the adaptive foreground (on the circle mask) and the monochrome icon from
 * assets/, plus a phone-sized screenshot of the in-app splash from the running Expo web app (dev-only ?holdSplash=1).
 *   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8101
 *   node scripts/screenshots-brand.mjs [--base http://localhost:8101] [--out docs/screenshots/phase-4-feedback]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:8101');
const OUT = arg('out', 'docs/screenshots/phase-4-feedback');
mkdirSync(OUT, { recursive: true });

// App icon, plus the adaptive foreground and monochrome shown on a 66/108 circle (the launcher's safe zone).
await sharp('assets/icon.png').resize(512).webp({ quality: 90 }).toFile(join(OUT, 'icon.webp'));
for (const [file, name, fg] of [
  ['assets/android-icon-foreground.png', 'adaptive-foreground', null],
  ['assets/android-icon-monochrome.png', 'adaptive-monochrome', '#17191B'],
]) {
  const size = 512;
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#3a3f44"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${(size * 66) / 108 / 2}" fill="${fg ?? '#17191B'}"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${(size * 66) / 108 / 2}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-dasharray="4 4"/></svg>`,
  );
  const layer = await sharp(file).resize(size).png().toBuffer();
  await sharp(circle)
    .composite([{ input: layer }])
    .webp({ quality: 90 })
    .toFile(join(OUT, `${name}.webp`));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultNavigationTimeout(180000);
await page.goto(`${BASE}/?demo=1&holdSplash=1`);
await page.getByTestId('app-splash').waitFor({ timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'splash.png') });
const box = await page.getByTestId('app-splash-wordmark').boundingBox();
console.log('wordmark box', box);
await browser.close();
await sharp(join(OUT, 'splash.png')).webp({ quality: 90 }).toFile(join(OUT, 'splash.webp'));
