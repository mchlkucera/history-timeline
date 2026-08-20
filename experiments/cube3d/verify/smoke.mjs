/** verify/smoke.mjs — load the page, report console + page errors, dump state. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto('http://127.0.0.1:5183/', { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__cube?.ready, null, { timeout: 25000 });
} catch {
  console.log('!! never became ready');
}
await page.waitForTimeout(700);
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none');
console.log('state:', JSON.stringify(await page.evaluate(() => window.__cube?.state ?? null)));
console.log('traced:', JSON.stringify(await page.evaluate(() => window.__cube?.traced ?? null)));
console.log('solid:', JSON.stringify(await page.evaluate(() => window.__cube?.solid ?? null)));
console.log('polityStats:', JSON.stringify(await page.evaluate(() => window.__api?.polityStats?.() ?? null)));
await browser.close();
