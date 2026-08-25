/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑧ CONNECTIONS =================
// The relationship atlas. Three kinds of thing share one horizontal time axis:
//   event   — happens at a point in time
//   entity  — persists and is in ONE place at a time (a person: a thread)
//   spread  — persists and is in MANY places at once; its footprint moves and its
//             intensity waxes and wanes (printing, the Industrial Revolution, a religion)
//
// Spreads — and states, which behave the same way — are drawn with the SAME ribbon
// geometry as ③ Flow of empires (flowLayout, imported from ./flow), so thickness
// follows the weight curve: swelling and tapering, not a rectangle. Events and
// entities are placed INSIDE the ribbon they belong to, so "Mainz 1439 is a point
// within the printing spread" is literally what you see.
//
// Relationships are explicit and weighted (data/relations/SCHEMA.md). Click anything
// and the whole view re-grades itself by link weight: w=1.0 at full strength, w=0.2
// barely up, everything unrelated dimmed but still there as context.

import {
  $, BELIEFS, EVENTS, POLITIES, SelStore, catColor, clamp, fitCanvas, fmtY, fontMono, fontUI,
  hexHsl, hideTip, reduceMotion, repaintOnFonts, showTip, tokens, varyColor, yearPill, type Tokens,
} from './shared';
import {
  bindPinch, slopFor, TAP_PAD, armSafariGestureGuard, refuseSafariGestures,
} from './gesture';
import { flowLayout } from './flow';
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
  ribbon: boolean;                       // has a weight curve -> drawn as a ribbon
  weight?: [number, number][];
  from?: string[]; to?: string[];
  type?: string;                         // moment | episode | life | era | zone
  lvl: number;                           // importance 1..5, for the context budget
  linked: boolean;                       // appears in links.json
}

// ---------- lanes are QUERIES, and they deliberately overlap ----------
// Each lane scores an item 0-1. An item is drawn SOLID in its best-scoring lane and
// HOLLOW everywhere else it matches, so a repeat reads as an echo, not as a bug.
interface Lane { id: string; name: string; q: string; si: number; score: (n: Item) => number }
const LANES: Lane[] = [
  {
    id: 'eu', name: 'Europe', q: 'region match', si: 0,
    // a state IS its territory, so a European polity belongs to the region lane first;
    // everything else that merely happened in Europe scores lower and echoes here.
    score: n => n.region === 'EU' ? (n.kind === 'polity' ? 1 : 0.6) : 0,
  },
  {
    id: 'sci', name: 'Science & technology', q: 'category match', si: 2,
    score: n => n.cat === 'sci' ? 1 : n.cat === 'reach' ? 0.45 : 0,
  },
  {
    id: 'belief', name: 'Ideas & belief', q: 'category match', si: 6,
    score: n => n.cat === 'belief' ? 1 : n.cat === 'art' ? 0.5 : 0,
  },
  {
    id: 'power', name: 'Power & economy', q: 'category match', si: 3,
    // narrowed: a European state's home is the Europe lane, so it still echoes here
    // (the British Empire is genuinely both) but it no longer out-ranks the economic
    // spreads this lane is actually about, and battles no longer flood it.
    score: n => n.cat === 'society' ? 0.95
      : n.cat === 'power' ? (n.kind === 'polity' && n.region === 'EU' ? 0.4 : 0.9)
        : n.cat === 'war' ? 0.55 : 0,
  },
];

// ---------- level of detail, ported verbatim from ② (render/timeline.ts) ----------
// The visible span decides which importance levels render, and levels fade rather than
// pop. Same thresholds, same ramp, same 2.5× widening for the "lens" case, so the two
// views behave identically — zoom out for the essentials, zoom in and the rest arrives.
const THR: Record<number, number> = { 1: Infinity, 2: 40000, 3: 2400, 4: 650, 5: 170 };
const levelFor = (S: number) => (S <= THR[5] ? 5 : S <= THR[4] ? 4 : S <= THR[3] ? 3 : S <= THR[2] ? 2 : 1);
const alphaFor = (lvl: number, S: number, isLens: boolean) => {
  const t = THR[lvl] * (isLens ? 2.5 : 1); if (!isFinite(t)) return 1;
  if (S <= t) return 1; if (S <= t * 1.6) return 1 - (S - t) / (t * .6); return 0;
};

// hexHsl / varyColor moved to shared.ts (the timeline needs them too); the local id
// hash stays because ribbon-interior placement uses it directly.
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// interpolate a ribbon's top/bottom edge at one year
function bandAt(a: any, y: number): [number, number] | null {
  const t = a.top, b = a.bot; if (!t || t.length < 2) return null;
  if (y <= t[0][0]) return [t[0][1], b[0][1]];
  const last = t.length - 1;
  if (y >= t[last][0]) return [t[last][1], b[last][1]];
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m][0] <= y) lo = m; else hi = m; }
  const f = (y - t[lo][0]) / ((t[hi][0] - t[lo][0]) || 1);
  return [t[lo][1] + (t[hi][1] - t[lo][1]) * f, b[lo][1] + (b[hi][1] - b[lo][1]) * f];
}

export const Conn = {
  cv: null as unknown as HTMLCanvasElement,
  d0: 1350, d1: 2026,
  nodes: new Map<string, Item>(),
  sel: null as string | null,
  hover: null as string | null,
  hoverX: null as number | null,
  unresolved: 0,
  lanes: [] as any[],
  hits: [] as any[],          // {id, lane, x0, x1, y, r, kind, anchor}
  labels: [] as any[],        // placed after everything else, best-first, collisions dropped
  dirty: true, lastW: 0, mode: 'abs',
  H: 760,
  LANE_H: 196, PAD: 8, AXIS: 34, LABEL_H: 18, LOOSE_H: 34,

  // ---------- build the universe ----------
  build() {
    this.nodes = new Map(); this.unresolved = 0; this._linkPairs = 0;
    const add = (n: Item) => { if (!this.nodes.has(n.id)) this.nodes.set(n.id, n); return this.nodes.get(n.id)!; };

    // every spread is in, always — they are the spine of this view
    for (const s of REL.spreads) {
      const fp = s.footprint && s.footprint.length ? s.footprint[0] : null;
      add({
        id: 'spread:' + s.id, kind: 'spread', name: s.name, start: s.start, end: s.end,
        cat: SPREADCAT[s.kind] || 'society', region: fp ? regionOf(fp.lat, fp.lon) : null,
        note: s.note || '', ribbon: true, weight: s.weight || [[s.start, 1], [s.end, 1]],
        from: (s.from || []).map(x => 'spread:' + x), to: (s.to || []).map(x => 'spread:' + x),
        lvl: lvlOfWeight(peakOf(s.weight)), linked: false,
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
      return {
        id, kind, name: e[2], start: e[0], end: e[1] || e[0], cat: e[6] || 'power',
        region, note: e[5] || '', ribbon: false, type: e[7], lvl: e[4] || 3, linked: false,
      };
    };
    const polNode = (p: any): Item => ({
      id: 'polity:' + p.id, kind: 'polity', name: p.name, start: p.start, end: p.end,
      cat: 'power', region: p.region || null, note: p.note || '', ribbon: true, weight: p.weight,
      from: (p.from || []).map((x: string) => 'polity:' + x), to: (p.to || []).map((x: string) => 'polity:' + x),
      lvl: lvlOfWeight(peakOf(p.weight)), linked: false,
    });
    const belNode = (b: any): Item => ({
      id: 'belief:' + b.id, kind: 'belief', name: b.name, start: b.start, end: b.end,
      cat: 'belief', region: null, note: b.note || '', ribbon: true, weight: b.weight,
      from: (b.from || []).map((x: string) => 'belief:' + x), to: (b.to || []).map((x: string) => 'belief:' + x),
      lvl: lvlOfWeight(peakOf(b.weight)), linked: false,
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

    // links — the WEIGHTS live in the shared relIndex (relations.ts) now; this loop
    // survives for its side-effects: resolve() adds every linked node to the corpus,
    // and the unresolved count is this view's honesty line.
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

    // context budget — now that level of detail governs what is drawn, the corpus can be
    // DEEPER than the screen: everything below the current level is simply held back
    // until you zoom in. So top up generously with levels 1–4 and let the span decide.
    POLITIES.slice().sort((a, b) => peakOf(b.weight) - peakOf(a.weight)).slice(0, 60).forEach(p => add(polNode(p)));
    for (const sys of (BELIEFS.systems || [])) for (const st of (sys.streams || [])) add(belNode(st));
    EVENTS.filter(e => (e[4] || 5) <= 4 && e[3] !== 'CO' && e[0] > -4000)
      .slice(0, 420).forEach(e => add(evNode(e, (e[7] === 'life' ? 'entity:' : 'event:') + e[2], e[7] === 'life' ? 'entity' : 'event')));

    // lane assignment: best score solid, the rest hollow
    for (const n of this.nodes.values()) {
      (n as any).lanes = LANES.map((l, i) => [i, l.score(n)] as [number, number]).filter(x => x[1] > 0)
        .sort((a, b) => b[1] - a[1]);
      (n as any).home = (n as any).lanes.length ? (n as any).lanes[0][0] : -1;
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

  // ---------- geometry ----------
  height() { return LANES.length * this.LANE_H + this.PAD + this.AXIS; },
  X(y: number, G: number, Wp: number) { return G + (y - this.d0) / (this.d1 - this.d0) * Wp; },
  span() { return this.d1 - this.d0; },

  // An item's level of detail in one lane. An echo is by definition the second telling of
  // something, so it costs a level: a wide view shows each thing once, and the repeats
  // fade in as you come closer. `isLens` is ②'s widening — see lodItem().
  lodOf(n: Item, li: number, isLens: boolean) {
    return alphaFor(clamp(n.lvl + ((n as any).home === li ? 0 : 1), 1, 5), this.span(), isLens);
  },

  layout(cw: number) {
    const G = 12, Wp = cw - G - 12;
    this.lanes = [];
    for (let li = 0; li < LANES.length; li++) {
      const lane = LANES[li];
      const top = this.PAD + li * this.LANE_H;
      const rTop = top + this.LABEL_H;
      const rH = this.LANE_H - this.LABEL_H - this.LOOSE_H - 6;
      const members = [...this.nodes.values()].filter(n => (n as any).lanes.some((x: any[]) => x[0] === li));
      // Ribbons enter the stack at their level-of-detail strength, so one fading in
      // SWELLS in rather than popping into a stack that then shoves everything sideways.
      // A link endpoint keeps a hairline's worth of presence even below the current
      // level — selection must never be able to make one of its own relations vanish,
      // and the layout has to stay identical before and after a click.
      const lodA = new Map<string, number>();
      const ribbons: any[] = [];
      for (const n of members) {
        if (!n.ribbon || n.end <= this.d0 || n.start >= this.d1) continue;
        const a = this.lodOf(n, li, false);
        const s = Math.max(a, n.linked ? 0.12 : 0);
        if (s <= 0.02) continue;
        lodA.set(n.id, a);
        ribbons.push(s >= 0.999 ? n : { ...n, weight: (n.weight || []).map((p: number[]) => [p[0], p[1] * s]) });
      }
      const lay = ribbons.length ? flowLayout(ribbons, Wp, rH, this.d0, this.d1, this.mode) : null;
      this.lanes.push({ lane, li, top, rTop, rH, members, lay, lodA, G, Wp, loose: [] as any[] });
    }
    this.lastW = cw; this.dirty = false;
  },

  // where an item is drawn in one lane — the anchor a thread can attach to
  anchorOf(id: string, li: number): { x: number; y: number } | null {
    for (const h of this.hits) if (h.id === id && h.li === li) return { x: h.ax, y: h.ay };
    return null;
  },
  hitOf(id: string, li?: number) {
    let any: any = null;
    for (const h of this.hits) {
      if (h.id !== id) continue;
      if (li === undefined || h.li === li) return h;
      if (!any) any = h;
    }
    return any;
  },
  homeAnchor(id: string) {
    const n = this.nodes.get(id); if (!n) return null;
    const h = this.hitOf(id, (n as any).home) || this.hitOf(id);
    return h ? { x: h.ax, y: h.ay } : null;
  },

  // Where a given YEAR falls on an item: a ribbon is sampled at that year, a point item
  // is simply itself. This is what lets a thread land on a date instead of on an anchor.
  pointAt(id: string, year: number): { x: number; y: number } | null {
    const n = this.nodes.get(id); if (!n) return null;
    const h = this.hitOf(id, (n as any).home) || this.hitOf(id);
    if (!h) return null;
    if (h.kind !== 'ribbon') return { x: h.ax, y: h.ay };
    const t = h.a.top; if (!t || t.length < 2) return { x: h.ax, y: h.ay };
    const y = clamp(year, t[0][0], t[t.length - 1][0]);
    const b = bandAt(h.a, y); if (!b) return { x: h.ax, y: h.ay };
    const G = 12, Wp = this.cv.clientWidth - G - 12;
    return { x: this.X(y, G, Wp), y: h.rTop + (b[0] + b[1]) / 2 };
  },

  // WHEN is a relation? An event is its own date. A ribbon that begins inside the shared
  // span enters at its start. A ribbon that was already there is dated by its strongest
  // moment within the shared span. Nothing is dated by "the middle of the picture", which
  // is what made every thread converge on one point and read as a spider.
  momentOf(oid: string, sn: Item): { x: number; y: number; year: number } | null {
    const o = this.nodes.get(oid); if (!o) return null;
    const lo = Math.max(o.start, sn.start), hi = Math.min(o.end, sn.end);
    let year: number;
    if (hi < lo) year = o.start > sn.end ? o.start : o.end;      // no overlap: the near end
    else if (o.start >= lo && o.start <= hi) year = o.start;      // it begins during this
    else {
      year = lo;
      const h = this.hitOf(oid, (o as any).home) || this.hitOf(oid);
      if (h && h.kind === 'ribbon') {
        let bt = -1;
        for (let i = 0; i < h.a.top.length; i++) {
          const yy = h.a.top[i][0]; if (yy < lo || yy > hi) continue;
          const th = h.a.bot[i][1] - h.a.top[i][1]; if (th > bt) { bt = th; year = yy; }
        }
      }
    }
    const p = this.pointAt(oid, year); if (!p) return null;
    return { x: p.x, y: p.y, year };
  },

  // ---------- the graded dimming: the shared implementations (relations.ts) ----------
  _linkPairs: 0,
  relsOf(id: string) { return relIndex.get(id) || []; },
  relOf(id: string): Map<string, { w: number; kind: string }> { return relOfShared(id); },
  alphaOf(id: string, rels: Map<string, { w: number; kind: string }> | null) {
    return dimAlpha(id, this.sel, rels);
  },

  // ---------- paint ----------
  render() {
    if (!this.cv) return;
    const H = this.height();
    const d = fitCanvas(this.cv, H); if (!d) return;
    const { cw, ctx } = d; const T = tokens();
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    if (!this.nodes.size) {
      ctx.fillStyle = T.ink3; ctx.font = fontUI(13);
      ctx.fillText('No relations data loaded — run npm run data.', 20, H / 2); return;
    }
    if (this.dirty || cw !== this.lastW) this.layout(cw);
    const G = 12, Wp = cw - G - 12;
    const rels = this.sel ? this.relOf(this.sel) : null;
    this.hits = []; this.labels = [];
    // resting state: nothing is selected, so nothing has earned prominence yet. The view
    // should read as four calm bands of history you can name, not as a graph.
    const REST = !this.sel;
    // an item the selection actually points at is exempt from level of detail — clicking
    // something must never be able to hide one of its own relations.
    const lit = (id: string) => litOf(id, this.sel, rels);
    const bgHsl = hexHsl(T.panel); const bgL = bgHsl ? bgHsl[2] : 92;

    for (const L of this.lanes) {
      // lane label + separator
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath();
      ctx.moveTo(0, L.top + this.LANE_H - 3); ctx.lineTo(cw, L.top + this.LANE_H - 3); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.s[L.lane.si]; ctx.beginPath(); ctx.arc(12, L.top + 9, 4, 0, 7); ctx.fill();
      ctx.fillStyle = T.ink2; ctx.font = fontUI(10.5, 600); ctx.textAlign = 'left';   // a lane name is language
      ctx.fillText(L.lane.name.toUpperCase(), 22, L.top + 13);
      ctx.fillStyle = T.ink3; ctx.font = fontUI(10);
      ctx.fillText('· ' + L.lane.q, 26 + ctx.measureText(L.lane.name.toUpperCase()).width * 1.06, L.top + 13);

      // ---- ribbons: spreads and states, thickness = weight over time ----
      const ribLabels: any[] = [];
      if (L.lay) {
        for (const [id, a] of L.lay.paths) {
          if (a.top.length < 2) continue;
          const n = this.nodes.get(id); if (!n) continue;
          const solid = (n as any).home === L.li;
          const isLit = lit(id);
          const lodA = isLit ? 1 : Math.max(L.lodA.get(id) ?? 0, n.linked ? 0.12 : 0);
          if (lodA <= 0.02) continue;
          const [col, colL] = varyColor(catColor(n.cat, T), n.id);
          const al = this.alphaOf(id, rels) * lodA;
          const isSel = id === this.sel, isHov = id === this.hover;
          ctx.beginPath();
          ctx.moveTo(this.X(a.top[0][0], G, Wp), L.rTop + a.top[0][1]);
          for (let i = 1; i < a.top.length; i++) ctx.lineTo(this.X(a.top[i][0], G, Wp), L.rTop + a.top[i][1]);
          for (let i = a.bot.length - 1; i >= 0; i--) ctx.lineTo(this.X(a.bot[i][0], G, Wp), L.rTop + a.bot[i][1]);
          ctx.closePath();
          const fillA = al * (REST ? 0.6 : 0.88);
          if (solid) {
            ctx.globalAlpha = fillA; ctx.fillStyle = col; ctx.fill();
            // a hairline of the panel colour between stacked ribbons: they separate by
            // edge rather than by shouting at each other in saturation
            ctx.globalAlpha = al * 0.8; ctx.strokeStyle = T.panel; ctx.lineWidth = 0.9; ctx.stroke();
          } else {
            // an echo must be quieter than the solid it echoes, or a lane full of echoes
            // (every European state repeats in Power & economy) reads as a hairball
            ctx.globalAlpha = al * (isLit ? 0.1 : 0.03); ctx.fillStyle = col; ctx.fill();
            ctx.globalAlpha = al * (isLit ? 0.6 : 0.2); ctx.strokeStyle = col; ctx.lineWidth = isLit ? 1.1 : 0.7;
            ctx.setLineDash(isLit ? [4, 3] : [1.5, 4]); ctx.stroke(); ctx.setLineDash([]);
          }
          if (isSel || isHov) {
            // the echo of the selected item gets a lighter version of the same outline —
            // it says "this is that same thing" without out-shouting the thing itself
            ctx.globalAlpha = solid ? 1 : 0.5; ctx.strokeStyle = T.ink;
            ctx.lineWidth = isSel ? (solid ? 1.8 : 1) : 1.1; ctx.stroke();
          }
          // the thickest point is the hit target and the fallback thread anchor. The NAME
          // goes somewhere else: a ribbon that only ever grows is thickest at the right
          // edge, and a lane of such ribbons piles every label into one corner, so the
          // name is placed where thickness and being-in-the-middle score best together.
          const N = a.top.length;
          let bi = 0, bt = 0, ni = 0, ns = -1;
          for (let i = 0; i < N; i++) {
            const t = a.bot[i][1] - a.top[i][1];
            if (t > bt) { bt = t; bi = i; }
            const u = N > 1 ? i / (N - 1) : .5;
            const s = t * (0.55 + 0.45 * (1 - Math.abs(2 * u - 1)));
            if (s > ns) { ns = s; ni = i; }
          }
          const bx = this.X(a.top[bi][0], G, Wp), by = L.rTop + (a.top[bi][1] + a.bot[bi][1]) / 2;
          const nx = this.X(a.top[ni][0], G, Wp), ny = L.rTop + (a.top[ni][1] + a.bot[ni][1]) / 2;
          const x0 = this.X(a.top[0][0], G, Wp), x1 = this.X(a.top[a.top.length - 1][0], G, Wp);
          if (bt >= 10 && x1 - x0 > 44 && al > 0.34 && (solid || isLit)) {
            // what the ribbon ACTUALLY looks like on screen is the colour composited over
            // the panel at the fill alpha — a dark teal drawn at 0.6 is a pale field, and
            // white text on it is unreadable. So derive the ink from the composite.
            const effL = bgL + (colL - bgL) * fillA;
            ribLabels.push({
              text: n.name, x: nx, y: ny + 3.8, min: x0 + 4, max: x1 - 4, center: true, bt,
              ribbon: solid ? (effL > 50 ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.34)') : null,
              col: solid ? (effL > 50 ? T.ink : '#fff') : col, alpha: Math.min(1, al + .1),
              font: fontUI(clamp((a.bot[ni][1] - a.top[ni][1]) * 0.5, 9.5, 12.5), 600),
              prio: (isSel ? 1e6 : rels && rels.get(id) ? 1000 + 1000 * rels.get(id)!.w : (solid ? 480 : 190) + bt),
            });
          }
          ctx.globalAlpha = 1;
          this.hits.push({ id, li: L.li, kind: 'ribbon', a, rTop: L.rTop, ax: bx, ay: by, solid });
        }
      }
      // a lane names its principals, not its whole membership — the rest are one hover away
      ribLabels.sort((a, b) => b.prio - a.prio || b.bt - a.bt);
      for (const l of ribLabels.slice(0, REST ? 7 : 11)) this.labels.push(l);

      // ---- events + entities, sitting INSIDE the ribbon they belong to ----
      const loose: any[] = [];
      for (const n of L.members) {
        if (n.ribbon) continue;
        if (n.end < this.d0 || n.start > this.d1) continue;
        const solid = (n as any).home === L.li;
        const px = this.X(n.start, G, Wp), px1 = this.X(n.end, G, Wp);
        if (px1 < -20 || px > cw + 20) continue;
        // strongest link to a ribbon that is actually drawn in this lane = its parent
        let host: any = null, hw = 0, hk = '';
        for (const r of this.relsOf(n.id)) {
          const t = this.nodes.get(r.other);
          if (!t || !t.ribbon || !L.lay || !L.lay.paths.has(t.id)) continue;
          if (r.w > hw) { hw = r.w; hk = r.kind; host = L.lay.paths.get(t.id); }
        }
        let y: number | null = null, inside = false;
        if (host) {
          const b = bandAt(host, clamp(n.start, this.d0, this.d1));
          if (b) {
            const th = b[1] - b[0];
            const f = th > 12 ? 0.3 + (hash(n.id) % 100) / 100 * 0.4 : 0.5;
            y = L.rTop + b[0] + th * f; inside = true;
          }
        }
        // ②'s lens widening lands here: a point drawn INSIDE its spread is this view's
        // whole reason to exist — Mainz within printing — so it holds detail 2.5× longer
        // than the same event floating loose, exactly as the Music and Science bands do.
        const lodA = lit(n.id) ? 1 : this.lodOf(n, L.li, inside);
        if (lodA <= 0.02) continue;
        if (y === null) { loose.push({ n, px, px1, solid, lodA }); continue; }
        this.drawItem(ctx, T, n, px, px1, y, solid, rels, inside, L.li, hk === 'origin', lodA);
      }
      // ---- the loose strip: matched the lane, but has no parent ribbon here ----
      // three rows, and anything that will not fit is dropped rather than stacked on top
      // of a neighbour — an unreadable pile-up says less than an honest omission.
      const rows = REST ? [-1e9, -1e9] : [-1e9, -1e9, -1e9];
      loose.sort((a, b) => a.px - b.px);
      for (const it of loose) {
        // a floating point that belongs to no ribbon here is the weakest thing this lane
        // can say, so at rest it has to be first-rank to earn its place at all
        if (REST && it.n.lvl > 2) continue;
        const r = rows.findIndex(e => e < it.px - 6); if (r < 0) continue;
        rows[r] = Math.max(it.px1, it.px) + 8;
        const y = L.top + this.LANE_H - this.LOOSE_H + 6 + r * 9.5;
        this.drawItem(ctx, T, it.n, it.px, it.px1, y, it.solid, rels, false, L.li, false, it.lodA * (REST ? 0.72 : 1));
      }
    }

    // ---- threads: the faintest tie that still resolves when you look for it ----
    // Two changes over the drawn-graph version. Each thread leaves the selection at the
    // YEAR the relation is about and lands on the related item at that same moment, so it
    // carries information instead of radiating from one arbitrary anchor as a spider. And
    // weight drives opacity far harder than it drives anything else: w=0.3 is a whisper
    // you find only by looking, w=1.0 is plainly drawn. The ranking is in the panel; the
    // canvas only has to hint that a tie exists.
    // THE SELECTION IS GLOBAL, and this corpus is not. SelStore can now be
    // written by the timeline and by the selection card, so `sel` may be an id
    // this view has no node for — a curated lane member, say. It has nothing to
    // draw here, which is fine; the non-null assertion that used to be on this
    // line was not (`Cannot read properties of undefined (reading 'ribbon')`,
    // twenty lines down, taking the whole React tree with it).
    const sn = this.sel ? this.nodes.get(this.sel) : null;
    if (this.sel && rels && sn) {
      const hub = this.homeAnchor(this.sel);
      if (hub) {
        // the selection's own echoes in the other lanes it matches — barely there
        for (const [li] of (sn as any).lanes) {
          if (li === (sn as any).home) continue;
          const e = this.anchorOf(this.sel, li); if (!e) continue;
          ctx.globalAlpha = .14; ctx.strokeStyle = T.ink2; ctx.lineWidth = .7; ctx.setLineDash([1.5, 4]);
          ctx.beginPath(); ctx.moveTo(hub.x, hub.y);
          ctx.bezierCurveTo(hub.x, (hub.y + e.y) / 2, e.x, (hub.y + e.y) / 2, e.x, e.y);
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
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
        // a small stop at the far end: the thread has to resolve INTO something
        ctx.globalAlpha = Math.min(0.55, a * 2.1); ctx.fillStyle = kindColor(r.kind, T);
        ctx.beginPath(); ctx.arc(dst.x, dst.y, 0.9 + 1.4 * r.w * r.w, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // a ribbon already gets an ink outline when selected, so only a point needs a ring
      if (!sn.ribbon && hub) {
        ctx.strokeStyle = T.ink; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(hub.x, hub.y, 7, 0, 7); ctx.stroke();
      }
    }

    this.drawLabels(ctx, cw);

    // ---- axis (same conventions as ② and ③) ----
    const BOT = H - this.AXIS + 6;
    ctx.strokeStyle = T.line; ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
    const span = this.d1 - this.d0;
    const step = [2000, 1000, 500, 250, 100, 50, 25, 10, 5].find(s => span / s >= 6) || 5;
    ctx.beginPath();
    for (let y = Math.ceil(this.d0 / step) * step; y <= this.d1; y += step) {
      const x = this.X(y, G, Wp); ctx.moveTo(x, this.PAD); ctx.lineTo(x, BOT - 6); ctx.fillText(fmtY(y), x, BOT + 10);
    }
    ctx.globalAlpha = .25; ctx.stroke(); ctx.globalAlpha = 1; ctx.textAlign = 'left';
    if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
      const yr = this.d0 + (this.hoverX - G) / Wp * span;
      ctx.strokeStyle = T.accent; ctx.globalAlpha = .45; ctx.beginPath();
      ctx.moveTo(this.hoverX, this.PAD); ctx.lineTo(this.hoverX, BOT - 6); ctx.stroke(); ctx.globalAlpha = 1;
      yearPill(ctx, T, this.hoverX, BOT - 4, fmtY(yr));
    }
    this.caption();
  },

  drawLabels(ctx: CanvasRenderingContext2D, cw: number) {
    const placed: number[][] = [];
    const hits = (r: number[]) => placed.some(p => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
    for (const L of this.labels.slice().sort((a, b) => b.prio - a.prio)) {
      ctx.font = L.font;
      const tw = ctx.measureText(L.text).width;
      let x = L.x;
      if (L.center) {
        if (tw > L.max - L.min) continue;
        x = clamp(L.x, L.min + tw / 2, L.max - tw / 2);
      }
      const r = L.center ? [x - tw / 2 - 2, L.y - 9, x + tw / 2 + 2, L.y + 3] : [x - 2, L.y - 8, x + tw + 2, L.y + 3];
      if (r[2] > cw - 4 || r[0] < 2) continue;        // never let a label run off the canvas
      if (hits(r)) continue;
      placed.push(r);
      ctx.globalAlpha = L.alpha; ctx.textAlign = L.center ? 'center' : 'left';
      if (L.ribbon) { ctx.fillStyle = L.ribbon; ctx.fillText(L.text, x + 0.7, L.y + 0.6); }
      if (L.halo) { ctx.strokeStyle = L.halo; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeText(L.text, x, L.y); }
      ctx.fillStyle = L.col; ctx.fillText(L.text, x, L.y);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  },

  // one event / entity, in the shape grammar of ② — hollow when it is an echo
  drawItem(ctx: CanvasRenderingContext2D, T: Tokens, n: Item, x0: number, x1: number, y: number,
    solid: boolean, rels: Map<string, { w: number; kind: string }> | null, inside: boolean, li: number,
    origin: boolean, lodA: number) {
    const col = catColor(n.cat, T);
    const al = this.alphaOf(n.id, rels) * lodA;
    const isSel = n.id === this.sel, isHov = n.id === this.hover;
    const w = Math.max(x1 - x0, 0);
    ctx.globalAlpha = al; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.4;
    if (n.type === 'life' || n.type === 'episode' || n.type === 'era' || w > 3) {
      const h = n.type === 'life' ? 6 : 5.5;
      ctx.beginPath(); ctx.roundRect(x0, y - h / 2, Math.max(w, 5), h, h / 2);
      if (solid) ctx.fill(); else { ctx.globalAlpha = al * .18; ctx.fill(); ctx.globalAlpha = al; ctx.stroke(); }
      if (n.type === 'life') { ctx.globalAlpha = al; ctx.beginPath(); ctx.arc(x0, y, 2.8, 0, 7); if (solid) ctx.fill(); else ctx.stroke(); }
    } else {
      const r = inside ? 3.4 : 3;
      ctx.beginPath(); ctx.arc(x0, y, r, 0, 7);
      if (solid) ctx.fill(); else { ctx.globalAlpha = al * .18; ctx.fill(); ctx.globalAlpha = al; ctx.stroke(); }
    }
    // the event a spread STARTS from — Mainz 1439 — gets a stem and a diamond, because
    // at its origin the ribbon is still a hairline and the point would read as floating
    if (origin) {
      ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x0, y - 9); ctx.lineTo(x0, y + 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y - 5.4); ctx.lineTo(x0 + 4.4, y); ctx.lineTo(x0, y + 5.4); ctx.lineTo(x0 - 4.4, y);
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = T.panel; ctx.lineWidth = 1; ctx.stroke();
    }
    // a point sitting inside a ribbon gets a hairline of the panel colour so it reads
    // as ON the ribbon rather than as part of it
    if (inside && !origin) {
      ctx.globalAlpha = Math.min(1, al * .9); ctx.strokeStyle = T.panel; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x0, y, (n.type === 'moment' || !n.type ? 3.4 : 3.4) + 1.2, 0, 7); ctx.stroke();
    }
    if (isSel || isHov) {
      ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = isSel ? 1.6 : 1;
      ctx.beginPath(); ctx.arc(x0, y, 7, 0, 7); ctx.stroke();
    }
    // labels are prominence, not decoration: strong relations get named first, and
    // anything that would collide with an already-placed label is simply dropped.
    // ② labels anything it draws strongly; here the ribbons already carry the names, so
    // at rest only the first-rank moments get one and the rest are a hover away. That is
    // the single biggest difference between "calm" and "a wall of text".
    const showLabel = isSel || isHov || (this.sel ? al > 0.34 : (al > 0.3 && n.lvl <= 2));
    if (showLabel) {
      const r = rels && rels.get(n.id);
      this.labels.push({
        text: n.name.length > 34 ? n.name.slice(0, 33) + '…' : n.name,
        x: Math.max(x0, x1) + 6, y: y + 3.4, col: T.ink, alpha: clamp(al + .12, 0, 1),
        halo: inside ? T.panel : null,
        font: fontUI(10.5, isSel ? 600 : 400),
        prio: isSel ? 1e6 : r ? 1000 + 1000 * r.w : (6 - n.lvl) * 20 + (inside ? 40 : 0),
      });
    }
    ctx.globalAlpha = 1;
    this.hits.push({ id: n.id, li, kind: 'item', x0, x1: Math.max(x0, x1), y, ax: x0, ay: y });
  },

  /** `pad` widens every target by the same margin — 0 for a cursor, TAP_PAD for
   *  a fingertip, which cannot be aimed at a 14px-tall node row. */
  at(mx: number, my: number, pad = 0) {
    // points win over ribbons — the contained thing is the smaller target
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.kind !== 'item') continue;
      if (mx >= h.x0 - 6 - pad && mx <= h.x1 + 6 + pad && Math.abs(my - h.y) <= 7 + pad) return h;
    }
    const G = 12, Wp = this.cv.clientWidth - G - 12;
    for (const h of this.hits) {
      if (h.kind !== 'ribbon') continue;
      const a = h.a, n = a.top.length;
      const x0 = this.X(a.top[0][0], G, Wp), x1 = this.X(a.top[n - 1][0], G, Wp);
      if (mx < x0 - 2 - pad || mx > x1 + 2 + pad) continue;
      const t = clamp(Math.round((mx - x0) / Math.max(x1 - x0, 1) * (n - 1)), 0, n - 1);
      if (my >= h.rTop + a.top[t][1] - 1 - pad && my <= h.rTop + a.bot[t][1] + 1 + pad) return h;
    }
    return null;
  },

  select(id: string | null) {
    // body is the store write: the SelStore subscriber (init) assigns this.sel and
    // re-renders, so internal callers keep working and the selection is app-wide.
    SelStore.set(id);
  },

  // ---------- the side panel: the shared Related renderer (relations.ts) ----------
  panel() {
    renderRelatedPanel($('#connPanel'), this.sel, {
      emptyHTML: `<div class="empty">Four lanes, one time axis. At this span you are seeing only the ` +
        `<b>most important</b> things in each — <b>scroll to zoom in</b> and the rest fade in by importance, ` +
        `the same way ② behaves.</div>` +
        `<div class="empty" style="margin-top:10px"><b>Click anything</b> — a ribbon, a point, a state — and everything ` +
        `related to it stays lit in proportion to how strongly it is related, with a faint thread drawn to each. ` +
        `Everything else dims but stays on screen as context. Click empty space to clear.</div>` +
        `<div class="empty" style="margin-top:10px">Try <b>the Industrial Revolution</b> ribbon in <i>Power &amp; economy</i>, ` +
        `or the <b>printing</b> ribbon in <i>Science &amp; technology</i> and the events sitting inside it.</div>`,
      extraSub: (id: string) => {
        const n = this.nodes.get(id); if (!n) return '';
        const laneNames = ((n as any).lanes || []).map((l: any[], i: number) =>
          `${LANES[l[0]].name}${i === 0 ? ' <i>(solid)</i>' : ' <i>(echo)</i>'}`).join(' · ') || '—';
        return `<div class="sub">lanes: ${laneNames}</div>`;
      },
    });
  },

  _cap: '',
  caption() {
    const el = $('#connCap'); if (!el) return;
    const spreads = [...this.nodes.values()].filter(n => n.kind === 'spread').length;
    const links = this._linkPairs;
    const html = `<b>Showing importance ≤ ${levelFor(this.span())} of 5 · span ${Math.round(this.span()).toLocaleString()} yrs` +
      ` · ${spreads} spreads · ${links} weighted links in the corpus.</b> ` +
      `Scroll to zoom and the level of detail follows, exactly as in ② — the essentials at a wide span, ` +
      `the rest fading in as you come closer. Ribbon thickness is the spread's reach at that moment; a ribbon's ` +
      `importance is the peak of that same curve. Points drawn <i>inside</i> a ribbon are the ` +
      `events and lives that belong to it. Solid = this is the item's strongest-matching lane; hollow = the same item ` +
      `echoed in another lane it also matches, one level of detail further down.` +
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
    repaintOnFonts(() => this.render());
    armSafariGestureGuard();
    refuseSafariGestures(cv);
    /* Same division as every other view: one finger drags the graph through time,
       two zoom about their midpoint. The pinch calls the wheel's own arithmetic
       with `pow(1.0018, deltaY)` replaced by the finger ratio, against the same
       [8, 30000] span clamp — one zoom path, two input devices. */
    const P = bindPinch(cv, {
      onStart: () => { this.drag = null; hideTip(); },
      onPinch: (now, prev) => {
        const r = cv.getBoundingClientRect(); const G = 12, Wp = cv.clientWidth - G - 12;
        const yc = this.d0 + (prev.cx - r.left - G) / Wp * (this.d1 - this.d0);
        const s = clamp(this.span() * (prev.d / now.d), 8, 30000);
        const frac = (yc - this.d0) / (this.d1 - this.d0);
        this.d0 = yc - frac * s; this.d1 = this.d0 + s;
        const dy = (now.cx - prev.cx) / Wp * s;
        this.d0 -= dy; this.d1 -= dy;
        this.dirty = true; this.render();
      },
      onRebase: p => { this.drag = { x: p.clientX, y: p.clientY, d0: this.d0, d1: this.d1, moved: false }; },
    });
    cv.addEventListener('pointermove', e => {
      if (P.multi) { this.drag = null; return; }        // the pinch owns the gesture
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.hoverX = mx;
      if (this.drag) {
        const G = 12, Wp = cv.clientWidth - G - 12;
        const dx = e.clientX - this.drag.x;
        const dy = dx / Wp * (this.drag.d1 - this.drag.d0);
        if (Math.abs(dx) > slopFor(e) || (e.pointerType !== 'mouse' && Math.abs(e.clientY - this.drag.y) > slopFor(e))) this.drag.moved = true;
        this.d0 = this.drag.d0 - dy; this.d1 = this.drag.d1 - dy; this.dirty = true; this.render(); return;
      }
      // hover is a mouse affordance; the tap below opens the same node instead
      if (e.pointerType !== 'mouse') return;
      const h = this.at(mx, my);
      const id = h ? h.id : null;
      this.hover = id; this.render();
      if (h) {
        const n = this.nodes.get(h.id)!;
        const links = this.relsOf(h.id).length;
        const rels = this.sel ? this.relOf(this.sel) : null;
        const r = rels && rels.get(h.id);
        showTip(e.clientX, e.clientY,
          `<div class=t>${esc(n.name)}</div>` +
          `<div class=m>${n.kind} · ${fmtY(n.start)}${n.end > n.start ? ' – ' + fmtY(n.end) : ''}${h.solid === false ? ' · echo of another lane' : ''}</div>` +
          (n.note ? `<div class=m>${esc(n.note)}</div>` : '') +
          `<div class=m>${links} relation${links === 1 ? '' : 's'}${r ? ` · ${r.kind} of the selection, weight ${r.w.toFixed(2)}` : ''}</div>` +
          `<div class=m>click to focus</div>`);
        cv.style.cursor = 'pointer';
      } else { hideTip(); cv.style.cursor = 'crosshair'; }
    });
    cv.addEventListener('pointerleave', () => { hideTip(); this.hover = null; this.hoverX = null; this.render(); });
    cv.addEventListener('pointerdown', e => {
      if (P.multi) { this.drag = null; hideTip(); return; }
      this.drag = { x: e.clientX, y: e.clientY, d0: this.d0, d1: this.d1, moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
    });
    cv.addEventListener('pointerup', e => {
      const wasDrag = this.drag && this.drag.moved; this.drag = null;
      if (wasDrag || P.tapBlocked) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const h = this.at(mx, my, e.pointerType === 'mouse' ? 0 : TAP_PAD);
      this.select(h ? h.id : null);            // empty space clears
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(); const G = 12, Wp = cv.clientWidth - G - 12;
      const yc = this.d0 + (e.clientX - r.left - G) / Wp * (this.d1 - this.d0);
      // same gesture constants as ②: wheel zooms about the cursor, drag pans
      const f = Math.pow(1.0018, e.deltaY); const s = clamp(this.span() * f, 8, 30000);
      const frac = (yc - this.d0) / (this.d1 - this.d0);
      this.d0 = yc - frac * s; this.d1 = this.d0 + s; this.dirty = true; this.render();
    }, { passive: false });

    // panel rows walk the graph — the delegated listener is bound (once) by
    // renderRelatedPanel, and it writes SelStore directly.
    const jump = (id: string, btn: string) => {
      const b = $(btn); if (!b) return;
      if (!this.nodes.has(id)) { (b as HTMLElement).style.display = 'none'; return; }
      b.addEventListener('click', () => {
        const n = this.nodes.get(id)!;
        const pad = Math.max(30, (n.end - n.start) * 0.55);
        this.animTo(n.start - pad, Math.min(2026, n.end + pad));
        this.select(id);
      });
    };
    jump('spread:industrial-revolution', '#connIR');
    jump('spread:printing', '#connPrint');
    $('#connAll')?.addEventListener('click', () => {
      const ss = REL.spreads.length ? REL.spreads : null;
      const a = ss ? Math.min(...ss.map(s => s.start)) - 60 : -600;
      this.animTo(a, 2026);
    });
    $('#connClear')?.addEventListener('click', () => this.select(null));
    $('#connMode')?.addEventListener('click', (e: any) => {
      this.mode = this.mode === 'abs' ? 'norm' : 'abs';
      e.target.textContent = this.mode === 'abs' ? 'Share of lane' : 'Absolute reach';
      this.dirty = true; this.render();
    });
    buildConnLegend();
    this.panel();
  },
  drag: null as any,
};

// the same shape-grammar legend idea as ②, saying what solid / hollow / inside mean
export function buildConnLegend() {
  const row = $('#connGrammar'); if (!row) return;
  const c = 'var(--ink2)';
  const g = (svg: string, label: string) => `<span class="g"><svg width="34" height="16" viewBox="0 0 34 16">${svg}</svg>${label}</span>`;
  row.innerHTML =
    g(`<path d="M1 9 C10 3 22 3 33 6 L33 12 C22 10 10 13 1 13 Z" fill="${c}" opacity=".85"/>`, 'spread — thickness = reach') +
    g(`<path d="M1 9 C10 3 22 3 33 6 L33 12 C22 10 10 13 1 13 Z" fill="none" stroke="${c}" stroke-width=".9" stroke-dasharray="1.5 4"/>`, 'the same item, echoed in another lane') +
    g(`<path d="M1 9 C10 3 22 3 33 6 L33 12 C22 10 10 13 1 13 Z" fill="${c}" opacity=".28"/><circle cx="17" cy="8" r="3.4" fill="${c}"/>`, 'event inside its spread') +
    g(`<path d="M9 15 C9 9 11 7 11 1" fill="none" stroke="var(--accent2)" stroke-width="1.3" opacity=".32"/>` +
      `<path d="M23 15 C23 9 25 7 25 1" fill="none" stroke="var(--accent2)" stroke-width=".7" opacity=".07"/>`,
      'link — strong, then weak: weight is its opacity');
}

export function initConn() { Conn.init(); }
