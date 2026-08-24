/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ② ZOOMABLE TIMELINE =================
// The flagship projection. Two visual categories only, taken from the Connections
// vocabulary: SPREADS (anything with duration — era, polity, episode, life, movement)
// drawn as constant-height rectangles whose edges carry a per-item sharpness envelope,
// and EVENTS (moments) drawn as dots in their own stratum BELOW the spreads. Spreads
// pack into interval lanes biggest-first with no visual overlap — the founder's two
// old spreadsheets, live. One piecewise C1 scale (shared.ts tv/ty) runs the wheel from
// a decade to the Big Bang with no mode switch; the old log toggle is dead.
import {
  $, EVENTS, POLITIES, CATS, CATBY, catColor, clamp, fitCanvas, fmtBig, fmtSpan, fmtY, fontMono, fontUI,
  hideTip, reduceMotion, repaintOnFonts, showTip, tokens, yearPill,
  tv, ty, VFULL, timeTicks, withA, hexHsl, varyColor, mix, clampV, clampDomain,
  TimeStore, SelStore, evId, LANES, sharpnessOf,
  textW, ellipsize,
} from './shared';
import {
  REL, SPREADCAT, peakOf, lvlOfWeight, regionOf, relOf, dimAlpha, lit, renderRelatedPanel,
} from './relations';
import { FOLD, roleWord } from './fold';
import { SelCard } from './selcard';

// ── projections of this state ───────────────────────────────────────────────
// The Timeline group is ONE instrument shown two ways. vertical.ts reads d0/d1, log,
// lens, off and q off THIS object rather than copying them, and the shared controls
// (#lensRow, #catRow) are bound here exactly once. So anything that WRITES that state
// has to repaint whichever projection is currently on screen — that is what paint() is
// for, and every state-changing handler below calls it instead of render().
const PROJECTIONS: Array<() => void> = [];
const REVEALS: Array<(bandKey: string) => void> = [];

// A spread in the lane corpus. `row` is its PERMANENT lane index within its band,
// assigned once per corpus from the canonical importance-first order, so zoom can
// never reshuffle: lane 0 goes to Rome and the defining eras by construction.
interface SpreadItem {
  id: string; name: string; start: number; end: number;
  cat: string; type: string; lvl: number; sharpness: number;
  note: string; tags: string; peak: number; row: number;
  ev: any[] | null;
}
interface LSpread { it: SpreadItem; row: number; x0: number; x1: number; lodA: number; isMatch: boolean }
interface LEvent { ev: any[]; id: string; x0: number; row: number; lodA: number; mode: 'right' | 'left' | 'none'; labelW: number; isMatch: boolean }
interface LaneLayout {
  key: string; label: string; si: number | null; isCur: boolean;
  spreads: LSpread[]; events: LEvent[];
  ns: number; ne: number; more: number; exp: boolean;
  isRegion: boolean; era: LSpread[]; eraRow: number; eraOut: string[];
  top: number; h: number; evTop: number;
  // ── continuous geometry, one entry per PERMANENT row in permanent order ──
  // rowH is what is DRAWN this frame (slew-limited); rowG is what the content
  // ASKS for (0..1, the row's max LOD alpha). render() divides the two to know
  // how far a row is from where it is going, and fades it by exactly that much.
  rowY: number[]; rowH: number[]; rowG: number[];
  evY: number[]; evH: number[]; evG: number[];
  headH: number; gapH: number; dying: boolean;
}
interface Layout {
  lanes: LaneLayout[]; H: number; G: number; Wp: number;
  sel: string | null; rels: Map<string, { w: number; kind: string }> | null; q: string;
  anim: boolean;                 // something is still converging — paint again next frame
}

/* ── CONTINUITY: HEIGHT AS A FUNCTION OF ZOOM ─────────────────────────────────

   The founder, on the old layout: "Right now it jumps the height on zooms,
   movements, we need a smoother way… Google earth smoothness. Just slowly,
   smoothing, discovering new ones without jumps in layout."

   The jumps had three sources and every one of them was a DISCRETE decision
   dressed as a continuous gesture: an item crossing its LOD threshold popped a
   whole 24px row into existence; panning culled an item out of the window and
   its row collapsed; the global height-budget trim redistributed rows in whole
   steps. None of that is fixable with an animation timer chasing a discrete
   layout — the layout itself has to be continuous.

   So: A ROW'S HEIGHT IS rowPitch × THE MAX LOD ALPHA OF ITS VISIBLE CONTENT.
   Every item already had a continuous alpha (alphaFor's fade ramp, now a
   smoothstep so the derivative is continuous too). An item fading in 0→1 grows
   its row 0→24px in lockstep with its own fade; zooming out closes the row the
   same way; a band's height is the sum of its rows plus its furniture. Nothing
   to ease, nothing to time, perfectly reversible: the same window always gives
   the same height.

   THREE THINGS GUARD IT.

   1. THE SOFT PAN WINDOW. Culling is against a window padded by 30% on each
      side, and the window alpha ramps 0→1 across that pad. The ramp lives
      ENTIRELY OFF-SCREEN: anything whose extent touches the viewport at all is
      window-alpha 1, so a spread crossing the whole screen can never dim from
      pan maths and the viewport edges never look permanently faded. Leaving the
      screen shrinks a row instead of deleting it.

   2. THE SLEW-RATE LIMITER. The continuous function defines the TARGET; the
      limiter bounds how fast the drawn height may converge on it — 2.5px per
      frame for any single row, 2.2px per frame for a whole band. That one clamp
      catches every remaining source of a jump, enumerated or not: a flick pan
      that blows through the pad in two frames, a preset teleport, a lane toggle,
      the budget trim engaging, a search that re-ranks the corpus. It is NOT an
      easing curve — there is no timer and no duration. When the input is idle
      the drawn height equals the target exactly, so nothing breathes.

   3. HYSTERESIS ON THE TRIM. The global budget engages at HMAX+24 and releases
      only if restoring a row would leave the total under HMAX−24, a 48px dead
      band against a 24px row, so it cannot oscillate near the cap.

   Together they replace the 180ms discrete-moment ease that was on the table:
   ONE mechanism, not two, and it covers cases an enumerated ease would miss. */
const PAD_FRAC = 0.30;      // soft pan window: 30% of the viewport each side
const SLEW_ROW = 2.5;       // px/frame a single row's drawn height may move
const SLEW_LANE = 2.2;      // px/frame a whole band's drawn height may move
const SETTLE = 0.05;        // closer than this and the follower snaps — idle ⇒ drawn === target
const IDLE_MS = 400;        // a gap this long is a new look, not a gesture: snap, don't ramp
const LAB_G0 = 0.60, LAB_G1 = 0.85;    // a row's text fades in between 60% and 85% grown
const HIT_FLOOR = 0.34;     // below this a row is drawn but NOT hoverable (see hitAt)
const TRIM_ON = 24, TRIM_OFF = 24;     // the height-budget hysteresis band
const HEAD_H = 22;          // band header strip — the one fixed piece of furniture
const GAP_H = 6;            // spreads ↔ events separation, faded in with both
// The tick-label strip. It used to run along the BOTTOM of the canvas, under the plot,
// with the set-year pill sliding about inside the lanes above it. His words: "Lets
// remove the in-canvas orange date shower (which is sliding) altogether… Lets move the
// grey dates to the top." So the grey scale is a masthead, the bottom 34px keeps only
// the accent stub and the cursor's own pill, and lanes start below AXIS_TOP.
const AXIS_TOP = 22;

/* ── WHY THERE IS NO HOVER-DRIVEN LAYOUT HERE ─────────────────────────────────

   A cursor-directed fisheye was built and removed: the lane under the pointer grew,
   relaxed its level of detail and took the space from its neighbours. It worked, and
   the founder rejected it on sight — "The x moving is interesting, feels like jelly
   now, I would like it to work only on zoom. just like google earth. Stuff moves only
   on zoom or panning."

   So the rule this file now keeps: THE LAYOUT MOVES FOR ZOOM, PAN, OR A CLICK. Never
   for a hover. Pointing at something must be free — you can read a tooltip, aim at a
   rectangle, cross four bands on the way to a chip, and the page underneath does not
   answer. Anything that would make height or level of detail a function of the pointer
   belongs behind an explicit gesture, not under the cursor. */
// How far a plateau is pre-mixed toward the ground so it can be drawn OPAQUE.
// See the note on mix() in shared.ts: painting the token at 0.75 alpha over the
// light film is what turned the indigo empires into grey-lavender mush.
const GROUND_MIX = 0.12;

/* ── THE ERA ROW ──────────────────────────────────────────────────────────────

   Biggest-first packing has one structural blind spot, and it is exactly the
   thing the founder asks for by name: "what did the world look like, WHAT WARS
   WERE THERE, what technology, what was going on in other spheres".

   Rows are assigned ONCE per corpus, in (level, peak, duration) order, and that
   last key is the trap: a four-year world war at level 1 is placed after
   Farming, Printing, Railways and Electrification — level 1 and centuries long —
   and lands in Europe's SEVENTH row, permanently. Promoting the wars to level 1
   does not help, because the burial happens inside the level. Neither would a
   peak proxy. Frame Cubism at 1875-1955 and Europe shows empires and technology
   and no war at all.

   So each REGION lane reserves at most one row for the window's own EPISODES.
   "Episode" is not a new idea invented for this: it is the grammar's own word
   for a bounded happening, and in the region lanes the hand-authored corpus is
   exactly two types — 11 zones (long, territorial, already deduped against the
   polities) and 17 episodes. The episodes ARE the buried class, and they are
   the wars, the revolutions and the plagues: World War I and II, the Punic and
   Thirty Years' Wars, the French, Haitian and Latin American revolutions, the
   Black Death, the Opium War, the US Civil War.

   An episode qualifies for the row when it is
     · mostly inside the window            (≥ 80% of ITSELF is on screen),
     · an episode OF this window, not the backdrop it sits on
                                           (3% ≤ its extent ≤ 50% of the span),
     · wide enough to read as a bar        (≥ 8px), and
     · not already drawn.
   The lowest level wins; ties go war-category first, then peak, then duration.

   THE ROW IS THE LANE'S LOWEST-PRIORITY VISIBLE ROW, given right of way rather
   than cleared: an episode takes only the space it actually collides with, so
   whatever else was in that row and does not overlap it simply stays. Nothing is
   added, so lane heights, the global height budget and the trim are all
   untouched, and a window with no qualifying episode gets no reserved row at all.

   AND IT MAY NOT OUTRANK ITS WAY IN. An episode evicts only things at its own
   level or below. Without that guard the rule cheerfully traded Asia's Silk Road
   (level 1, sixteen centuries) for Zheng He's treasure fleets (level 3, twenty-
   eight years) at an 800–1500 window — the importance ladder inverted in the name
   of surfacing an episode. World War I and II are level 1, so they still take the
   marginal row from Telegraph and telecommunications, which is level 1 too.

   Rows 0..n−2 never move, so zooming inside an era still cannot reshuffle what
   you were looking at — the stability rule survives intact. */
const ERA_MIN_PX = 8;          // narrower than this it is a tick, not a bar
const ERA_MIN_FRAC = 0.03;     // an episode OF this window…
const ERA_MAX_FRAC = 0.5;      // …not the backdrop it sits on
const ERA_INSIDE = 0.8;        // and mostly on screen, not clipped by an edge
const eraRank = (a: LSpread, b: LSpread) =>
  a.it.lvl - b.it.lvl
  || (a.it.cat === 'war' ? 0 : 1) - (b.it.cat === 'war' ? 0 : 1)
  || b.it.peak - a.it.peak
  || (b.it.end - b.it.start) - (a.it.end - a.it.start)
  || a.it.start - b.it.start;

// How dark the rest of the world goes when something is selected. NOT 0.1:
// selection here means "frame this thing AGAINST the lanes", and the relation
// links are secondary garnish — see the note on dimAlpha in relations.ts.
const DIM_FLOOR = 0.42;

// rectangle height by importance tier — the ONLY height variation permitted;
// never a weight curve (founder decision 2).
const TIER_H: Record<number, number> = { 1: 20, 2: 17, 3: 14, 4: 12, 5: 10 };

export const TL = {
  cv: null as unknown as HTMLCanvasElement, d0: -3000, d1: 2026,
  // Frozen `false`, kept because Lab and the vertical projection still read it. The
  // deep-time MODE died: the one piecewise scale reaches the Big Bang by wheel alone.
  log: false,
  lens: { MU: false, SC: false, MZ: false } as Record<string, boolean>,
  q: '', hoverX: null as number | null, off: new Set<string>(),
  THR: { 1: Infinity, 2: 40000, 3: 2400, 4: 650, 5: 170 } as Record<number, number>,
  LMAX: 10.2,                              // dead, but part of the compatibility surface
  // stage height budget — sizeRenderers() writes this; the canvas grows to its content
  // but never (except at the trim floor) past this.
  HMAX: 760,
  SP_PITCH: 24, EV_PITCH: 17, SPREAD_CAP: 6, EVENT_CAP: 3,
  // Lanes the reader has opened past their row cap by pressing "+N more".
  // Pressing it used to zoom one level of detail in, which could RAISE the
  // number it had just named: more items pass the LOD threshold while the rows
  // stay capped, so "+7 more" answered a click by saying "+11 more". It now
  // does what it says — the lane keeps every row it has and the band grows.
  expanded: new Set<string>(),

  // ---- the lane registry: bands and lenses unified -------------------------
  // Fixed order: CO deep time, then ON curated lanes in registry order, then the four
  // standing regions. Regions and CO are always on; curated lanes toggle via chips.
  // A lane switched OFF is not removed from the layout on the spot — that is a
  // whole band vanishing in one frame, the exact jump this work exists to kill.
  // It stays here as `dying`, its header height targets 0, and the slew limiter
  // walks it out at 2.2px/frame; layout() drops it once it has actually closed.
  dying: new Set<string>(),
  laneDefs(): { key: string; label: string; si: number | null; kind: 'deep' | 'curated' | 'region'; dying?: boolean }[] {
    const out: { key: string; label: string; si: number | null; kind: 'deep' | 'curated' | 'region'; dying?: boolean }[] =
      [{ key: 'CO', label: 'Deep time', si: null, kind: 'deep' }];
    for (const L of LANES) {
      if (this.lens[L.key]) out.push({ key: L.key, label: L.label, si: L.si, kind: 'curated' });
      else if (this.dying.has(L.key)) out.push({ key: L.key, label: L.label, si: L.si, kind: 'curated', dying: true });
    }
    out.push(
      { key: 'EU', label: 'Europe', si: 0, kind: 'region' },
      { key: 'ME', label: 'MidEast & Africa', si: 1, kind: 'region' },
      { key: 'AS', label: 'Asia', si: 2, kind: 'region' },
      { key: 'AM', label: 'Americas', si: 3, kind: 'region' });
    return out;
  },
  /** Is this band key a curated lane? Replaces every hardcoded ['MU','SC','MZ'] list. */
  isCurated(key: string) { return LANES.some(l => l.key === key); },
  // COMPAT SHIM for the vertical projection: same tuple shape as ever; the bh numbers
  // are frozen constants consumed only by VT's railWidth.
  bands(): [string, string, number, number | null][] {
    const lens: [string, string, number, number | null][] = [];
    for (const L of LANES) if (this.lens[L.key]) lens.push([L.key, L.label, 88, L.si]);
    return [['CO', 'Deep time', 34, null], ...lens,
      ['EU', 'Europe', 86, 0], ['ME', 'MidEast & Africa', 86, 1], ['AS', 'Asia', 86, 2], ['AM', 'Americas', 86, 3]];
  },
  span() { return this.d1 - this.d0; },

  // ---- the piecewise screen mapping (shared tv/ty; d0/d1 stay in YEARS) ----
  x(y: number, G: number, Wp: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1);
    return G + (tv(y) - v0) / ((v1 - v0) || 1) * Wp;
  },
  ix(x: number, G: number, Wp: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1);
    return ty(v0 + (x - G) / Wp * (v1 - v0));
  },
  /**
   * Zoom about an anchor year by factor f, in v-space. INVARIANT: x is affine in tv
   * with x(anchor) = G + frac·Wp before and after by construction, so the year under
   * the cursor never moves — at the seam and in deep time alike.
   */
  zoomBy(anchorYear: number, f: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1), vc = tv(anchorYear);
    const frac = (vc - v0) / ((v1 - v0) || 1);
    const spanV = clamp((v1 - v0) * f, 8, VFULL);
    const [nv0, nv1] = clampV(vc - frac * spanV, vc - frac * spanV + spanV);
    this.d0 = ty(nv0); this.d1 = ty(nv1);
  },
  levelFor(S: number) { if (S <= this.THR[5]) return 5; if (S <= this.THR[4]) return 4; if (S <= this.THR[3]) return 3; if (S <= this.THR[2]) return 2; return 1; },
  /**
   * The fade ramp, now a SMOOTHSTEP over the same t → 1.6t window rather than a
   * straight line. Row height is this number times the pitch, so the linear ramp
   * put a corner in the height curve at each end of every crossing — a visible
   * tick in an otherwise smooth zoom. Smoothstep is C1 at both ends: the row
   * eases out of nothing and into full without either kink.
   */
  alphaFor(lvl: number, S: number, isLens: boolean) {
    const t = this.THR[lvl] * (isLens ? 2.5 : 1); if (!isFinite(t)) return 1;
    if (S <= t) return 1;
    const p = (S - t) / (t * 0.6);
    if (p >= 1) return 0;
    return 1 - p * p * (3 - 2 * p);
  },
  /**
   * THE SOFT PAN WINDOW. How much of the padded window an extent is inside: 1
   * for anything that touches the viewport AT ALL — a spread crossing the whole
   * screen must never dim from pan maths, and the viewport edges must never look
   * permanently faded — then a smoothstep 1→0 across the pad, which lives
   * entirely off-screen. Panning something away shrinks its row instead of
   * deleting it, and no row can vanish in a single frame.
   */
  winAlpha(x0: number, x1: number, XL: number, XR: number, pad: number) {
    const d = x0 > XR ? x0 - XR : (x1 < XL ? XL - x1 : 0);
    if (d <= 0) return 1;
    if (d >= pad) return 0;
    const p = d / pad;
    return 1 - p * p * (3 - 2 * p);
  },

  // ---- the spread corpus: membership + PERMANENT lane packing --------------
  // Region lanes: EVENTS durations of that band ∪ POLIS polities by region (AF folds
  // into ME) ∪ REL.spreads by first-footprint region — deduped by exact name so an
  // EVENTS row does not shadow the polity it duplicates. Curated lanes: their EVENTS
  // durations (lane members live in EVENTS). Packed ONCE per corpus in year space,
  // zero-gap (abutting spreads share a row — the Gantt look), canonical order
  // (level asc, duration desc, peak desc, start asc, id asc).
  _corpus: null as null | { sig: string; byLane: Map<string, SpreadItem[]> },
  ensureCorpus() {
    const sig = EVENTS.length + '|' + POLITIES.length + '|' + REL.spreads.length + '|' + LANES.map(l => l.key).join(',');
    if (this._corpus && this._corpus.sig === sig) return this._corpus.byLane;
    const byLane = new Map<string, SpreadItem[]>();
    for (const key of ['CO', ...LANES.map(l => l.key), 'EU', 'ME', 'AS', 'AM']) byLane.set(key, []);
    for (const e of EVENTS) {
      if (!e[1]) continue;                             // moments belong to the event stratum
      const arr = byLane.get(e[3]); if (!arr) continue;
      arr.push({
        id: evId(e), name: e[2], start: e[0], end: e[1], cat: e[6] || 'power',
        type: e[7] || 'episode', lvl: e[4] || 3, sharpness: sharpnessOf(e[7], e[9]),
        // NOTE (not changed here, deliberately — it is the founder's call): a
        // hand-authored spread has an importance LEVEL and no weight curve, so
        // peak is 0, and the packer breaks ties inside a level by peak. Every
        // curated polity therefore outranks every era, war and lifespan at the
        // same level. Giving these a level-derived proxy (11 − 2·lvl, the exact
        // inverse of lvlOfWeight's thresholds) was tried and does interleave
        // them sensibly — but it does NOT lift World War I into Europe's first
        // rows, because WWI is level 2 and fourteen level-1 spreads fill them
        // first. See the report; the row cap is the real constraint.
        note: '', tags: e[5] || '', peak: 0, row: -1, ev: e,
      });
    }
    for (const p of POLITIES) {
      const arr = byLane.get(p.region === 'AF' ? 'ME' : p.region); if (!arr) continue;
      arr.push({
        id: 'polity:' + p.id, name: p.name, start: p.start, end: p.end, cat: 'power',
        type: 'polity', lvl: lvlOfWeight(peakOf(p.weight)), sharpness: 0.85,
        note: p.note || '', tags: '', peak: peakOf(p.weight), row: -1, ev: null,
      });
    }
    for (const s of REL.spreads) {
      const fp = s.footprint && s.footprint.length ? s.footprint[0] : null;
      const arr = fp ? byLane.get(regionOf(fp.lat, fp.lon) || '') : null; if (!arr) continue;
      arr.push({
        id: 'spread:' + s.id, name: s.name, start: s.start, end: s.end,
        cat: SPREADCAT[s.kind] || 'society', type: 'spread',
        lvl: lvlOfWeight(peakOf(s.weight)), sharpness: s.sharpness ?? 0.25,
        note: s.note || '', tags: '', peak: peakOf(s.weight), row: -1, ev: null,
      });
    }
    for (const [key, items] of byLane) {
      const names = new Set(items.filter(i => !i.ev).map(i => i.name.toLowerCase()));
      const kept = items.filter(i => !(i.ev && names.has(i.name.toLowerCase())));
      // DEVIATION from the architect's exact key (level, duration, peak): peak weight
      // outranks duration inside a level, so the top rows hold what actually loomed
      // largest (Rome, the big empires) rather than whatever merely lasted longest —
      // the founder's "importance-first (level, then duration/peak weight)". And at
      // equal level/peak, collective phenomena (empires, eras, movements) outrank
      // individual lives, or a 90-year lifespan buries the 14-year Bauhaus.
      const typeRank = (t: SpreadItem) => (t.type === 'life' ? 1 : 0);
      kept.sort((a, b) => a.lvl - b.lvl
        || b.peak - a.peak
        || typeRank(a) - typeRank(b)
        || (b.end - b.start) - (a.end - a.start)
        || a.start - b.start
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const rows: SpreadItem[][] = [];
      for (const it of kept) {                          // zero-gap interval packing
        let r = 0;
        for (; r < rows.length; r++) if (!rows[r].some(o => it.start < o.end && o.start < it.end)) break;
        if (r === rows.length) rows.push([]);
        rows[r].push(it); it.row = r;
      }
      byLane.set(key, kept);
    }
    this._corpus = { sig, byLane };
    return byLane;
  },

  // ---- pure layout pass: filter, pack, squeeze, budget → per-lane continuous rows ----
  // size() calls this before fitCanvas; render() paints from the SAME result, so the
  // canvas height and the painted content can never disagree. Read the CONTINUITY note
  // above the constants before touching anything below.
  //
  // _dh is the follower's state: what each lane's rows are DRAWN at right now. Keyed by
  // lane key and then by PERMANENT row index — never by a compacted index, or a row
  // opening above would shift every drawn height down one slot and pop the whole band.
  // Keying it permanently is also what makes the old "rows with nothing visible are
  // compacted out" step disappear: an empty row simply has target height 0.
  _dh: new Map<string, { row: number[]; ev: number[]; head: number }>(),
  _trimS: new Map<string, number>(),        // rows the global budget has taken off a lane
  _trimE: new Map<string, number>(),
  _snap: true,                              // next layout jumps straight to its target
  _noSnap: false,                           // …unless a user-initiated change wants the ramp
  _lastCw: 0,
  _lastLay: -1e9,
  _rr: 0,
  _raf: 0,


  layout(cw: number): Layout {
    const G = 118, Wp = cw - G - 10;
    const span = this.span();
    const sel = SelStore.id;
    const rels = sel ? relOf(sel) : null;
    const q = this.q.toLowerCase();
    const ctx = this.cv.getContext('2d')!;
    const byLane = this.ensureCorpus();

    // ── the follower's clock. SNAP means "this is a new look, not a gesture": the
    // first paint, a resize, a return from another tab (nothing painted for
    // IDLE_MS), or prefers-reduced-motion. _noSnap is the one-shot the discrete
    // user actions set so their ramp survives an idle gap.
    const now = performance.now();
    const snap = (this._snap || this._lastCw !== cw || (now - this._lastLay) > IDLE_MS || reduceMotion())
      && !this._noSnap;
    this._snap = false; this._noSnap = false; this._lastCw = cw; this._lastLay = now;

    const XL = G, XR = G + Wp, PAD = Math.max(80, Wp * PAD_FRAC);
    const uiF = fontUI(11.5);

    interface Draft {
      L: LaneLayout; vis: LSpread[]; gRaw: number[]; spare: boolean[];
      evRaw: number[]; evSpare: boolean[];
      gS: number[]; gE: number[]; cumS: number; cumE: number; hT: number;
      capS: number; capE: number;
    }
    const drafts: Draft[] = [];

    // ══ PHASE A — what is visible, and how much height each row ASKS for ═════
    for (const def of this.laneDefs()) {
      const laneId = def.key;
      const isCur = def.kind === 'curated';
      const dying = !!def.dying;
      const isExp = this.expanded.has(laneId);
      const eventCap = isExp ? 10 : this.EVENT_CAP;
      const corpus = byLane.get(laneId) || [];
      let nRows = 1;
      for (const it of corpus) if (it.row + 1 > nRows) nRows = it.row + 1;
      const gRaw = new Array<number>(nRows).fill(0);
      const spare = new Array<boolean>(nRows).fill(false);
      const vis: LSpread[] = [];
      for (const it of corpus) {
        if (this.off.has(it.cat)) continue;
        const isMatch = !!q && (it.name.toLowerCase().includes(q) || it.tags.includes(q) || it.note.toLowerCase().includes(q));
        const x0 = this.x(it.start, G, Wp), x1 = this.x(it.end, G, Wp);
        // SOFT WINDOW first: the only cull is the pad, 30% of the viewport away,
        // so nothing can leave the layout in a single pan frame.
        const wA = this.winAlpha(x0, x1, XL, XR, PAD);
        if (wA <= 0.02) continue;
        let lodA = lit(it.id, sel, rels) ? 1 : this.alphaFor(it.lvl, span, isCur);
        if (isMatch && lodA <= 0.02) lodA = 0.6;      // a searched-for thing must be findable
        lodA *= wA;
        if (lodA <= 0.02) continue;
        vis.push({ it, row: it.row, x0, x1, lodA, isMatch });
        if (lodA > gRaw[it.row]) gRaw[it.row] = lodA;   // THE ROW'S HEIGHT IS THIS
        if (isMatch || it.id === sel) spare[it.row] = true;
      }

      // THE ZONE-CAP FOLD (fold.ts). A founding or dissolution event that
      // duplicates a spread's cap is not a second fact: "Qin unifies China, 221
      // BCE" IS the left edge of the Qin dynasty rectangle two rows above it.
      // Two marks, one fact, and the dot is the weaker of the two. So the dot
      // folds into the spread, which names it in its tooltip and its card.
      //
      // PER FRAME, and against what this lane can actually SHOW: zoom out until
      // the Qin's fifteen years fall below the level of detail and the dot
      // returns, because at that zoom it is the only mark carrying the fact.
      // Keyed to LOD visibility rather than to the row budget — the budget edge
      // is fractional now, and hanging a dot's existence on it would flicker.
      const drawn = new Set(vis.map(v => v.it.id));
      const foldedMatch = new Set<string>();
      // events: per-frame pixel packing, today's laneEnd algorithm, end==0 only;
      // when no row is free the event is DROPPED to the overflow count.
      ctx.font = uiF;
      const evs = EVENTS.filter(e => e[3] === laneId && !e[1] && !this.off.has(e[6])).sort((a, b) => a[0] - b[0]);
      const laneEnd = new Array(eventCap).fill(-1e18);
      const events: LEvent[] = [];
      const evRaw = new Array<number>(eventCap).fill(0);
      const evSpare = new Array<boolean>(eventCap).fill(false);
      let usedRows = 0, more = 0;
      for (const ev of evs) {
        const id = evId(ev);
        const title = ev[2];
        const isMatch = !!q && (title.toLowerCase().includes(q) || ev[5].includes(q));
        const fold = FOLD[title];
        if (fold && drawn.has(fold.spread)) {
          if (isMatch) foldedMatch.add(fold.spread);   // a search for it lands on its parent
          continue;
        }
        const x0 = this.x(ev[0], G, Wp);
        const wA = this.winAlpha(x0, x0, XL, XR, PAD);
        if (wA <= 0.02) continue;
        const lodA = (lit(id, sel, rels) ? 1 : this.alphaFor(ev[4], span, isCur)) * wA;
        if (lodA <= 0.02) continue;
        const labelW = textW(ctx, title, uiF);
        let lane = laneEnd.findIndex(le => le < x0 - 4);
        let mode: 'right' | 'left' | 'none' = 'right';
        if (lane < 0) {
          if (!isMatch) { more++; continue; }         // dropped, never double-stacked…
          // …except a search match, which packs dot-only into the least-crowded row
          lane = 0; let mMin = 1e18; laneEnd.forEach((le, i2) => { if (le < mMin) { mMin = le; lane = i2; } });
          mode = 'none';
        }
        const prevEnd = laneEnd[lane];
        if (mode === 'right' && x0 + 7 + labelW >= cw - 4) mode = (x0 - 9 - labelW > Math.max(G, prevEnd + 4)) ? 'left' : 'none';
        laneEnd[lane] = Math.max(prevEnd, x0 + 8 + (mode === 'right' ? labelW : 0));
        usedRows = Math.max(usedRows, lane + 1);
        if (lodA > evRaw[lane]) evRaw[lane] = lodA;
        if (isMatch || id === sel) evSpare[lane] = true;
        events.push({ ev, id, x0, row: lane, lodA, mode, labelW, isMatch });
      }
      if (foldedMatch.size) for (const v of vis) if (foldedMatch.has(v.it.id)) v.isMatch = true;
      // era-row candidates, gathered from everything VISIBLE (not just what
      // survived the budget) — whether they are already drawn is decided after
      // the global trim, which is the only point at which that is finally known.
      const era = def.kind === 'region'
        ? (byLane.get(laneId) || [])
          .filter(it => it.type === 'episode')
          .map(it => vis.find(v => v.it.id === it.id))
          .filter((v): v is LSpread => !!v && this.isEraEpisode(v, span))
          .sort(eraRank)
        : [];
      // A LANE SWITCHED OFF HAS TO ACTUALLY CLOSE. `dying` zeroed the header height
      // and nothing else, so a lane the reader had just turned off kept every one of
      // its rows: the band lost its name and its dot and went on drawing its content
      // for ever — and because its height never fell under the 0.4px threshold, it
      // never left the `dying` set either, so switching it back on had nothing to
      // grow. The rows ARE the lane. They target zero with the header, and the slew
      // limiter walks the whole band out at 2.2px a frame, which is the close the
      // note above this file always described.
      if (dying) { gRaw.fill(0); evRaw.fill(0); }
      const L: LaneLayout = {
        key: laneId, label: def.label, si: def.si, isCur, spreads: [], events,
        ns: 0, ne: usedRows, more, exp: isExp,
        isRegion: def.kind === 'region', era, eraRow: -1, eraOut: [],
        top: 0, h: 0, evTop: 0,
        rowY: [], rowH: [], rowG: gRaw, evY: [], evH: [], evG: evRaw,
        headH: 0, gapH: 0, dying,
      };
      drafts.push({
        L, vis, gRaw, spare, evRaw, evSpare, gS: [], gE: [], cumS: 0, cumE: 0, hT: 0,
        capS: 0, capE: 0,
      });
    }

    // ══ PHASE B — the budget. Caps stay INTEGER; the slew limiter is what makes a
    // cap change smooth, so there is one mechanism here and not two. ═══════════
    const SPREAD_FLOOR = 3;                            // a lane keeps up to 3 spread rows
    // THE CUMULATIVE SQUEEZE, which replaces the old integer row cap. Rows spend a
    // shared budget of `cap` row-heights in permanent order. A row only 40% faded in
    // spends 0.4 of it, so a row BELOW the cap opens at exactly the rate a row above
    // it closes and the band's height does not move at all. Rows holding a search hit
    // or the selection are spared and spend their full demand, exactly as the integer
    // cap spared them.
    const squeeze = (raw: number[], spare: boolean[], cap: number) => {
      const g = new Array<number>(raw.length).fill(0);
      let cum = 0;
      for (let r = 0; r < raw.length; r++) {
        const want = raw[r];
        if (want <= 0) continue;
        const v = spare[r] ? want : Math.min(want, Math.max(0, cap - cum));
        g[r] = v; cum += v;
      }
      return { g, cum };
    };
    const measure = (d: Draft) => {
      const L = d.L;
      d.capS = L.exp ? 999 : Math.max(SPREAD_FLOOR, this.SPREAD_CAP - (this._trimS.get(L.key) || 0));
      d.capE = L.exp ? 10 : Math.max(1, this.EVENT_CAP - (this._trimE.get(L.key) || 0));
      const s = squeeze(d.gRaw, d.spare, d.capS); d.gS = s.g; d.cumS = s.cum;
      const e = squeeze(d.evRaw, d.evSpare, d.capE); d.gE = e.g; d.cumE = e.cum;
      // an empty lane is a bare HEAD_H strip, and the closing padding fades in with
      // the first row instead of appearing whole — so even "this lane gets its very
      // first item" is continuous. A dying lane targets zero and the limiter walks
      // it out at 2.2px a frame.
      d.hT = (L.dying ? 0 : HEAD_H)
        + d.cumS * this.SP_PITCH + d.cumE * this.EV_PITCH
        + GAP_H * Math.min(1, d.cumS) * Math.min(1, d.cumE)
        + GAP_H * Math.min(1, d.cumS + d.cumE);
      return d.hT;
    };
    const total = () => drafts.reduce((a, d) => a + d.hT, 0) + 34 + AXIS_TOP;

    for (const d of drafts) measure(d);
    const lastSolid = (g: number[]) => { let last = -1; for (let r = 0; r < g.length; r++) if (g[r] > 0.02) last = r; return last; };
    // trim candidates: never an expanded lane (the reader opened it), never a dying
    // one, and never a lane whose lowest row is holding a search hit or the selection.
    const canTrim = (d: Draft) => {
      if (d.L.exp || d.L.dying || d.capS <= SPREAD_FLOOR) return false;
      const last = lastSolid(d.gS);
      return last >= 0 && !d.spare[last];
    };
    let guard = 400;
    while (total() > this.HMAX + TRIM_ON && guard-- > 0) {
      const cands = drafts.filter(canTrim);
      if (cands.length) {
        let m = -1; for (const d of cands) if (d.cumS > m) m = d.cumS;
        const tied = cands.filter(d => d.cumS > m - 0.01);
        const pick = tied[(this._rr++) % tied.length];
        this._trimS.set(pick.L.key, (this._trimS.get(pick.L.key) || 0) + 1);
        measure(pick);
        continue;
      }
      const ec = drafts.filter(d => !d.L.exp && !d.L.dying && d.capE > 1 && d.cumE > 0.001);
      if (ec.length) {
        let m = -1; for (const d of ec) if (d.cumE > m) m = d.cumE;
        const tied = ec.filter(d => d.cumE > m - 0.01);
        const pick = tied[(this._rr++) % tied.length];
        this._trimE.set(pick.L.key, (this._trimE.get(pick.L.key) || 0) + 1);
        measure(pick);
        continue;
      }
      break;      // the floor (3 spread rows + 1 event row) — the canvas may exceed
                  // HMAX slightly and the section scrolls; never loop on an
                  // unsatisfiable target
    }
    // HYSTERESIS. A row comes back only if the result would sit under HMAX−TRIM_OFF.
    // Engage at +24, release under −24: a 48px dead band around a 24px row, so the
    // trim cannot chatter while a zoom drifts past the cap. Event rows come back
    // first because they went last.
    guard = 400;
    while (guard-- > 0) {
      const ec = drafts.filter(d => (this._trimE.get(d.L.key) || 0) > 0);
      const sc = drafts.filter(d => (this._trimS.get(d.L.key) || 0) > 0);
      const map = ec.length ? this._trimE : sc.length ? this._trimS : null;
      const pool = ec.length ? ec : sc;
      if (!map) break;
      pool.sort((a, b) => (a.cumS + a.cumE) - (b.cumS + b.cumE));
      const pick = pool[0], k = pick.L.key, was = map.get(k)!;
      map.set(k, was - 1); measure(pick);
      if (total() < this.HMAX - TRIM_OFF) continue;
      map.set(k, was); measure(pick); break;
    }

    // ══ PHASE C — what survives the budget, and THE ERA ROW ══════════════════
    const clash = (c: LSpread, arr: LSpread[]) =>
      arr.filter(o => c.it.start < o.it.end && o.it.start < c.it.end);
    for (const d of drafts) {
      const L = d.L;
      for (const v of d.vis) { if (d.gS[v.row] > 0.02) L.spreads.push(v); else L.more++; }
      L.events = L.events.filter(e => { if (d.gE[e.row] > 0.02) return true; L.more++; return false; });
      let nsSolid = 0, neSolid = 0, victim = -1;
      for (let r = 0; r < d.gS.length; r++) if (d.gS[r] >= 0.35) { nsSolid++; victim = r; }
      for (let r = 0; r < d.gE.length; r++) if (d.gE[r] >= 0.35) neSolid++;
      L.ns = nsSolid; L.ne = neSolid;
      // ---- THE ERA ROW (see the note above the constants) ------------------
      // After the budget, because "is it already drawn" is only finally true here.
      // The victim is the lane's lowest row that is actually A ROW — a 5%-grown
      // ghost is not somewhere to promote a world war into.
      if (!L.isRegion || nsSolid < 2 || !L.era.length || victim < 0) continue;
      const already = new Set(L.spreads.map(v => v.it.id));
      const fresh = L.era.filter(v => !already.has(v.it.id));
      if (!fresh.length) continue;
      const best = fresh[0].it.lvl;                   // era is pre-sorted by level
      const row = L.spreads.filter(v => v.row === victim);
      // the same sparing the row budget already gives: a row holding the selection
      // or a search hit is never disturbed
      if (row.some(v => v.isMatch || v.it.id === sel)) continue;
      let keep = row.slice();
      const placed: LSpread[] = [];
      const out: string[] = [];
      for (const c of fresh) {
        if (c.it.lvl !== best) break;
        if (clash(c, placed).length) continue;        // one row: no self-overlap
        const evict = clash(c, keep);
        if (evict.some(o => o.it.lvl < c.it.lvl)) continue;   // never outrank its way in
        keep = keep.filter(o => !evict.includes(o));
        out.push(...evict.map(o => o.it.name));
        placed.push(c);
      }
      if (!placed.length) continue;
      L.spreads = L.spreads.filter(v => v.row !== victim)
        .concat(keep, placed.map(p => ({ ...p, row: victim })));
      L.eraOut = out;                                  // the trade, kept inspectable
      L.more = Math.max(0, L.more + out.length - placed.length);
      L.eraRow = victim;
      // the promoted episode owns that row now, so the row's demand is ITS demand
      let g = 0; for (const v of L.spreads) if (v.row === victim && v.lodA > g) g = v.lodA;
      const before = d.cumS - d.gS[victim];
      d.gS[victim] = d.spare[victim] ? g : Math.min(g, Math.max(0, d.capS - before));
      d.gRaw[victim] = g; d.cumS = before + d.gS[victim];
    }

    // ══ PHASE D — the slew limiter, then the geometry ════════════════════════
    // The continuous function above IS the target. Everything here only bounds how
    // fast the drawn height may converge on it: SLEW_ROW for a single row, SLEW_LANE
    // for the band as a whole — and the band's bound is on the SIGNED sum, so a row
    // opening while another closes leaves the band perfectly still. No timer and no
    // duration; when the target stops moving the drawn value snaps onto it, so an
    // idle timeline is at its target exactly and nothing breathes.
    let anim = false;
    let top = AXIS_TOP;
    for (const d of drafts) {
      const L = d.L;
      const tRow = d.gS.map(g => g * this.SP_PITCH);
      const tEv = d.gE.map(g => g * this.EV_PITCH);
      const tHead = L.dying ? 0 : HEAD_H;
      let st = this._dh.get(L.key);
      // a lane seen for the first time starts CLOSED and grows in, unless this frame
      // is a snap (boot, resize, reduced motion) in which case it arrives whole
      if (!st) { st = { row: [], ev: [], head: snap ? tHead : 0 }; this._dh.set(L.key, st); }
      const n = tRow.length, m = tEv.length;
      while (st.row.length < n) st.row.push(0);
      while (st.ev.length < m) st.ev.push(0);
      const tOf = (a: number[], r: number, len: number) => (r < len ? a[r] : 0);
      if (snap) {
        for (let r = 0; r < st.row.length; r++) st.row[r] = tOf(tRow, r, n);
        for (let r = 0; r < st.ev.length; r++) st.ev[r] = tOf(tEv, r, m);
        st.head = tHead;
      } else {
        const dr = new Array<number>(st.row.length).fill(0);
        const de = new Array<number>(st.ev.length).fill(0);
        let sum = 0;
        for (let r = 0; r < st.row.length; r++) { dr[r] = clamp(tOf(tRow, r, n) - st.row[r], -SLEW_ROW, SLEW_ROW); sum += dr[r]; }
        for (let r = 0; r < st.ev.length; r++) { de[r] = clamp(tOf(tEv, r, m) - st.ev[r], -SLEW_ROW, SLEW_ROW); sum += de[r]; }
        let dh = clamp(tHead - st.head, -SLEW_ROW, SLEW_ROW); sum += dh;
        const scale = (k: number) => {
          for (let r = 0; r < dr.length; r++) dr[r] *= k;
          for (let r = 0; r < de.length; r++) de[r] *= k;
          dh *= k;
        };
        if (Math.abs(sum) > SLEW_LANE) scale(SLEW_LANE / Math.abs(sum));
        // AND THEN ON THE BAND HEIGHT ITSELF, not merely on the row sum. L.h is the sum
        // PLUS two GAP_H terms that pass through a min(1, …) — derived furniture that a
        // row crossing that knee drags along faster than the sum reports. Measured, a
        // one-frame teleport moved a band 3.17px while every row obeyed its 2.5. So the
        // predicted height is computed from the candidate deltas and they are rescaled
        // against THAT: the number the eye actually sees is the number that is bounded.
        // Twice, because the min() makes the prediction piecewise-linear rather than
        // linear, and one pass can leave a little on the table.
        const hOf = (k: number) => {
          let s = 0, e = 0;
          for (let r = 0; r < st.row.length; r++) s += st.row[r] + dr[r] * k;
          for (let r = 0; r < st.ev.length; r++) e += st.ev[r] + de[r] * k;
          const nS = s / this.SP_PITCH, nE = e / this.EV_PITCH;
          return (st.head + dh * k) + s + GAP_H * Math.min(1, nS) * Math.min(1, nE)
            + e + GAP_H * Math.min(1, nS + nE);
        };
        for (let pass = 0; pass < 2; pass++) {
          const move = Math.abs(hOf(1) - hOf(0));
          if (move <= SLEW_LANE) break;
          scale(SLEW_LANE / move);
        }
        for (let r = 0; r < st.row.length; r++) {
          const t = tOf(tRow, r, n);
          st.row[r] = Math.abs(t - st.row[r]) < SETTLE ? t : st.row[r] + dr[r];
          if (st.row[r] !== t) anim = true;
        }
        for (let r = 0; r < st.ev.length; r++) {
          const t = tOf(tEv, r, m);
          st.ev[r] = Math.abs(t - st.ev[r]) < SETTLE ? t : st.ev[r] + de[r];
          if (st.ev[r] !== t) anim = true;
        }
        st.head = Math.abs(tHead - st.head) < SETTLE ? tHead : st.head + dh;
        if (st.head !== tHead) anim = true;
      }
      // ---- drawn geometry, in permanent row order ----
      L.rowH = st.row.slice(); L.evH = st.ev.slice();
      L.rowG = d.gRaw.slice(); L.evG = d.evRaw.slice();
      L.headH = st.head;
      let y = 0, sumS = 0;
      L.rowY = new Array<number>(L.rowH.length);
      for (let r = 0; r < L.rowH.length; r++) { L.rowY[r] = y; y += L.rowH[r]; sumS += L.rowH[r]; }
      let ye = 0, sumE = 0;
      L.evY = new Array<number>(L.evH.length);
      for (let r = 0; r < L.evH.length; r++) { L.evY[r] = ye; ye += L.evH[r]; sumE += L.evH[r]; }
      const nS = sumS / this.SP_PITCH, nE = sumE / this.EV_PITCH;
      L.gapH = GAP_H * Math.min(1, nS) * Math.min(1, nE);
      L.h = L.headH + sumS + L.gapH + sumE + GAP_H * Math.min(1, nS + nE);
      L.evTop = L.headH + sumS + L.gapH;
      L.top = top; top += L.h;
    }
    // a dying lane that has finished closing leaves for good
    for (const d of drafts) {
      if (!d.L.dying) continue;
      if (d.L.h < 0.4) { this.dying.delete(d.L.key); this._dh.delete(d.L.key); } else anim = true;
    }
    const lanes = drafts.map(d => d.L).filter(L => !(L.dying && L.h < 0.4));
    return { lanes, H: top + 34, G, Wp, sel, rels, q, anim };
  },

  /** Does this visible spread read as an EPISODE OF the current window? */
  isEraEpisode(v: LSpread, span: number): boolean {
    const it = v.it;
    const ext = it.end - it.start;
    if (ext <= 0) return false;
    const ov = Math.min(it.end, this.d1) - Math.max(it.start, this.d0);
    if (ov <= 0 || ov / ext < ERA_INSIDE) return false;   // clipped by an edge
    const f = ext / span;
    if (f < ERA_MIN_FRAC || f > ERA_MAX_FRAC) return false;
    return (v.x1 - v.x0) >= ERA_MIN_PX;                   // legible as a bar
  },

  _lay: null as Layout | null,
  size() {
    if (!this.cv) return null;
    const cw = this.cv.clientWidth || this.cv.parentElement?.clientWidth || 0;
    if (!cw) return null;
    const lay = this._lay = this.layout(cw);
    const d = fitCanvas(this.cv, lay.H);
    return d ? { cw: d.cw, H: lay.H, ctx: d.ctx, lay } : null;
  },
  boxes: [] as any[],
  /**
   * What is under the cursor — LAST box wins, except that a SEARCH MATCH wins
   * over everything. At a five-thousand-year span, Cubism (1907-22) is seven
   * pixels wide and Surrealism (1924-66) starts three pixels into it: search
   * for "cubism", get one hit, click the one thing lit on screen, and the plain
   * last-wins test hands you Surrealism. If you searched for it, you meant it.
   *
   * SUB-GROWN ROWS. Boxes are pushed at the DRAWN geometry, never the target — a
   * row caught 30% of the way in is hit-tested exactly where it is on screen, not
   * where it is going. Below HIT_FLOOR (34% grown, an 8px slot at 30% opacity) a
   * row is drawn but registers no box at all: a mark that faint is scenery, and
   * making it clickable only means the pointer catches ghosts on the way past.
   */
  hitAt(mx: number, my: number) {
    const inside = (b: any) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
    if (this.q) { const m = this.boxes.findLast((b: any) => b.isMatch && inside(b)); if (m) return m; }
    return this.boxes.findLast(inside);
  },
  /** Register another projection of this state (vertical.ts). Repainted by paint(). */
  onProjection(fn: () => void) { PROJECTIONS.push(fn); },
  /** Register a projection that has to bring a named band into view (vertical.ts). */
  onReveal(fn: (bandKey: string) => void) { REVEALS.push(fn); },
  reveal(bandKey: string) { for (const f of REVEALS) f(bandKey); },
  /** The state changed — repaint every projection of it, not just this one. */
  paint() { this.render(); for (const f of PROJECTIONS) f(); },
  /**
   * "Do not snap the next frame." The continuous height function needs no help
   * during a gesture, because a gesture paints every frame and the slew limiter is
   * already following it. A one-off CLICK is the exception: lane toggles, "+N more",
   * the domain chips. Those can land after seconds of stillness, and layout() reads
   * a long silence as "a new look — arrive whole", which is right when you come back
   * to the tab and wrong when you have just pressed a button. Pressing a button
   * means ramp, so the button says so.
   */
  ease() { this._noSnap = true; },

  // ---- one spread rectangle with its sharpness envelope --------------------
  // The envelope is ALPHA/EDGE only — never geometry, never height. Per-edge ramp
  // width R = min(0.5·(1−s)·W, 96): s=0.85 polity → crisp and stroked; s=0.25 era →
  // long ramps with a 25% plateau; s→0 near-triangular. All alpha is baked into the
  // gradient stops — globalAlpha stays 1, no double multiply.
  drawSpread(ctx: CanvasRenderingContext2D, x0: number, x1: number, yC: number, h: number, col: string, alpha: number, s: number, W = Math.max(x1 - x0, 2)) {
    const R = Math.min(0.5 * (1 - s) * W, 96);
    const lo = alpha * Math.max(s, 0.06);
    const g = ctx.createLinearGradient(x0, 0, x0 + W, 0);
    g.addColorStop(0, withA(col, lo));
    g.addColorStop(R / W, withA(col, alpha));
    g.addColorStop(1 - R / W, withA(col, alpha));
    g.addColorStop(1, withA(col, lo));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x0, yC - h / 2, W, h, 3); ctx.fill();
  },

  render() {
    const dim = this.size(); if (!dim) return;
    const { cw, H, ctx, lay } = dim; const T = tokens();
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    const { G, Wp, lanes, sel, rels, q } = lay;
    this.boxes = [];
    let hitCount = 0;

    // ---- shared time axis: THE SCALE IS A MASTHEAD ----------------------------
    // The grey year labels used to sit in a strip along the BOTTOM, sharing that
    // strip with the accent stub and the cursor's pill — three things claiming one
    // edge. They read along the top now, above everything, and the gridlines start
    // BELOW them: a rule that struck through its own label was never worth the
    // "full height" it bought. What stays full height is the cursor crosshair, which
    // is the only accent in the plot and the only vertical the reader is steering.
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
    ctx.beginPath();
    for (const t of timeTicks(this.d0, this.d1, Wp)) {
      const x = this.x(t.y, G, Wp);
      if (x < G - 1 || x > cw - 4) continue;
      ctx.moveTo(x, AXIS_TOP); ctx.lineTo(x, H - 30);
      ctx.fillText(t.label, x, AXIS_TOP - 7);
    }
    ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(0, AXIS_TOP); ctx.lineTo(cw, AXIS_TOP); ctx.stroke(); ctx.globalAlpha = 1;
    const xn = this.x(2026, G, Wp);
    if (xn >= G && xn <= cw) { ctx.strokeStyle = T.accent2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xn, AXIS_TOP); ctx.lineTo(xn, H - 30); ctx.stroke(); ctx.setLineDash([]); }

    const bgHsl = hexHsl(T.panel); const bgL = bgHsl ? bgHsl[2] : 92;
    // Which way the ground goes decides how the per-item colour jitter spends
    // itself (see varyColor in shared.ts) and which way the plateau is mixed.
    const isLight = bgL > 50;
    const uiF = fontUI(11.5);

    for (const L of lanes) {
      // band separator + header. The header is a HEIGHT now, not a constant: a lane
      // switched off shrinks its header to nothing over eight frames instead of
      // deleting a whole band between two paints. hs is 1 for every live lane, so
      // this is exactly today's furniture everywhere except during that close.
      const hs = clamp(L.headH / HEAD_H, 0, 1);
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(0, L.top + L.h); ctx.lineTo(cw, L.top + L.h); ctx.stroke(); ctx.globalAlpha = 1;
      if (hs > 0.02) {
        ctx.globalAlpha = hs;
        ctx.fillStyle = L.si === null ? T.ink2 : T.s[L.si]; ctx.beginPath(); ctx.arc(10, L.top + 13 * hs, 4 * hs, 0, 7); ctx.fill();
        ctx.fillStyle = T.ink2; ctx.font = fontUI(10.5, 600); ctx.textAlign = 'left';   // a band name is language
        ctx.fillText(L.label.toUpperCase(), 20, L.top + 17 * hs);
        ctx.globalAlpha = 1;
      }

      // ---- SPREAD STRATUM: rows at CONTINUOUS pitch, rectangles with envelopes ----
      // Row r owns the slot [rowY[r], rowY[r] + rowH[r]] and nothing else, at every
      // fractional state — that is what keeps "zero pairwise overlap" structural
      // rather than something to re-check. The rectangle keeps its share of that
      // slot (TIER_H is 20/24 of the pitch at most, so the 2px gutter scales too),
      // which is why a half-grown row is a half-height rectangle and not a full one
      // spilling into its neighbour.
      const byRow: LSpread[][] = [];
      for (const s of L.spreads) (byRow[s.row] ||= []).push(s);
      const top0 = L.top + L.headH;
      for (let r = 0; r < L.rowH.length; r++) {
        const slot = L.rowH[r];
        if (slot <= 0.05) continue;
        const rowItems = (byRow[r] || []).sort((a, b) => a.x0 - b.x0);
        if (!rowItems.length) continue;
        const g = clamp(slot / this.SP_PITCH, 0, 1);
        // how far this row is from the height its content asked for: a row being
        // squeezed out by the budget, or still catching up to the slew limiter,
        // fades by exactly the fraction of its demand it is being given
        const fade = clamp(g / Math.max(L.rowG[r] || g, 1e-3), 0, 1);
        const textGate = clamp((g - LAB_G0) / (LAB_G1 - LAB_G0), 0, 1);
        const yC = top0 + L.rowY[r] + slot / 2;
        let prevEnd = -1e18;
        for (let i = 0; i < rowItems.length; i++) {
          const s = rowItems[i], it = s.it;
          const searchDim = q ? (s.isMatch ? 1 : 0.12) : 1;
          if (q && s.isMatch) hitCount++;
          const dimA = dimAlpha(it.id, sel, rels, DIM_FLOOR) * searchDim;
          const h = (TIER_H[it.lvl] || 12) * g;
          const [col, colL] = varyColor(catColor(it.cat, T), it.id, isLight);
          // COMPOSITE-AWARE FILL: the plateau is opaque in a colour pre-mixed a
          // little way toward the ground, so what lands on screen is the category
          // token rather than the token drained 25% toward the page. The LOD, dim
          // and search fades still multiply on top, exactly as before.
          const plate = mix(col, T.panel, GROUND_MIX);
          const fillA = clamp(s.lodA * dimA * fade, 0, 1);
          // a rectangle narrower than 2px is widened to stay visible — but never
          // past its neighbour's left edge, or two ticks in one row overlap
          const nextX0 = i + 1 < rowItems.length ? rowItems[i + 1].x0 : 1e18;
          const W = Math.max(0.5, Math.min(Math.max(s.x1 - s.x0, 2), nextX0 - s.x0));
          this.drawSpread(ctx, s.x0, s.x1, yC, h, plate, fillA, it.sharpness, W);
          if (it.sharpness >= 0.6) {                   // the stroke is what makes "founded on a date" read
            ctx.globalAlpha = clamp(0.9 * s.lodA * dimA * fade, 0, 1);
            ctx.strokeStyle = col; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(s.x0, yC - h / 2, W, h, 3); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (it.id === sel) {                          // the selection ring, Conn's exact idea
            ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.roundRect(s.x0 - 1, yC - h / 2 - 1, W + 2, h + 2, 4); ctx.stroke();
          } else if (s.isMatch) {
            ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.roundRect(s.x0 - 1, yC - h / 2 - 1, W + 2, h + 2, 4); ctx.stroke();
          }
          // ---- THE LABEL, and the founder's truncation rule --------------------
          // A rectangle too narrow for its full name shows AS MUCH OF THE NAME AS
          // FITS plus an ellipsis — never a blank bar. Only when fewer than three
          // characters plus "…" would fit does it fall back to the outside-label
          // algorithm, and only then to nothing. ellipsize() caches per (font, text,
          // 8px width bucket), so a continuous zoom re-uses one answer across an
          // 8px band of widths instead of re-measuring every frame.
          const visX0 = Math.max(s.x0, G);
          const inF = fontUI(10.5, 600);
          ctx.font = inF;
          const inner = (s.x1 - visX0) - 12;
          const inText = ellipsize(ctx, it.name, inner, inF, 3);
          let mode: 'in' | 'right' | 'left' | 'none' = 'none';
          let labelW = 0;
          if (inText) mode = 'in';
          else {
            ctx.font = uiF;
            labelW = textW(ctx, it.name, uiF);
            const nx = i + 1 < rowItems.length ? rowItems[i + 1].x0 : 1e18;
            if (s.x1 + 7 + labelW < Math.min(nx - 4, cw - 4)) mode = 'right';
            else if (s.x0 - 9 - labelW > Math.max(G, prevEnd + 4)) mode = 'left';
          }
          // text fades in with the row (60%→85% grown) and with its own alpha,
          // continuously — the old hard cutoff at 0.25 popped every label
          const textA = clamp((s.lodA * dimA * fade - 0.10) / 0.15, 0, 1) * textGate;
          if (textA > 0.02) {
            if (mode === 'in') {
              // ink from the COMPOSITE lightness — the plateau is darker now that it
              // is opaque, so this is the rule that flips those labels to white
              const mixL = colL + (bgL - colL) * GROUND_MIX;
              const effL = bgL + (mixL - bgL) * fillA;
              ctx.globalAlpha = Math.min(1, fillA + 0.2) * textA;
              ctx.fillStyle = effL > 50 ? T.ink : '#fff';
              ctx.fillText(inText, visX0 + 6, yC + 3.5);
            } else if (mode === 'right') {
              ctx.globalAlpha = textA; ctx.fillStyle = T.ink;
              ctx.fillText(it.name, s.x1 + 7, yC + 4);
            } else if (mode === 'left') {
              ctx.globalAlpha = textA; ctx.fillStyle = T.ink;
              ctx.fillText(it.name, s.x0 - 9 - labelW, yC + 4);
            }
          }
          ctx.globalAlpha = 1;
          prevEnd = Math.max(prevEnd, s.x1 + (mode === 'right' ? 8 + labelW : 0));
          if (g >= HIT_FLOOR) this.boxes.push({
            x: mode === 'left' ? s.x0 - 11 - labelW : s.x0 - 2,
            y: yC - h / 2 - 2,
            w: (s.x1 - s.x0) + 4 + (mode === 'right' ? 10 + labelW : mode === 'left' ? 12 + labelW : 0),
            h: h + 4, kind: 'spread', id: it.id, it, band: L.label, isMatch: s.isMatch, row: r,
          });
        }
      }

      // ---- EVENT STRATUM: strictly below the spread block (decision 4) ----
      // Same treatment: an event row is EV_PITCH × the max alpha of its dots, and the
      // dot keeps its share of the slot, so a stratum opens and closes as smoothly as
      // the spreads above it.
      ctx.font = uiF;
      const evTop = L.top + L.evTop;
      for (const E of L.events) {
        const slot = L.evH[E.row] || 0;
        if (slot <= 0.05) continue;
        const g = clamp(slot / this.EV_PITCH, 0, 1);
        const fade = clamp(g / Math.max(L.evG[E.row] || g, 1e-3), 0, 1);
        const title = E.ev[2];
        const searchDim = q ? (E.isMatch ? 1 : 0.12) : 1;
        if (q && E.isMatch) hitCount++;
        const a = clamp(E.lodA * dimAlpha(E.id, sel, rels, DIM_FLOOR) * searchDim * fade, 0, 1);
        const yy = evTop + L.evY[E.row] + slot / 2;
        ctx.globalAlpha = a; ctx.fillStyle = catColor(E.ev[6], T);
        ctx.beginPath(); ctx.arc(E.x0, yy, 3.2 * g, 0, 7); ctx.fill();
        if (E.id === sel) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(E.x0, yy, 7 * g, 0, 7); ctx.stroke();
        } else if (E.isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(E.x0, yy, 7 * g, 0, 7); ctx.stroke();
        }
        ctx.fillStyle = T.ink;
        const textA = clamp((a - 0.10) / 0.15, 0, 1) * clamp((g - LAB_G0) / (LAB_G1 - LAB_G0), 0, 1);
        if (textA > 0.02) {
          ctx.globalAlpha = textA;
          if (E.mode === 'right') ctx.fillText(title, E.x0 + 7, yy + 4);
          else if (E.mode === 'left') ctx.fillText(title, E.x0 - 9 - E.labelW, yy + 4);
        }
        ctx.globalAlpha = 1;
        if (g >= HIT_FLOOR) this.boxes.push({
          x: E.mode === 'left' ? E.x0 - 11 - E.labelW : E.x0 - 8, y: yy - slot / 2,
          w: 16 + (E.mode === 'none' ? 4 : E.labelW), h: slot, kind: 'ev', id: E.id, ev: E.ev,
          band: L.label, isMatch: E.isMatch,
        });
      }

      // ---- the row-cap affordance: it OPENS the lane, it does not zoom ----
      if ((L.more > 0 || L.exp) && hs > 0.5) {
        ctx.font = fontMono(10); ctx.fillStyle = T.ink3; ctx.textAlign = 'right';
        const txt = L.exp ? '− less' : `+${L.more} more`;
        ctx.fillText(txt, cw - 12, L.top + L.h - 6);
        const tw = ctx.measureText(txt).width;
        this.boxes.push({
          x: cw - 14 - tw, y: L.top + L.h - 17, w: tw + 8, h: 15,
          kind: 'more', lane: L.key, band: L.label, exp: L.exp, more: L.more,
        });
        ctx.textAlign = 'left';
      }
    }

    // ---- the global time index: A STUB, NOT A MERIDIAN ----------------------
    // This ran the full height in minium. So does the hover crosshair. And the
    // shell's own .tl-index-line continued up from the rail in a THIRD place —
    // the rail's scale is not this canvas's, so the two "set year" lines sat at
    // different x while claiming the same year. His words: "let's not make the
    // red line from the bottom go all the way to top — there's two lines
    // battling now."
    //
    // So the set year is a short stub rising off the axis, and the hover crosshair
    // is the ONLY full-height vertical on the canvas. Stub = the year you set.
    // Crosshair = where your cursor is.
    //
    // AND THE STUB NO LONGER CARRIES A LABEL. It used to fly a pill of its own, which
    // slid across the plot on every pan — an accent-coloured year loose in the middle
    // of the lanes, a third place the same number was being told. His words: "Lets
    // remove the in-canvas orange date shower (which is sliding) altogether. Just the
    // bottom slider shows what you see in view (grey) and whats in center is the
    // current date." So the rail below the canvas is the set year's only readout, and
    // the one pill left on this canvas is the cursor's, which does not slide on its
    // own — it goes where the hand goes.
    const xg = this.x(TimeStore.year, G, Wp);
    if (xg >= G && xg <= cw - 4) {
      const base = H - 30, tip = base - 34;
      const gr = ctx.createLinearGradient(0, base, 0, tip);
      gr.addColorStop(0, T.accent); gr.addColorStop(1, withA(T.accent, 0));
      ctx.strokeStyle = gr; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xg, base); ctx.lineTo(xg, tip); ctx.stroke();
    }

    // hover crosshair + year readout (the hover pill keeps the bottom edge)
    if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
      const yr = this.ix(this.hoverX, G, Wp);
      ctx.strokeStyle = T.accent; ctx.globalAlpha = .55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.hoverX, AXIS_TOP); ctx.lineTo(this.hoverX, H - 30); ctx.stroke();
      ctx.globalAlpha = 1;
      yearPill(ctx, T, this.hoverX, H - 26, fmtBig(yr));
    }
    const baseL = this.levelFor(this.span());
    // both readouts are optional chrome now — the panel search box that carried
    // #searchCnt has been removed, and render() must not care
    const rd = $('#zoomReadout'); if (rd) rd.textContent = `showing importance ≤ ${baseL} of 5 · span ${fmtSpan(this.span())}`;
    const sc = $('#searchCnt'); if (sc) sc.textContent = q ? `${hitCount} hits` : '';
    // THE FOLLOWER'S ONLY CLOCK. layout() reports `anim` while any drawn height is
    // still short of its target; one rAF per frame walks it the rest of the way and
    // then stops. this.render(), never this.paint(): the vertical projection has its
    // own layout and must not be dragged through 60 repaints for a band it does not
    // draw. A canvas with no width paints nothing, so a hidden tab parks the loop.
    if (lay.anim) { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }
    else if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  },

  // eased in V-SPACE: year-space easing would spend 99.9% of the Big Bang preset's run
  // outside human history.
  animTo(a: number, b: number, done?: () => void) {
    if (reduceMotion()) { this.d0 = a; this.d1 = b; this.paint(); done?.(); return; }
    const va0 = tv(this.d0), vb0 = tv(this.d1), va1 = tv(a), vb1 = tv(b), t0 = performance.now();
    const step = (t: number) => {
      const p = clamp((t - t0) / 650, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.d0 = ty(va0 + (va1 - va0) * e); this.d1 = ty(vb0 + (vb1 - vb0) * e); this.paint();
      if (p < 1) requestAnimationFrame(step); else done?.();
    };
    requestAnimationFrame(step);
  },
  /** If the global moment is outside the window, centre the window on it. */
  ensureYearVisible() {
    // …unless a deliberate framing is in flight. "In perspective" on Cubism
    // asks for 1874-1954 while the global moment is still 1783, and this would
    // otherwise yank the window straight back to 1783 the instant the tab
    // switch repaints — the framing losing an argument with a courtesy.
    if (this._holdYear) { this._holdYear = false; return; }   // one-shot: consumed here
    const y = TimeStore.year;
    if (y >= this.d0 && y <= this.d1) return;
    const s = this.span();
    const [ca, cb] = clampDomain(y - s / 2, y + s / 2);
    this.animTo(ca, cb);
  },
  _holdYear: false,
  /**
   * THE CORE LOOP'S ONE MOVE: frame the window on something, WITHOUT touching
   * the moment. animTo writes d0/d1 and nothing else, which is the whole
   * contract — "In perspective" changes what you can see, never where you are.
   */
  frameTo(a: number, b: number) {
    this._holdYear = true;
    // Cleared on a macrotask, never synchronously: with prefers-reduced-motion
    // animTo calls done() in the same tick as the click, which is BEFORE React
    // has flushed the tab switch — so a synchronous clear would hand the flag
    // back just in time for renderTab() to undo the framing.
    const [ca, cb] = clampDomain(a, b);
    this.animTo(ca, cb, () => {
      SelCard.reanchor();
      setTimeout(() => { this._holdYear = false; }, 0);
    });
  },

  /**
   * Empty the search. Pressing "In perspective" means "now show me its world",
   * and a live query dims everything that is not a hit to 12% — which is the
   * exact opposite. You searched to FIND the thing; you found it; the box
   * visibly empties and the world comes back.
   */
  clearSearch() {
    if (!this.q) return;
    this.q = '';
    const box = $<HTMLInputElement>('#searchBox'); if (box) box.value = '';
    const cnt = $('#searchCnt'); if (cnt) cnt.textContent = '';
  },
  /** A hit box in canvas CSS pixels, as a viewport rect the card can dodge. */
  rectOf(b: { x: number; y: number; w: number; h: number }): DOMRect {
    const r = this.cv.getBoundingClientRect();
    return new DOMRect(r.left + b.x, r.top + b.y, b.w, b.h);
  },
  /** Where a selected id is on screen right now, or null if it is not drawn. */
  anchorOf(id: string): DOMRect | null {
    if (!this.cv || !this.cv.clientWidth) return null;
    const b = this.boxes.find(bx => bx.id === id);
    return b ? this.rectOf(b) : null;
  },

  _storesBound: false,
  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#zoomCanvas')!;
    // curated-lane defaults arrive with the registry (Arts on at boot)
    for (const L of LANES) if (!(L.key in this.lens)) this.lens[L.key] = !!L.default;
    // THE PRESET BUTTONS AND THE PANEL SEARCH BOX ARE GONE — "Remove the random
    // controls!" and "Keep only one search - one at the top." Mozart's world, 1776 in
    // context, Deep time and Reset were four canned framings occupying the top of the
    // panel; the wheel reaches every one of them and the rail transport reaches the
    // rest. animTo/frameTo stay — they are the core loop's move, and the card's "In
    // perspective" and Lab's search dropdown both call them.
    //
    // The QUERY state stays too: this.q, clearSearch() and the #searchCnt readout are
    // all still here for whichever input owns the search. Only the duplicate box in
    // this panel went. Everything below is bound defensively so this file cannot care
    // whether a given piece of chrome is still in the markup.
    const box = $<HTMLInputElement>('#searchBox');
    if (box) box.addEventListener('input', (e: any) => { this.q = e.target.value.trim(); this.paint(); });
    this.buildLaneRow();
    this.buildCatRow();
    buildGrammarLegend();
    repaintOnFonts(() => this.render());
    if (!this._storesBound) {
      this._storesBound = true;
      TimeStore.subscribe(() => this.paint());
      SelStore.subscribe(() => {
        this.paint();
        renderRelatedPanel($('#tlRelPanel'), SelStore.id);
      });
      renderRelatedPanel($('#tlRelPanel'), SelStore.id);
    }
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(); const G = 118, Wp = cv.clientWidth - G - 10;
      const yc = this.ix(e.clientX - r.left, G, Wp);
      this.zoomBy(yc, Math.pow(1.0018, e.deltaY));
      this.paint();
    }, { passive: false });
    let drag: any = null;
    cv.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, v0: tv(this.d0), v1: tv(this.d1), moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
    });
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.hoverX = mx;
      if (drag) {
        // pan in v-space, or deep-time panning is wildly nonuniform
        const G = 118, Wp = cv.clientWidth - G - 10;
        const dv = (e.clientX - drag.x) / Wp * (drag.v1 - drag.v0);
        if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
        const [nv0, nv1] = clampV(drag.v0 - dv, drag.v1 - dv);
        this.d0 = ty(nv0); this.d1 = ty(nv1); this.paint(); return;
      }
      const b = this.hitAt(mx, my);
      this.render();
      if (b && b.kind === 'more') {
        showTip(e.clientX, e.clientY, b.exp
          ? `<div class=t>${b.band}</div><div class=m>Collapse this lane back to its row cap.</div>`
          : `<div class=t>${b.band}</div><div class=m>${b.more} more row${b.more === 1 ? '' : 's'} in this lane. Click to open the lane — the band grows, the zoom does not move.</div>`);
        cv.style.cursor = 'pointer'; return;
      }
      if (b && b.kind === 'spread') {
        const it = b.it; const cat = CATBY[it.cat];
        showTip(e.clientX, e.clientY, `<div class=t>${it.name}</div><div class=m>${fmtBig(it.start)} – ${fmtY(it.end)} · ${b.band}</div>` +
          `<div class=m>${cat ? cat.name : ''} · ${it.type}</div>` +
          (it.note ? `<div class=m>${it.note}</div>` : '') +
          foldLines(it.id) +
          `<div class=m>importance ${'●'.repeat(6 - it.lvl)}${'○'.repeat(it.lvl - 1)} (${it.lvl}) · click to select</div>`);
        cv.style.cursor = 'pointer';
      } else if (b) {
        const [y0, y1, t, , lvl] = b.ev; const cat = CATBY[b.ev[6]], typ = b.ev[7], pl = b.ev[8];
        showTip(e.clientX, e.clientY, `<div class=t>${t}</div><div class=m>${fmtBig(y0)}${y1 ? ' – ' + fmtY(y1) : ''} · ${b.band}</div>` +
          `<div class=m>${cat ? cat.name : ''} · ${typ}${pl ? ' · ' + pl[2] : ''}</div>` +
          `<div class=m>importance ${'●'.repeat(6 - lvl)}${'○'.repeat(lvl - 1)} (${lvl}) · click to select · Wikipedia in the Related panel</div>`);
        cv.style.cursor = 'pointer';
      } else { hideTip(); cv.style.cursor = 'crosshair'; }
    });
    cv.addEventListener('pointerup', e => {
      const wasDrag = drag && drag.moved; drag = null; if (wasDrag) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const G = 118, Wp = cv.clientWidth - G - 10;
      const H = cv.clientHeight;
      // EITHER axis strip sets the global moment — the grey scale reads along the
      // top now, and the strip you can read the year off is the strip you expect to
      // be able to point at. The bottom 30px keeps the same job it always had.
      if (my > H - 30 || my < AXIS_TOP) {
        TimeStore.set(Math.round(this.ix(mx, G, Wp)), 'tl');
        return;
      }
      const b = this.hitAt(mx, my);
      if (b && b.kind === 'more') {                    // open (or close) the lane — never zoom
        if (b.lane) {
          if (this.expanded.has(b.lane)) this.expanded.delete(b.lane); else this.expanded.add(b.lane);
        }
        hideTip();
        this.ease(); this.paint();
        return;
      }
      // Click means select, and the card appears BESIDE the mark — never over
      // it. Empty canvas clears the selection, exactly as before.
      SelCard.select(b ? b.id : null, b ? this.rectOf(b) : null);
    });
    cv.addEventListener('pointerleave', () => { hideTip(); this.hoverX = null; this.render(); });
    this.syncChips();
  },
  // Builds the curated-lane chips into the EXISTING #lensRow (which ships EMPTY).
  // Guarded against the strict-mode double build exactly like buildCatRow.
  buildLaneRow() {
    const row = $('#lensRow'); if (!row) return;
    if (row.querySelector('[data-lens]')) { this.syncChips(); return; }
    for (const L of LANES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (this.lens[L.key] ? ' on' : '');
      b.dataset.lens = L.key;
      b.innerHTML = `<span class="dot" style="background:${L.si === null ? 'var(--tl-ink-2)' : `var(--s${L.si + 1})`}"></span>${L.label}`;
      b.addEventListener('click', () => {
        this.lens[L.key] = !this.lens[L.key];
        b.classList.toggle('on', this.lens[L.key]);
        // A lane going OFF is not deleted from the layout on the spot — it is marked
        // dying and the slew limiter closes it. Going ON, it grows from nothing.
        if (this.lens[L.key]) this.dying.delete(L.key); else this.dying.add(L.key);
        this.ease(); this.paint();
        // Switching a lane ON is a request to look at it.
        if (this.lens[L.key]) this.reveal(L.key);
      });
      row.appendChild(b);
    }
  },
  syncChips() { document.querySelectorAll<HTMLElement>('#lensRow .chip').forEach(ch => ch.classList.toggle('on', this.lens[ch.dataset.lens!])); },

  // ================= domain (category) filter =================
  // `off` is the set of hidden category ids; render() filters on it. Everything below is a
  // different way of WRITING that one set, so there is exactly one source of truth.
  catPrevOff: null as Set<string> | null,
  catIsSolo(id?: string) { return this.off.size === CATS.length - 1 && (id === undefined || !this.off.has(id)); },
  catAll() { this.off.clear(); this.catPrevOff = null; this.syncCatChips(); this.ease(); this.paint(); },
  catNone() {
    if (this.off.size !== CATS.length) this.catPrevOff = new Set(this.off);
    this.off = new Set(CATS.map(c => c.id));
    this.syncCatChips(); this.ease(); this.paint();
  },
  catToggle(id: string) {
    if (this.off.has(id)) this.off.delete(id); else this.off.add(id);
    this.syncCatChips(); this.ease(); this.paint();
  },
  // "only" — isolate one domain. Pressing it again on the isolated domain restores the set
  // that was showing before the first press, so isolating is a look, not a destination.
  catSolo(id: string) {
    if (this.catIsSolo(id)) {
      this.off = this.catPrevOff ? new Set(this.catPrevOff) : new Set<string>();
      this.catPrevOff = null;
    } else {
      if (!this.catIsSolo()) this.catPrevOff = new Set(this.off);   // don't clobber it while hopping solo→solo
      this.off = new Set(CATS.filter(c => c.id !== id).map(c => c.id));
    }
    this.syncCatChips(); this.ease(); this.paint();
  },
  // Builds into the EXISTING #catRow (Lab.tsx owns that element) — append only, never restructure.
  buildCatRow() {
    const row = $('#catRow'); if (!row) return;
    if (row.querySelector('[data-cat]')) { this.syncCatChips(); return; }   // already built (HMR / re-init)
    const OFF = '.45';                                             // resting opacity of the "only" affordance

    // All / None are VERBS, not filters — globals.css styles .chip.catall and deliberately
    // gives them no swatch and no pressed state, so nothing is set inline here. The live
    // state they act on is carried by the "n of 8" readout instead.
    const master = (kind: 'all' | 'none', label: string, hint: string) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip catall'; b.dataset.catall = kind;
      b.textContent = label; b.title = hint;
      b.addEventListener('click', () => (kind === 'all' ? this.catAll() : this.catNone()));
      row.appendChild(b);
    };
    master('all', 'All', 'Show every domain');
    master('none', 'None', 'Hide every domain — then click the one or two you want');

    const cnt = document.createElement('span');
    cnt.className = 'note'; cnt.id = 'catCount';
    cnt.style.cssText = 'font-variant-numeric:tabular-nums';
    row.appendChild(cnt);

    const sep = document.createElement('span');
    sep.setAttribute('aria-hidden', 'true');
    sep.style.cssText = 'flex:none;align-self:center;width:1px;height:15px;background:var(--line)';
    row.appendChild(sep);

    for (const c of CATS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip on'; b.dataset.cat = c.id;
      b.setAttribute('aria-pressed', 'true');
      // the "only" tag is a mouse target inside the button, so it cannot be focusable itself
      // (interactive content may not nest). aria-keyshortcuts is the keyboard equivalent and,
      // unlike a title tooltip, screen readers announce it — so it is advertised, not hidden.
      b.setAttribute('aria-keyshortcuts', 'Alt+Enter');
      // the "only" tag borrows .chip.catall's typography so the two verbs read as one family
      b.innerHTML = `<span class="dot" style="background:var(--s${c.si + 1})"></span>${c.name}` +
        `<span class="only" aria-hidden="true" style="padding-left:7px;` +
        `border-left:1px solid var(--line);font-size:var(--tl-text-2xs,10px);` +
        `letter-spacing:var(--tl-track-caps,.06em);text-transform:uppercase;` +
        `opacity:${OFF}">only</span>`;
      b.addEventListener('click', e => {
        const t = e.target as HTMLElement | null;
        if ((t && t.closest && t.closest('.only')) || e.altKey || e.metaKey) this.catSolo(c.id);
        else this.catToggle(c.id);
      });
      // a keyboard-activated click carries no modifier state in Chromium, so Alt+Enter /
      // Alt+Space must be caught here or the isolate has no keyboard route at all.
      b.addEventListener('keydown', e => {
        if (e.altKey && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.catSolo(c.id); }
      });
      // the affordance is always present (so it is seen, not discovered) but quiet until aimed at
      const only = b.querySelector<HTMLElement>('.only')!;
      const fade = (v: string) => { only.style.opacity = v; };
      b.addEventListener('pointerenter', () => fade('1'));
      b.addEventListener('pointerleave', () => fade(OFF));
      b.addEventListener('focus', () => fade('1'));
      b.addEventListener('blur', () => fade(OFF));
      row.appendChild(b);
    }
    this.syncCatChips();
  },
  syncCatChips() {
    document.querySelectorAll<HTMLElement>('#catRow .chip[data-cat]').forEach(ch => {
      const id = ch.dataset.cat!, name = CATBY[id] ? CATBY[id].name : id;
      const shown = !this.off.has(id), solo = this.catIsSolo(id);
      ch.classList.toggle('on', shown);
      ch.setAttribute('aria-pressed', String(shown));
      // the affordance names what it will do next, so "press it again to go back" is read, not learnt
      const only = ch.querySelector<HTMLElement>('.only');
      if (only) only.textContent = solo ? 'back' : 'only';
      ch.title = solo
        ? `${name} is the only domain showing. BACK (or ⌥/Alt-click, or Alt+Enter) restores the set you had before.`
        : `${name} — click to show or hide. ONLY (or ⌥/Alt-click, or Alt+Enter) isolates this domain.`;
    });
    const cnt = $('#catCount');
    if (cnt) cnt.textContent = `${CATS.length - this.off.size} of ${CATS.length}`;
  },
};

/** The founding/dissolution events a spread has swallowed, as tooltip lines. */
function foldLines(id: string): string {
  let out = '';
  for (const t in FOLD) {
    if (FOLD[t].spread !== id) continue;
    const ev = EVENTS.find(e => !e[1] && e[2] === t);
    if (!ev) continue;
    out += `<div class=m><b>${roleWord(FOLD[t].role)}</b> — ${t}, ${fmtY(ev[0])}</div>`;
  }
  return out;
}

// ONE container, shared by both projections (#grammarRowV, in the disclosure at the
// foot of the Timeline panel). Two visual categories now: spreads (rectangles, sharp
// or soft per their sharpness) and events (dots). Height carries importance; colour
// still carries domain.
export function buildGrammarLegend() {
  const rows = [$('#grammarRow'), $('#grammarRowV')].filter(Boolean) as HTMLElement[];
  if (!rows.length) return;
  const g = (svg: string, label: string) => `<span class="g"><svg width="30" height="14" viewBox="0 0 30 14">${svg}</svg>${label}</span>`;
  const c = 'var(--ink2)';
  rows.forEach((r, i) => {
    const gid = 'tlfade' + i;                          // per-container gradient id — never duplicated
    r.innerHTML = `<span class="note" style="font-weight:600">Mark =</span>` +
      g(`<rect x="3" y="3.5" width="24" height="7" rx="2" fill="${c}" opacity=".75"/><rect x="3" y="3.5" width="24" height="7" rx="2" fill="none" stroke="${c}" stroke-width="1"/>`, 'spread, sharp — dated ends') +
      g(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="${c}" stop-opacity=".05"/><stop offset=".38" stop-color="${c}" stop-opacity=".75"/>` +
        `<stop offset=".62" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="${c}" stop-opacity=".05"/>` +
        `</linearGradient></defs><rect x="2" y="3.5" width="26" height="7" rx="2" fill="url(#${gid})"/>`, 'spread, soft — fades in and out') +
      g(`<circle cx="15" cy="7" r="3.2" fill="${c}"/>`, 'event — a moment') +
      `<span class="note" style="margin-left:6px">taller = more important</span>` +
      `<span class="note" style="font-weight:600;margin-left:6px">Colour = domain</span>`;
  });
}
