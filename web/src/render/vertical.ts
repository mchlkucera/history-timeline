/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ②ᵥ VERTICAL TIMELINE =================
// Ported from experiments/vertical/parts/30-vertical.js — a transposition of the
// zoomable timeline (timeline.ts). Time runs DOWN, past at top, always: that is the
// product's settled reading direction, so there is no flip control and there must not
// be one.
//
// WHAT IS VERBATIM from the prototype (which is itself verbatim from the horizontal
// view): the importance ladder — THR, levelFor, alphaFor; the band list; the five
// shapes and their magic numbers; the lane packer; the content-driven column bidding
// in layout(); the label placement search with its leader hairlines; the two-axis
// drag; the pan rail and the edge chips; the tooltip contents. The axis and the wheel
// now go through the SHARED piecewise scale (shared.ts tv/ty/timeTicks, TL.zoomBy) —
// the old log branch, the era wash and the inline step table are gone, and clicking
// selects app-wide (SelStore) instead of opening Wikipedia.
//
// THIS PROJECTION STILL DRAWS THE OLDER SHAPE GRAMMAR and only the hand-curated
// corpus: the new spread lanes, sharpness fades, constant-height tiers and the
// polity/spreads.json rows land here next round. Its time-pixel track packer already
// guarantees no visual overlap, so the founder's core complaint does not regress.
//
// WHAT IS ADAPTED for the app:
//  · STATE IS NOT OWNED HERE. Vertical and horizontal are two projections of ONE
//    instrument, so span, log, lenses, domains and the search query are read straight
//    off TL, and so are THR / levelFor / alphaFor / bands(). They cannot drift, because
//    there is only one of them. The only state this file owns is what has no meaning in
//    the other projection: panX (how far across the surface you are) and hoverY.
//  · the controls are wired ONCE, in timeline.ts, against the shared ids. This file
//    binds nothing but its own canvas; TL.paint() repaints whichever projection is on
//    screen (see onTimelineChange).
//  · every font goes through fontUI() / fontMono(), never a literal family, and every
//    colour through tokens(). Where the prototype used the accent for something that is
//    not a location — the era wash, the deep-time band dot, the edge chips — this uses
//    ink, matching timeline.ts and the one-accent rule. The accent survives in exactly
//    two places, both of which mean "where you are": the hover crosshair and the pan
//    rail's window frame.
//  · height comes from the stage (Lab.sizeRenderers writes VT.H) instead of being
//    measured off the document, because there is no page scroll in the shell.

import {
  $, EVENTS, CATBY, SelStore, TimeStore, catColor, clamp, evId, fitCanvas, fmtBig, fmtSpan, fmtY,
  fontMono, fontUI, hideTip, reduceMotion, repaintOnFonts, showTip, timeTicks, tokens, tv, ty,
  withA, clampV, type Tokens,
} from './shared';
import {
  bindPinch, slopFor, TAP_PAD, armSafariGestureGuard, refuseSafariGestures,
} from './gesture';
import { dimAlpha, relOf } from './relations';
import { SelCard } from './selcard';
import { TL } from './timeline';

// year pill at the cursor — rotated: sits on the left axis, vertically centred on the
// crosshair. shared.ts's yearPill() centres on x and hangs below y, which is the
// horizontal axis's geometry; this is the same object turned a quarter turn.
function yearPillV(ctx: CanvasRenderingContext2D, T: Tokens, x: number, cy: number, text: string, accent?: string) {
  ctx.font = fontMono(12, 600);                       // a year is a measurement
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = accent || T.accent; ctx.beginPath(); ctx.roundRect(x, cy - 10, w, 20, 10); ctx.fill();
  ctx.fillStyle = T.bg; ctx.textAlign = 'center'; ctx.fillText(text, x + w / 2, cy + 4); ctx.textAlign = 'left';
}

// ---------- label wrapping ----------
// Only possible because a label now runs ACROSS time instead of along it: it no longer
// has to fit inside the years it describes, so it gets its own full line.
const LH = 13, MAXLINES = 3;
const labFont = () => fontUI(11.5);                    // event titles are language
const headFont = () => fontUI(10.5, 600);              // a column name is language

// Both caches are keyed on the resolved font string as well as the text, because a
// webfont landing mid-session changes every measurement underneath them.
const _wrapCache = new Map<string, string[]>();
const _wantCache = new Map<string, number>();
export function clearMeasureCaches() { _wrapCache.clear(); _wantCache.clear(); }

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const key = ctx.font + '|' + text + '|' + Math.round(maxW) + '|' + maxLines;
  const hit = _wrapCache.get(key); if (hit) return hit;
  const words = String(text).split(/\s+/);
  const lines: string[] = []; let cur = '', broke = false;
  for (let i = 0; i < words.length; i++) {
    const t = cur ? cur + ' ' + words[i] : words[i];
    if (cur && ctx.measureText(t).width > maxW) {
      lines.push(cur); cur = words[i];
      if (lines.length === maxLines) { broke = true; break; }
    } else cur = t;
  }
  if (!broke) { if (cur) { if (lines.length < maxLines) lines.push(cur); else broke = true; } }
  if (broke) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last.replace(/[\s,;:·—-]+$/, '') + '…';
  }
  for (let k = 0; k < lines.length; k++) {            // a single word wider than the column
    if (ctx.measureText(lines[k]).width > maxW) {
      let s = lines[k];
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      lines[k] = s + '…';
    }
  }
  if (_wrapCache.size > 4000) _wrapCache.clear();
  _wrapCache.set(key, lines); return lines;
}
// How wide does this label WANT to be? A label that fits on one line is what makes a
// column read as a list rather than a paragraph; the one-line width is what a column
// bids with.
function oneLineW(ctx: CanvasRenderingContext2D, text: string) {
  const key = ctx.font + '|' + text;
  const hit = _wantCache.get(key); if (hit !== undefined) return hit;
  const w = Math.ceil(ctx.measureText(text).width);
  if (_wantCache.size > 4000) _wantCache.clear();
  _wantCache.set(key, w); return w;
}

interface Col { key: string; label: string; bw: number; si: number | null; maxTracks: number; railW: number; w: number; min: number; demand: number }
interface Lab { anchor: number; h: number; lines: string[]; a: number; col: string; mx: number; lvl: number; ev: any[]; isMatch: boolean | '' | 0; y?: number; drop?: boolean }

export const VT = {
  cv: null as unknown as HTMLCanvasElement,
  H: 760,
  // The one piece of state that is genuinely this projection's own: how far across the
  // surface you have travelled. It has no meaning in the horizontal view, so it does not
  // belong on TL.
  panX: 0,
  hoverY: null as number | null,

  // ---- shared state: ONE instrument, two projections ----------------------
  // Everything below is read off TL rather than copied, so switching the seg is a change
  // of projection and never a change of subject.
  get d0() { return TL.d0; }, set d0(v: number) { TL.d0 = v; },
  get d1() { return TL.d1; }, set d1(v: number) { TL.d1 = v; },
  get log() { return TL.log; },
  get off() { return TL.off; },
  get q() { return TL.q; },
  span() { return TL.d1 - TL.d0; },
  bands() { return TL.bands(); },
  get LMAX() { return TL.LMAX; },
  levelFor(S: number) { return TL.levelFor(S); },
  alphaFor(lvl: number, S: number, isLens: boolean) { return TL.alphaFor(lvl, S, isLens); },

  // ---- geometry -----------------------------------------------------------
  GX: 96, GY: 44, PAD: 26, MAXPUSH: 64,
  // Label-column width band. LABMAX is the cap on a column's bid; it is also the
  // no-ellipsis guarantee — the widest title in the corpus needs 138px to wrap into
  // MAXLINES lines without truncation, so any column at or above that can never
  // ellipsise. Widths quantise to STEPW so a zoom does not make the columns shiver.
  LABMIN: 96, LABMAX: 192, LABNEED: 144, STEPW: 16, PITCH: 9,

  // screen pixel for a year (past at top, monotonically increasing) — the shared
  // piecewise scale, same as the horizontal projection
  y(t: number, G: number, Hp: number) {
    const v0 = tv(TL.d0), v1 = tv(TL.d1);
    return G + (tv(t) - v0) / ((v1 - v0) || 1) * Hp;
  },
  // inverse: year at a screen pixel
  it(py: number, G: number, Hp: number) {
    const v0 = tv(TL.d0), v1 = tv(TL.d1);
    return ty(v0 + (py - G) / Hp * (v1 - v0));
  },

  // Is this event drawn in this column, and at what alpha? The importance ramp and the
  // off-screen cull, factored out so the width-measuring pass and the drawing pass can
  // never disagree about what is on screen. `pad` widens the window for the measuring
  // pass only (see layout).
  alphaOf(ev: any[], isLens: boolean, key: string, GY: number, Hp: number, PB: number, pad?: number) {
    // A layer set to `detailed` means "everything we hold", which cannot mean
    // "...once you have zoomed far enough in" here either. TL.lodOf is the one
    // place that decides, so both projections drop the gate at the same word.
    const a = TL.lodOf(ev[4], this.span(), isLens, TL.detailOfEvent(ev));
    if (a <= 0.02) return 0;
    const p = pad || 0;
    const ya = this.y(ev[0], GY, Hp), yb = ev[1] ? this.y(ev[1], GY, Hp) : ya;
    if (Math.max(ya, yb) < GY - 40 - p || Math.min(ya, yb) > PB + p) return 0;
    return a;
  },
  // The band's height in the horizontal view still drives the lane count here, and so the
  // width of the mark rail — the same band is the same busy.
  railWidth(bw: number) { const maxTracks = Math.max(1, Math.floor((bw - 24) / 17)); return { maxTracks, railW: 10 + (maxTracks - 1) * this.PITCH + 9 }; },

  size() {
    if (!this.cv) return null;
    const d = fitCanvas(this.cv, this.H); return d ? { cw: d.cw, H: this.H, ctx: d.ctx } : null;
  },
  boxes: [] as any[],
  _cols: {} as Record<string, [number, number]>,
  _colList: [] as { key: string; label: string; si: number | null; x: number; w: number }[],
  _eras: [] as [string, number][],
  _pills: [] as { x: number; y: number; w: number; h: number; to: number; col: string }[],
  _rail: null as null | { y0: number; y1: number; k: number; SW: number },
  _surface: { SW: 0, CW: 0, panX: 0, maxPan: 0 },
  _dropped: 0,
  _visLabels: 0,

  // ---- keeping the window on the part of the surface the reader is reading -----
  // panX is a raw pixel offset into a surface whose composition changes underneath it:
  // a lens adds or removes a whole column, a domain filter empties one, and a zoom
  // changes every column's width because the widths are bid from the labels that are
  // legible at that level of detail. After any of those, the same panX points at a
  // different piece of history — which is how the Mozart preset could leave the reader
  // looking at empty surface with the column they asked for off the right edge.
  //
  // WHAT panX DOES ON A RELAYOUT: it follows the ANCHOR — the column under the
  // window's left edge keeps its offset under that edge. Clamping alone is what we had
  // and it is what failed (0 is a legal pan onto the wrong columns). "Follow the new
  // column" is wrong as a default, because a lens switched OFF, or a domain hidden,
  // has no new column and should not move the reader at all. Preserving the CENTRE
  // drifts on a surface whose total width changes, and it moves the reader for a
  // change they did not ask for. Preserving the anchor means an unasked-for relayout
  // costs the reader nothing, and an asked-for one is handled by reveal() below,
  // which overrides it.
  _sig: '',
  _anchor: null as null | { key: string; dx: number },
  // A column named by a deliberate act (a preset, a lens switched on) that must end up
  // in view. Held rather than acted on immediately, because render() bails when this
  // projection is off screen and _colList would be stale.
  _reveal: null as string | null,

  // ---- pass 1: what width does each column actually need? -------------------
  // A column bids the width its longest label wants on one line. Nothing here looks at
  // the viewport, and nothing looks at the search query, so typing never reflows the
  // columns — that is the whole point. It measures over a window padded by a screenful
  // of time above and below, too, so that dragging through time does not make the
  // columns breathe under your hand: the bid changes when the level of detail changes,
  // not on every frame of a drag.
  layout(ctx: CanvasRenderingContext2D, bands: [string, string, number, number | null][], bandEvs: Record<string, any[]>, GY: number, Hp: number, PB: number, VW: number) {
    const cols: Col[] = [];
    for (const [key, label, bw, si] of bands) {
      const { maxTracks, railW } = this.railWidth(bw);
      const isLens = TL.isCurated(key);
      ctx.font = labFont();
      let want = 0, n = 0;
      for (const ev of bandEvs[key]) {
        const a = this.alphaOf(ev, isLens, key, GY, Hp, PB, Hp);
        if (a <= 0.25) continue;                       // no label at this alpha
        n++; const w = oneLineW(ctx, ev[2]); if (w > want) want = w;
      }
      ctx.font = headFont();
      const headW = Math.ceil(ctx.measureText(label.toUpperCase()).width) + 26;
      let colW: number, minW: number;
      if (!n) { colW = minW = Math.max(headW, railW + 34); }   // nothing to say: get out of the way
      else {
        const labW = clamp(Math.ceil(want / this.STEPW) * this.STEPW, this.LABMIN, this.LABMAX);
        colW = Math.max(railW + 12 + labW, headW);
        minW = Math.max(railW + 12 + this.LABNEED, headW);      // below this something would truncate
      }
      cols.push({ key, label, bw, si, maxTracks, railW, w: colW, min: minW, demand: n ? colW : 0 });
    }
    // A column is ENTITLED to `min` — the width below which its labels would truncate.
    // Everything above that is appetite. So: if the window can hold every entitlement,
    // never overflow — squeeze the appetites and, if there is still room, hand the
    // leftover to the busiest columns. Only when the window cannot hold the entitlements
    // does the surface grow past it and pan.
    let SW = cols.reduce((a, c) => a + c.w, 0);
    if (SW < VW) {
      const dsum = cols.reduce((a, c) => a + c.demand, 0) || SW, slack = VW - SW;
      for (const c of cols) c.w += slack * (c.demand || (c.w * 0.0001)) / dsum;
    } else {
      const give = cols.reduce((a, c) => a + (c.w - c.min), 0), need = SW - VW;
      const f = Math.min(1, give ? need / give : 0);
      for (const c of cols) c.w -= (c.w - c.min) * f;
    }
    SW = cols.reduce((a, c) => a + c.w, 0);
    return { cols, SW };
  },

  render() {
    const dim = this.size(); if (!dim) return;
    const { cw, H, ctx } = dim; const T = tokens();
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    const GX = this.GX, GY = this.GY, PAD = this.PAD;
    const Hp = H - GY - PAD, PB = H - PAD;     // plot height, plot bottom
    const CW = cw - GX - 8;                    // width of the WINDOW onto the surface
    const bands = this.bands();
    const q = this.q.toLowerCase();
    let hitCount = 0; this._dropped = 0; this.boxes = [];

    const bandEvs: Record<string, any[]> = {};
    // THE LAYER MODEL, SEEN FROM THE PROJECTION THAT HAS NO PANEL.
    // This view still draws BANDS as columns, because down-the-page is its time
    // axis and a column per layer would be a different instrument. But WHAT is in
    // a column is no longer "the band, minus the hidden domains" — it is whatever
    // the layer panel is currently asking for, layer by layer, at each layer's own
    // detail. TL.evVisible() is the single question both projections ask, so the
    // seg cannot switch you to a different set of facts.
    for (const b of bands) bandEvs[b[0]] = EVENTS.filter(e => e[3] === b[0] && TL.evVisible(e)).sort((a, b2) => a[0] - b2[0]);
    const { cols, SW } = this.layout(ctx, bands, bandEvs, GY, Hp, PB, CW);
    // Re-validate the pan against the new composition before anything is drawn with
    // it. The signature is every column key and width, so this fires for a lens, a
    // domain filter and a level-of-detail change alike, and never during a plain pan.
    const sig = cols.map(c => c.key + ':' + Math.round(c.w)).join('|');
    if (sig !== this._sig) {
      const a = this._anchor;
      if (a) {
        let sx = 0;
        for (const c of cols) { if (c.key === a.key) { this.panX = sx + a.dx; break; } sx += c.w; }
      }
      this._sig = sig;
    }
    const maxPan = Math.max(0, SW - CW);
    this.panX = clamp(this.panX, 0, maxPan);
    const panX = this.panX;
    // ...and record where that leaves us, for the next relayout to restore.
    {
      let sx = 0; this._anchor = null;
      for (const c of cols) {
        if (panX < sx + c.w - 1e-3) { this._anchor = { key: c.key, dx: panX - sx }; break; }
        sx += c.w;
      }
      if (!this._anchor && cols.length) {
        const last = cols[cols.length - 1];
        this._anchor = { key: last.key, dx: panX - (SW - last.w) };
      }
    }

    // ---- time axis. The SHARED bounded tick engine (timeTicks) — the old inline step
    // table would iterate ~7 million times at the full deep-time span. Lives in a fixed
    // gutter and spans the window, not the surface: panning sideways never loses it.
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'right';   // years are measurements
    ctx.beginPath();
    for (const tk of timeTicks(TL.d0, TL.d1, Hp)) {
      const yy = this.y(tk.y, GY, Hp);
      if (yy < GY - 1 || yy > PB + 1) continue;
      ctx.moveTo(GX, yy); ctx.lineTo(cw - 8, yy);
      ctx.fillText(tk.label, GX - 10, yy + 4);
    }
    ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    const yn = this.y(2026, GY, Hp);
    if (yn >= GY && yn <= PB) { ctx.strokeStyle = T.accent2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(GX, yn); ctx.lineTo(cw - 8, yn); ctx.stroke(); ctx.setLineDash([]); }

    const baseL = this.levelFor(this.span());
    // graded selection dimming, shared with every other view
    const rels = SelStore.id ? relOf(SelStore.id) : null;

    // ---- columns. The surface is drawn at -panX and clipped to the window, so nothing
    // ever paints over the time-axis gutter.
    ctx.save(); ctx.beginPath(); ctx.rect(GX, 0, CW, PB); ctx.clip();
    let cx = GX - panX; this._cols = {}; this._colList = [];
    for (const C of cols) {
      const { key, label, si, maxTracks, railW } = C, colW = C.w;
      this._cols[key] = [cx, colW]; this._colList.push({ key, label, si, x: cx, w: colW });
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath();
      ctx.moveTo(cx + colW, GY - 26); ctx.lineTo(cx + colW, PB); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = si === null ? T.ink2 : T.s[si]; ctx.beginPath(); ctx.arc(cx + 8, GY - 20, 4, 0, 7); ctx.fill();
      ctx.fillStyle = T.ink2; ctx.font = headFont(); ctx.textAlign = 'left';
      ctx.fillText(label.toUpperCase(), cx + 18, GY - 16);

      const isLens = TL.isCurated(key);
      const evs = bandEvs[key];
      const PITCH = this.PITCH;
      const labX = cx + railW + 4, labW = Math.max(46, colW - railW - 12);
      const trackEnd = new Array(maxTracks).fill(-1e18);
      const labels: Lab[] = [];
      ctx.save(); ctx.beginPath(); ctx.rect(cx, GY, colW, Hp); ctx.clip();
      ctx.font = labFont();

      for (const ev of evs) {
        const [y0, y1, title, , lvl] = ev; const cat = ev[6], typ = ev[7];
        let a = this.alphaOf(ev, isLens, key, GY, Hp, PB);
        if (!a) continue;
        a *= dimAlpha(evId(ev), SelStore.id, rels, 0.42);   // graded selection dimming, timeline floor
        const ya = this.y(y0, GY, Hp), yb = y1 ? this.y(y1, GY, Hp) : ya;
        const top = Math.min(ya, yb), bot = Math.max(ya, yb);
        const isMatch = q && ((title.toLowerCase().includes(q)) || ev[5].includes(q));
        if (q) { if (isMatch) { hitCount++; } else a *= .12; }
        const col = catColor(cat, T);

        // lane packing, in time-pixels. No label width in the budget any more — that
        // whole term is what the rotation buys us.
        let track = trackEnd.findIndex(te => te < top - 4);
        if (track < 0) { track = 0; let m = 1e18; trackEnd.forEach((te, i) => { if (te < m) { m = te; track = i; } }); }
        trackEnd[track] = Math.max(trackEnd[track], bot + 8);
        const mx = cx + 10 + track * PITCH;

        const ct = Math.max(top, GY - 30), cb = Math.min(bot, PB + 30), clen = Math.max(cb - ct, 6);
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.strokeStyle = col;
        if (typ === 'era') {                                    // translucent swath, full column
          ctx.globalAlpha = a * .22; ctx.fillRect(cx + 2, ct, colW - 4, clen);
          ctx.globalAlpha = a * .9; ctx.fillRect(mx - 1, ct, 2, clen);
        } else if (typ === 'zone') {                            // thick tapered ribbon
          const th = Math.max(5, 12 - lvl * 1.2), cap = Math.min(9, clen * .28);
          ctx.beginPath();
          ctx.moveTo(mx, ct); ctx.lineTo(mx - th / 2, ct + cap);
          ctx.lineTo(mx - th / 2, ct + clen - cap); ctx.lineTo(mx, ct + clen);
          ctx.lineTo(mx + th / 2, ct + clen - cap); ctx.lineTo(mx + th / 2, ct + cap);
          ctx.closePath(); ctx.fill();
        } else if (typ === 'life') {                            // capsule + birth dot + death cap
          ctx.globalAlpha = a * .55; ctx.beginPath(); ctx.roundRect(mx - 3.5, ct, 7, clen, 3.5); ctx.fill();
          ctx.globalAlpha = a;
          if (ya > GY - 8 && ya < PB + 8) { ctx.beginPath(); ctx.arc(mx, ya, 3.4, 0, 7); ctx.fill(); }
          if (y1 && yb > GY - 8 && yb < PB + 8) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx - 5, yb); ctx.lineTo(mx + 5, yb); ctx.stroke(); }
        } else if (y1 || typ === 'episode') {                   // bar
          ctx.beginPath(); ctx.roundRect(mx - 4, ct, 8, clen, 4); ctx.fill();
        } else {                                                // moment — a quiet point
          ctx.beginPath(); ctx.arc(mx, ya, 3.2, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        this.boxes.push({ k: 'mark', x: mx - 8, y: ct - 5, w: 16, h: clen + 10, ev, band: label });

        // anchor: the point the label belongs to. Durations use the midpoint of their
        // *visible* stretch so an era running off both ends keeps its name.
        const vt = Math.max(top, GY + 2), vb = Math.min(bot, PB - 2);
        const anchor = clamp(y1 ? (vt + vb) / 2 : ya, GY + 2, PB - 2);
        if (a > 0.25) {
          const lines = wrapText(ctx, title, labW, MAXLINES);
          labels.push({ anchor, h: lines.length * LH, lines, a, col, mx, lvl, ev, isMatch });
        } else if (isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(mx, anchor, 7, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }

      // ---- label placement. Most-important-first into the nearest free slot. Replaces
      // the horizontal view's lane budgeting and its left/right edge flipping.
      const GAP = 4, MAXPUSH = this.MAXPUSH, slots: [number, number][] = [];
      labels.sort((A, B) => A.lvl - B.lvl || A.anchor - B.anchor);
      for (const L of labels) {
        const bh = L.h + GAP, want = L.anchor - bh / 2;
        let put: number | null = null;
        for (let d = 0; d <= MAXPUSH && put === null; d += 3) {
          for (const t of (d === 0 ? [want] : [want + d, want - d])) {
            if (t < GY + 2 || t + bh > PB - 2) continue;
            let ok = true;
            for (const s of slots) { if (t < s[1] && t + bh > s[0]) { ok = false; break; } }
            if (ok) { put = t; break; }
          }
        }
        if (put === null) { L.drop = true; this._dropped++; continue; }
        L.y = put + GAP / 2; slots.push([put, put + bh]);
      }
      ctx.font = labFont(); ctx.textAlign = 'left';
      for (const L of labels) {
        if (L.drop) continue;
        const cy = L.y! + L.h / 2;
        if (Math.abs(cy - L.anchor) > 3) {                // leader hairline back to the true year
          ctx.globalAlpha = L.a * .45; ctx.strokeStyle = L.col; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(L.mx + 6, L.anchor); ctx.lineTo(labX - 4, cy); ctx.stroke();
        }
        if (L.isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(L.mx, L.anchor, 7, 0, 7); ctx.stroke();
        }
        ctx.globalAlpha = L.a; ctx.fillStyle = T.ink;
        for (let k = 0; k < L.lines.length; k++) ctx.fillText(L.lines[k], labX, L.y! + 10 + k * LH);
        ctx.globalAlpha = 1;
        this.boxes.push({ k: 'lab', x: labX - 6, y: L.y! - 2, w: labW + 10, h: L.h + 4, ev: L.ev, band: label, col: key });
      }
      ctx.restore();
      cx += colW;
    }
    ctx.restore();
    // hit-testing works on the visible slice of each box, so a mark half-scrolled under
    // the axis gutter cannot be clicked through it
    let visLabels = 0;
    for (const b of this.boxes) {
      const x0 = Math.max(b.x, GX), x1 = Math.min(b.x + b.w, cw - 8);
      b.vx = x0; b.vw = x1 - x0;
      if (b.k === 'lab' && b.vw > b.w * 0.6) visLabels++;
    }
    this._visLabels = visLabels;

    // ---- "there is more over here" ------------------------------------------
    this._surface = { SW, CW, panX, maxPan };
    this.edgeHints(ctx, T, cw, GX, GY, PB, CW, panX, maxPan);
    this.panRail(ctx, T, cw, GX, PB, CW, SW, panX);

    // ---- the global time index: the horizontal twin of ②'s red meridian ----
    {
      const yG = this.y(TimeStore.year, GY, Hp);
      if (yG >= GY && yG <= PB) {
        ctx.strokeStyle = T.accent; ctx.globalAlpha = .9; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(GX, yG); ctx.lineTo(cw - 8, yG); ctx.stroke(); ctx.globalAlpha = 1;
        yearPillV(ctx, T, 4, yG, fmtBig(TimeStore.year));
      }
    }

    // ---- hover crosshair + year readout ----
    if (this.hoverY !== null && this.hoverY > GY && this.hoverY < PB) {
      const yr = this.it(this.hoverY, GY, Hp);
      ctx.strokeStyle = T.accent; ctx.globalAlpha = .55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(GX, this.hoverY); ctx.lineTo(cw - 8, this.hoverY); ctx.stroke();
      ctx.globalAlpha = 1;
      yearPillV(ctx, T, 4, this.hoverY, fmtBig(yr));
    }
    // the shared readouts — whichever projection is on screen reports on the same state
    const rd = $('#zoomReadout'); if (rd) rd.textContent =
      `showing importance ≤ ${baseL} of 5 · span ${fmtSpan(this.span())}`;
    const sc = $('#searchCnt'); if (sc) sc.textContent = q ? `${hitCount} hits` : '';

    // A reveal asked for while this projection was off screen (the horizontal seg was
    // showing, or another view entirely) is honoured on the first frame that has a
    // real layout to aim at — which is this one.
    if (this._reveal) this.applyReveal();
  },

  /**
   * Bring a named column fully into view — the same job, and the same shortest-pan
   * animation, as clicking the "Mozart ›" chip at the edge. This is what a preset or a
   * lens calls through TL.reveal(); it is deliberately the ONLY way the view pans
   * itself, so there is one pan-to-column behaviour in the file and not two.
   */
  revealColumn(key: string) {
    this._reveal = key;
    if (this.cv && this.cv.clientWidth) this.applyReveal();
  },
  applyReveal() {
    const key = this._reveal; this._reveal = null;
    const c = key && this._colList.find(c => c.key === key); if (!c) return;
    const { CW, panX } = this._surface;
    const sx = c.x + panX - this.GX;                    // where it sits on the SURFACE
    let to = panX;
    // shortest pan: nudge whichever edge is out, never jump to the far end
    if (c.w >= CW || sx < panX) to = sx;                // left edge in (or it is wider than the window)
    else if (sx + c.w > panX + CW) to = sx + c.w - CW;  // right edge in
    if (Math.abs(to - panX) > 0.5) this.panAnim(to);
  },

  // Fade the columns out against the panel at whichever edge has more surface behind it,
  // and name the next column that way. The fade says "this is cut off"; the chip says
  // what you would get for dragging.
  edgeHints(ctx: CanvasRenderingContext2D, T: Tokens, cw: number, GX: number, GY: number, PB: number, CW: number, panX: number, maxPan: number) {
    const R = cw - 8, FW = 58;
    this._pills = [];
    // The chip sits above the header row, where it can never cover a header or a label,
    // and it is a control as well as a hint: click it and the named column slides in.
    // Filled with INK, not the accent: it is a button (.btn.hero is solid ink for the
    // same reason), and the accent is reserved for where you ARE, not where you could go.
    const pill = (x: number, text: string, dir: number, to: number, col: string) => {
      ctx.font = fontUI(10.5, 600);
      const label = dir < 0 ? '‹  ' + text : text + '  ›';
      const w = ctx.measureText(label).width + 20, h = 18, y = 1, px = dir < 0 ? x : x - w;
      ctx.globalAlpha = 1; ctx.fillStyle = T.ink;
      ctx.beginPath(); ctx.roundRect(px, y, w, h, 9); ctx.fill();
      ctx.fillStyle = T.bg; ctx.textAlign = 'left'; ctx.fillText(label, px + 10, y + 12.5);
      this._pills.push({ x: px, y, w, h, to, col });
    };
    const fade = (side: number) => {
      const x0 = side < 0 ? GX : R, x1 = side < 0 ? GX + FW : R - FW;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      // opaque for the first third, so text is gone before the hard cut rather than being
      // sliced mid-word
      g.addColorStop(0, withA(T.panel, 1)); g.addColorStop(.3, withA(T.panel, 1));
      g.addColorStop(.62, withA(T.panel, .62)); g.addColorStop(1, withA(T.panel, 0));
      ctx.fillStyle = g; ctx.fillRect(Math.min(x0, x1), GY - 30, FW, PB - GY + 30);
      ctx.strokeStyle = T.line; ctx.globalAlpha = .9; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0 + (side < 0 ? .5 : -.5), GY - 30); ctx.lineTo(x0 + (side < 0 ? .5 : -.5), PB); ctx.stroke();
      ctx.globalAlpha = 1;
    };
    // "off screen" means too little of it is left to read, not literally zero — an 18px
    // sliver under the fade is not a column you can see.
    const READ = 72, surfX = (c: { x: number }) => c.x + panX - GX;
    if (panX > 0.5) {
      fade(-1);
      const off = this._colList.filter(c => c.x + c.w <= GX + READ), h = off[off.length - 1];
      if (h) pill(GX + 6, h.label + (off.length > 1 ? '  +' + (off.length - 1) : ''), -1, surfX(h), h.key);
    }
    if (panX < maxPan - 0.5) {
      fade(1);
      const off = this._colList.filter(c => c.x >= R - READ), h = off[0];
      // the shortest pan that brings the named column fully into view — not a jump to the
      // far end, so you keep your bearings
      if (h) pill(R - 6, h.label + (off.length > 1 ? '  +' + (off.length - 1) : ''), 1, surfX(h) + h.w - CW, h.key);
    }
  },

  // A scrollbar that is also a map: every column as a block, in its own colour, with the
  // window drawn over it. It reads as "you are here, that is the whole of it" even when
  // nothing is hidden. The window frame is the ONE place in this view that earns the
  // accent — it is literally where you are.
  panRail(ctx: CanvasRenderingContext2D, T: Tokens, cw: number, GX: number, PB: number, CW: number, SW: number, panX: number) {
    const y0 = PB + 7, h = 12, tw = CW, k = tw / SW;
    this._rail = { y0, y1: y0 + h, k, SW };
    ctx.fillStyle = T.panel2; ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.roundRect(GX, y0, tw, h, 6); ctx.fill(); ctx.globalAlpha = 1;
    ctx.save(); ctx.beginPath(); ctx.roundRect(GX, y0, tw, h, 6); ctx.clip();
    let sx = 0;
    for (const c of this._colList) {
      const bx = GX + sx * k, bw = Math.max(1, c.w * k - 1.5);
      ctx.fillStyle = c.si === null ? T.ink2 : T.s[c.si]; ctx.globalAlpha = .32;
      ctx.fillRect(bx, y0, bw, h); ctx.globalAlpha = 1;
      ctx.font = fontUI(8, 600); ctx.textAlign = 'center';
      const nm = c.label.toUpperCase();
      if (ctx.measureText(nm).width < bw - 8) { ctx.fillStyle = T.ink3; ctx.fillText(nm, bx + bw / 2, y0 + 8.5); }
      sx += c.w;
    }
    ctx.restore();
    ctx.textAlign = 'left';
    const thx = GX + panX * k, thw = Math.max(18, CW * k);
    ctx.fillStyle = T.ink; ctx.globalAlpha = .09;
    ctx.beginPath(); ctx.roundRect(thx, y0 - 2, thw, h + 4, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = T.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(thx + 1, y0 - 1, thw - 2, h + 2, 7); ctx.stroke();
    if (thw < CW - 1) {                     // grips, so the frame reads as draggable
      ctx.strokeStyle = T.accent; ctx.lineWidth = 1.2; ctx.globalAlpha = .85; ctx.beginPath();
      for (const gx of [thx + 5, thx + thw - 5]) { ctx.moveTo(gx, y0 + 3); ctx.lineTo(gx, y0 + h - 3); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  },

  /** `pad` grows every box before the test — 0 for a cursor, TAP_PAD for a
   *  finger. Same reasoning as timeline.ts's hitAt: these marks are drawn for a
   *  cursor and a fingertip cannot be aimed at a 4px dot. */
  hit(mx: number, my: number, pad = 0) { return this.boxes.findLast(b => b.vw > 0 && mx >= b.vx - pad && mx <= b.vx + b.vw + pad && my >= b.y - pad && my <= b.y + b.h + pad); },
  /** A hit box in canvas CSS pixels, as a viewport rect the card can dodge. */
  rectOf(b: any): DOMRect {
    const r = this.cv.getBoundingClientRect();
    return new DOMRect(r.left + (b.vx ?? b.x), r.top + b.y, b.vw ?? b.w, b.h);
  },
  /** Where a selected id is drawn right now, or null if it is not on screen. */
  anchorOf(id: string): DOMRect | null {
    if (!this.cv || !this.cv.clientWidth) return null;
    const b = this.boxes.find((bx: any) => bx.vw > 0 && evId(bx.ev) === id);
    return b ? this.rectOf(b) : null;
  },
  panTo(x: number) { this.panX = x; this.render(); },
  pillAt(mx: number, my: number) { return (this._pills || []).find(p => mx >= p.x && mx <= p.x + p.w && my >= p.y - 2 && my <= p.y + p.h + 2); },
  panAnim(to: number) {
    to = clamp(to, 0, this._surface.maxPan);
    if (reduceMotion()) { this.panTo(to); return; }
    const A = this.panX, t0 = performance.now();
    const step = (t: number) => {
      const p = clamp((t - t0) / 380, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.panX = A + (to - A) * e; this.render(); if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#vertCanvas')!;
    if (!cv) return;
    // Every shared control — the four presets, the search box, the lens chips, the domain
    // row and the grammar legend — is wired ONCE, by timeline.ts, against the shared
    // state. TL.paint() calls back here, so a control pressed while this projection is on
    // screen repaints it. Binding them again from this file would double every handler.
    TL.onProjection(() => this.render());
    TL.onReveal(k => this.revealColumn(k));
    repaintOnFonts(() => { clearMeasureCaches(); this.render(); });

    // Wheel stays what it was: time zoom. Sideways travel is on shift+wheel and on an
    // unambiguously horizontal trackpad swipe, so it never fights the zoom.
    armSafariGestureGuard();
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2;
      if (sideways) {
        const d = (e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) ? e.deltaY : e.deltaX;
        this.panX += d; this.render(); return;
      }
      const r = cv.getBoundingClientRect(); const Hp = this.H - this.GY - this.PAD;
      const tc = this.it(e.clientY - r.top, this.GY, Hp);
      TL.zoomBy(tc, Math.pow(1.0018, e.deltaY));      // shared clamps, shared fixed-point
      this.render();
    }, { passive: false });

    let drag: any = null;
    const onRail = (my: number) => !!this._rail && my >= this._rail.y0 - 5 && my <= this._rail.y1 + 5;
    const startDrag = (p: { clientX: number; clientY: number }) => {
      drag = { x: p.clientX, y: p.clientY, d0: this.d0, d1: this.d1, panX: this.panX, moved: false };
    };
    /* THIS PROJECTION'S TIME AXIS IS VERTICAL, so a pinch's ANCHOR is the
       midpoint's Y — but its SCALE is still the plain separation of the two
       contacts, which is what a hand means by a pinch whichever way it is held.
       Zoom goes to TL.zoomBy exactly as the wheel's does, so the shared clamp,
       the shared fixed-point rule AND the 26-rung ladder (this view reads the
       same TL state the horizontal one does) all apply unchanged. */
    refuseSafariGestures(cv);
    const P = bindPinch(cv, {
      onStart: () => { drag = null; hideTip(); },
      onPinch: (now, prev) => {
        const r = cv.getBoundingClientRect(); const Hp = this.H - this.GY - this.PAD;
        TL.zoomBy(this.it(prev.cy - r.top, this.GY, Hp), prev.d / now.d);
        // then carry the sheet with the midpoint: Y through time, X across the
        // surface. In V-SPACE, and through the shared clamp, because the pinch
        // reaches deep time where a year-space translation is wildly nonuniform.
        if (!this.log) {
          const dv = (now.cy - prev.cy) / Hp * (tv(TL.d1) - tv(TL.d0));
          const [nv0, nv1] = clampV(tv(TL.d0) - dv, tv(TL.d1) - dv);
          TL.d0 = ty(nv0); TL.d1 = ty(nv1);
        }
        this.panX -= now.cx - prev.cx;
        this.render();
      },
      onRebase: p => startDrag(p),
    });
    cv.addEventListener('pointerdown', e => {
      if (P.multi) { drag = null; hideTip(); return; }   // a second finger is a pinch
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
      const pl = this.pillAt(mx, my);
      if (pl) { drag = { rail: true, moved: true }; this.panAnim(pl.to); return; }
      if (onRail(my)) {                     // grab the map: centre the window on the click
        drag = { rail: true, moved: true };
        this.panTo((mx - this.GX) / this._rail!.k - this._surface.CW / 2); return;
      }
      startDrag(e);
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', e => {
      if (P.multi) { drag = null; return; }              // the pinch owns the gesture
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.hoverY = my;
      if (drag && drag.rail) { this.panTo((mx - this.GX) / this._rail!.k - this._surface.CW / 2); return; }
      if (drag) {
        // one gesture, both axes: Y travels through time, X pans the surface
        const Hp = this.H - this.GY - this.PAD;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        const slop = slopFor(e);
        if (Math.abs(dx) > slop || Math.abs(dy) > slop) drag.moved = true;
        this.panX = drag.panX - dx;
        if (!this.log) {
          const dt = dy / Hp * (drag.d1 - drag.d0);
          this.d0 = drag.d0 - dt; this.d1 = drag.d1 - dt;
        }
        this.render(); return;   // keep the crosshair: the year readout is the anchor while travelling
      }
      if (e.pointerType !== 'mouse') return;   // no hover on a finger; the tap selects
      const b = this.hit(mx, my);
      this.render();
      if (onRail(my) || this.pillAt(mx, my)) { hideTip(); cv.style.cursor = 'pointer'; return; }
      if (b) {
        const [y0, y1, t, , lvl] = b.ev; const cat = CATBY[b.ev[6]], typ = b.ev[7], pl = b.ev[8];
        showTip(e.clientX, e.clientY, `<div class=t>${t}</div><div class=m>${fmtBig(y0)}${y1 ? ' – ' + fmtY(y1) : ''} · ${b.band}</div>` +
          `<div class=m>${cat ? cat.name : ''} · ${typ}${pl ? ' · ' + pl[2] : ''}</div>` +
          `<div class=m>importance ${'●'.repeat(6 - lvl)}${'○'.repeat(lvl - 1)} (${lvl}) · click to select · Wikipedia in the Related panel</div>`);
        cv.style.cursor = 'pointer';
      } else { hideTip(); cv.style.cursor = 'grab'; }
    });
    cv.addEventListener('pointerup', e => {
      const wasDrag = drag && drag.moved; drag = null; cv.style.cursor = 'grab';
      if (wasDrag || P.tapBlocked) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx < this.GX) {                              // year gutter: set the global moment
        const Hp = this.H - this.GY - this.PAD;
        TimeStore.set(Math.round(this.it(my, this.GY, Hp)), 'vt');
        return;
      }
      const b = this.hit(mx, my, e.pointerType === 'mouse' ? 0 : TAP_PAD);
      // Click means select, and the card opens beside the mark — never over it.
      // Empty canvas clears the selection, exactly as before.
      SelCard.select(b ? evId(b.ev) : null, b ? this.rectOf(b) : null);
    });
    cv.addEventListener('pointerleave', () => { hideTip(); this.hoverY = null; this.render(); });
    cv.style.cursor = 'grab';
  },
};
