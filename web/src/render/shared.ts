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
  const a = 2026 - y; if (a >= 1e9) return (a / 1e9).toFixed(1).replace(/\.0$/, '') + ' billion yrs ago';
  if (a >= 1e6) return (a / 1e6).toFixed(0) + ' million yrs ago'; if (a >= 20000) return Math.round(a / 1000) + ',000 yrs ago'; return fmtY(y);
};
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
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
