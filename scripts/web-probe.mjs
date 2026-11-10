#!/usr/bin/env node
/**
 * Dev probe for the Expo web build (start it first: `npx expo start --web --port 8081`). Reports cross-origin
 * isolation, which screen state renders, console errors, and whether SQLite data survives a reload.
 *   node scripts/web-probe.mjs
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:8081';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
console.log(logs.join('\n') || 'no console errors or warnings');
await browser.close();
