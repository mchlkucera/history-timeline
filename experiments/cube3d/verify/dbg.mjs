import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5183/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__cube?.ready, null, { timeout: 60000 });
await page.evaluate(() => window.__api.view('home', 0));
await page.waitForTimeout(500);
// sample theta from inside the page, every frame, so playwright round-trips do not distort it
await page.evaluate(() => {
  window.__trace = [];
  const t0 = performance.now();
  const f = () => { window.__trace.push([performance.now() - t0, window.__api.spherical().theta]); if (performance.now() - t0 < 3000) requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await page.mouse.move(800, 500); await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(800 + i * 22, 500); await page.waitForTimeout(12); }
await page.mouse.up();
const upAt = await page.evaluate(() => window.__trace[window.__trace.length - 1][0]);
await page.waitForTimeout(2600);
const tr = await page.evaluate(() => window.__trace);
console.log('release at ~', upAt.toFixed(0), 'ms; frames captured', tr.length);
const last = tr[tr.length - 1][1];
for (const [t, th] of tr) {
  if (t < upAt - 40) continue;
  if (Math.round(t) % 1 === 0 && (t - upAt) % 1 < 100) { }
}
const marks = [-50, 0, 40, 80, 120, 200, 300, 500, 800, 1200, 1800, 2400];
for (const m of marks) {
  const want = upAt + m;
  let best = tr[0];
  for (const s of tr) if (Math.abs(s[0] - want) < Math.abs(best[0] - want)) best = s;
  console.log(`  t=${String(m).padStart(5)}ms  theta=${best[1].toFixed(4)}  remaining=${(last - best[1]).toFixed(4)}`);
}
console.log('fps during capture:', (tr.length / (tr[tr.length-1][0]/1000)).toFixed(0));
await browser.close();
