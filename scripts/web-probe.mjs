#!/usr/bin/env node
/**
 * Dev probe for the Expo web build (start it first with the emulator flag:
 * `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true npx expo start --web --port 8091`). Reports cross-origin isolation,
 * which screen state renders, console errors, the 250 px layout lock, and whether SQLite data survives a reload.
 *   node scripts/web-probe.mjs [http://localhost:8091]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:8091';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  window.localStorage.setItem(
    'ticktack.preferences',
    JSON.stringify({
      state: { theme: 'dark', language: 'en', dayStart: '06:00', dayEnd: '19:00', onboardingDone: true },
      version: 1,
    }),
  );
});
const page = await context.newPage();
const logs = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

const states = async () =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid^="state-"]')].map((e) => e.dataset.testid).join(','));

await page.goto(`${BASE}/?demo=1`, { timeout: 180000 });
await page.getByTestId('screen-today').waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
console.log('crossOriginIsolated:', await page.evaluate(() => self.crossOriginIsolated));
console.log('with ?demo=1 ->', await states());
await page.goto(`${BASE}/`);
await page.getByTestId('screen-today').waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
console.log('after reload without demo (persistence) ->', await states());
await page.setViewportSize({ width: 240, height: 700 });
await page.waitForTimeout(500);
console.log(
  'at 240 px: root width',
  await page.evaluate(() => Math.round(document.getElementById('root')?.getBoundingClientRect().width ?? 0)),
  'html overflow-x',
  await page.evaluate(() => getComputedStyle(document.documentElement).overflowX),
);
console.log(logs.join('\n') || 'no console errors or warnings');
await browser.close();
