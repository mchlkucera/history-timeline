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
  tv, ty, VFULL, YMIN, YMAX, timeTicks, withA, hexHsl, varyColor,
  TimeStore, SelStore, evId, LANES, sharpnessOf,
} from './shared';
import {
  REL, SPREADCAT, peakOf, lvlOfWeight, regionOf, relOf, dimAlpha, lit, renderRelatedPanel,
} from './relations';
import { FOLD, roleWord } from './fold';
import { SelCard } from './selcard';

// ── projections of this state ───────────────────────────────────────────────
// The Timeline group is ONE instrument shown two ways. vertical.ts reads d0/d1, log,
// lens, off and q off THIS object rather than copying them, and the shared controls
// (#btnMozart … #catRow) are bound here exactly once. So anything that WRITES that state
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
}
interface Layout {
  lanes: LaneLayout[]; H: number; G: number; Wp: number;
  sel: string | null; rels: Map<string, { w: number; kind: string }> | null; q: string;
}

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
  laneDefs(): { key: string; label: string; si: number | null; kind: 'deep' | 'curated' | 'region' }[] {
    const out: { key: string; label: string; si: number | null; kind: 'deep' | 'curated' | 'region' }[] =
      [{ key: 'CO', label: 'Deep time', si: null, kind: 'deep' }];
    for (const L of LANES) if (this.lens[L.key]) out.push({ key: L.key, label: L.label, si: L.si, kind: 'curated' });
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
    let nv0 = vc - frac * spanV, nv1 = nv0 + spanV;
    const lo = tv(YMIN), hi = tv(YMAX);
    if (nv1 > hi) { nv0 -= (nv1 - hi); nv1 = hi; }     // shift, don't squash
    if (nv0 < lo) { nv1 += (lo - nv0); nv0 = lo; if (nv1 > hi) nv1 = hi; }
    this.d0 = ty(nv0); this.d1 = ty(nv1);
  },
  levelFor(S: number) { if (S <= this.THR[5]) return 5; if (S <= this.THR[4]) return 4; if (S <= this.THR[3]) return 3; if (S <= this.THR[2]) return 2; return 1; },
  alphaFor(lvl: number, S: number, isLens: boolean) {
    const t = this.THR[lvl] * (isLens ? 2.5 : 1); if (!isFinite(t)) return 1;
    if (S <= t) return 1; if (S <= t * 1.6) return 1 - (S - t) / (t * .6); return 0;
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

  // ---- pure layout pass: filter, pack, compact, cap → per-lane {h, rows, more} ----
  // size() calls this before fitCanvas; render() paints from the SAME result, so the
  // canvas height and the painted content can never disagree.
  layout(cw: number): Layout {
    const G = 118, Wp = cw - G - 10;
    const span = this.span();
    const sel = SelStore.id;
    const rels = sel ? relOf(sel) : null;
    const q = this.q.toLowerCase();
    const ctx = this.cv.getContext('2d')!;
    const byLane = this.ensureCorpus();
    const lanes: LaneLayout[] = [];
    for (const def of this.laneDefs()) {
      const laneId = def['key'];
      const isCur = def.kind === 'curated';
      const isExp = this.expanded.has(laneId);
      const spreadCap = isExp ? 999 : this.SPREAD_CAP;
      const eventCap = isExp ? 10 : this.EVENT_CAP;
      // spreads: visible iff LOD alpha > 0.02 (lit items bypass LOD) and on screen
      const vis: LSpread[] = [];
      for (const it of (byLane.get(def.key) || [])) {
        if (this.off.has(it.cat)) continue;
        const isMatch = !!q && (it.name.toLowerCase().includes(q) || it.tags.includes(q) || it.note.toLowerCase().includes(q));
        let lodA = lit(it.id, sel, rels) ? 1 : this.alphaFor(it.lvl, span, isCur);
        if (isMatch && lodA <= 0.02) lodA = 0.6;     // a searched-for thing must be findable
        if (lodA <= 0.02) continue;
        const x0 = this.x(it.start, G, Wp), x1 = this.x(it.end, G, Wp);
        if (x1 < G - 40 || x0 > cw + 40) continue;
        vis.push({ it, row: it.row, x0, x1, lodA, isMatch });
      }
      // rows with zero visible spreads are COMPACTED OUT — order preserved
      const rowIdx = [...new Set(vis.map(v => v.row))].sort((a, b) => a - b);
      const rowMap = new Map(rowIdx.map((r, i) => [r, i] as [number, number]));
      let more = 0;
      const spreads: LSpread[] = [];
      for (const v of vis) {
        const cr = rowMap.get(v.row)!;
        // the row cap spares search matches and the selection — neither may be hidden
        if (cr >= spreadCap && !v.isMatch && v.it.id !== sel) { more++; continue; }
        spreads.push({ ...v, row: cr });
      }
      // second compaction: capped-away rows close up under any spared rows above them
      const keptRows = [...new Set(spreads.map(v => v.row))].sort((a, b) => a - b);
      const rowMap2 = new Map(keptRows.map((r, i) => [r, i] as [number, number]));
      for (const v of spreads) v.row = rowMap2.get(v.row)!;
      const ns = keptRows.length;
      // THE ZONE-CAP FOLD (fold.ts). A founding or dissolution event that
      // duplicates a spread's cap is not a second fact: "Qin unifies China, 221
      // BCE" IS the left edge of the Qin dynasty rectangle two rows above it.
      // Two marks, one fact, and the dot is the weaker of the two. So the dot
      // folds into the spread, which names it in its tooltip and its card.
      //
      // PER FRAME, and against what this lane is ACTUALLY DRAWING: zoom out
      // until the Qin's fifteen years fall below the level of detail and the dot
      // returns, because at that zoom it is the only mark carrying the fact.
      const drawn = new Set(spreads.map(v => v.it.id));
      const foldedMatch = new Set<string>();
      // events: per-frame pixel packing, today's laneEnd algorithm, end==0 only;
      // when no row is free the event is DROPPED to the overflow count.
      ctx.font = fontUI(11.5);
      const evs = EVENTS.filter(e => e[3] === laneId && !e[1] && !this.off.has(e[6])).sort((a, b) => a[0] - b[0]);
      const laneEnd = new Array(eventCap).fill(-1e18);
      const events: LEvent[] = [];
      let usedRows = 0;
      for (const ev of evs) {
        const id = evId(ev);
        const title = ev[2];
        const isMatch = !!q && (title.toLowerCase().includes(q) || ev[5].includes(q));
        const fold = FOLD[title];
        if (fold && drawn.has(fold.spread)) {
          if (isMatch) foldedMatch.add(fold.spread);   // a search for it lands on its parent
          continue;
        }
        const lodA = lit(id, sel, rels) ? 1 : this.alphaFor(ev[4], span, isCur);
        if (lodA <= 0.02) continue;
        const x0 = this.x(ev[0], G, Wp);
        if (x0 < G - 40 || x0 > cw) continue;
        const labelW = ctx.measureText(title).width;
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
        events.push({ ev, id, x0, row: lane, lodA, mode, labelW, isMatch });
      }
      if (foldedMatch.size) for (const v of spreads) if (foldedMatch.has(v.it.id)) v.isMatch = true;
      // era-row candidates, gathered from everything VISIBLE (not just what
      // survived the cap) — whether they are already drawn is decided after the
      // global trim, which is the only point at which that is finally known.
      const era = def.kind === 'region'
        ? (byLane.get(laneId) || [])
          .filter(it => it.type === 'episode')
          .map(it => vis.find(v => v.it.id === it.id))
          .filter((v): v is LSpread => !!v && this.isEraEpisode(v, span))
          .sort(eraRank)
        : [];
      lanes.push({
        key: laneId, label: def.label, si: def.si, isCur, spreads, events,
        ns, ne: usedRows, more, exp: isExp,
        isRegion: def.kind === 'region', era, eraRow: -1, eraOut: [],
        top: 0, h: 0, evTop: 0,
      });
    }
    // per-lane height; a lane with no visible content collapses to a 20px strip
    const hOf = (L: LaneLayout) => (L.ns || L.ne)
      ? 22 + L.ns * this.SP_PITCH + (L.ns && L.ne ? 6 : 0) + L.ne * this.EV_PITCH + 6
      : 20;
    // GLOBAL cap: trim the lane showing the most spread rows (round-robin on ties),
    // then event rows to 1 the same way; floor 1 spread + 1 event row — then STOP,
    // even if still over (the canvas may exceed HMAX slightly, accepted).
    const SPREAD_FLOOR = 3;                            // a lane keeps up to 3 spread rows
    let rr = 0, guard = 400;
    // A lane the reader deliberately opened is not a trim candidate. The budget
    // still governs every OTHER lane and the floor below is untouched, so the
    // canvas grows and the section scrolls exactly as it already does whenever
    // the content cannot be squeezed under HMAX.
    const noTrim = new Set<LaneLayout>(lanes.filter(L => L.exp));
    while (lanes.reduce((a, L) => a + hOf(L), 0) + 34 > this.HMAX && guard-- > 0) {
      let m = SPREAD_FLOOR;
      for (const L of lanes) if (!noTrim.has(L) && L.ns > m) m = L.ns;
      if (m > SPREAD_FLOOR) {
        const cands = lanes.filter(L => !noTrim.has(L) && L.ns === m);
        const pick = cands[(rr++) % cands.length];
        const last = pick.ns - 1;
        // a row holding a search match or the selection is spared — skip this lane
        if (pick.spreads.some(v => v.row === last && (v.isMatch || v.it.id === sel))) { noTrim.add(pick); continue; }
        pick.more += pick.spreads.filter(v => v.row === last).length;
        pick.spreads = pick.spreads.filter(v => v.row !== last);
        pick.ns = last;
        continue;
      }
      let me = 1; for (const L of lanes) if (!L.exp && L.ne > me) me = L.ne;
      if (me > 1) {
        const cands = lanes.filter(L => !L.exp && L.ne === me);
        const pick = cands[(rr++) % cands.length];
        const last = pick.ne - 1;
        pick.more += pick.events.filter(e2 => e2.row === last).length;
        pick.events = pick.events.filter(e2 => e2.row !== last);
        pick.ne = last;
        continue;
      }
      break;      // the floor (3 spread rows + 1 event row) — the canvas may exceed
                  // HMAX slightly and the section scrolls; never loop on an
                  // unsatisfiable target
    }
    // ---- THE ERA ROW (see the note above the constants) --------------------
    // After the trim, because "is it already drawn" is only finally true here.
    const clash = (c: LSpread, arr: LSpread[]) =>
      arr.filter(o => c.it.start < o.it.end && o.it.start < c.it.end);
    for (const L of lanes) {
      if (!L.isRegion || L.ns < 2 || !L.era.length) continue;
      const drawn = new Set(L.spreads.map(v => v.it.id));
      const cands = L.era.filter(v => !drawn.has(v.it.id));
      if (!cands.length) continue;
      const best = cands[0].it.lvl;                   // era is pre-sorted by level
      const victim = L.ns - 1;
      const row = L.spreads.filter(v => v.row === victim);
      // the same sparing the row cap already gives: a row holding the selection
      // or a search hit is never disturbed
      if (row.some(v => v.isMatch || v.it.id === sel)) continue;
      let keep = row.slice();
      const placed: LSpread[] = [];
      const out: string[] = [];
      for (const c of cands) {
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
    }

    let top = 0;
    for (const L of lanes) {
      L.top = top; L.h = hOf(L);
      L.evTop = L.top + 22 + L.ns * this.SP_PITCH + (L.ns && L.ne ? 6 : 0);
      top += L.h;
    }
    return { lanes, H: top + 34, G, Wp, sel, rels, q };
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

  // ---- one spread rectangle with its sharpness envelope --------------------
  // The envelope is ALPHA/EDGE only — never geometry, never height. Per-edge ramp
  // width R = min(0.5·(1−s)·W, 96): s=0.85 polity → crisp and stroked; s=0.25 era →
  // long ramps with a 25% plateau; s→0 near-triangular. All alpha is baked into the
  // gradient stops — globalAlpha stays 1, no double multiply.
  drawSpread(ctx: CanvasRenderingContext2D, x0: number, x1: number, yC: number, h: number, col: string, alpha: number, s: number) {
    const W = Math.max(x1 - x0, 2);
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

    // ---- shared time axis (bounded by construction; both projections use it) ----
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
    ctx.beginPath();
    for (const t of timeTicks(this.d0, this.d1, Wp)) {
      const x = this.x(t.y, G, Wp);
      if (x < G - 1 || x > cw - 4) continue;
      ctx.moveTo(x, 0); ctx.lineTo(x, H - 30);
      ctx.fillText(t.label, x, H - 10);
    }
    ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    const xn = this.x(2026, G, Wp);
    if (xn >= G && xn <= cw) { ctx.strokeStyle = T.accent2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xn, 0); ctx.lineTo(xn, H - 30); ctx.stroke(); ctx.setLineDash([]); }

    const bgHsl = hexHsl(T.panel); const bgL = bgHsl ? bgHsl[2] : 92;

    for (const L of lanes) {
      // band separator + header — exactly today's furniture
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(0, L.top + L.h); ctx.lineTo(cw, L.top + L.h); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = L.si === null ? T.ink2 : T.s[L.si]; ctx.beginPath(); ctx.arc(10, L.top + 13, 4, 0, 7); ctx.fill();
      ctx.fillStyle = T.ink2; ctx.font = fontUI(10.5, 600); ctx.textAlign = 'left';   // a band name is language
      ctx.fillText(L.label.toUpperCase(), 20, L.top + 17);

      // ---- SPREAD STRATUM: rows at constant pitch, rectangles with envelopes ----
      const byRow: LSpread[][] = [];
      for (const s of L.spreads) (byRow[s.row] ||= []).push(s);
      for (let r = 0; r < L.ns; r++) {
        const rowItems = (byRow[r] || []).sort((a, b) => a.x0 - b.x0);
        const yC = L.top + 22 + 12 + r * this.SP_PITCH;
        let prevEnd = -1e18;
        for (let i = 0; i < rowItems.length; i++) {
          const s = rowItems[i], it = s.it;
          const searchDim = q ? (s.isMatch ? 1 : 0.12) : 1;
          if (q && s.isMatch) hitCount++;
          const dimA = dimAlpha(it.id, sel, rels, DIM_FLOOR) * searchDim;
          const h = TIER_H[it.lvl] || 12;
          const [col, colL] = varyColor(catColor(it.cat, T), it.id);
          const fillA = clamp(0.75 * s.lodA * dimA, 0, 1);
          this.drawSpread(ctx, s.x0, s.x1, yC, h, col, fillA, it.sharpness);
          const W = Math.max(s.x1 - s.x0, 2);
          if (it.sharpness >= 0.6) {                   // the stroke is what makes "founded on a date" read
            ctx.globalAlpha = clamp(0.9 * s.lodA * dimA, 0, 1);
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
          // label: inside when it fits (sticky-left), else today's right/left/none
          const visX0 = Math.max(s.x0, G);
          ctx.font = fontUI(10.5, 600);
          const inW = ctx.measureText(it.name).width;
          let mode: 'in' | 'right' | 'left' | 'none' = 'none';
          let labelW = inW;
          if (inW + 12 <= s.x1 - visX0) mode = 'in';
          else {
            ctx.font = fontUI(11.5);
            labelW = ctx.measureText(it.name).width;
            const nextX0 = i + 1 < rowItems.length ? rowItems[i + 1].x0 : 1e18;
            if (s.x1 + 7 + labelW < Math.min(nextX0 - 4, cw - 4)) mode = 'right';
            else if (s.x0 - 9 - labelW > Math.max(G, prevEnd + 4)) mode = 'left';
          }
          if (s.lodA * dimA > 0.25) {
            if (mode === 'in') {
              const effL = bgL + (colL - bgL) * fillA;  // ink from the COMPOSITE lightness
              ctx.globalAlpha = Math.min(1, fillA + 0.2);
              ctx.fillStyle = effL > 50 ? T.ink : '#fff';
              ctx.fillText(it.name, visX0 + 6, yC + 3.5);
            } else if (mode === 'right') {
              ctx.globalAlpha = Math.min(1, s.lodA * dimA); ctx.fillStyle = T.ink;
              ctx.fillText(it.name, s.x1 + 7, yC + 4);
            } else if (mode === 'left') {
              ctx.globalAlpha = Math.min(1, s.lodA * dimA); ctx.fillStyle = T.ink;
              ctx.fillText(it.name, s.x0 - 9 - labelW, yC + 4);
            }
          }
          ctx.globalAlpha = 1;
          prevEnd = Math.max(prevEnd, s.x1 + (mode === 'right' ? 8 + labelW : 0));
          this.boxes.push({
            x: mode === 'left' ? s.x0 - 11 - labelW : s.x0 - 2,
            y: yC - h / 2 - 2,
            w: (s.x1 - s.x0) + 4 + (mode === 'right' ? 10 + labelW : mode === 'left' ? 12 + labelW : 0),
            h: h + 4, kind: 'spread', id: it.id, it, band: L.label, isMatch: s.isMatch,
          });
        }
      }

      // ---- EVENT STRATUM: strictly below the spread block (decision 4) ----
      ctx.font = fontUI(11.5);
      for (const E of L.events) {
        const title = E.ev[2];
        const searchDim = q ? (E.isMatch ? 1 : 0.12) : 1;
        if (q && E.isMatch) hitCount++;
        const a = clamp(E.lodA * dimAlpha(E.id, sel, rels, DIM_FLOOR) * searchDim, 0, 1);
        const yy = L.evTop + 8.5 + E.row * this.EV_PITCH;
        ctx.globalAlpha = a; ctx.fillStyle = catColor(E.ev[6], T);
        ctx.beginPath(); ctx.arc(E.x0, yy, 3.2, 0, 7); ctx.fill();
        if (E.id === sel) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(E.x0, yy, 7, 0, 7); ctx.stroke();
        } else if (E.isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(E.x0, yy, 7, 0, 7); ctx.stroke();
        }
        ctx.globalAlpha = a; ctx.fillStyle = T.ink;
        if (a > 0.25) {
          if (E.mode === 'right') ctx.fillText(title, E.x0 + 7, yy + 4);
          else if (E.mode === 'left') ctx.fillText(title, E.x0 - 9 - E.labelW, yy + 4);
        }
        ctx.globalAlpha = 1;
        this.boxes.push({
          x: E.mode === 'left' ? E.x0 - 11 - E.labelW : E.x0 - 8, y: yy - 9,
          w: 16 + (E.mode === 'none' ? 4 : E.labelW), h: 18, kind: 'ev', id: E.id, ev: E.ev,
          band: L.label, isMatch: E.isMatch,
        });
      }

      // ---- the row-cap affordance: it OPENS the lane, it does not zoom ----
      if (L.more > 0 || L.exp) {
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
    // So the set year is a short stub rising off the axis with its year above
    // it, and the hover crosshair is the ONLY full-height vertical on the
    // canvas. Red stub = the year you set. Crosshair = where your cursor is.
    const xg = this.x(TimeStore.year, G, Wp);
    if (xg >= G && xg <= cw - 4) {
      const base = H - 30, tip = base - 34;
      const gr = ctx.createLinearGradient(0, base, 0, tip);
      gr.addColorStop(0, T.accent); gr.addColorStop(1, withA(T.accent, 0));
      ctx.strokeStyle = gr; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xg, base); ctx.lineTo(xg, tip); ctx.stroke();
      yearPill(ctx, T, xg, tip - 20, fmtBig(TimeStore.year));
    }

    // hover crosshair + year readout (the hover pill keeps the bottom edge)
    if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
      const yr = this.ix(this.hoverX, G, Wp);
      ctx.strokeStyle = T.accent; ctx.globalAlpha = .55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.hoverX, 0); ctx.lineTo(this.hoverX, H - 30); ctx.stroke();
      ctx.globalAlpha = 1;
      yearPill(ctx, T, this.hoverX, H - 26, fmtBig(yr));
    }
    const baseL = this.levelFor(this.span());
    $('#zoomReadout')!.textContent = `showing importance ≤ ${baseL} of 5 · span ${fmtSpan(this.span())}`;
    $('#searchCnt')!.textContent = q ? `${hitCount} hits` : '';
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
    this.animTo(y - s / 2, y + s / 2);
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
    this.animTo(Math.max(a, YMIN), Math.min(b, YMAX), () => {
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
    // his own life events, plus the music row so his lifespan sits beside Bach's and Beethoven's
    $('#btnMozart')!.addEventListener('click', () => {
      this.lens.MZ = true; this.lens.MU = true;
      this.syncChips();
      this.animTo(1735, 1835, () => this.reveal('MZ'));
    });
    $('#btn1776z')!.addEventListener('click', () => { this.animTo(1746, 1806); TimeStore.set(1776, 'ui'); });
    // the deep-time MODE is dead; the button is now a preset that animates the one
    // continuous scale out to the whole of time.
    $('#btnDeep')!.addEventListener('click', () => { this.animTo(-13.9e9, 2026); });
    $('#btnResetZ')!.addEventListener('click', () => { this.animTo(-3000, 2026); });
    $('#searchBox')!.addEventListener('input', (e: any) => { this.q = e.target.value.trim(); this.paint(); });
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
        let nv0 = drag.v0 - dv, nv1 = drag.v1 - dv;
        const lo = tv(YMIN), hi = tv(YMAX);
        if (nv1 > hi) { nv0 -= (nv1 - hi); nv1 = hi; }
        if (nv0 < lo) { nv1 += (lo - nv0); nv0 = lo; if (nv1 > hi) nv1 = hi; }
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
      if (my > H - 30) {                               // axis strip: set the global moment
        TimeStore.set(Math.round(this.ix(mx, G, Wp)), 'tl');
        return;
      }
      const b = this.hitAt(mx, my);
      if (b && b.kind === 'more') {                    // open (or close) the lane — never zoom
        if (b.lane) {
          if (this.expanded.has(b.lane)) this.expanded.delete(b.lane); else this.expanded.add(b.lane);
        }
        hideTip();
        this.paint();
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
        this.paint();
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
  catAll() { this.off.clear(); this.catPrevOff = null; this.syncCatChips(); this.paint(); },
  catNone() {
    if (this.off.size !== CATS.length) this.catPrevOff = new Set(this.off);
    this.off = new Set(CATS.map(c => c.id));
    this.syncCatChips(); this.paint();
  },
  catToggle(id: string) {
    if (this.off.has(id)) this.off.delete(id); else this.off.add(id);
    this.syncCatChips(); this.paint();
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
    this.syncCatChips(); this.paint();
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
