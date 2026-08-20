/**
 * verify/shoot.mjs — drive the cube in a real browser, screenshot it, measure it.
 *   node verify/shoot.mjs [--headed] [--out verify/shots] [--only 01,04]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);
const OUT = path.resolve(arg('out', 'verify/shots'));
const W = +arg('w', 1600), H = +arg('h', 1000);
const ONLY = arg('only', null)?.split(',');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: !has('headed'),
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit']
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:5183/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__cube?.ready, null, { timeout: 60000 });
await page.waitForTimeout(500);

console.log('GPU:', await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
}));

const shot = async (name, settle = 420, clip) => {
  if (ONLY && !ONLY.some(o => name.startsWith(o))) return;
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, name + '.png'), ...(clip ? { clip } : {}) });
  console.log('  shot', name);
};

async function measure(label, ms, driver) {
  await page.evaluate(() => window.__api.resetPerf());
  const stopAt = Date.now() + ms;
  const p = driver ? driver(stopAt) : null;
  const samples = [];
  while (Date.now() < stopAt) { await page.waitForTimeout(200); samples.push(await page.evaluate(() => window.__cube.fps)); }
  if (p) await p;
  const s = samples.filter(x => x > 0).sort((a, b) => a - b);
  const st = await page.evaluate(() => ({ tris: window.__cube.tris, calls: window.__cube.calls, min: window.__cube.minFps }));
  const med = s[Math.floor(s.length / 2)] ?? 0, p10 = s[Math.floor(s.length * 0.1)] ?? 0;
  console.log(`  [fps] ${label.padEnd(30)} median ${med.toFixed(0).padStart(4)} | p10 ${p10.toFixed(0).padStart(4)} | worst frame ${st.min.toFixed(0).padStart(4)} | tris ${st.tris.toLocaleString().padStart(9)} | calls ${st.calls}`);
  return { label, med, p10, worstFrame: st.min, tris: st.tris, calls: st.calls };
}

const dragOrbit = (stopAt) => (async () => {
  const cx = W / 2, cy = H / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  let a = 0;
  while (Date.now() < stopAt) { a += 0.22; await page.mouse.move(cx + Math.cos(a) * 280, cy + Math.sin(a * 0.6) * 100, { steps: 2 }); await page.waitForTimeout(15); }
  await page.mouse.up();
})();

const results = [];
const st = await page.evaluate(() => ({ ghost: window.__cube.ghostTris, verts: window.__cube.ghostVerts, solid: window.__cube.solid }));
console.log('ghost triangles:', st.ghost.toLocaleString(), '| ghost vertices:', st.verts.toLocaleString());
console.log('solid:', JSON.stringify(st.solid));
console.log('polity join:', JSON.stringify(await page.evaluate(() => window.__api.polityStats())));
console.log('scene audit:', JSON.stringify(await page.evaluate(() => window.__api.audit())));

// ── 1. the default view: the Rome lineage traced as one solid ───────────────
await shot('01-default');
console.log('traced lineage:', JSON.stringify(await page.evaluate(() => window.__cube.traced.map(t => `${t.name}(${t.span})`))));
results.push(await measure('static, default view', 1400));
results.push(await measure('orbit drag, default', 3000, dragOrbit));
await shot('02-after-drag');

await page.evaluate(() => window.__api.view('top', 0)); await shot('03-top-down');
await page.evaluate(() => window.__api.view('front', 0)); await shot('04-front');
await page.evaluate(() => window.__api.view('side', 0)); await shot('05-side');
await page.evaluate(() => window.__api.view('low', 0)); await shot('06-low-angle');
await page.evaluate(() => { window.__api.view('home', 0); window.__api.view('focus', 1); });
await shot('07-focus-rome-lineage', 900);

// ── 2. lineage: one polity, then the chain, then the forks ──────────────────
await page.evaluate(() => { window.__api.ghost(0.16); window.__api.select('roman-empire', 0); window.__api.view('home', 0); });
await shot('08-rome-alone', 700);
await page.evaluate(() => window.__api.lineage(1));
await shot('09-rome-lineage-1', 800);
await page.evaluate(() => window.__api.lineage(3));
await shot('10-rome-lineage-3', 900);
await page.evaluate(() => window.__api.view('focus', 1));
await shot('11-rome-lineage-focus', 1000);
await page.evaluate(() => { window.__api.view('side', 0); window.__api.ghost(0.09); });
await shot('12-rome-lineage-side', 800);
results.push(await measure('orbit drag, 3-link lineage', 2600, dragOrbit));

// ── 3. the two-ended time cut, capped and uncapped ──────────────────────────
await page.evaluate(() => { window.__api.select('ottoman-empire', 0); window.__api.ghost(0.14); window.__api.view('home', 0); });
await page.waitForTimeout(600);
await page.evaluate(() => window.__api.cut(0.34, 0.66));
await shot('13-cut-range-1050-to-1650', 700);
await page.evaluate(() => { window.__api.view('focus', 1); });
await page.waitForTimeout(1000);
await page.evaluate(() => { window.__api.ghost(0.03); window.__api.cut(0.52, 0.76); window.__api.orbit(0, 0.03, null); });
await shot('14-cut-capped-from-above', 700);
await page.evaluate(() => window.__api.caps(false));
await shot('15-cut-hollow-from-above', 700);
await page.evaluate(() => { window.__api.caps(true); window.__api.orbit(0, 3.11, null); });
await shot('16-cut-capped-from-below', 700);
await page.evaluate(() => window.__api.caps(false));
await shot('17-cut-hollow-from-below', 700);
await page.evaluate(() => { window.__api.caps(true); window.__api.orbit(-0.7, 0.8, null); });
await shot('18-cut-capped-oblique', 700);
results.push(await measure('orbit drag, capped cut', 2400, dragOrbit));
await page.evaluate(() => window.__api.caps(false));
results.push(await measure('orbit drag, cut without caps', 2000, dragOrbit));
await page.evaluate(() => { window.__api.caps(true); window.__api.cut(0, 1); window.__api.ghost(0.16); window.__api.view('home', 0); });

// ── 4. single-slice mode, watched from the top ──────────────────────────────
await page.evaluate(() => { window.__api.select('roman-republic', 3); });
await page.waitForTimeout(900);
await page.evaluate(() => { window.__api.slice(true, 6); window.__api.view('top', 1); });
await shot('19-slice-1000AD-top', 900);
await page.evaluate(() => window.__api.slice(true, 12));
await shot('20-slice-1815AD-top', 900);
await page.evaluate(() => window.__api.slice(true, 15));
await shot('21-slice-1938AD-top', 900);
// mid cross-fade, to show the transition is labelled honestly
await page.evaluate(() => window.__api.sliceGo(16));
await shot('22-slice-crossfade', 0);      // caught mid cross-fade, ~300 ms long
await page.waitForTimeout(500);
results.push(await measure('single slice, top view', 1600));
await page.evaluate(() => window.__api.slicePlay(true));
results.push(await measure('single slice, playing', 2600));
await page.evaluate(() => { window.__api.slicePlay(false); window.__api.slice(false); window.__api.view('home', 0); });

// ── 5. perspective vs isometric, same view state ────────────────────────────
for (const [tag, kind] of [['persp', 'persp'], ['iso', 'ortho']]) {
  await page.evaluate((k) => { window.__api.proj(k); window.__api.view('home', 0); }, kind);
  await shot(`23-${tag}-home`, 600);
  await page.evaluate(() => window.__api.view('top', 0));
  await shot(`24-${tag}-top`, 600);
  await page.evaluate(() => window.__api.view('front', 0));
  await shot(`25-${tag}-front`, 600);
}
await page.evaluate(() => { window.__api.proj('ortho'); window.__api.view('home', 0); });
results.push(await measure('orbit drag, isometric', 2400, dragOrbit));
await page.evaluate(() => { window.__api.proj('persp'); window.__api.view('home', 0); });

// ── 6. the pivot marker, mid-drag, at two very different depths ─────────────
{
  const hold = async (name, note) => {
    await page.mouse.move(W / 2, H / 2); await page.mouse.down();
    for (let i = 0; i < 5; i++) { await page.mouse.move(W / 2 + i * 5, H / 2 - i * 3); await page.waitForTimeout(30); }
    await page.waitForTimeout(320);
    const px = await page.evaluate(() => window.__cube.pivotScreenRadius);
    await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: W / 2 - 120, y: H / 2 - 120, width: 240, height: 240 } });
    await page.screenshot({ path: path.join(OUT, name + '-full.png') });
    await page.mouse.up();
    console.log(`  shot ${name}  ${note}  ring radius = ${px.toFixed(2)} css px`);
    return px;
  };
  await page.evaluate(() => { window.__api.select('ottoman-empire', 0); window.__api.view('home', 0); });
  await page.waitForTimeout(700);
  const a = await hold('26-pivot-far', 'perspective, orbit radius 720');
  await page.evaluate(() => { window.__api.view('focus', 1); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__api.orbit(null, null, 40));
  await page.waitForTimeout(300);
  const b = await hold('27-pivot-near', 'perspective, orbit radius 40');
  await page.evaluate(() => { window.__api.view('home', 0); window.__api.proj('ortho'); });
  await page.waitForTimeout(400);
  const c = await hold('28-pivot-iso', 'orthographic');
  await page.evaluate(() => window.__api.proj('persp'));
  results.push({ label: 'pivot marker screen radius (px)', far: a, near: b, iso: c });
}

// ── 7. heaviest realistic configuration ────────────────────────────────────
await page.evaluate(() => {
  window.__api.select('roman-republic', 3);
  window.__api.ghost(0.45); window.__api.ghostLines(true); window.__api.outlines(true);
  window.__api.view('home', 0);
});
await shot('29-worst-case', 900);
results.push(await measure('orbit drag, worst case', 2600, dragOrbit));
await page.evaluate(() => window.__api.cut(0.30, 0.72));
results.push(await measure('orbit drag, worst case + cut', 2600, dragOrbit));
console.log('  worst-case audit:', JSON.stringify(await page.evaluate(() => window.__api.audit())));
await page.evaluate(() => {
  window.__api.cut(0, 1); window.__api.ghost(0.16); window.__api.outlines(false);
  window.__api.select('roman-republic', 3); window.__api.view('home', 0);
});

console.log('\nconsole errors:', errs.length ? errs.slice(0, 8) : 'none');
fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify({ ghost: st, results }, null, 2));
await browser.close();
