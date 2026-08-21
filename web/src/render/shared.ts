/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared helpers + the runtime data store.
// Ported from the "data plumbing" / "shared helpers" / "world geometry" sections of
// prototypes/partB.html. The only structural change vs the original: the big datasets
// arrive over the network instead of as <script> globals, so everything that used to be
// a top-level `const` is now a module-level binding filled in by initData().

import { EVENTS, CAPSULES } from '@/data/events';
export { EVENTS, CAPSULES };
export type { TLEvent } from '@/data/events';

// ---------- data plumbing ----------
// (in the prototype these read `typeof CATMAP !== 'undefined' ? CATMAP : {}` etc.)
export let CAT_MAP: Record<string, [string, string]> = {};
export let POLITIES: any[] = [];
export let BELIEFS: any = { systems: [] };
export let POPS: any = null;
export let PLACES: Record<string, any> = {};

export let WORLDS: Record<string, any[]> = {};
export let YEARS: number[] = [];
export const GEO: Record<number, any[]> = {};

let dataReady = false;
export const isReady = () => dataReady;

export interface Datasets {
  LIVES: any[];
  CATMAP: Record<string, [string, string]>;
  POLIS: any[];
  BELIEF: any;
  POPDATA: any;
  PLACEMAP: Record<string, any>;
}

export function initData(worlds: Record<string, any[]>, ds: Datasets) {
  if (dataReady) return;
  CAT_MAP = ds.CATMAP || {};
  POLITIES = ds.POLIS || [];
  BELIEFS = ds.BELIEF || { systems: [] };
  POPS = ds.POPDATA || null;
  PLACES = ds.PLACEMAP || {};
  WORLDS = worlds;

  // ---------- world geometry (delta-decoded, decimetre-degrees -> degrees) ----------
  YEARS = Object.keys(WORLDS).map(Number).sort((a, b) => a - b);
  for (const y of YEARS) {
    GEO[y] = WORLDS[String(y)].map((f: any) => {
      const rings = f[2].map((d: number[]) => {
        const out = new Float64Array(d.length);
        let x = d[0], yv = d[1]; out[0] = x / 10; out[1] = yv / 10;
        for (let i = 2; i < d.length; i += 2) { x += d[i]; yv += d[i + 1]; out[i] = x / 10; out[i + 1] = yv / 10; }
        return out;
      });
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, lc: number[] | null = null, lcArea = -1;
      for (const r of rings) {
        let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
        for (let i = 0; i < r.length; i += 2) {
          const x = r[i], y2 = r[i + 1];
          if (x < a0) a0 = x; if (x > a1) a1 = x; if (y2 < b0) b0 = y2; if (y2 > b1) b1 = y2;
        }
        if (a0 < x0) x0 = a0; if (a1 > x1) x1 = a1; if (b0 < y0) y0 = b0; if (b1 > y1) y1 = b1;
        const ra = (a1 - a0) * (b1 - b0);
        if (ra > lcArea) { lcArea = ra; lc = [(a0 + a1) / 2, (b0 + b1) / 2]; }
      }
      return { name: f[0], sov: f[1] === 0 ? f[0] : f[1], rings, bb: [x0, y0, x1, y1], lc, lw: lcArea ? Math.sqrt(lcArea) : 0, area: (x1 - x0) * (y1 - y0) };
    });
  }

  // lifespans live in their own dataset so partA's EVENTS array stays hand-editable
  for (const L of ds.LIVES || []) EVENTS.push(L.slice());
  for (const ev of EVENTS) {
    const m = CAT_MAP[ev[2]];
    ev[6] = m ? m[0] : guessCat(ev);
    ev[7] = m ? m[1] : (ev[1] ? 'episode' : 'moment');
    const p = PLACES[ev[2]];
    ev[8] = p || null;                     // [lat, lon, place, scope]
  }
  dataReady = true;
}

// ---------- shared helpers ----------
export const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;

export interface Tokens {
  bg: string; panel: string; panel2: string; line: string; ink: string; ink2: string; ink3: string;
  accent: string; accent2: string; sea: string; stroke: string; s: string[];
}
export const tokens = (): Tokens => {
  const cs = getComputedStyle(document.documentElement); const g = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: g('--bg'), panel: g('--panel'), panel2: g('--panel2'), line: g('--line'), ink: g('--ink'), ink2: g('--ink2'), ink3: g('--ink3'),
    accent: g('--accent'), accent2: g('--accent2'), sea: g('--sea'), stroke: g('--stroke'),
    s: [g('--s1'), g('--s2'), g('--s3'), g('--s4'), g('--s5'), g('--s6'), g('--s7'), g('--s8')],
  };
};
// ---------- canvas typography ----------
// A canvas has no cascade: ctx.font takes a fully-resolved CSS font shorthand, so the
// family list has to be read out of the document and pasted in by hand. That is why every
// renderer went to the system stack when the chrome moved to Instrument Sans / IBM Plex
// Mono — nothing was wrong, nothing was ever told.
//
// The doctrine, from DESIGN.md: A MEASUREMENT IS MONO, LANGUAGE IS SANS. Years, counts,
// distances, legend scales → fontMono(). Names, captions, band titles → fontUI().
//
// Read through the tokens, never by literal family name: app.css points --tl-font-ui /
// --tl-font-mono at whatever next/font minted for the three faces, and that name is not
// guaranteed to be the human one.
const FALLBACK_FONT = {
  ui: '"Instrument Sans", "Helvetica Neue", -apple-system, system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};
let _stacks: { ui: string; mono: string } | null = null;

// A bad family string does not throw — the assignment is silently dropped and the canvas
// keeps painting in 10px sans-serif. So the stack is parsed once, against a sentinel, and
// demoted to the literal fallback if the browser refuses it.
function usable(stack: string, fallback: string) {
  if (!stack) return fallback;
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return stack;
    c.font = '17px monospace';                       // sentinel — survives a failed parse
    c.font = `400 12px ${stack}`;
    return c.font.startsWith('17px') ? fallback : stack;
  } catch { return fallback; }
}
export function fontStacks() {
  if (_stacks) return _stacks;
  if (typeof document === 'undefined') return FALLBACK_FONT;
  const cs = getComputedStyle(document.documentElement);
  return (_stacks = {
    ui: usable(cs.getPropertyValue('--tl-font-ui').trim(), FALLBACK_FONT.ui),
    mono: usable(cs.getPropertyValue('--tl-font-mono').trim(), FALLBACK_FONT.mono),
  });
}
/** language — names, captions, band titles */
export const fontUI = (px: number, weight: number | string = 400) => `${weight} ${px}px ${fontStacks().ui}`;
/** measurement — years, counts, distances, scales */
export const fontMono = (px: number, weight: number | string = 400) => `${weight} ${px}px ${fontStacks().mono}`;

// Canvas text does NOT trigger a webfont download and does NOT reflow when one lands, so a
// view painted during the swap keeps the fallback metrics until something else forces a
// repaint. Every renderer registers its render() here; the faces are requested explicitly
// and everyone repaints once, together, when they arrive.
const _fontCbs: Array<() => void> = [];
let _fontsPrimed = false;
const firstFamily = (stack: string) => (stack.split(',')[0] || '').trim();
export function primeFonts(): Promise<unknown> {
  const F = (document as any).fonts;
  if (!F || !F.load) return Promise.resolve();
  const st = fontStacks(); const jobs: Promise<unknown>[] = [];
  for (const stack of [st.ui, st.mono]) {
    const fam = firstFamily(stack); if (!fam) continue;
    for (const w of [400, 600]) jobs.push(F.load(`${w} 12px ${fam}`).catch(() => { }));
  }
  return Promise.all(jobs);
}
export function repaintOnFonts(fn: () => void) {
  if (typeof document === 'undefined') return;
  _fontCbs.push(fn);
  if (_fontsPrimed) return;
  _fontsPrimed = true;
  primeFonts().then(() => (document as any).fonts?.ready)
    .then(() => { for (const f of _fontCbs) { try { f(); } catch { /* a view that is not mounted yet */ } } })
    .catch(() => { });
}

// astronomical year 0 is 1 BCE — never print "0 BCE"
export const fmtY = (y: number) => { y = Math.round(y); return y < 0 ? (Math.abs(y) + ' BCE') : (y === 0 ? '1 BCE' : '' + y); };
export const fmtBig = (y: number) => {
  const a = YREF - y; if (a >= 1e9) return (a / 1e9).toFixed(1).replace(/\.0$/, '') + ' billion yrs ago';
  if (a >= 1e6) return (a / 1e6).toFixed(0) + ' million yrs ago'; if (a >= 20000) return Math.round(a / 1000) + ',000 yrs ago'; return fmtY(y);
};
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------- the piecewise time scale ----------
// ONE C1 scale from a decade to the Big Bang. Linear in years for everything a person
// would call history (the last 10,000 years), morphing continuously into log-of-years-
// ago beyond the seam — ChronoZoom's two failure modes (pure linear starves deep time,
// pure log warps the familiar centuries) are both avoided by never being purely either.
// TL keeps d0/d1 in YEARS; this transform is how years become screen space.
export const YREF = 2026;                 // "now" for years-ago arithmetic (fmtBig too)
export const A0 = 10000;                  // seam: linear for the last 10,000 years
export const YMIN = -13.9e9;              // a hair before the Big Bang
export const YMAX = 2100;
const u = (a: number) => (a <= A0 ? a : A0 * (1 + Math.log(a / A0)));
const uinv = (uu: number) => (uu <= A0 ? uu : A0 * Math.exp(uu / A0 - 1));
/** year -> transformed coordinate (monotone increasing in y; C1 at the seam). */
export const tv = (y: number) => -u(YREF - y);
/** transformed coordinate -> year. The inverse of tv. */
export const ty = (v: number) => YREF - uinv(-v);
export const VFULL = tv(YMAX) - tv(YMIN);
// verify the computed anchors the whole scale hangs off (never hardcode them):
// tv(YMIN) ≈ −151448.14 · tv(YMAX) = +74 · VFULL ≈ 151522.14
if (Math.abs(tv(YMIN) + 151448.14) > 0.5 || tv(YMAX) !== 74) {
  // eslint-disable-next-line no-console
  console.warn('piecewise time scale anchors are off:', tv(YMIN), tv(YMAX), VFULL);
}

/** "10 kya" … "10 Gya" — the deep-time tick labels (a = years ago). */
export const fmtAgo = (a: number) => {
  const f = (x: number) => String(parseFloat(x.toPrecision(3)));
  if (a >= 1e9) return f(a / 1e9) + ' Gya';
  if (a >= 1e6) return f(a / 1e6) + ' Mya';
  return f(a / 1e3) + ' kya';
};
/** span readout: "5,026 yrs" · "3.2 Myr" · "13.9 Gyr" */
export const fmtSpan = (yrs: number) => {
  if (yrs < 1e6) return Math.round(yrs).toLocaleString('en-US') + ' yrs';
  if (yrs < 1e9) return (yrs / 1e6).toFixed(1) + ' Myr';
  return (yrs / 1e9).toFixed(1) + ' Gyr';
};

// Axis ticks for BOTH timeline projections. Bounded by construction (≤ ~26 ticks): the
// linear part obeys the existing ≤14 rule scaled by its pixel share, and the log part
// is at most seven decades with optional 2· / 5· subdivisions. NO unbounded
// year-stepping loop may ever come back — the old vertical axis iterated ~7 million
// times at the full span, which is the hang this function exists to kill.
export function timeTicks(d0: number, d1: number, Wpx: number): { y: number; label: string }[] {
  const out: { y: number; label: string }[] = [];
  const SEAM = YREF - A0;                              // year −7974
  const v0 = tv(d0), v1 = tv(d1), spanV = (v1 - v0) || 1;
  if (d0 < SEAM) {                                     // LOG PART: decades of years-ago
    const decadePx = Wpx * (A0 * Math.LN10) / spanV;   // px between 10^n and 10^(n+1)
    const hi = Math.min(d1, SEAM);
    const mults = decadePx >= 110 ? [1, 2, 5] : [1];
    for (let n = 4; n <= 10; n++) {
      for (const m of mults) {
        const a = m * Math.pow(10, n), y = YREF - a;
        if (y < d0 || y > hi) continue;
        out.push({ y, label: fmtAgo(a) });
      }
    }
  }
  if (d1 > SEAM) {                                     // LINEAR PART: the existing rule
    const lin0 = Math.max(d0, SEAM);
    const wl = (tv(d1) - tv(lin0)) / spanV * Wpx;      // this part's share of the axis
    const nl = Math.max(2, Math.floor(14 * wl / Wpx));
    const linSpan = d1 - lin0;
    const steps = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
    const step = steps.filter(s => linSpan / s <= nl).pop() ?? steps[0];
    for (let y = Math.ceil(lin0 / step) * step; y <= d1; y += step) out.push({ y, label: fmtY(y) });
  }
  // collision cull, extent-aware: labels are 11px IBM Plex Mono (monospaced), so a
  // label's width is len × ~6.6px and two ticks collide when their half-widths meet.
  // A flat position gap is not enough — at the full 13.9 Gyr span decade ticks sit
  // 39.5px apart while "200 Mya" + "100 Mya" need ~50px between centres.
  const CH = 6.6, PAD = 8;
  out.sort((a, b) => a.y - b.y);
  const kept: { y: number; label: string }[] = [];
  let lastPx = -1e9, lastW = 0;
  for (const t of out) {
    const px = (tv(t.y) - v0) / spanV * Wpx;
    const w = t.label.length * CH;
    if (px - lastPx < (lastW + w) / 2 + PAD) continue;
    lastPx = px; lastW = w; kept.push(t);
  }
  return kept;
}

// ---------- colour utilities shared by the timeline family ----------
// Canvas gradients interpolate in straight RGBA, so fading a hex to `transparent` runs
// it through grey — always fade to the colour's own zero-alpha form instead.
export function withA(c: string, a: number) {
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
  m = /^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/.exec(c);
  if (m) return `hsl(${m[1]} ${m[2]}% ${m[3]}% / ${a})`;
  return c;
}
export function hexHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn, sat = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, sat * 100, l * 100];
}
const strHash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
// returns [css colour, its lightness 0-100] — hue barely moves so a lane still reads
// as ONE domain, lightness moves a lot so neighbours separate. Memoized: the timeline
// calls this for every rectangle every frame.
const _varyCache = new Map<string, [string, number]>();
export function varyColor(hex: string, id: string): [string, number] {
  const key = hex + '|' + id;
  const hit = _varyCache.get(key); if (hit) return hit;
  const c = hexHsl(hex);
  let out: [string, number];
  if (!c) out = [hex, 50];
  else {
    const s0 = strHash(id);
    const h = (c[0] + ((s0 % 15) - 7) + 360) % 360;
    const sa = clamp(c[1] - 7 + ((s0 >> 3) % 14), 28, 68);
    const li = clamp(c[2] - 15 + ((s0 >> 7) % 33), 25, 70);
    out = [`hsl(${h.toFixed(0)} ${sa.toFixed(0)}% ${li.toFixed(0)}%)`, li];
  }
  if (_varyCache.size > 4000) _varyCache.clear();
  _varyCache.set(key, out);
  return out;
}

// ---------- the two global stores ----------
// Framework-free, mirroring the PROJECTIONS callback pattern. THE ANTI-LOOP CONTRACT:
// stores are WRITTEN only from user-input handlers (pointerup, input, click) — never
// from render(), never from inside a subscriber. Subscribers only repaint/refresh. The
// source tag lets a writer's own subscriber no-op (the map ignores source==='map').
export type TimeSource = 'map' | 'tl' | 'vt' | 'ui' | 'boot';
export const TimeStore = {
  year: 1783,
  source: 'boot' as TimeSource,
  _subs: new Set<() => void>(),
  set(year: number, source: TimeSource) {
    year = Math.round(year);
    if (year === this.year) return;
    this.year = year; this.source = source;
    for (const f of [...this._subs]) f();
  },
  subscribe(f: () => void) { this._subs.add(f); return () => { this._subs.delete(f); }; },
};
// Selection vocabulary: 'event:<title>' | 'entity:<title>' | 'polity:<id>' |
// 'spread:<id>' | 'belief:<id>' | 'lane:<KEY>:<id>' (curated lane members).
export const SelStore = {
  id: null as string | null,
  _subs: new Set<() => void>(),
  set(id: string | null) {
    if (id === this.id) return;
    this.id = id;
    for (const f of [...this._subs]) f();
  },
  subscribe(f: () => void) { this._subs.add(f); return () => { this._subs.delete(f); }; },
};
/** The node id of an EVENTS tuple. Slot 10 (curated lane members) overrides. */
export const evId = (ev: any[]): string => (ev[10] ?? ((ev[7] === 'life' ? 'entity:' : 'event:') + ev[2]));

// ---------- curated lanes ----------
// The lane registry: bands and lenses unified. Region lanes and deep time are always
// on; curated lanes toggle via chips and arrive as data (public/data/lanes.json).
export interface LaneMember {
  id: string; name: string; start: number; end: number; type: string; cat: string;
  lvl: number; sharpness: number; note?: string; tags?: string;
  lat?: number; lon?: number; place?: string;
}
export interface LaneDef {
  key: string; label: string; si: number | null;
  kind: 'deep' | 'curated' | 'region';
  default?: boolean; members?: LaneMember[];
}
const BUILTIN_LANES: LaneDef[] = [
  { key: 'MU', label: 'Music', si: 4, kind: 'curated', default: false, members: [] },
  { key: 'SC', label: 'Science & ideas', si: 5, kind: 'curated', default: false, members: [] },
  { key: 'MZ', label: 'Mozart', si: 6, kind: 'curated', default: false, members: [] },
];
export let LANES: LaneDef[] = BUILTIN_LANES.slice();
let lanesApplied = false;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
/**
 * Install the curated lane registry and append every member to EVENTS as a fully
 * populated tuple — slots 6/7 pre-filled (so initData's classifier never touches
 * them), slot 9 = sharpness, slot 10 = the 'lane:KEY:id' node id. Because members
 * live in EVENTS with band = lane key, both timeline projections see them with zero
 * further plumbing. Call AFTER initData().
 */
export function setLanes(json: any) {
  if (lanesApplied) return;
  lanesApplied = true;
  const raw: any[] = (json && json.lanes) || [];
  if (!raw.length) { LANES = BUILTIN_LANES.slice(); return; }
  const KEYFALL: Record<string, [string, string, number | null, boolean]> = {
    arts: ['AR', 'Arts', 4, true], design: ['DS', 'Design', 3, false],
  };
  const seen = new Set<string>();
  const lanes: LaneDef[] = [];
  for (const L of raw) {
    const fall = KEYFALL[L.id] || null;
    const key = String(L.key || (fall ? fall[0] : (L.id || '??').slice(0, 2).toUpperCase())).toUpperCase();
    if (seen.has(key) || ['CO', 'EU', 'ME', 'AS', 'AM'].includes(key)) continue;
    seen.add(key);
    const members: LaneMember[] = ((L.members || []) as any[]).map((m: any) => ({
      id: m.id || slug(m.name),
      name: m.name,
      start: m.start, end: m.end,
      type: m.type === 'spread' ? 'movement' : (m.type || 'movement'),
      cat: m.cat || 'art',
      lvl: clamp(Math.round(m.lvl ?? m.imp ?? 3), 1, 5),
      sharpness: clamp(Number(m.sharpness ?? 0.5), 0, 1),
      note: m.note || '', tags: m.tags || '',
      lat: m.lat, lon: m.lon, place: m.place,
    }));
    lanes.push({
      key, label: L.label || (fall ? fall[1] : key), si: (L.si ?? (fall ? fall[2] : null)),
      kind: 'curated', default: !!(L.default ?? (fall ? fall[3] : false)), members,
    });
  }
  for (const b of BUILTIN_LANES) if (!lanes.some(l => l.key === b.key)) lanes.unshift({ ...b });
  LANES = lanes;
  for (const lane of LANES) {
    for (const m of lane.members || []) {
      EVENTS.push([
        m.start, m.end, m.name, lane.key, m.lvl, m.tags || '', m.cat, m.type,
        (m.lat != null && m.lon != null) ? [m.lat, m.lon, m.place || '', ''] : null,
        m.sharpness, 'lane:' + lane.key + ':' + m.id,
      ]);
    }
  }
}
/** Default sharpness by semantic type; ev9 (slot 9) wins when it is a number. */
export function sharpnessOf(type: string | undefined, ev9: any): number {
  if (typeof ev9 === 'number') return clamp(ev9, 0, 1);
  switch (type) {
    case 'era': return 0.25;
    case 'zone': return 0.85;
    case 'episode': return 0.9;
    case 'life': return 1.0;
    default: return 0.5;
  }
}
// was a module-level const in the prototype; a function here so nothing touches
// `matchMedia` while the client component is being server-rendered.
export const reduceMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const getTip = () => $<HTMLElement>('#tip');
export function showTip(x: number, y: number, html: string) {
  const tip = getTip(); if (!tip) return;
  tip.innerHTML = html; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = clamp(x + 14, 8, innerWidth - r.width - 8) + 'px';
  tip.style.top = clamp(y + 14, 8, innerHeight - r.height - 8) + 'px';
}
export function hideTip() { const tip = getTip(); if (tip) tip.style.display = 'none'; }

export function fitCanvas(cv: HTMLCanvasElement, h: number) {
  const cw = cv.clientWidth || cv.parentElement!.clientWidth; if (!cw) return null;
  const dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(cw * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
  }
  const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cw, ch: h, ctx };
}
// year pill drawn at the cursor — "what year am I hovering on"
export function yearPill(ctx: CanvasRenderingContext2D, T: Tokens, x: number, y: number, text: string, accent?: string) {
  ctx.font = fontMono(12, 600);                    // a year is a measurement
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = accent || T.accent; ctx.beginPath(); ctx.roundRect(x - w / 2, y, w, 20, 10); ctx.fill();
  ctx.fillStyle = T.bg; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 14); ctx.textAlign = 'left';
}

// ---------- the visual grammar ----------
// si indexes the validated categorical palette. 'reach' was added after a review found
// exploration/migration/colonisation scattered across nature/power/society by four
// independent classifiers — for an atlas, movement across the map is the native verb.
export const CATS = [
  { id: 'power', name: 'Power & states', si: 0 },
  { id: 'war', name: 'War & conflict', si: 7 },
  { id: 'belief', name: 'Ideas & belief', si: 6 },
  { id: 'sci', name: 'Science & tech', si: 2 },
  { id: 'art', name: 'Art & culture', si: 4 },
  { id: 'nature', name: 'Nature & catastrophe', si: 5 },
  { id: 'society', name: 'Society & economy', si: 3 },
  { id: 'reach', name: 'Exploration & movement', si: 1 }];
export const CATBY: Record<string, { id: string; name: string; si: number }> = {}; CATS.forEach(c => { CATBY[c.id] = c; });
export const catColor = (id: string, T: Tokens) => { const c = CATBY[id]; return c ? T.s[c.si] : T.ink2; };
export const TYPES = [
  { id: 'moment', name: 'moment' }, { id: 'episode', name: 'episode' }, { id: 'life', name: 'a life' },
  { id: 'zone', name: 'territory' }, { id: 'era', name: 'era' }];
// fallback classifier so the lab works even before the curated map is merged in
export function guessCat(ev: any[]) {
  const t = (ev[5] + ' ' + ev[2]).toLowerCase();
  if (/war|battle|conquest|siege|invade|invasion|armada|crusade|revolt/.test(t)) return 'war';
  if (/religio|christian|islam|buddh|philosoph|reformation|schism|communism|enlighten/.test(t)) return 'belief';
  if (/science|physics|math|astronom|medicine|technolog|invention|computing|printing|space|internet|dna|electricity/.test(t)) return 'sci';
  if (/music|opera|art|literature|jazz|rock|symphon|mozart|beethoven/.test(t)) return 'art';
  if (/cosmos|life|extinction|plague|pandemic|volcano|earth|human|climate/.test(t)) return 'nature';
  if (/exploration|migration|colony|colonialism|voyage|route/.test(t)) return 'reach';
  if (/trade|economy|slavery|university|law|gold|money|independence/.test(t)) return 'society';
  return 'power';
}

// ---------- point-in-polygon / feature lookup ----------
export function pip(lon: number, lat: number, f: any) {
  if (lon < f.bb[0] || lon > f.bb[2] || lat < f.bb[1] || lat > f.bb[3]) return false;
  let inside = false;
  for (const r of f.rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
  }
  return inside;
}
export function featureAt(year: number, lon: number, lat: number) {
  let best: any = null;
  for (const f of GEO[year]) if (pip(lon, lat, f)) if (!best || f.area < best.area) best = f;
  return best;
}

export const FAMOUS: [RegExp, string][] = [
  [/brit|england|united kingdom/i, '#D585A0'], [/france|french/i, '#5E8FCC'], [/spain|castil|aragon/i, '#D9A441'],
  [/portug/i, '#6FA96B'], [/ottoman|turkey/i, '#C25B4E'], [/russia|soviet|ussr|muscovy/i, '#4F9E8C'],
  [/qing|ming|song|china|chinese|yuan|han |^han$|tang/i, '#D9C25A'], [/mongol/i, '#D98B4A'],
  [/roman|rome/i, '#B05A78'], [/byzant/i, '#8E6FB8'], [/habsburg|austria/i, '#C9B45C'],
  [/united states|usa/i, '#5FA3A8'], [/caliphate|umayyad|abbasid|arab/i, '#4E8F5E'],
  [/persia|achaemenid|safavid|iran/i, '#67A0B8'], [/egypt/i, '#C9A45C'], [/netherlands|dutch/i, '#D98B60'],
  [/denmark|norway|sweden/i, '#7C9BC4'], [/prussia|germany|german/i, '#8FA0A8'], [/japan/i, '#D57F7F'],
  [/mughal|maurya|gupta|india/i, '#B88FC4']];
const sovCache: Record<string, string> = {};
export function sovColor(s: string) {
  if (sovCache[s]) return sovCache[s];
  let c: string | null = null;
  for (const [re, col] of FAMOUS) if (re.test(s)) { c = col; break; }
  if (!c) {
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    c = `hsl(${h % 360} ${34 + h % 18}% ${52 + ((h >> 4) % 14)}%)`;
  }
  return sovCache[s] = c;
}

// ---------- tab bridge ----------
// The prototype's gotoTab() clicked a <button>; here the tab lives in React state, so the
// client component hands us a setter and the renderers call it exactly as before.
let _gotoTab: (name: string) => void = () => { };
export function setGotoTab(fn: (name: string) => void) { _gotoTab = fn; }
export function gotoTab(name: string) { _gotoTab(name); }
