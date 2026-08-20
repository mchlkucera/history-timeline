import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const argv = process.argv.slice(2);
const OUT = path.resolve('verify/shots'); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-gpu-vsync','--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await page.goto('http://127.0.0.1:5183/', { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__cube?.ready, null, { timeout: 20000 }); }
catch (e) { console.log('NOT READY. errors:', errs.slice(0,6)); await browser.close(); process.exit(1); }
await page.waitForTimeout(400);
// argv is a list of "name:jsExpr"
for (const spec of argv) {
  const i = spec.indexOf(':');
  const name = spec.slice(0, i), js = spec.slice(i + 1);
  await page.evaluate(js);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
}
console.log('errors:', errs.length ? errs.slice(0,5) : 'none');
await browser.close();
