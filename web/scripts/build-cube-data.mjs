/**
 * build-cube-data.mjs — turn prototypes/worlds.js into a compact, pre-simplified,
 * hole-classified, orientation-normalised polygon set for the 3-D cube.
 *
 * Emits public/data/world-block.json, fetched at runtime by src/render/cube3d.
 * Ported unchanged from experiments/cube3d/scripts/build-data.mjs except for
 * the two paths above — it is deliberately a SEPARATE script from
 * build-data.mjs (which emits worlds.json for the 2-D views) because the two
 * encodings answer different questions: worlds.json keeps every vertex for
 * point-in-polygon hit testing, world-block.json is simplified for extrusion
 * and carries the ring nesting and winding that earcut needs.
 *
 * Run:  npm run data   (or: node scripts/build-cube-data.mjs)
 *
 * Everything expensive that can happen once, happens here (in node) rather than
 * in the browser: delta decoding, Douglas-Peucker simplification, ring nesting
 * (which ring is a hole of which), winding normalisation, area/centroid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.resolve(ROOT, '../prototypes/worlds.js');
const OUT = path.resolve(ROOT, 'public/data/world-block.json');

// ---- tunables -------------------------------------------------------------
const DP_TOL      = Number(process.env.DP_TOL      ?? 0.32); // degrees
const MIN_RING_D  = Number(process.env.MIN_RING_D  ?? 1.1);  // bbox diagonal, degrees
const MIN_FEAT_A  = Number(process.env.MIN_FEAT_A  ?? 3.0);  // bbox area, sq degrees
const PREC        = 100; // 2 decimal places -> ~1.1 km at the equator

// ---------------------------------------------------------------------------
const raw = fs.readFileSync(SRC, 'utf8');
const WORLDS = eval(raw + ';WORLDS');
const YEARS = Object.keys(WORLDS).map(Number).sort((a, b) => a - b);

/** delta-decode one flat int array into [x,y,x,y,...] degrees */
function decode(d) {
  const out = new Float64Array(d.length);
  let x = d[0], y = d[1];
  out[0] = x / 10; out[1] = y / 10;
  for (let i = 2; i < d.length; i += 2) {
    x += d[i]; y += d[i + 1];
    out[i] = x / 10; out[i + 1] = y / 10;
  }
  return out;
}

/** signed area x2 (positive => counter-clockwise in a Y-up frame) */
function area2(r) {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    s += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return s;
}

function bbox(r) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1];
  }
  return [x0, y0, x1, y1];
}

/** even-odd point-in-ring */
function pointInRing(px, py, r) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker on a closed ring, iterative. `r` is flat [x,y,...]. */
function simplifyRing(r, tol) {
  const n = r.length / 2;
  if (n < 5) return r;
  const keep = new Uint8Array(n);
  // Anchor at two far-apart points so the closed ring is split into two chains.
  keep[0] = 1;
  const mid = n >> 1;
  keep[mid] = 1;
  const tol2 = tol * tol;
  const stack = [[0, mid], [mid, n - 1]];
  // treat index n as index 0 (closed)
  const gx = (i) => r[2 * (i % n)], gy = (i) => r[2 * (i % n) + 1];
  stack.push([n - 1, n]); // last chain closes back to start
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = gx(a), ay = gy(a), bx = gx(b), by = gy(b);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1, bestD = -1;
    for (let i = a + 1; i < b; i++) {
      const px = gx(i), py = gy(i);
      let d2;
      if (len2 === 0) { d2 = (px - ax) ** 2 + (py - ay) ** 2; }
      else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d2 > bestD) { bestD = d2; best = i; }
    }
    if (bestD > tol2 && best > 0) {
      keep[best % n] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) { out.push(r[2 * i], r[2 * i + 1]); }
  return out.length >= 6 ? out : r;
}

/** remove consecutive duplicate points and a repeated closing point */
function dedupe(r) {
  const out = [];
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i], y = r[i + 1];
    const m = out.length;
    if (m >= 2 && Math.abs(out[m - 2] - x) < 1e-9 && Math.abs(out[m - 1] - y) < 1e-9) continue;
    out.push(x, y);
  }
  while (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-9 && Math.abs(out[1] - out[out.length - 1]) < 1e-9) {
    out.length -= 2;
  }
  return out;
}

function q(v) { return Math.round(v * PREC) / PREC; }

// ---------------------------------------------------------------------------
let statRingsIn = 0, statRingsOut = 0, statPtsIn = 0, statPtsOut = 0;
let statFeatIn = 0, statFeatOut = 0, statHoles = 0, statWrap = 0;
let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;

const byYear = {};
const sovStats = {}; // sovereign -> { years:[], area }

for (const year of YEARS) {
  const feats = [];
  for (const f of WORLDS[year]) {
    statFeatIn++;
    const name = f[0];
    const sov = f[1] === 0 ? f[0] : f[1];
    // 1. decode + simplify + drop tiny rings
    const rings = [];
    for (const d of f[2]) {
      statRingsIn++; statPtsIn += d.length / 2;
      let r = Array.from(decode(d));
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < lonMin) lonMin = r[i]; if (r[i] > lonMax) lonMax = r[i];
        if (r[i + 1] < latMin) latMin = r[i + 1]; if (r[i + 1] > latMax) latMax = r[i + 1];
      }
      // antimeridian sanity: an edge longer than 180 deg of longitude is a wrap
      for (let i = 0; i + 3 < r.length; i += 2) if (Math.abs(r[i + 2] - r[i]) > 180) { statWrap++; break; }
      const bb = bbox(r);
      const diag = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]);
      if (diag < MIN_RING_D) continue;
      r = dedupe(simplifyRing(r, DP_TOL));
      if (r.length < 6) continue;
      rings.push(r);
    }
    if (!rings.length) continue;

    // 2. nesting -> depth; even = outer, odd = hole
    const meta = rings.map(r => ({ r, bb: bbox(r), a: Math.abs(area2(r)) / 2, depth: 0, parent: -1 }));
    for (let i = 0; i < meta.length; i++) {
      const px = meta[i].r[0], py = meta[i].r[1];
      let bestParent = -1, bestArea = Infinity;
      for (let j = 0; j < meta.length; j++) {
        if (i === j) continue;
        const B = meta[j].bb;
        if (px < B[0] || px > B[2] || py < B[1] || py > B[3]) continue;
        if (meta[j].a <= meta[i].a) continue;
        if (!pointInRing(px, py, meta[j].r)) continue;
        meta[i].depth++;
        if (meta[j].a < bestArea) { bestArea = meta[j].a; bestParent = j; }
      }
      meta[i].parent = bestParent;
    }

    // 3. group outer rings (even depth) with their immediate hole children
    const polys = [];
    const idxOfOuter = new Map();
    meta.forEach((m, i) => { if (m.depth % 2 === 0) { idxOfOuter.set(i, polys.length); polys.push({ outer: m, holes: [] }); } });
    meta.forEach((m, i) => {
      if (m.depth % 2 === 1 && m.parent >= 0 && idxOfOuter.has(m.parent)) {
        polys[idxOfOuter.get(m.parent)].holes.push(m); statHoles++;
      }
    });
    if (!polys.length) continue;

    // 4. normalise winding: outer CCW (area2 > 0), holes CW
    const outPolys = [];
    let featArea = 0, cx = 0, cy = 0, cw = 0;
    for (const p of polys) {
      const o = area2(p.outer.r) > 0 ? p.outer.r : reverse(p.outer.r);
      const hs = p.holes.map(h => (area2(h.r) < 0 ? h.r : reverse(h.r)));
      featArea += p.outer.a;
      // area-weighted centroid of the outer ring bbox
      const B = p.outer.bb, w = p.outer.a;
      cx += (B[0] + B[2]) / 2 * w; cy += (B[1] + B[3]) / 2 * w; cw += w;
      outPolys.push({ o: o.map(q), h: hs.map(h => h.map(q)) });
      statRingsOut += 1 + hs.length;
      statPtsOut += (o.length + hs.reduce((s, h) => s + h.length, 0)) / 2;
    }
    const bb = bbox(outPolys.flatMap(p => p.o));
    const bbArea = (bb[2] - bb[0]) * (bb[3] - bb[1]);
    if (bbArea < MIN_FEAT_A) { statPtsOut -= outPolys.reduce((s, p) => s + p.o.length / 2 + p.h.reduce((t, h) => t + h.length / 2, 0), 0); statRingsOut -= outPolys.reduce((s,p)=>s+1+p.h.length,0); continue; }

    statFeatOut++;
    feats.push({
      n: name, s: sov,
      a: Math.round(featArea * 10) / 10,
      c: [q(cw ? cx / cw : 0), q(cw ? cy / cw : 0)],
      bb: bb.map(q),
      p: outPolys
    });
    const S = (sovStats[sov] ||= { years: [], area: 0 });
    if (S.years[S.years.length - 1] !== year) S.years.push(year);
    S.area += featArea;
  }
  byYear[year] = feats;
}

function reverse(r) {
  const out = new Array(r.length);
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { out[2 * i] = r[r.length - 2 - 2 * i]; out[2 * i + 1] = r[r.length - 1 - 2 * i]; }
  return out;
}

// sovereign index, biggest / longest-lived first
const sovereigns = Object.entries(sovStats)
  .filter(([k]) => k && k !== '?')
  .map(([name, v]) => ({ name, years: v.years, span: v.years.length, area: Math.round(v.area) }))
  .sort((a, b) => (b.span - a.span) || (b.area - a.area));

const payload = { years: YEARS, byYear, sovereigns, bounds: { lonMin, lonMax, latMin, latMax } };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`── build-data ─────────────────────────────────`);
console.log(`  tolerance  DP=${DP_TOL}deg  minRingDiag=${MIN_RING_D}deg  minFeatArea=${MIN_FEAT_A}sqdeg`);
console.log(`  features   ${statFeatIn} -> ${statFeatOut}`);
console.log(`  rings      ${statRingsIn} -> ${statRingsOut}   (holes detected: ${statHoles})`);
console.log(`  points     ${statPtsIn} -> ${statPtsOut}  (${(100 * statPtsOut / statPtsIn).toFixed(1)}%)`);
console.log(`  lon range  ${lonMin.toFixed(1)} .. ${lonMax.toFixed(1)}   lat ${latMin.toFixed(1)} .. ${latMax.toFixed(1)}`);
console.log(`  wrap-suspect rings: ${statWrap}`);
console.log(`  sovereigns ${sovereigns.length}   longest: ${sovereigns.slice(0, 6).map(s => s.name + '(' + s.span + ')').join(', ')}`);
console.log(`  wrote      ${OUT}  ${kb} KB`);
// prism triangle estimate: per ring, 2*(n-2) caps + 2n walls
console.log(`  ghost prism triangles (est): ${(statPtsOut * 4 - statRingsOut * 4).toLocaleString()}`);
