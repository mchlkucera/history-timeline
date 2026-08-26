/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑧ CONNECTIONS =================
// THE SAME INSTRUMENT AS ② (render/timeline.ts), POINTED AT A DIFFERENT QUESTION.
//
// It used to draw its own way — four lanes of swelling/tapering ribbons borrowed from
// ③ Flow, with a second "hollow dashed" vocabulary for repeats, a lane-normalisation
// toggle and a row of demo buttons. A stranger looking at ② and ⑧ side by side would
// not have said they were the same product. The founder's line was the whole brief:
// "The Connections should have same rendering as timeline."
//
// So the mark vocabulary here is now ②'s, to the pixel:
//   • anything with DURATION  — a spread, a state, a belief stream, a life, an episode —
//     is a rounded rectangle whose height is the importance ladder (TIER_H) and whose
//     edges carry the same sharpness envelope. It is drawn by TL.drawSpread itself,
//     imported, not re-implemented: one function, two views.
//   • a MOMENT is a dot in its own stratum below the rectangles, exactly as in ②.
//   • colour is the `--tl-cat-*` data system through catColor + varyColor,
//     selection is a T.ink ring, a search hit is a T.accent2 ring, the axis reads
//     along the TOP in mono, and the cursor is one minium hairline with a year pill.
// The zoom is ②'s too: the piecewise C1 v-space (shared tv/ty), the same clampV, so
// the wheel and the pinch feel identical in both views.
//
// WHAT IS STILL ONLY TRUE HERE, and the only reason the view exists:
//   • the lanes are QUERIES, not curated bands — an item lands in its best-scoring one;
//   • relationships are explicit and weighted (data/relations/SCHEMA.md), so clicking
//     anything re-grades the whole view by link weight and draws a faint thread to each
//     related thing at the YEAR the relation is about.
//
// Everything else — the click, the card, the highlight, the search, the axis — is the
// app's, not this view's.

import {
  $, BELIEFS, EVENTS, POLITIES, SelStore, TimeStore, catColor, clamp, clearTextCache, ellipsize, fitCanvas,
  fmtBig, fmtSpan, fmtY, fontMono, fontUI, hexHsl, hideTip, inkFor, reduceMotion, repaintOnFonts,
  sharpnessOf, showTip, textW, timeTicks, tokens, tv, ty, varyColor, clampV, yearPill,
} from './shared';
import {
  bindPinch, slopFor, TAP_PAD, armSafariGestureGuard, refuseSafariGestures,
} from './gesture';
import { SelCard } from './selcard';
import { TL } from './timeline';
import { polityLvl } from './layers';
import {
  REL, SPREADCAT, esc, kindColor, lit as litOf, lvlOfWeight, peakOf, regionOf,
  relIndex, relOf as relOfShared, dimAlpha, renderRelatedPanel,
} from './relations';
// the shared loader moved to relations.ts; re-exported so Lab.tsx's import line survives
export { loadRelations, setRelations } from './relations';
export type { Spread, Link, Relations } from './relations';

// ---------- the item model ----------
type NKind = 'spread' | 'polity' | 'belief' | 'event' | 'entity';
interface Item {
  id: string; kind: NKind; name: string; start: number; end: number;
  cat: string; region: string | null; note: string;
  dur: boolean;                          // has extent -> rectangle; otherwise a dot
  sharp: number;                         // ②'s sharpness envelope, same defaults
  type?: string;                         // moment | episode | life | era | zone | polity | spread
  lvl: number;                           // importance 1..5 — the same ladder ② uses
  linked: boolean;                       // appears in links.json
  lanes: number[];                       // every lane whose query it answers
  home: number;                          // the best-scoring one — the only place it is drawn
}

// ---------- lanes are QUERIES ----------
// Each lane scores an item 0-1 and the item is drawn in its best-scoring lane, ONCE.
// (The old build drew it again, hollow and dashed, in every other lane it matched. That
// was a second shape grammar nothing else in the app speaks, it needed its own legend
// row, and a lane of European states became a hairball of echoes. The fact survives
// where a set-membership fact belongs: in words, in the Related panel.)
interface Lane { id: string; name: string; si: number; score: (n: Item) => number }
const LANES: Lane[] = [
  {
    id: 'eu', name: 'Europe', si: 0,
    // a state IS its territory, so a European polity belongs to the region lane first
    score: n => n.region === 'EU' ? (n.kind === 'polity' ? 1 : 0.6) : 0,
  },
  {
    id: 'sci', name: 'Science & technology', si: 2,
    score: n => n.cat === 'sci' ? 1 : n.cat === 'reach' ? 0.45 : 0,
  },
  {
    id: 'belief', name: 'Ideas & belief', si: 6,
    score: n => n.cat === 'belief' ? 1 : n.cat === 'art' ? 0.5 : 0,
  },
  {
    id: 'power', name: 'Power & economy', si: 3,
    score: n => n.cat === 'society' ? 0.95
      : n.cat === 'power' ? (n.kind === 'polity' && n.region === 'EU' ? 0.4 : 0.9)
        : n.cat === 'war' ? 0.55 : 0,
  },
];

// ---------- level of detail, ported verbatim from ② ----------
// The visible span decides which importance levels render, and levels fade rather than
// pop. Same thresholds, same smoothstep ramp, so the two views behave identically.
const THR: Record<number, number> = { 1: Infinity, 2: 40000, 3: 2400, 4: 650, 5: 170 };
const levelFor = (S: number) => (S <= THR[5] ? 5 : S <= THR[4] ? 4 : S <= THR[3] ? 3 : S <= THR[2] ? 2 : 1);
const alphaFor = (lvl: number, S: number) => {
  const t = THR[lvl]; if (!isFinite(t)) return 1;
  if (S <= t) return 1;
  const p = (S - t) / (t * 0.6);
  if (p >= 1) return 0;
  return 1 - p * p * (3 - 2 * p);
};

// ---------- ②'s constants, so the two canvases measure the same ----------
// TIER_H, SP_PITCH, EV_PITCH, AXIS_TOP and DIM_FLOOR are module-private in timeline.ts.
// They are repeated here rather than exported from it (that file is not mine to edit);
// if the ladder is ever retuned there, retune it here in the same commit.
const TIER_H: Record<number, number> = { 1: 20, 2: 17, 3: 14, 4: 12, 5: 10 };
const SP_PITCH = 24, EV_PITCH = 17;
const AXIS_TOP = 22;                 // the mono year scale reads along the TOP, as in ②
const BOT = 30;                      // the strip the cursor pill sits on
const DIM_FLOOR = 0.42;              // an unrelated thing is context, never erased
const HEAD_H = 20;                   // the lane's dot + name
const GAP = 6;                       // between the rectangles and the event stratum
const VMAX = tv(2100) - tv(-10000);  // this corpus has no deep time; the clamp says so
const F_IN = fontUI(10.5, 600);      // ②'s _fIn / _fUi at pitch 1
const F_UI = fontUI(11.5);

interface Hit {
  id: string; li: number; kind: 'sp' | 'ev';
  x0: number; x1: number; y: number; h: number;      // the MARK
  bx: number; by: number; bw: number; bh: number;    // the click box, label included
}
interface Placed {
  n: Item; row: number; x0: number; x1: number; lodA: number; isMatch: boolean;
  labelW: number;
  nextX: number;                     // the next mark IN ITS OWN ROW, so a label knows its room
}

export const Conn = {
  cv: null as unknown as HTMLCanvasElement,
  d0: 1350, d1: 2026,
  nodes: new Map<string, Item>(),
  sel: null as string | null,
  hoverX: null as number | null,
  q: '',
  unresolved: 0,
  lanes: [] as any[],
  hits: [] as Hit[],
  dirty: true, lastW: 0,
  // the vertical budget, decided by the stage and nothing else — see measure()
  H: 824, laneH: 193, spRows: 4, evRows: 3,

  // ---------- build the universe ----------
  build() {
    this.nodes = new Map(); this.unresolved = 0; this._linkPairs = 0;
    const add = (n: Item) => { if (!this.nodes.has(n.id)) this.nodes.set(n.id, n); return this.nodes.get(n.id)!; };
    const base = { linked: false, lanes: [] as number[], home: -1 };

    // every spread is in, always — they are the spine of this view
    for (const s of REL.spreads) {
      const fp = s.footprint && s.footprint.length ? s.footprint[0] : null;
      add({
        ...base,
        id: 'spread:' + s.id, kind: 'spread', name: s.name, start: s.start, end: s.end,
        cat: SPREADCAT[s.kind] || 'society', region: fp ? regionOf(fp.lat, fp.lon) : null,
        note: s.note || '', dur: s.end > s.start, sharp: s.sharpness ?? 0.25, type: 'spread',
        lvl: lvlOfWeight(peakOf(s.weight)),
      });
    }

    // resolution indexes — the join keys of SCHEMA.md
    const byTitle = new Map<string, any[]>(); for (const e of EVENTS) if (!byTitle.has(e[2])) byTitle.set(e[2], e);
    const byPol = new Map<string, any>(); for (const p of POLITIES) byPol.set(p.id, p);
    const byBelief = new Map<string, any>();
    for (const sys of (BELIEFS.systems || [])) for (const st of (sys.streams || [])) byBelief.set(st.id, st);

    const evNode = (e: any[], id: string, kind: NKind): Item => {
      const pl = e[8];
      const band = e[3];
      const region = pl ? regionOf(pl[0], pl[1])
        : (band === 'EU' || band === 'ME' || band === 'AS' || band === 'AM') ? band
          : band === 'CO' ? null : 'EU';       // MU / SC / MZ are the European lens bands
      const end = e[1] || e[0];
      return {
        ...base,
        id, kind, name: e[2], start: e[0], end, cat: e[6] || 'power',
        region, note: e[5] || '', dur: end > e[0], sharp: sharpnessOf(e[7], e[9]),
        type: e[7] || 'moment', lvl: e[4] || 3,
      };
    };
    // ②'s own numbers for a polity: sharpness 0.85 (dated ends, stroked) and polityLvl,
    // so the Roman Empire is the same height and the same crispness in both views.
    const polNode = (p: any): Item => ({
      ...base,
      id: 'polity:' + p.id, kind: 'polity', name: p.name, start: p.start, end: p.end,
      cat: 'power', region: p.region || null, note: p.note || '',
      dur: p.end > p.start, sharp: 0.85, type: 'polity', lvl: polityLvl(p),
    });
    const belNode = (b: any): Item => ({
      ...base,
      id: 'belief:' + b.id, kind: 'belief', name: b.name, start: b.start, end: b.end,
      cat: 'belief', region: null, note: b.note || '',
      dur: b.end > b.start, sharp: 0.25, type: 'spread', lvl: lvlOfWeight(peakOf(b.weight)),
    });

    const resolve = (id: string): Item | null => {
      if (this.nodes.has(id)) return this.nodes.get(id)!;
      const i = id.indexOf(':'); if (i < 0) return null;
      const pre = id.slice(0, i), key = id.slice(i + 1);
      if (pre === 'event' || pre === 'entity') {
        const e = byTitle.get(key); if (!e) return null;
        return add(evNode(e, id, e[7] === 'life' ? 'entity' : 'event'));
      }
      if (pre === 'polity') { const p = byPol.get(key); return p ? add(polNode(p)) : null; }
      if (pre === 'belief') { const b = byBelief.get(key); return b ? add(belNode(b)) : null; }
      return null;                                   // spread ids are already in
    };

    // links — the WEIGHTS live in the shared relIndex (relations.ts); this loop survives
    // for its side-effects: resolve() adds every linked node to the corpus, and the
    // unresolved count is this view's honesty line.
    const seen = new Set<string>();
    for (const L of REL.links) {
      if (!L || !L.a || !L.b || L.a === L.b) continue;
      const k = L.a < L.b ? L.a + '|' + L.b : L.b + '|' + L.a;
      if (seen.has(k)) continue; seen.add(k);
      const A = resolve(L.a), B = resolve(L.b);
      if (!A || !B) { this.unresolved++; continue; }
      A.linked = B.linked = true;
      this._linkPairs++;
    }

    // context budget — level of detail governs what is drawn, so the corpus can be
    // DEEPER than the screen: everything below the current level is simply held back
    // until you zoom in.
    POLITIES.slice().sort((a, b) => peakOf(b.weight) - peakOf(a.weight)).slice(0, 60).forEach(p => add(polNode(p)));
    for (const sys of (BELIEFS.systems || [])) for (const st of (sys.streams || [])) add(belNode(st));
    EVENTS.filter(e => (e[4] || 5) <= 4 && e[3] !== 'CO' && e[0] > -4000)
      .slice(0, 420).forEach(e => add(evNode(e, (e[7] === 'life' ? 'entity:' : 'event:') + e[2], e[7] === 'life' ? 'entity' : 'event')));

    // lane assignment: the best score is where it lives, and it lives in one place
    for (const n of this.nodes.values()) {
      const scored = LANES.map((l, i) => [i, l.score(n)] as [number, number])
        .filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
      n.lanes = scored.map(x => x[0]);
      n.home = scored.length ? scored[0][0] : -1;
    }
    // default span: everything the spreads cover, with a little air
    const ss = REL.spreads.filter(s => isFinite(s.start));
    if (ss.length) {
      const a = Math.min(...ss.map(s => s.start)), b = Math.max(...ss.map(s => s.end));
      if (b - a > 3000) { this.d1 = b; this.d0 = b - 1100; }   // open where the corpus is dense
      else { const pad = Math.max(40, (b - a) * 0.08); this.d0 = a - pad; this.d1 = b + pad; }
    }
    this.dirty = true;
  },

  /**
   * THE VERTICAL BUDGET IS THE STAGE'S, NOT THIS FILE'S.
   *
   * It used to be a fixed 826px against a 611px stage, so the fourth lane — Power &
   * economy, a quarter of the view — was simply below the bottom of a box that does
   * not scroll. ② solves that with a scroller and a rail; this view has neither, and
   * inventing one here would be exactly the "random control" the brief forbids. So the
   * canvas FITS: four lanes share whatever the stage gives, and the rows inside a lane
   * are however many fit at ②'s pitches. Nothing here reads the pointer — this moves on
   * a window resize and on nothing else.
   */
  measure() {
    const box = this.cv && this.cv.parentElement;
    const stage = box && box.parentElement;
    const avail = stage ? stage.clientHeight : 0;
    if (!avail) return false;                       // hidden tab: keep the last budget
    const H = clamp(avail, 360, 1100);
    const laneH = (H - AXIS_TOP - BOT) / LANES.length;
    const budget = laneH - HEAD_H - GAP - 12;       // 12px of air above the separator
    const spRows = clamp(Math.round(budget * 0.62 / SP_PITCH), 1, 6);
    const evRows = clamp(Math.round(budget * 0.38 / EV_PITCH), 1, 4);
    const changed = spRows !== this.spRows || evRows !== this.evRows || Math.abs(H - this.H) > 0.5;
    this.H = H; this.laneH = laneH; this.spRows = spRows; this.evRows = evRows;
    if (changed) this.dirty = true;
    return changed;
  },

  // ---------- geometry: ②'s piecewise screen mapping, verbatim ----------
  height() { return this.H; },
  span() { return this.d1 - this.d0; },
  x(y: number, G: number, Wp: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1);
    return G + (tv(y) - v0) / ((v1 - v0) || 1) * Wp;
  },
  ix(x: number, G: number, Wp: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1);
    return ty(v0 + (x - G) / Wp * (v1 - v0));
  },
  /** Zoom about an anchor year by factor f, in v-space — ②'s zoomBy, same invariant. */
  zoomBy(anchorYear: number, f: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1), vc = tv(anchorYear);
    const frac = (vc - v0) / ((v1 - v0) || 1);
    const spanV = clamp((v1 - v0) * f, 8, VMAX);
    const [nv0, nv1] = clampV(vc - frac * spanV, vc - frac * spanV + spanV);
    this.d0 = ty(nv0); this.d1 = ty(nv1);
    this.dirty = true;
  },
  matches(n: Item) {
    return !!this.q && (n.name.toLowerCase().includes(this.q) || n.note.toLowerCase().includes(this.q));
  },

  // ---------- layout: interval packing, exactly ②'s idea ----------
  // Biggest and most important first into the first row that has room; anything that
  // will not fit is DROPPED rather than stacked on a neighbour. The packing reads only
  // the zoom window and the level of detail — never the selection, never the hover — so
  // clicking something cannot move the picture underneath the click.
  layout(cw: number, ctx: CanvasRenderingContext2D) {
    const G = 12, Wp = cw - G - 12;
    const S = this.span();
    this.lanes = [];
    for (let li = 0; li < LANES.length; li++) {
      const lane = LANES[li];
      const top = AXIS_TOP + li * this.laneH;
      const spreads: Placed[] = [], events: Placed[] = [];
      const cand: { n: Item; x0: number; x1: number; lodA: number }[] = [];
      for (const n of this.nodes.values()) {
        if (n.home !== li) continue;
        if (n.end < this.d0 || n.start > this.d1) continue;
        // a link endpoint keeps a hairline's worth of presence below the current level:
        // selecting a thing must never be able to make one of its own relations vanish,
        // and the layout has to be identical before and after the click that did it.
        const lodA = Math.max(alphaFor(n.lvl, S), n.linked ? 0.12 : 0);
        if (lodA <= 0.02) continue;
        const x0 = this.x(n.start, G, Wp), x1 = this.x(n.end, G, Wp);
        if (x1 < -40 || x0 > cw + 40) continue;
        cand.push({ n, x0, x1, lodA });
      }
      // rectangles: importance first, then the longest — the two things a reader scans
      const dur = cand.filter(c => c.n.dur).sort((a, b) =>
        a.n.lvl - b.n.lvl || (b.x1 - b.x0) - (a.x1 - a.x0) || a.x0 - b.x0);
      const rowEnd = new Array(this.spRows).fill(-1e9);
      for (const c of dur) {
        const r = rowEnd.findIndex(e => c.x0 > e + 4);
        if (r < 0) continue;                       // an honest omission beats a pile-up
        rowEnd[r] = Math.max(c.x1, c.x0 + 2);
        spreads.push({
          n: c.n, row: r, x0: c.x0, x1: c.x1, lodA: c.lodA, isMatch: this.matches(c.n),
          labelW: textW(ctx, c.n.name, F_UI), nextX: 1e18,
        });
      }
      // moments: left to right, and a dot RESERVES THE ROOM ITS NAME NEEDS. Packing on
      // the dot alone put "Divine Comedy" straight through "East India Company
      // chartered" — two marks 30px apart, two labels 120px wide.
      const pts = cand.filter(c => !c.n.dur).sort((a, b) => a.x0 - b.x0 || a.n.lvl - b.n.lvl);
      const evEnd = new Array(this.evRows).fill(-1e9);
      for (const c of pts) {
        const lw = textW(ctx, c.n.name, F_UI);
        const r = evEnd.findIndex(e => c.x0 > e + 6);
        if (r < 0) continue;
        evEnd[r] = c.x0 + 7 + lw;
        events.push({
          n: c.n, row: r, x0: c.x0, x1: c.x0, lodA: c.lodA, isMatch: this.matches(c.n),
          labelW: lw, nextX: 1e18,
        });
      }
      // …and every mark is told who its neighbours in its own row are, so a label can
      // ask "is there room to my right" instead of only "am I on the canvas".
      for (const [arr, rows] of [[spreads, this.spRows], [events, this.evRows]] as const) {
        for (let r = 0; r < rows; r++) {
          const row = (arr as Placed[]).filter(p => p.row === r).sort((a, b) => a.x0 - b.x0);
          for (let i = 0; i < row.length; i++) {
            row[i].nextX = i + 1 < row.length ? row[i + 1].x0 : 1e18;
          }
        }
        // …and drawn left to right within each row, so the paint can carry a running
        // "how far has this row been written to" and a left-flipped label can ask it.
        (arr as Placed[]).sort((a, b) => a.row - b.row || a.x0 - b.x0);
      }
      this.lanes.push({ lane, li, top, spreads, events, G, Wp });
    }
    this.lastW = cw; this.dirty = false;
  },

  // ---------- the graded dimming: the shared implementations (relations.ts) ----------
  _linkPairs: 0,
  relsOf(id: string) { return relIndex.get(id) || []; },
  relOf(id: string): Map<string, { w: number; kind: string }> { return relOfShared(id); },

  /** Where an id is drawn right now, or null if it is not on the canvas. */
  hitOf(id: string): Hit | null {
    for (const h of this.hits) if (h.id === id) return h;
    return null;
  },
  /** Where a given YEAR falls on a mark: along a rectangle, or the dot itself. */
  pointAt(id: string, year: number): { x: number; y: number } | null {
    const h = this.hitOf(id); if (!h) return null;
    if (h.kind !== 'sp') return { x: h.x0, y: h.y };
    const G = 12, Wp = this.cv.clientWidth - G - 12;
    return { x: clamp(this.x(clamp(year, this.d0 - 1e9, this.d1 + 1e9), G, Wp), h.x0, h.x1), y: h.y };
  },
  /**
   * WHEN is a relation? A moment is its own date. Something that BEGINS inside the
   * shared span enters at its start. Something already there is dated by the start of
   * the overlap. Nothing is dated by "the middle of the picture", which is what made
   * every thread converge on one point and read as a spider.
   */
  momentOf(oid: string, sn: Item): { x: number; y: number; year: number } | null {
    const o = this.nodes.get(oid); if (!o) return null;
    const lo = Math.max(o.start, sn.start), hi = Math.min(o.end, sn.end);
    const year = hi < lo ? (o.start > sn.end ? o.start : o.end)
      : (o.start >= lo && o.start <= hi) ? o.start : lo;
    const p = this.pointAt(oid, year); if (!p) return null;
    return { x: p.x, y: p.y, year };
  },

  // ---------- paint ----------
  render() {
    if (!this.cv) return;
    const cw0 = this.cv.clientWidth || (this.cv.parentElement ? this.cv.parentElement.clientWidth : 0);
    if (!cw0) return;
    this.measure();                       // the stage decides the height, before anything is sized
    const H = this.H;
    const d = fitCanvas(this.cv, H); if (!d) return;
    const { cw, ctx } = d; const T = tokens();
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    if (!this.nodes.size) {
      ctx.fillStyle = T.ink3; ctx.font = fontUI(13);
      ctx.fillText('No relations data loaded — run npm run data.', 20, H / 2); return;
    }
    if (this.dirty || cw !== this.lastW) this.layout(cw, ctx);
    const G = 12, Wp = cw - G - 12;
    const rels = this.sel ? this.relOf(this.sel) : null;
    const lit = (id: string) => litOf(id, this.sel, rels);
    this.hits = [];
    const bgHsl = hexHsl(T.panel); const isLight = (bgHsl ? bgHsl[2] : 92) > 50;
    let hitCount = 0;

    // ---- the shared time axis: THE SCALE IS A MASTHEAD, exactly as in ② --------
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';
    ctx.beginPath();
    for (const t of timeTicks(this.d0, this.d1, Wp)) {
      const x = this.x(t.y, G, Wp);
      if (x < G - 1 || x > cw - 4) continue;
      ctx.moveTo(x, AXIS_TOP); ctx.lineTo(x, H - BOT);
      const tw = ctx.measureText(t.label).width;
      if (x - tw / 2 >= 2 && x + tw / 2 <= cw - 4) ctx.fillText(t.label, x, AXIS_TOP - 7);
    }
    ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(0, AXIS_TOP); ctx.lineTo(cw, AXIS_TOP); ctx.stroke(); ctx.globalAlpha = 1;
    const xn = this.x(2026, G, Wp);
    if (xn >= G && xn <= cw) {
      ctx.strokeStyle = T.accent2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(xn, AXIS_TOP); ctx.lineTo(xn, H - BOT); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.textAlign = 'left';                 // the tick loop leaves it 'center'

    for (const L of this.lanes) {
      // ---- lane furniture: ②'s band furniture, at ②'s coordinates ----
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath();
      ctx.moveTo(0, Math.round(L.top + this.laneH) - .5); ctx.lineTo(cw, Math.round(L.top + this.laneH) - .5);
      ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = T.s[L.lane.si];
      ctx.beginPath(); ctx.arc(10, L.top + 13, 4, 0, 7); ctx.fill();
      ctx.fillStyle = T.ink2; ctx.font = fontUI(10.5, 600); ctx.textAlign = 'left';
      ctx.fillText(L.lane.name.toUpperCase(), 20, L.top + 17);

      // ---- rectangles: everything with duration --------------------------------
      const spTop = L.top + HEAD_H;
      // how far each row has been WRITTEN TO — a label flipped to the left has to
      // clear the last one drawn, not merely the last mark drawn. ②'s `prevEnd`.
      const spPrev = new Array(this.spRows).fill(-1e18);
      for (const s of L.spreads as Placed[]) {
        const n = s.n;
        const isSel = n.id === this.sel;
        const lodA = lit(n.id) ? 1 : s.lodA;
        const searchDim = this.q ? (s.isMatch ? 1 : 0.12) : 1;
        if (this.q && s.isMatch) hitCount++;
        const a = clamp(lodA * dimAlpha(n.id, this.sel, rels, DIM_FLOOR) * searchDim, 0, 1);
        if (a <= 0.02) continue;
        const yC = spTop + s.row * SP_PITCH + SP_PITCH / 2;
        const h = TIER_H[n.lvl] || 12;
        const [col, , edge] = varyColor(catColor(n.cat, T), n.id, isLight);
        const W = Math.max(s.x1 - s.x0, 2);
        TL.drawSpread(ctx, s.x0, s.x1, yC, h, col, a, n.sharp, W);
        if (n.sharp >= 0.6) {                  // the stroke is what makes "dated ends" read
          ctx.globalAlpha = clamp(0.9 * a, 0, 1); ctx.strokeStyle = edge; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(s.x0, yC - h / 2, W, h, 3); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (isSel) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.roundRect(s.x0 - 1, yC - h / 2 - 1, W + 2, h + 2, 4); ctx.stroke();
        } else if (s.isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.roundRect(s.x0 - 1, yC - h / 2 - 1, W + 2, h + 2, 4); ctx.stroke();
        }
        // ---- the label, and ②'s truncation rule ----
        const visX0 = Math.max(s.x0, G);
        ctx.font = F_IN;
        const inText = ellipsize(ctx, n.name, (s.x1 - visX0) - 12, F_IN, 3);
        const labelW = s.labelW;
        let mode: 'in' | 'right' | 'left' | 'none' = 'none';
        if (inText) mode = 'in';
        else if (s.x1 + 7 + labelW < Math.min(s.nextX - 4, cw - 4)) mode = 'right';
        else if (s.x0 - 9 - labelW > Math.max(G, spPrev[s.row] + 4)) mode = 'left';
        spPrev[s.row] = Math.max(spPrev[s.row], s.x1 + (mode === 'right' ? 8 + labelW : 2));
        const textA = clamp((a - 0.10) / 0.15, 0, 1);
        if (textA > 0.02) {
          if (mode === 'in') {
            ctx.globalAlpha = Math.min(1, a + 0.2) * textA;
            const inkX0 = visX0 + 6, inkX1 = inkX0 + textW(ctx, inText, F_IN);
            ctx.fillStyle = inkFor(col, T.panel,
              TL.spreadAlphaAt(inkX0, s.x0, W, n.sharp, a),
              TL.spreadAlphaAt(inkX1, s.x0, W, n.sharp, a), T.ink, T.panel);
            ctx.fillText(inText, visX0 + 6, yC + 3.5);
          } else if (mode !== 'none') {
            ctx.font = F_UI; ctx.globalAlpha = textA; ctx.fillStyle = T.ink;
            ctx.fillText(n.name, mode === 'right' ? s.x1 + 7 : s.x0 - 9 - labelW, yC + 4);
          }
        }
        ctx.globalAlpha = 1;
        this.hits.push({
          id: n.id, li: L.li, kind: 'sp', x0: s.x0, x1: s.x1, y: yC, h,
          bx: mode === 'left' ? s.x0 - 11 - labelW : s.x0 - 2,
          by: yC - SP_PITCH / 2, bh: SP_PITCH,
          bw: (mode === 'left' ? 13 + labelW : 4) + W + (mode === 'right' ? 8 + labelW : 0),
        });
      }

      // ---- the event stratum: dots, strictly below the rectangles ---------------
      const evTop = L.top + HEAD_H + this.spRows * SP_PITCH + GAP;
      ctx.font = F_UI;
      const evPrev = new Array(this.evRows).fill(-1e18);
      const evs = L.events as Placed[];
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i], n = e.n;
        const isSel = n.id === this.sel;
        const lodA = lit(n.id) ? 1 : e.lodA;
        const searchDim = this.q ? (e.isMatch ? 1 : 0.12) : 1;
        if (this.q && e.isMatch) hitCount++;
        const a = clamp(lodA * dimAlpha(n.id, this.sel, rels, DIM_FLOOR) * searchDim, 0, 1);
        if (a <= 0.02) continue;
        const yy = evTop + e.row * EV_PITCH + EV_PITCH / 2;
        ctx.globalAlpha = a; ctx.fillStyle = catColor(n.cat, T);
        ctx.beginPath(); ctx.arc(e.x0, yy, 3.2, 0, 7); ctx.fill();
        if (isSel) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(e.x0, yy, 7, 0, 7); ctx.stroke();
        } else if (e.isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(e.x0, yy, 7, 0, 7); ctx.stroke();
        }
        // the label goes right when the next dot in this row leaves room, else left
        const labelW = e.labelW;
        const mode: 'right' | 'left' | 'none' = e.x0 + 7 + labelW < Math.min(e.nextX - 6, cw - 4) ? 'right'
          : e.x0 - 9 - labelW > Math.max(G, evPrev[e.row] + 4) ? 'left' : 'none';
        evPrev[e.row] = Math.max(evPrev[e.row], e.x0 + (mode === 'right' ? 7 + labelW : 4));
        const textA = clamp((a - 0.10) / 0.15, 0, 1);
        if (textA > 0.02 && mode !== 'none') {
          ctx.globalAlpha = textA; ctx.fillStyle = T.ink;
          ctx.fillText(n.name, mode === 'right' ? e.x0 + 7 : e.x0 - 9 - labelW, yy + 4);
        }
        ctx.globalAlpha = 1;
        this.hits.push({
          id: n.id, li: L.li, kind: 'ev', x0: e.x0, x1: e.x0, y: yy, h: 6.4,
          bx: mode === 'left' ? e.x0 - 11 - labelW : e.x0 - 8,
          by: yy - EV_PITCH / 2, bh: EV_PITCH,
          bw: 16 + (mode === 'none' ? 4 : labelW),
        });
      }
    }

    // ---- threads: the faintest tie that still resolves when you look for it ----
    // Each thread leaves the selection at the YEAR the relation is about and lands on
    // the related mark at that same moment, so it carries information instead of
    // radiating from one anchor as a spider. Weight drives opacity hard: w=0.3 is a
    // whisper you find only by looking, w=1.0 is plainly drawn. The ranking is in the
    // panel and the card; the canvas only has to hint that a tie exists.
    // THE SELECTION IS GLOBAL AND THIS CORPUS IS NOT — SelStore can hold an id this
    // view has no node for, which is fine: there is simply nothing to draw.
    const sn = this.sel ? this.nodes.get(this.sel) : null;
    if (this.sel && rels && sn) {
      for (const [oid, r] of rels) {
        if (r.w < 0.3) continue;                            // only the strong relations
        const dst = this.momentOf(oid, sn); if (!dst) continue;
        const src = this.pointAt(this.sel, dst.year); if (!src) continue;
        const a = 0.022 + 0.30 * r.w * r.w * r.w;
        ctx.globalAlpha = a; ctx.strokeStyle = kindColor(r.kind, T);
        ctx.lineWidth = 0.5 + 0.8 * r.w * r.w;
        ctx.beginPath(); ctx.moveTo(src.x, src.y);
        const my = (src.y + dst.y) / 2;
        ctx.bezierCurveTo(src.x, my, dst.x, my, dst.x, dst.y); ctx.stroke();
        ctx.globalAlpha = Math.min(0.55, a * 2.1); ctx.fillStyle = kindColor(r.kind, T);
        ctx.beginPath(); ctx.arc(dst.x, dst.y, 0.9 + 1.4 * r.w * r.w, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ---- the cursor paints LAST, over everything, exactly as in ② -------------
    if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
      const hx = Math.round(this.hoverX) + .5;
      ctx.globalAlpha = .55; ctx.strokeStyle = T.panel; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx, AXIS_TOP); ctx.lineTo(hx, H - BOT); ctx.stroke();
      ctx.globalAlpha = .9; ctx.strokeStyle = T.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, AXIS_TOP); ctx.lineTo(hx, H - BOT); ctx.stroke();
      ctx.globalAlpha = 1;
      yearPill(ctx, T, this.hoverX, H - 26, fmtBig(this.ix(this.hoverX, G, Wp)));
    }
    const sc = $('#searchCnt'); if (sc && this.q) sc.textContent = `${hitCount} hits`;
    this.caption();
    SelCard.reanchor();
  },

  /** `pad` widens every target by the same margin — 0 for a cursor, TAP_PAD for a
   *  fingertip, which cannot be aimed at a 6px dot. Dots win over rectangles: the
   *  contained thing is the smaller target. */
  at(mx: number, my: number, pad = 0): Hit | null {
    for (const k of ['ev', 'sp'] as const) {
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i];
        if (h.kind !== k) continue;
        if (mx >= h.bx - pad && mx <= h.bx + h.bw + pad && my >= h.by - pad && my <= h.by + h.bh + pad) return h;
      }
    }
    return null;
  },
  /** A hit box in canvas CSS pixels, as a viewport rect the card can dodge. */
  rectOf(h: Hit): DOMRect {
    const r = this.cv.getBoundingClientRect();
    return new DOMRect(r.left + h.bx, r.top + h.by, h.bw, h.bh);
  },
  /** Where a selected id is on screen right now — the card's anchor, for Lab's wiring.
   *  (SelCard's `anchorOf` hook in Lab.tsx still answers null for this view; one line
   *  there — `if (v === 'conn') return Conn.anchorOf(id);` — makes a card that was
   *  opened from the timeline re-anchor correctly when the reader switches here.) */
  anchorOf(id: string): DOMRect | null {
    if (!this.cv || !this.cv.clientWidth) return null;
    const h = this.hitOf(id);
    return h ? this.rectOf(h) : null;
  },

  /** The one selection write. Everything — canvas, panel, card — hangs off SelStore. */
  select(id: string | null) { SelStore.set(id); },

  setQuery(v: string) {
    const q = v.trim().toLowerCase();
    if (q === this.q) return;
    this.q = q; this.dirty = true; this.render();
  },

  // ---------- the side panel: the shared Related renderer (relations.ts) ----------
  panel() {
    renderRelatedPanel($('#connPanel'), this.sel, {
      emptyHTML: `<div class="empty">Four lanes, one time axis, and the marks are ` +
        `<b>②'s</b> — a rectangle is something with duration, a dot is a moment, height is ` +
        `importance and colour is the domain. <b>Scroll to zoom</b> and the rest fade in by ` +
        `importance, exactly as they do there.</div>` +
        `<div class="empty" style="margin-top:10px"><b>Click anything</b> and everything related ` +
        `to it stays lit in proportion to how strongly it is related, with a faint thread drawn ` +
        `to each at the year the relation is about. Everything else dims but stays on screen as ` +
        `context. The selection is the app's, not this view's: it follows you to the map, the ` +
        `timeline and the cube.</div>`,
      extraSub: (id: string) => {
        const n = this.nodes.get(id); if (!n) return '';
        const also = n.lanes.filter(i => i !== n.home).map(i => LANES[i].name);
        return `<div class="sub">lane: ${n.home >= 0 ? LANES[n.home].name : '—'}` +
          (also.length ? ` · also matches ${also.join(' · ')}` : '') + `</div>`;
      },
    });
  },

  _cap: '',
  caption() {
    const el = $('#connCap'); if (!el) return;
    const spreads = [...this.nodes.values()].filter(n => n.kind === 'spread').length;
    const html = `<b>importance ≤ ${levelFor(this.span())} of 5 · span ${fmtSpan(this.span())}` +
      ` · ${spreads} spreads · ${this._linkPairs} weighted links.</b> ` +
      `Same marks as ② the timeline: a <b>rectangle</b> is something with duration and its ` +
      `edges say how dated its ends are, a <b>dot</b> is a moment, <b>taller means more ` +
      `important</b> and colour is the domain. The lanes are queries rather than curated ` +
      `bands, and a thing is drawn in the one it answers best. Click a mark to select it ` +
      `app-wide; the threads are its weighted relations.` +
      (this.unresolved ? ` <span style="color:var(--accent2)">${this.unresolved} link endpoint${this.unresolved === 1 ? '' : 's'} did not resolve against the corpus.</span>` : '');
    if (html !== this._cap) { this._cap = html; el.innerHTML = html; }
  },

  animTo(a: number, b: number) {
    if (reduceMotion()) { this.d0 = a; this.d1 = b; this.dirty = true; this.render(); return; }
    const A = this.d0, B = this.d1, t0 = performance.now();
    const step = (t: number) => {
      const p = clamp((t - t0) / 620, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.d0 = A + (a - A) * e; this.d1 = B + (b - B) * e; this.dirty = true; this.render();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#connCanvas')!;
    if (!cv) return;
    this.build();
    // this.sel MIRRORS the app-wide selection; select() writes the store, this reads it.
    this.sel = SelStore.id;
    SelStore.subscribe(() => { this.sel = SelStore.id; this.render(); this.panel(); });
    /* A REPAINT IS NOT ENOUGH WHEN THE FONT ARRIVES — IT HAS TO BE A RELAYOUT.
       Row packing reserves the room a name needs (textW), and textW memoises by
       (font, text). Measure "East India Company chartered" before IBM Plex has
       loaded and you cache the fallback's width, pack the next dot 10px too close,
       and then draw both names in the real font, one through the other. So the
       memo is dropped and the layout is redone, not just the paint. */
    repaintOnFonts(() => { clearTextCache(); this.dirty = true; this.render(); });
    armSafariGestureGuard();
    refuseSafariGestures(cv);
    /* ONE SEARCH, EVERYWHERE THE SAME. ②'s box is the app's single top field, and
       this view now rides the same element with the same listener shape — a hit keeps
       full alpha and takes a T.accent2 ring, everything else drops to 12%. */
    const box = $<HTMLInputElement>('#cmdk') || $<HTMLInputElement>('#searchBox');
    if (box) box.addEventListener('input', (e: any) => this.setQuery(e.target.value));

    /* Same division as every other view: one finger drags the graph through time,
       two zoom about their midpoint — through the same v-space arithmetic the wheel
       uses, so there is one zoom path and two input devices. */
    const P = bindPinch(cv, {
      onStart: () => { this.drag = null; hideTip(); },
      onPinch: (now, prev) => {
        const r = cv.getBoundingClientRect(); const G = 12, Wp = cv.clientWidth - G - 12;
        this.zoomBy(this.ix(prev.cx - r.left, G, Wp), prev.d / now.d);
        const v0 = tv(this.d0), v1 = tv(this.d1);
        const dv = (now.cx - prev.cx) / Wp * (v1 - v0);
        const [a, b] = clampV(v0 - dv, v1 - dv);
        this.d0 = ty(a); this.d1 = ty(b);
        this.dirty = true; this.render();
      },
      onRebase: p => { this.drag = { x: p.clientX, y: p.clientY, v0: tv(this.d0), v1: tv(this.d1), moved: false }; },
    });
    cv.addEventListener('pointermove', e => {
      if (P.multi) { this.drag = null; return; }        // the pinch owns the gesture
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.hoverX = mx;
      if (this.drag) {
        const G = 12, Wp = cv.clientWidth - G - 12;
        const dx = e.clientX - this.drag.x;
        const slop = slopFor(e);
        if (Math.abs(dx) > slop || (e.pointerType !== 'mouse' && Math.abs(e.clientY - this.drag.y) > slop)) this.drag.moved = true;
        const dv = dx / Wp * (this.drag.v1 - this.drag.v0);
        const [a, b] = clampV(this.drag.v0 - dv, this.drag.v1 - dv);
        this.d0 = ty(a); this.d1 = ty(b); this.dirty = true; this.render(); return;
      }
      // NO HOVER ON A FINGER. A touch pointermove that reaches here is the tail of a
      // tap, and a tooltip pinned under the fingertip covers the thing it describes.
      // Tap opens the card, which says more and can be closed.
      if (e.pointerType !== 'mouse') return;
      const h = this.at(mx, my);
      this.render();                                    // the crosshair follows the hand
      if (h) {
        const n = this.nodes.get(h.id)!;
        const links = this.relsOf(h.id).length;
        const rels = this.sel ? this.relOf(this.sel) : null;
        const r2 = rels && rels.get(h.id);
        showTip(e.clientX, e.clientY,
          `<div class=t>${esc(n.name)}</div>` +
          `<div class=m>${fmtBig(n.start)}${n.end > n.start ? ' – ' + fmtY(n.end) : ''} · ${esc(LANES[n.home] ? LANES[n.home].name : '—')}</div>` +
          `<div class=m>${esc(n.kind)} · ${esc(n.type || 'moment')}</div>` +
          (n.note ? `<div class=m>${esc(n.note)}</div>` : '') +
          `<div class=m>${links} relation${links === 1 ? '' : 's'}${r2 ? ` · ${esc(r2.kind)} of the selection, weight ${r2.w.toFixed(2)}` : ''}</div>` +
          `<div class=m>importance ${'●'.repeat(6 - n.lvl)}${'○'.repeat(n.lvl - 1)} (${n.lvl}) · click to select</div>`);
        cv.style.cursor = 'pointer';
      } else { hideTip(); cv.style.cursor = 'crosshair'; }
    });
    cv.addEventListener('pointerleave', () => { hideTip(); this.hoverX = null; this.render(); });
    cv.addEventListener('pointerdown', e => {
      if (P.multi) { this.drag = null; hideTip(); return; }
      this.drag = { x: e.clientX, y: e.clientY, v0: tv(this.d0), v1: tv(this.d1), moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
    });
    cv.addEventListener('pointerup', e => {
      // tapBlocked: this gesture was a pinch, so the lift that ended it is not a click
      // on whatever happens to be under the last finger. `moved` is decided by
      // gesture.ts's slop — 3px for a mouse, 10px for a finger — never by a number
      // invented here.
      const wasDrag = this.drag && this.drag.moved; this.drag = null;
      if (wasDrag || P.tapBlocked) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const H = cv.clientHeight;
      // EITHER axis strip sets the global moment, exactly as in ②.
      if (my < AXIS_TOP || my > H - BOT) {
        const G = 12, Wp = cv.clientWidth - G - 12;
        TimeStore.set(Math.round(this.ix(mx, G, Wp)), 'tl');
        return;
      }
      const h = this.at(mx, my, e.pointerType === 'mouse' ? 0 : TAP_PAD);
      // Click means select, and the card appears BESIDE the mark — never over it.
      // Empty canvas clears the selection, exactly as ② does.
      SelCard.select(h ? h.id : null, h ? this.rectOf(h) : null);
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(); const G = 12, Wp = cv.clientWidth - G - 12;
      this.zoomBy(this.ix(e.clientX - r.left, G, Wp), Math.pow(1.0018, e.deltaY));
      this.render();
    }, { passive: false });

    /* ── THE RANDOM CONTROLS ARE GONE ────────────────────────────────────────
       "No page should have random controls." This view had five buttons no other
       view has: two guided-tour jumps (the Industrial Revolution, printing from
       Mainz), a "Whole span" zoom preset, a "Share of lane" ribbon-normalisation
       toggle, and "Clear selection".

       The tour jumps and the preset are what the ONE search box at the top is for
       — type "industrial" and click the row. "Share of lane" normalised ribbon
       thickness within a lane, and there are no ribbons any more, so it has
       nothing left to mean. And nothing else in the app carries a clear-selection
       button: clicking empty canvas clears, and so does the card's own close.

       The markup was in Lab.tsx, which is not this file's to edit; it has since
       been deleted there, so this file binds none of them and no longer needs the
       loop that used to hide them. #connReset — "back to the framing this view
       opens on" — is the one that stayed, and it is Lab's own click handler, not
       a binding here. Nothing on this canvas is wired to a button any more: the
       whole instrument is the wheel, the drag, the tap and the one search box. */
    buildConnLegend();
    this.panel();
  },
  drag: null as { x: number; y: number; v0: number; v1: number; moved: boolean } | null,
};

// The SAME legend as ② (timeline.ts buildGrammarLegend) — the same three marks, in the
// same order, drawn the same way — plus the one line that is only true here: a link's
// weight is its opacity.
export function buildConnLegend() {
  const row = $('#connGrammar'); if (!row) return;
  const c = 'var(--ink2)';
  const g = (svg: string, label: string) => `<span class="g"><svg width="30" height="14" viewBox="0 0 30 14">${svg}</svg>${label}</span>`;
  row.innerHTML = `<span class="note" style="font-weight:600">Mark =</span>` +
    g(`<rect x="3" y="3.5" width="24" height="7" rx="2" fill="${c}" opacity=".75"/><rect x="3" y="3.5" width="24" height="7" rx="2" fill="none" stroke="${c}" stroke-width="1"/>`, 'spread, sharp — dated ends') +
    g(`<defs><linearGradient id="cnfade" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${c}" stop-opacity=".05"/><stop offset=".38" stop-color="${c}" stop-opacity=".75"/>` +
      `<stop offset=".62" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="${c}" stop-opacity=".05"/>` +
      `</linearGradient></defs><rect x="2" y="3.5" width="26" height="7" rx="2" fill="url(#cnfade)"/>`, 'spread, soft — fades in and out') +
    g(`<circle cx="15" cy="7" r="3.2" fill="${c}"/>`, 'event — a moment') +
    `<span class="note" style="margin-left:6px">taller = more important</span>` +
    `<span class="note" style="font-weight:600;margin-left:6px">Colour = domain</span>` +
    g(`<path d="M6 13 C6 7 8 5 8 1" fill="none" stroke="var(--accent2)" stroke-width="1.3" opacity=".32"/>` +
      `<path d="M20 13 C20 7 22 5 22 1" fill="none" stroke="var(--accent2)" stroke-width=".7" opacity=".07"/>`,
      'link — strong, then weak: weight is its opacity');
}

export function initConn() { Conn.init(); }
