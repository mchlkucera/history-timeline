/** verify/nav.mjs — assert the navigation actually behaves as claimed. */
import { chromium } from 'playwright';
const W = 1600, H = 1000;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5183/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__cube?.ready, null, { timeout: 60000 });
await page.waitForTimeout(400);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

await page.evaluate(() => { window.__api.select('ottoman-empire', 0); window.__api.view('home', 0); window.__api.ghost(0.16); });
await page.waitForTimeout(300);

// ── 1. depth-picked pivot: target moves to what's under the cursor, camera does not
{
  const before = await page.evaluate(() => window.__api.basis());
  // find a screen point that lands on the traced solid
  const p = await page.evaluate(() => {
    const b = window.__cube; const api = window.__api;
    for (let y = 200; y < 850; y += 12) for (let x = 500; x < 1200; x += 12) {
      const w = api.worldAtScreen(x, y); if (w) return { x, y, w };
    }
    return null;
  });
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  const after = await page.evaluate(() => window.__api.basis());
  await page.mouse.up();
  ok('pivot: camera position unchanged on pivot pick', dist(before.pos, after.pos) < 1e-6, `moved ${dist(before.pos, after.pos).toExponential(1)}`);
  ok('pivot: view direction unchanged on pivot pick', dist(before.fwd, after.fwd) < 1e-6);
  // the design puts the target on the view axis at the hit's *depth*, so compare depths
  const depth = (pt) => (pt[0]-after.pos[0])*after.fwd[0] + (pt[1]-after.pos[1])*after.fwd[1] + (pt[2]-after.pos[2])*after.fwd[2];
  const dHit = depth(p.w), dAfter = depth(after.target), dBefore = depth(before.target);
  ok('pivot: orbit target moved to the picked depth', Math.abs(dAfter - dHit) < Math.max(2, Math.abs(dBefore - dHit) * 0.25),
     `pivot depth ${dBefore.toFixed(0)} -> ${dAfter.toFixed(0)}, hit at ${dHit.toFixed(0)}`);
  ok('pivot: target stays on the view axis (no re-aim, no jump)',
     Math.abs(dist(after.target, after.pos) - Math.abs(dAfter)) < 1e-3);
}

// ── 2. inertia: motion continues after pointer-up, then settles
{
  await page.evaluate(() => window.__api.view('home', 0));
  await page.waitForTimeout(200);
  await page.mouse.move(800, 500); await page.mouse.down();
  for (let i = 0; i < 12; i++) { await page.mouse.move(800 + i * 22, 500); await page.waitForTimeout(12); }
  await page.mouse.up();
  const t0 = await page.evaluate(() => window.__api.spherical().theta);
  await page.waitForTimeout(150);
  const t1 = await page.evaluate(() => window.__api.spherical().theta);
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => window.__api.spherical().theta);
  await page.waitForTimeout(1300);
  const t3 = await page.evaluate(() => window.__api.spherical().theta);
  await page.waitForTimeout(300);
  const t4 = await page.evaluate(() => window.__api.spherical().theta);
  const v01 = Math.abs(t1 - t0) / 0.150, v12 = Math.abs(t2 - t1) / 0.300, v34 = Math.abs(t4 - t3) / 0.300;
  ok('inertia: keeps gliding after release', Math.abs(t1 - t0) > 1e-3, `${(t1 - t0).toFixed(4)} rad in the first 150ms`);
  ok('inertia: decays', v12 < v01 * 0.5, `${v01.toFixed(2)} -> ${v12.toFixed(2)} rad/s`);
  ok('inertia: comes to rest within ~1.5s', v34 < 0.004, `${v34.toFixed(5)} rad/s at t+1.75s`);
}

// ── 3. zoom to cursor: the point under the pointer stays under the pointer
{
  await page.evaluate(() => window.__api.view('home', 0));
  await page.waitForTimeout(250);
  const cx = 640, cy = 420;
  const w = await page.evaluate(([x, y]) => window.__api.worldAtScreen(x, y), [cx, cy]);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.waitForTimeout(300);
  const s = await page.evaluate((p) => window.__api.screenOf(p), w);
  const drift = Math.hypot(s[0] - cx, s[1] - cy);
  const r = await page.evaluate(() => window.__api.spherical().r);
  ok('zoom: dollies in', r < 700, `radius ${r.toFixed(0)} (home 720)`);
  ok('zoom: cursor anchor holds', drift < 40, `${drift.toFixed(1)} px drift after 6 wheel steps`);
}

// ── 4. no roll and no gimbal flip, even dragging far past vertical
{
  await page.evaluate(() => window.__api.view('home', 0));
  await page.waitForTimeout(200);
  await page.mouse.move(800, 500); await page.mouse.down();
  for (let i = 0; i < 60; i++) { await page.mouse.move(800 + i * 9, 500 - i * 14); await page.waitForTimeout(6); }
  await page.mouse.up(); await page.waitForTimeout(900);
  const b = await page.evaluate(() => window.__api.basis());
  const sp = await page.evaluate(() => window.__api.spherical());
  ok('no roll: camera up stays world +Z', near(b.camUp[2], 1, 1e-6));
  ok('no roll: screen-right stays horizontal', Math.abs(b.right[2]) < 2e-3, `right.z=${b.right[2].toExponential(1)}`);
  ok('no gimbal flip: polar angle clamped inside (0, pi)', sp.phi > 0 && sp.phi < Math.PI, `phi=${sp.phi.toFixed(5)}`);
  ok('no gimbal flip: theta finite', Number.isFinite(sp.theta));
}

// ── 5. home returns to a known view
{
  await page.evaluate(() => { window.__api.camera([300, -900, 400], [80, 20, 60]); });
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__api.view('home', 400));
  await page.waitForTimeout(900);
  const sp = await page.evaluate(() => window.__api.spherical());
  ok('home: radius restored', near(sp.r, 720, 2), `r=${sp.r.toFixed(1)}`);
  ok('home: angles restored', near(sp.theta, -0.62, 0.01) && near(sp.phi, 1.06, 0.01), `theta=${sp.theta.toFixed(3)} phi=${sp.phi.toFixed(3)}`);
  ok('home: target restored', dist(sp.target, [0, 0, 0]) < 0.5);
  ok('home: fov restored', near(sp.fov, 42, 0.01), `fov=${sp.fov}`);
}

// ── 6. axis views are near-orthographic
{
  await page.evaluate(() => window.__api.view('top', 0)); await page.waitForTimeout(200);
  const t = await page.evaluate(() => window.__api.spherical());
  ok('top view: near-orthographic focal length', t.fov <= 14, `fov=${t.fov}`);
  ok('top view: looking straight down', t.phi < 0.01, `phi=${t.phi}`);
}

// ── 7. double click flies to the clicked point
{
  await page.evaluate(() => window.__api.view('home', 0)); await page.waitForTimeout(250);
  const p = await page.evaluate(() => {
    for (let y = 300; y < 800; y += 10) for (let x = 500; x < 1100; x += 10) {
      const w = window.__api.worldAtScreen(x, y); if (w) return { x, y, w };
    } return null;
  });
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForTimeout(1100);
  const sp = await page.evaluate(() => window.__api.spherical());
  ok('double-click: target lands on the clicked point', dist(sp.target, p.w) < 6, `${dist(sp.target, p.w).toFixed(2)} units`);
  ok('double-click: closes in', sp.r < 720 * 0.7, `r=${sp.r.toFixed(0)}`);
}

// ── 8. isometric: same framing, parallel projection, and it round-trips
{
  await page.evaluate(() => { window.__api.proj('persp'); window.__api.view('home', 0); });
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => ({ s: window.__api.spherical(), o: window.__api.screenOf([0, 0, 0]), x: window.__api.screenOf([90, 0, 0]) }));
  await page.evaluate(() => window.__api.proj('ortho'));
  await page.waitForTimeout(250);
  const iso = await page.evaluate(() => ({ p: window.__cube.proj, s: window.__api.spherical(), o: window.__api.screenOf([0, 0, 0]), x: window.__api.screenOf([90, 0, 0]) }));
  ok('iso: camera is orthographic', iso.p === 'ortho');
  ok('iso: the orbit target does not move on screen', Math.hypot(iso.o[0] - before.o[0], iso.o[1] - before.o[1]) < 0.5,
     `${Math.hypot(iso.o[0] - before.o[0], iso.o[1] - before.o[1]).toFixed(3)} px`);
  const sBefore = Math.hypot(before.x[0] - before.o[0], before.x[1] - before.o[1]);
  const sIso = Math.hypot(iso.x[0] - iso.o[0], iso.x[1] - iso.o[1]);
  ok('iso: scale at the target is preserved (within perspective foreshortening)', Math.abs(sIso - sBefore) / sBefore < 0.12,
     `${sBefore.toFixed(1)} px -> ${sIso.toFixed(1)} px`);
  // parallel projection: a 300-unit vertical stick is the same length wherever it sits
  const len = await page.evaluate(() => {
    const near = window.__api.screenOf([-170, -80, -150]), nearT = window.__api.screenOf([-170, -80, 150]);
    const far = window.__api.screenOf([170, 80, -150]), farT = window.__api.screenOf([170, 80, 150]);
    return [Math.hypot(nearT[0] - near[0], nearT[1] - near[1]), Math.hypot(farT[0] - far[0], farT[1] - far[1])];
  });
  ok('iso: equal-length verticals project to equal lengths', Math.abs(len[0] - len[1]) / len[0] < 0.005,
     `${len[0].toFixed(1)} vs ${len[1].toFixed(1)} px`);
  // zoom-to-cursor still anchors under a parallel projection
  const cx = 620, cy = 430;
  const w = await page.evaluate(([x, y]) => window.__api.worldAtScreen(x, y), [cx, cy]);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(45); }
  await page.waitForTimeout(320);
  const sp = await page.evaluate((q) => window.__api.screenOf(q), w);
  const drift = Math.hypot(sp[0] - cx, sp[1] - cy);
  ok('iso: zoom-to-cursor anchor holds', drift < 40, `${drift.toFixed(1)} px drift after 6 wheel steps`);
  const zoomed = await page.evaluate(() => ({ s: window.__api.spherical(), o: window.__api.screenOf([0, 0, 0]), x: window.__api.screenOf([90, 0, 0]) }));
  const sZoom = Math.hypot(zoomed.x[0] - zoomed.o[0], zoomed.x[1] - zoomed.o[1]);
  // ortho has no dolly: the wheel widens or narrows the frustum. (The radius may
  // still drift, because the wheel also re-picks the depth pivot — visually a
  // no-op under a parallel projection.)
  ok('iso: wheel changes frustum size, and the world gets bigger', zoomed.s.fov < iso.s.fov * 0.95 && sZoom > sIso * 1.1,
     `equivalent fov ${iso.s.fov.toFixed(1)} -> ${zoomed.s.fov.toFixed(1)}, 90 units ${sIso.toFixed(0)} -> ${sZoom.toFixed(0)} px`);
  // axis views still work
  await page.evaluate(() => window.__api.view('top', 0));
  await page.waitForTimeout(200);
  const t = await page.evaluate(() => window.__api.spherical());
  ok('iso: axis views still land square', t.phi < 0.01 && Math.abs(t.fov - 12) < 0.5, `phi=${t.phi.toFixed(4)} fov=${t.fov.toFixed(2)}`);
  // and back to perspective without a scale jump
  await page.evaluate(() => { window.__api.proj('persp'); window.__api.view('home', 0); });
  await page.waitForTimeout(250);
  const back = await page.evaluate(() => ({ p: window.__cube.proj, s: window.__api.spherical() }));
  ok('iso: toggles back to a normal perspective lens', back.p === 'persp' && Math.abs(back.s.fov - 42) < 0.01, `fov=${back.s.fov}`);
}

// ── 9. the pivot marker is a constant number of screen pixels
{
  await page.evaluate(() => { window.__api.view('home', 0); });
  await page.waitForTimeout(200);
  const sizeAt = async () => {
    await page.mouse.move(800, 500); await page.mouse.down();
    await page.mouse.move(806, 496); await page.waitForTimeout(320);
    const r = await page.evaluate(() => ({ px: window.__cube.pivotScreenRadius, a: window.__cube.pivotAlpha }));
    await page.mouse.up();
    return r;
  };
  const far = await sizeAt();
  await page.evaluate(() => window.__api.orbit(null, null, 40));
  await page.waitForTimeout(250);
  const near = await sizeAt();
  await page.evaluate(() => window.__api.proj('ortho'));
  await page.waitForTimeout(250);
  const orth = await sizeAt();
  await page.evaluate(() => { window.__api.proj('persp'); window.__api.view('home', 0); });
  ok('pivot marker: fades in while dragging', far.a > 0.9, `alpha ${far.a.toFixed(2)}`);
  ok('pivot marker: constant screen size across an 18x depth change',
     Math.abs(far.px - near.px) < 0.3, `${far.px.toFixed(2)} px at r=720, ${near.px.toFixed(2)} px at r=40`);
  ok('pivot marker: constant screen size under orthographic', Math.abs(orth.px - far.px) < 0.3, `${orth.px.toFixed(2)} px`);
  ok('pivot marker: small — under 12 px radius', far.px < 12, `${far.px.toFixed(2)} px`);
  await page.waitForTimeout(800);
  const idle = await page.evaluate(() => window.__cube.pivotAlpha);
  ok('pivot marker: fades back out after release', idle < 0.02, `alpha ${idle.toFixed(3)}`);
}

// ── 10. the time cut is a two-ended range
{
  await page.evaluate(() => { window.__api.select('ottoman-empire', 0); window.__api.view('home', 0); });
  await page.waitForTimeout(500);
  const z = await page.evaluate(() => window.__api.cut(0.35, 0.70));
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => window.__cube.state);
  ok('cut: keeps a lower AND an upper bound', st.cutLo === 0.35 && st.cutHi === 0.70, `${z[0].toFixed(1)} .. ${z[1].toFixed(1)} world z`);
  const lbl = await page.evaluate(() => document.getElementById('cutV').textContent);
  ok('cut: labels read as years, not fractions', /\d+\s(AD|BC)\s→\s\d+\s(AD|BC)/.test(lbl), `"${lbl}"`);
  const caps = await page.evaluate(() => {
    const g = window.__api.capsInfo();
    return g;
  });
  ok('cut: a stencil cap pass exists on both planes', caps.caps === 2 && caps.stencilMeshes === 4, JSON.stringify(caps));
  ok('cut: caps sit exactly on the two clip planes', Math.abs(caps.z[0] - z[0]) < 0.2 && Math.abs(caps.z[1] - z[1]) < 0.2, JSON.stringify(caps.z));
  await page.evaluate(() => window.__api.cut(0, 1));
}

// ── 11. single-slice mode
{
  await page.evaluate(() => window.__api.slice(true, 9));
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => window.__api.sliceInfo());
  ok('slice: exactly one snapshot is visible', v.visibleYears === 1, `${v.visibleYears} sheets, year ${v.year}`);
  ok('slice: the solid is clipped to that slab', Math.abs(v.window[1] - v.window[0] - 7.2) < 0.3, `${(v.window[1] - v.window[0]).toFixed(2)} units thick`);
  await page.evaluate(() => window.__api.sliceGo(10));
  await page.waitForTimeout(90);
  const mid = await page.evaluate(() => window.__api.sliceInfo());
  ok('slice: a cross-fade shows two sheets mid-transition', mid.visibleYears === 2 && mid.t < 1, `t=${mid.t.toFixed(2)}`);
  ok('slice: the readout says so while it is between snapshots', /interpolated/.test(mid.readout), `"${mid.readout.replace(/\s+/g, ' ').slice(0, 60)}"`);
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => window.__api.sliceInfo());
  ok('slice: settles on the new snapshot, one sheet, labelled measured', end.visibleYears === 1 && /measured/.test(end.readout) && end.year === 1715,
     `year ${end.year}`);
  await page.evaluate(() => { window.__api.slicePlay(true); });
  await page.waitForTimeout(1400);
  const played = await page.evaluate(() => window.__api.sliceInfo());
  await page.evaluate(() => { window.__api.slicePlay(false); window.__api.slice(false); });
  ok('slice: playback advances on its own', played.i > end.i, `snapshot ${end.i} -> ${played.i}`);
  await page.waitForTimeout(200);
  const off = await page.evaluate(() => window.__api.sliceInfo());
  ok('slice: leaving the mode restores every sheet', off.visibleYears === 18, `${off.visibleYears} sheets`);
}

// ── 12. the filter box actually drives the view (this was the bug)
{
  await page.evaluate(() => window.__api.select('ottoman-empire', 0));
  await page.waitForTimeout(400);
  await page.click('#filter');
  await page.type('#filter', 'rome', { delay: 30 });
  const listed = await page.evaluate(() => document.querySelectorAll('#sov option').length);
  await page.waitForTimeout(900);      // past the 280 ms debounce plus the mesh
  const after = await page.evaluate(() => window.__cube.state.polity);
  ok('filter: narrows the list', listed > 0 && listed < 40, `${listed} options`);
  ok('filter: typing alone re-traces the view', after !== 'ottoman-empire', `now tracing "${after}"`);
  ok('filter: picks the obvious match for "rome"', /roman/.test(after), `"${after}"`);
  await page.evaluate(() => { document.getElementById('filter').value = ''; window.__api.type(''); });
  await page.waitForTimeout(200);
  const ids = await page.evaluate(() => window.__api.type('ottoman'));
  await page.waitForTimeout(900);
  const after2 = await page.evaluate(() => window.__cube.state.polity);
  ok('filter: a second query re-traces again', after2 === 'ottoman-empire', `"${after2}" from ${JSON.stringify(ids.slice(0, 3))}`);
}

// ── 13. lineage tracing across changing sovereign strings
{
  const one = await page.evaluate(() => { window.__api.select('roman-empire', 0); return window.__cube.traced; });
  await page.waitForTimeout(500);
  const oneSnaps = await page.evaluate(() => document.getElementById('eLabel').textContent);
  const many = await page.evaluate(() => window.__api.lineage(3));
  await page.waitForTimeout(900);
  const manySnaps = await page.evaluate(() => document.getElementById('eLabel').textContent);
  ok('lineage: off means exactly one polity', one.length === 1, `${one.length}: ${one.map(p => p.name).join(', ')}`);
  ok('lineage: "Roman Empire" alone is a single snapshot', /1 of 18/.test(oneSnaps), oneSnaps.trim().slice(0, 60));
  ok('lineage: following the graph reaches Byzantium and the Ottomans',
     many.includes('byzantine-empire') && many.includes('ottoman-empire'), `${many.length} polities`);
  ok('lineage: the chain spans most of the block', /1[0-9] of 18/.test(manySnaps), manySnaps.trim().slice(0, 80));
}

console.log(`\n  ${pass} passed, ${fail} failed. page errors: ${errs.length ? errs.slice(0,3) : 'none'}`);
await browser.close();
process.exit(fail ? 1 : 0);
