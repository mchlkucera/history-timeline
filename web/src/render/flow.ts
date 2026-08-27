/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= FLOW ENGINE (empires + braided rivers) + ③ FLOW OF EMPIRES =================
// Ported from prototypes/partB.html. Ribbons() is shared with ⑥a braid.ts, exactly as in
// the original. Only change: `cv` is resolved in init().
import {
  $, POLITIES, SelStore, clamp, fitCanvas, fmtY, fontMono, fontUI, hideTip, reduceMotion, repaintOnFonts,
  showTip, tokens, yearPill, type Tokens,
} from './shared';
import { SelCard } from './selcard';
import {
  bindPinch, slopFor, armSafariGestureGuard, refuseSafariGestures,
} from './gesture';

/** A polity's weight at one year: linear between the curve's control points, 0 outside
 *  its span, 1 for anything that carries no curve at all. Module-level because the
 *  absolute scale's reference (refMaxTotal) has to read the same curve flowLayout does. */
function wAt(p: any, y: number): number {
  if (y < p.start || y > p.end) return 0;
  const Wt = p.weight;
  if (!Wt || !Wt.length) return 1;
  if (y <= Wt[0][0]) return Wt[0][1];
  if (y >= Wt[Wt.length - 1][0]) return Wt[Wt.length - 1][1];
  for (let i = 1; i < Wt.length; i++) {
    if (y <= Wt[i][0]) {
      const [ya, wa] = Wt[i - 1], [yb, wb] = Wt[i]; const t = (y - ya) / ((yb - ya) || 1); return wa + (wb - wa) * t;
    }
  }
  return 0;
}

/* ── THE ABSOLUTE SCALE'S REFERENCE ────────────────────────────────────────────
   "I would like to keep the size same when panning left/right — now it normalizes so
   that the biggest piece of current view takes up 100%."

   It did: the absolute mode divided by the tallest stack IN THE WINDOW, so a pan
   re-scaled the whole picture. Rome at year 100 measured 128px in one 800-year window
   and 75px in the next one along — and Bronze Age Egypt, alone in its own window, drew
   as thick as Rome. That destroys the one thing this view is for.

   The reference is now the tallest stack the CORPUS ever reaches, so px-per-weight-unit
   is a constant: two polities of equal weight are equally thick in any century, at any
   pan, at any zoom. It is computed exactly rather than sampled — the total is a sum of
   piecewise-linear curves, so its maximum sits on one of their control points — and
   cached per item set, because it is the same number for every frame of a drag.

   It follows the VISIBLE set (region chips filter `items` before we get here). That is
   a click, not a pan, so the picture is allowed to re-scale there; and without it,
   isolating Africa would draw the continent as a 5%-tall sliver of empty plate. */
const REF_CACHE = new Map<string, number>();

export function refMaxTotal(items: any[]): number {
  let sig = String(items.length);
  for (const it of items) { let h = 0; for (let i = 0; i < it.id.length; i++) h = (h * 31 + it.id.charCodeAt(i)) >>> 0; sig += ',' + h; }
  const hit = REF_CACHE.get(sig); if (hit !== undefined) return hit;
  const ys = new Set<number>();
  for (const p of items) {
    ys.add(p.start); ys.add(p.end);
    if (Array.isArray(p.weight)) for (const kv of p.weight) if (kv[0] > p.start && kv[0] < p.end) ys.add(kv[0]);
  }
  let max = 0;
  for (const y of ys) { let t = 0; for (const p of items) t += wAt(p, y); if (t > max) max = t; }
  if (REF_CACHE.size > 64) REF_CACHE.clear();          // region chips can only mint so many sets
  REF_CACHE.set(sig, max);
  return max;
}

// Lineage-ordered stacked ribbons: children sit next to their parent, so a split
// renders as a fork. Thickness = weight. This is the Histomap mechanic.
export function flowLayout(items: any[], W: number, H: number, d0: number, d1: number, mode: string) {
  const set = new Map(items.map(i => [i.id, i]));
  const kids = new Map<string, string[]>(), pars = new Map<string, string[]>();
  for (const it of items) { kids.set(it.id, []); pars.set(it.id, []); }
  for (const it of items) {
    for (const t of (it.to || [])) if (set.has(t) && t !== it.id) kids.get(it.id)!.push(t);
    for (const f of (it.from || [])) if (set.has(f) && f !== it.id) pars.get(it.id)!.push(f);
  }
  /* WEST AT THE TOP, EAST AT THE BOTTOM — ROUGHLY, WHICH IS THE WORD HE USED.
     "Make sure roughly the Flow view is from West on top all the way to East on bottom
     (roughly) so that we can orient in it a little bit."

     The old sequence — EU, ME, AS, AM, AF — was a list, not a direction: measured against
     a west-to-east ranking it scored a correlation of −0.06, i.e. no geography at all, so
     a reader had nothing to hold. This one runs by the region's longitude on the map every
     atlas prints and this app draws (equirectangular, Greenwich in the middle, the Americas
     down the left edge): AM ≈ 90°W, EU ≈ 12°E, AF ≈ 19°E, ME ≈ 40°E, AS ≈ 100°E. Reading
     that map left to right IS this order top to bottom, which is the whole point — the two
     views agree about where things are.

     WHY REGION AND NOT LONGITUDE ITSELF, which is the more literal reading: the corpus has
     no longitude for about half of these — a polity gets one only where it matches a
     feature in the map's 18 snapshots, and the ancient half never does. Worse, the ones
     that would have it are the ones it fits least: a single number for the British Empire,
     the Mongols or Portugal-and-Brazil is a fiction, and it would MOVE as the territory
     moved, which is layout changing without a click. Region is on 147 of 147 polities, it
     never moves, and five bands are what a reader can actually hold.

     THE AMERICAS ARE THE DELIBERATE CHOICE. By raw longitude they run to 172°W, so a
     strict sort would put them above Europe — which is where they are on the map, and also
     where the Pacific ones (Australia, Aotearoa, Hawai'i, the Lapita expansion: 5 of the
     33) are NOT. The region is 85% American, the reader's mental map is the Atlantic-
     centred one, and the alternative — Europe on top and the Americas at the bottom,
     reached by going east across the Pacific — makes the fifth of the plate a reader
     recognises fastest the hardest to find. So: Americas first, Oceania travelling with
     them, stated rather than hidden.

     LINEAGE STILL OWNS EVERYTHING BELOW A ROOT. Only the ROOTS are sorted; each root's
     descendants are then visited depth-first, so a fork stays beside its parent even when
     the child sits in another region — a Portuguese Brazil stays under Portugal. That is
     the trade, and measured it is not a loss: mean parent-child distance in the stack
     falls from 18.75 to 13.97 rows and the worst from 108 to 77, because the colonial
     lineages that leap Europe→Americas now leap between neighbouring bands. Edges within
     three rows (56.2%) and component spread (1.183) are unchanged to three decimals. */
  const REG = ['AM', 'EU', 'AF', 'ME', 'AS'];
  const rank = (p: any) => { const r = REG.indexOf(p.region); return r < 0 ? REG.length : r; };
  const roots = items.filter(i => pars.get(i.id)!.length === 0)
    .sort((a, b) => rank(a) - rank(b) || a.start - b.start);
  const order = new Map<string, number>(); let n = 0;
  const visit = (id: string) => {
    if (order.has(id)) return; order.set(id, n++);
    // siblings go west to east as well, and only then by date. A fork costs nothing to
    // order this way — each child is visited with its whole subtree before the next one
    // starts, so adjacency to the parent is untouched — and it measurably tightens both
    // readings at once: mean parent-child distance 13.97 → 13.58 rows, edges landing
    // within three rows 56.2% → 58.4%, region blocks 31 → 28.
    const ks = kids.get(id)!.slice().sort((a, b) =>
      rank(set.get(a)) - rank(set.get(b)) || set.get(a).start - set.get(b).start);
    for (const k of ks) visit(k);
  };
  roots.forEach(r => visit(r.id));
  // whatever the roots could not reach — anything whose every parent is also its
  // descendant — lands in its own band too, rather than in a start-ordered tail that
  // would drop a European polity underneath Asia and undo the reading above.
  items.slice().sort((a, b) => rank(a) - rank(b) || a.start - b.start).forEach(i => visit(i.id));
  const ord = [...items].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const REF = mode === 'norm' ? 0 : refMaxTotal(items);
  const STEP = Math.max(2, (d1 - d0) / Math.max(W, 1) * 2);
  const cols: any[] = []; let maxTotal = 0;
  for (let y = d0; y <= d1; y += STEP) {
    const act: any[] = []; let tot = 0;
    for (const p of ord) { const w = wAt(p, y); if (w > 0.001) { act.push([p, w]); tot += w; } }
    if (tot > maxTotal) maxTotal = tot;
    cols.push({ y, act, tot });
  }
  const paths = new Map<string, any>();
  for (const c of cols) {
    const scale = mode === 'norm' ? (c.tot > 0 ? H / c.tot : 0) : (REF > 0 ? H * 0.94 / REF : 0);
    let acc = mode === 'norm' ? 0 : (H - c.tot * scale) / 2;
    for (const [p, w] of c.act) {
      const h = w * scale;
      let a = paths.get(p.id); if (!a) { a = { p, top: [], bot: [] }; paths.set(p.id, a); }
      a.top.push([c.y, acc]); a.bot.push([c.y, acc + h]);
      acc += h;
    }
  }
  return { paths, cols, order, kids, pars, set, maxTotal, ref: REF };
}

// great traditions / ideological trunks → a stable hue each, matched against stream ids
export const TRUNKS: [RegExp, number][] = [
  [/christian|catholic|orthodox|protestant|luther|calvin|anglic|methodis|baptist|pentecost|mormon|anabapt|chalcedon/, 268],
  [/islam|sunni|shia|sufi|wahhab/, 145],
  [/buddh|theravada|mahayana|vajrayana|zen/, 38],
  [/hindu|vedic|jain|sikh|sramana/, 12],
  [/jud(a|e)|hebrew|israelite/, 205],
  [/chinese|confucian|dao|tao|shinto/, 325],
  [/zoroastr|manich|persia/, 186],
  [/secular|nonreligious|atheis|humanis/, 240],
  [/folk|indigenous|animism|shaman|pagan|norse|celtic|slavic|near-eastern|greco-roman/, 58],
  [/marx|commun|social|labour/, 355],
  [/liberal|enlightenment|classical-econom|neoliberal/, 212],
  [/conservat|reaction|monarch/, 28],
  [/fasci|nazi|authoritarian/, 275],
  [/anarch/, 0],
  [/national|populis/, 300],
  [/environment|green|ecolog/, 132]];

export interface RibbonCfg {
  canvas: string; d0: number; d1: number; height?: number; mode?: string; colorBy?: string;
  /** SelStore's namespace for what THIS instance draws: empires are polities, braids are beliefs. */
  selKind?: string;
  onRender?: (r: any) => void;
}

export function Ribbons(cfg: RibbonCfg) {
  return {
    cv: null as unknown as HTMLCanvasElement, items: [] as any[], lay: null as any, d0: cfg.d0, d1: cfg.d1, mode: cfg.mode || 'norm',
    hover: null as string | null, hoverX: null as number | null, q: '', off: new Set<string>(), H: cfg.height || 560, colorBy: cfg.colorBy || 'region',
    bands: null as any[] | null,
    selKind: cfg.selKind || 'polity',
    // Side inset, in px. This used to be a bare 10 and the canvas used to sit inside a
    // padded card that supplied the rest; full-bleed, 10px put centred axis labels and
    // edge-most ribbon names half off the plate. Paint, hit-test, wheel and drag all read
    // it from here so they cannot drift apart again.
    PAD: 22,
    hues: { EU: 210, ME: 35, AS: 52, AM: 150, AF: 0 } as Record<string, number>,
    colorOf(p: any, T: Tokens) {
      void T;
      if (this.colorBy === 'region') {
        const h = this.hues[p.region] !== undefined ? this.hues[p.region] : 280;
        let s = 0; for (let i = 0; i < p.id.length; i++) s = (s * 31 + p.id.charCodeAt(i)) >>> 0;
        return `hsl(${(h + (s % 26) - 13 + 360) % 360} ${38 + s % 20}% ${46 + ((s >> 3) % 18)}%)`;
      }
      // Hue = the great tradition a stream belongs to, found by walking up the ancestry to the
      // first recognised trunk. Family-head alone is too coarse: Christianity, Islam and
      // Zoroastrianism all descend from Near Eastern polytheism and would share one colour.
      const chain = [p.id]; let q = p.id, guard = 0;
      while (this.lay && this.lay.pars.get(q) && this.lay.pars.get(q).length && guard++ < 40) {
        q = this.lay.pars.get(q)[0]; chain.push(q);
      }
      for (let d = 0; d < chain.length; d++) {
        for (const [re, hue] of TRUNKS) if (re.test(chain[d]))
          return `hsl(${hue} ${44 - Math.min(d, 4) * 3}% ${36 + Math.min(d, 5) * 7}%)`;
      }
      const fam = chain[chain.length - 1];
      let s = 0; for (let i = 0; i < fam.length; i++) s = (s * 31 + fam.charCodeAt(i)) >>> 0;
      return `hsl(${(s * 47) % 360} 30% ${44 + Math.min(chain.length, 5) * 5}%)`;
    },
    /** This instance's SelStore id for a ribbon — 'polity:rome', 'belief:sunni-islam'. */
    selIdOf(id: string) { return this.selKind + ':' + id; },
    /** The global selection, back as a LOCAL ribbon id — or null when what is selected
     *  app-wide is not a thing this canvas draws (an event, a person, a spread). */
    localSel(): string | null {
      const g = SelStore.id;
      if (!g) return null;
      const pre = this.selKind + ':';
      return g.startsWith(pre) ? g.slice(pre.length) : null;
    },
    /** Is a ribbon THIS canvas draws being held up for reading right now? The one switch
     *  behind the hover suspension, and deliberately not a flag of our own: it is read from
     *  SelStore every time it is asked, so a selection made on the map or the timeline
     *  suspends the hover here too, and clearing it anywhere restores the hover here.
     *
     *  THE CARD IS PART OF THE CONDITION, because the reader was told it is the way out:
     *  "if you dont want it highlighted you should just close it via cross, then you can
     *  hover as you like". The card's × dismisses the card and — today — leaves the
     *  selection standing in the store, so a suspension keyed to the store alone would
     *  answer that × with a picture that still refuses the pointer. Keyed to the card being
     *  ON SCREEN, the × is the exit he says it is, and Escape (which drops the selection as
     *  well) is the other one. Should the × ever clear the selection outright, `localSel()`
     *  goes null and this clause quietly stops mattering — it cannot go wrong in that
     *  direction.
     *
     *  It is also false while the selected ribbon is panned off the window or its region is
     *  switched off — nothing is lit then, and a view that answers neither the pointer nor
     *  the selection reads as broken rather than as focused. */
    selShown(): boolean {
      const s = this.localSel();
      return !!(s && SelCard.open && this.lay && this.lay.paths.has(s));
    },
    /** Where a ribbon is on screen — the rect the card is placed beside. A ribbon can be
     *  a metre wide, so the anchor is the slice UNDER THE POINTER when there was one, and
     *  the thickest slice otherwise (a selection arriving from another view). Anchoring a
     *  1500-year-long empire at its peak would open the card half a screen from the finger
     *  that asked for it. */
    rectOf(b: any, mx?: number): DOMRect {
      const r = this.cv.getBoundingClientRect();
      const G = this.PAD, Wp = this.cv.clientWidth - G * 2, TOP = 26, a = b.a, n = a.top.length;
      let bi = 0;
      if (mx !== undefined) {
        const x0 = G + (a.top[0][0] - this.d0) / (this.d1 - this.d0) * Wp;
        const x1 = G + (a.top[n - 1][0] - this.d0) / (this.d1 - this.d0) * Wp;
        bi = clamp(Math.round((mx - x0) / Math.max(x1 - x0, 1) * (n - 1)), 0, n - 1);
      } else {
        let bt = -1;
        for (let i = 0; i < n; i++) { const t = a.bot[i][1] - a.top[i][1]; if (t > bt) { bt = t; bi = i; } }
      }
      const x = G + (a.top[bi][0] - this.d0) / (this.d1 - this.d0) * Wp;
      return new DOMRect(r.left + x - 4, r.top + TOP + a.top[bi][1], 8, Math.max(a.bot[bi][1] - a.top[bi][1], 2));
    },
    kin(id: string) {
      const out = new Set([id]); if (!this.lay) return out;
      const up = [id], dn = [id];
      while (up.length) { const c = up.pop()!; for (const p of (this.lay.pars.get(c) || [])) if (!out.has(p)) { out.add(p); up.push(p); } }
      while (dn.length) { const c = dn.pop()!; for (const k of (this.lay.kids.get(c) || [])) if (!out.has(k)) { out.add(k); dn.push(k); } }
      return out;
    },
    render() {
      if (!this.cv) return;
      const d = fitCanvas(this.cv, this.H); if (!d) return;
      const { cw, ctx } = d; const T = tokens(); const H = this.H;
      ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
      const G = this.PAD, Wp = cw - G * 2, TOP = 26, BOT = H - 30, PH = BOT - TOP;
      const vis = this.items.filter(i => !this.off.has(i.region));
      if (!vis.length) {
        // "None" is now a button, so an empty canvas is usually the reader's own doing —
        // saying "no data loaded" there would be a lie and a dead end.
        ctx.fillStyle = T.ink3; ctx.font = fontUI(13);
        ctx.fillText(this.items.length
          ? 'Every region is hidden. Press ALL, or pick one, to bring the ribbons back.'
          : 'No data loaded for this view.', G + 10, H / 2);
        return;
      }
      this.lay = flowLayout(vis, Wp, PH, this.d0, this.d1, this.mode);
      const X = (y: number) => G + (y - this.d0) / (this.d1 - this.d0) * Wp;
      const q = this.q.toLowerCase();
      // THE SELECTION IS GLOBAL. A ribbon picked here, a mark picked on the timeline and a
      // country picked on the map are one act, so the ribbon lights up whichever view made
      // the choice. Emphasis is ink and alpha only — never the accent, which means "where
      // you are in time" and nothing else — and it never moves the layout.
      // ...but only while the selected ribbon is actually ON THIS SCREEN. Dimming the
      // whole picture for a polity that has been panned off the window, or whose region
      // is switched off, leaves a view where everything is faded and nothing is lit —
      // which reads as broken rather than as focused.
      const sel = this.localSel();
      const selId = sel && this.lay.paths.has(sel) ? sel : null;
      // AND WHILE A SELECTION IS LIVE, THE HOVER STANDS DOWN. "When I have something
      // selected, I shouldn't be able to hover over others. Just keep one selected with
      // all the connections. If I close it, go back to the hover to see view."
      // Two emphases at once is two answers to one question: the pointer kept re-lighting
      // a second lineage over the top of the chosen one, and the picture argued with
      // itself. So the selection wins outright for as long as it stands, and the moment it
      // is cleared the hover has it back — no timer, no easing and nothing to remember,
      // because `hover` goes on tracking the pointer the whole time and only its EFFECT is
      // withheld.
      // `hold` is the same switch the pointer handlers ask, so the paint and the tooltip can
      // never disagree about who owns the picture: while the card stands the selection owns
      // it outright; once the card is dismissed the pointer has it back and the selection
      // keeps only what it had before — its ribbon lit whenever nothing is being hovered.
      const hold = this.selShown();
      // WHO IS DRIVING THE EMPHASIS, named, because how loud it is allowed to be follows
      // from that and from nothing else.
      const from = hold ? 'sel' : (this.hover ? 'hover' : (selId ? 'sel' : null));
      const kin = from === 'sel' ? this.kin(selId!) : (from === 'hover' ? this.kin(this.hover!) : null);
      /* A HOVER IS A GLANCE AND MUST BE THE QUIETEST THING IN THE VIEW. "Make the hover
         highlight less aggressive, it's hard to use now." It was inverted: the involuntary
         gesture dropped everything else to 0.13 while the deliberate one — a selection —
         only went to 0.34, so a pointer crossing the plate on its way somewhere kept
         collapsing the picture to near-black without being asked. Worse than the alpha,
         `dim` was also suppressing the ribbon NAMES, so hovering to find something deleted
         the labels you were navigating by.
         Now: a hover leaves the rest of the plate at HOVER_DIM, which is a shading rather
         than a blackout, AND KEEPS EVERY NAME. What makes the hovered lineage read is the
         lift — full ink plus a crisper outline on the ribbon actually under the pointer —
         not the loss of everything around it. Lifting one is cheaper than pushing down
         forty and it cannot damage legibility anywhere else.
         A SELECTION KEEPS ITS FOCUS at 0.34 with the context names dropped: that is a
         decision the reader made and it has earned the right to quiet the rest. A search
         query dims at the same strength for the same reason — it is also asked for. */
      const HOVER_DIM = 0.62, FOCUS_DIM = 0.34;
      const kinDim = from === 'hover' ? HOVER_DIM : FOCUS_DIM;
      this.bands = [];
      const labels: { text: string; x: number; y: number; min: number; max: number; size: number }[] = [];
      for (const [id, a] of this.lay.paths) {
        if (a.top.length < 2) continue;
        const p = a.p, col = this.colorOf(p, T);
        const offKin = !!(kin && !kin.has(id));
        const offQuery = !!(q && !p.name.toLowerCase().includes(q));
        // …and a name survives a hover. It is only dropped by the two acts the reader
        // asked for: a selection being read, and a query filtering the plate.
        const mute = offQuery || (offKin && from === 'sel');
        ctx.globalAlpha = offQuery ? FOCUS_DIM : (offKin ? kinDim : (kin && kin.has(id) ? 0.98 : 0.86));
        ctx.beginPath();
        ctx.moveTo(X(a.top[0][0]), TOP + a.top[0][1]);
        for (let i = 1; i < a.top.length; i++) ctx.lineTo(X(a.top[i][0]), TOP + a.top[i][1]);
        for (let i = a.bot.length - 1; i >= 0; i--) ctx.lineTo(X(a.bot[i][0]), TOP + a.bot[i][1]);
        ctx.closePath(); ctx.fillStyle = col; ctx.fill();
        // THE LIFT, in ink and alpha only — never the accent, which means "where you are in
        // time". The one under the pointer gets the crisp outline, its lineage a fainter
        // one: with the dim this gentle, the outline is what says WHICH, so it has to be
        // legible on a 6px ribbon at the full span.
        if (id === selId) { ctx.strokeStyle = T.ink; ctx.lineWidth = 2; ctx.globalAlpha = .95; ctx.stroke(); }
        else if (id === this.hover && from === 'hover') { ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6; ctx.globalAlpha = .8; ctx.stroke(); }
        else if (kin && kin.has(id)) { ctx.strokeStyle = T.ink; ctx.lineWidth = 1.1; ctx.globalAlpha = .5; ctx.stroke(); }
        // label inside the ribbon at its thickest point
        let bi = 0, bt = 0;
        for (let i = 0; i < a.top.length; i++) { const t = a.bot[i][1] - a.top[i][1]; if (t > bt) { bt = t; bi = i; } }
        const bx = X(a.top[bi][0]), by = TOP + (a.top[bi][1] + a.bot[bi][1]) / 2;
        const x0 = X(a.top[0][0]), x1 = X(a.top[a.top.length - 1][0]);
        if (bt >= 11 && x1 - x0 > 44 && !mute)
          labels.push({ text: p.name, x: bx, y: by, min: x0, max: x1, size: clamp(bt * 0.55, 10, 13) });
        this.bands.push({ id, a, p, col });
        ctx.globalAlpha = 1;
      }
      // lineage links across gaps (conquests, revivals)
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
      for (const b of this.bands) {
        for (const k of (this.lay.kids.get(b.id) || [])) {
          const kb = this.lay.paths.get(k); if (!kb || !kb.top.length) continue;
          const ax = X(b.a.top[b.a.top.length - 1][0]), ay = TOP + (b.a.top[b.a.top.length - 1][1] + b.a.bot[b.a.bot.length - 1][1]) / 2;
          const bx = X(kb.top[0][0]), by = TOP + (kb.top[0][1] + kb.bot[0][1]) / 2;
          if (Math.abs(bx - ax) < 3 && Math.abs(by - ay) < 26) continue;
          ctx.globalAlpha = (kin && (kin.has(b.id) && kin.has(k))) ? .75 : .16;
          ctx.strokeStyle = T.ink2; ctx.beginPath(); ctx.moveTo(ax, ay);
          ctx.bezierCurveTo((ax + bx) / 2, ay, (ax + bx) / 2, by, bx, by); ctx.stroke();
        }
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // axis
      ctx.strokeStyle = T.line; ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
      const span = this.d1 - this.d0;
      const steps = [2000, 1000, 500, 250, 100, 50, 25, 10, 5];
      const step = steps.find(s => span / s >= 6) || 5;
      ctx.beginPath();
      for (let y = Math.ceil(this.d0 / step) * step; y <= this.d1; y += step) {
        const x = X(y); ctx.moveTo(x, TOP - 6); ctx.lineTo(x, BOT + 4);
        // the tick keeps its exact x; only the centred label is nudged in, because a
        // first or last tick landing on the inset used to render as "00 BCE"
        const hw = ctx.measureText(fmtY(y)).width / 2;
        ctx.fillText(fmtY(y), clamp(x, hw + 3, cw - hw - 3), BOT + 20);
      }
      ctx.globalAlpha = .3; ctx.stroke(); ctx.globalAlpha = 1; ctx.textAlign = 'left';

      // ---- ribbon names, in one pass, on top of everything they name ----
      // Ribbons are filled in lineage order, so a name painted the instant its own ribbon
      // was filled got buried under every ribbon filled after it. That — not the canvas
      // edge — is where "Qing Dynast", "Portu…" and "Ancien(t Egypt)" came from. Same
      // two-pass shape connections.ts already uses for its labels.
      //
      // Thickest ribbon first, so when two names want the same patch of canvas the bigger
      // power keeps it, and the loser is simply absent rather than half-legible on top of
      // its neighbour.
      ctx.textAlign = 'center';
      const placed: number[][] = [];
      for (const L of labels.slice().sort((a, b) => b.size - a.size)) {
        ctx.font = fontUI(L.size, 600);                    // a polity name is language
        const half = ctx.measureText(L.text).width / 2;
        if (half * 2 > L.max - L.min - 8) continue;        // will not fit inside its own ribbon
        let lx = clamp(L.x, L.min + half + 4, L.max - half - 4);
        lx = clamp(lx, half + 3, cw - half - 3);           // ...and never off the plate
        if (lx - half < L.min || lx + half > L.max) continue;
        const box = [lx - half - 2, L.y - L.size * 0.7, lx + half + 2, L.y + L.size * 0.55];
        if (placed.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
        placed.push(box);
        ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,.34)';
        ctx.fillText(L.text, lx + 0.7, L.y + 4.4);
        ctx.fillStyle = '#fff'; ctx.fillText(L.text, lx, L.y + 3.8);
      }
      ctx.textAlign = 'left';
      if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
        const yr = this.d0 + (this.hoverX - G) / Wp * span;
        ctx.strokeStyle = T.accent; ctx.globalAlpha = .5; ctx.beginPath();
        ctx.moveTo(this.hoverX, TOP - 6); ctx.lineTo(this.hoverX, BOT + 2); ctx.stroke(); ctx.globalAlpha = 1;
        yearPill(ctx, T, this.hoverX, 2, fmtY(yr));
      }
      if (cfg.onRender) cfg.onRender(this);
    },
    at(mx: number, my: number) {
      const G = this.PAD, Wp = this.cv.clientWidth - G * 2, TOP = 26;
      if (!this.bands) return null;
      for (const b of this.bands) {
        const a = b.a; const n = a.top.length;
        const x0 = G + (a.top[0][0] - this.d0) / (this.d1 - this.d0) * Wp;
        const x1 = G + (a.top[n - 1][0] - this.d0) / (this.d1 - this.d0) * Wp;
        if (mx < x0 - 2 || mx > x1 + 2) continue;
        const t = clamp(Math.round((mx - x0) / Math.max(x1 - x0, 1) * (n - 1)), 0, n - 1);
        if (my >= TOP + a.top[t][1] - 1 && my <= TOP + a.bot[t][1] + 1) return b;
      }
      return null;
    },
    /** The ribbon's whole story, as the tooltip body. One builder, two callers:
     *  the mouse's hover and the finger's tap. */
    tipFor(b: any): string {
      const p = b.p;
      const par = (this.lay.pars.get(p.id) || []).map((i: string) => this.lay.set.get(i).name);
      const kid = (this.lay.kids.get(p.id) || []).map((i: string) => this.lay.set.get(i).name);
      return `<div class=t>${p.name}</div><div class=m>${fmtY(p.start)} – ${fmtY(p.end)}${p.region ? ' · ' + p.region : ''}</div>` +
        (p.note ? `<div class=m>${p.note}</div>` : '') +
        (par.length ? `<div class=m>← from ${par.join(', ')}</div>` : '') +
        (kid.length ? `<div class=m>→ becomes ${kid.join(', ')}</div>` : '');
    },
    init() {
      const cv = this.cv = $<HTMLCanvasElement>(cfg.canvas)!;
      armSafariGestureGuard();
      // ── gesture ─────────────────────────────────────────────────────────────
      // Declared before every handler that reads them: bindPinch must own the
      // FIRST pointerdown listener on this canvas, so that by the time the view's
      // own pointerdown runs, a second finger has already set `multi`.
      let drag: any = null;
      const startDrag = (p: { clientX: number; clientY: number }) => {
        drag = { x: p.clientX, y: p.clientY, d0: this.d0, d1: this.d1, moved: false };
      };
      /** Is this move a PAN rather than a look? Asked of the event itself rather than read
       *  off `drag.moved`, because the hover listener runs BEFORE the pan listener on the
       *  same event — trusting the flag would leave the first slid frame lit. Same slop as
       *  the pan uses (3px mouse, 10px touch), so the two can never disagree about whether
       *  a gesture has begun. */
      const panning = (e: PointerEvent) => !!drag
        && (drag.moved || Math.abs(e.clientX - drag.x) > slopFor(e) || Math.abs(e.clientY - drag.y) > slopFor(e));
      refuseSafariGestures(cv);
      const P = bindPinch(cv, {
        onStart: () => { drag = null; hideTip(); },
        onPinch: (now, prev) => {
          const r = cv.getBoundingClientRect(); const G = this.PAD, Wp = cv.clientWidth - G * 2;
          // the wheel's arithmetic, with `pow(1.0018, deltaY)` swapped for the
          // finger ratio — the same span clamp, the same fixed-point rule
          const yc = this.d0 + (prev.cx - r.left - G) / Wp * (this.d1 - this.d0);
          const s = clamp((this.d1 - this.d0) * (prev.d / now.d), 60, 16000);
          const frac = (yc - this.d0) / (this.d1 - this.d0);
          this.d0 = yc - frac * s; this.d1 = this.d0 + s;
          const dy = (now.cx - prev.cx) / Wp * s;         // then carry it with the midpoint
          this.d0 -= dy; this.d1 -= dy;
          this.render();
        },
        onRebase: p => startDrag(p),
      });
      cv.addEventListener('pointermove', e => {
        if (P.multi) { hideTip(); return; }
        const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        this.hoverX = mx;
        // NO HOVER ON A FINGER: a tooltip pinned under the fingertip covers the
        // ribbon it describes. The tap path below opens the same tooltip, offset
        // from the touch, and the next tap on empty ground dismisses it.
        if (e.pointerType !== 'mouse') return;
        // AND NO HOVER WHILE THE WORLD IS MOVING UNDER THE POINTER. "When you have
        // something highlighted and you move/pan around you get all different entities
        // highlighted." The pointer is not looking during a drag — it is holding the sheet —
        // but every ribbon that slid past it was hit-tested, lit, and given a tooltip, so a
        // pan strobed through a dozen highlights and lost the one that was chosen. A drag is
        // navigation, not inspection, in either state: with a selection standing it would
        // fight the selection, and with none it is still noise. Emphasis resumes on the next
        // move after the button comes up, which is a look again.
        // No render() here: the pan listener below paints this same event, and clearing
        // `hover` first is what that paint reads.
        if (panning(e)) { this.hover = null; hideTip(); return; }
        const b = this.at(mx, my);
        const id = b ? b.id : null;
        // `hover` keeps tracking even while a selection holds the picture — render()
        // withholds the emphasis, and clearing the selection brings it straight back under
        // a pointer that never moved.
        this.hover = id;
        // THE TOOLTIP GOES WITH THE EMPHASIS. It is the same act read twice: describing the
        // ribbon under the pointer while the card describes the chosen one puts two answers
        // on screen to one question. The CURSOR does not go with it — this still says
        // `pointer` over every ribbon, because clicking another one must still pick it, and
        // the hit test underneath is untouched.
        if (this.selShown()) {
          hideTip();
          cv.style.cursor = b ? 'pointer' : 'crosshair';
          this.render();                                   // the year pill still follows the pointer
          return;
        }
        this.render();
        if (b) {
          showTip(e.clientX, e.clientY, this.tipFor(b));
          cv.style.cursor = 'pointer';
        } else { hideTip(); cv.style.cursor = 'crosshair'; }
      });
      cv.addEventListener('pointerleave', () => { hideTip(); this.hover = null; this.hoverX = null; this.render(); });
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const r = cv.getBoundingClientRect(); const G = this.PAD, Wp = cv.clientWidth - G * 2;
        const yc = this.d0 + (e.clientX - r.left - G) / Wp * (this.d1 - this.d0);
        const f = Math.pow(1.0018, e.deltaY); const s = clamp((this.d1 - this.d0) * f, 60, 16000);
        const frac = (yc - this.d0) / (this.d1 - this.d0);
        this.d0 = yc - frac * s; this.d1 = this.d0 + s; this.render();
      }, { passive: false });
      cv.addEventListener('pointerdown', e => {
        if (P.multi) { drag = null; hideTip(); return; }
        startDrag(e);
        try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
      });
      /* THIS VIEW HAD NO TAP AT ALL. Every fact it holds — the polity's name, its
         dates, what it came from and what it became — lived in a hover tooltip,
         and there is no hover on a finger, so on an iPad the Flow was a picture
         with no readable content whatsoever. The tap opens the tooltip the mouse
         would have got, and a tap on empty ground dismisses it.

         AND NOW IT SELECTS, on a finger and on a mouse alike. "When we click one
         space across map/timeline/flow/connections/cube — this should be possible.
         All should have clickeable details — showing the card." A ribbon is a
         polity (a braid stream is a belief), both of which the card already knows
         how to describe, so a click here is the same act as a click on the
         timeline: write the global selection, and let the card open beside the
         thing that was clicked. Empty canvas clears it, exactly as the timeline
         and the map do. The tooltip stays for the finger only — the mouse has
         hover, and a tooltip AND a card for one mouse click is two answers to one
         question. */
      cv.addEventListener('pointerup', e => {
        const wasDrag = drag && drag.moved; drag = null;
        if (wasDrag || P.tapBlocked) return;
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const b = this.at(mx, e.clientY - r.top);
        if (e.pointerType !== 'mouse') {
          // ON A FINGER THE TAP IS BOTH: the tooltip AND the selection. There is no hover to
          // suspend here, and this tooltip describes the very ribbon being selected, so it
          // is one answer and not two — it is the only way a touch reader ever sees a
          // polity's dates and lineage.
          if (b) showTip(e.clientX, e.clientY, this.tipFor(b)); else hideTip();
        } else if (b) hideTip();      // ...whereas on a mouse the card is about to say it
        // the SelStore subscriber below repaints — no render() here, or the card
        // would be anchored against a canvas the store is about to redraw anyway
        SelCard.select(b ? this.selIdOf(b.id) : null, b ? this.rectOf(b, mx) : null);
      });
      cv.addEventListener('pointermove', e => {
        if (!drag || P.multi) return;
        const G = this.PAD, Wp = cv.clientWidth - G * 2;
        const dx = e.clientX - drag.x;
        if (Math.abs(dx) > slopFor(e) || Math.abs(e.clientY - drag.y) > slopFor(e)) drag.moved = true;
        const dy = dx / Wp * (drag.d1 - drag.d0);
        this.d0 = drag.d0 - dy; this.d1 = drag.d1 - dy; this.render();
      });
      // A selection made ANYWHERE — the timeline, the map, the cube, search — lights
      // up its ribbon here, and one made here survives leaving the view, because
      // both directions are the same one global store.
      SelStore.subscribe(() => this.render());
      repaintOnFonts(() => this.render());
    },
    /** WHAT THE "Find a polity…" FIELD DROVE, now that the field is gone.
     *  A query DIMS every ribbon whose name does not contain it and leaves the
     *  matches at full ink — a filter over the whole picture, not a selection of
     *  one thing, which is why it could not simply become a SelStore write. The
     *  global "Search anything…" is the only search in the app now, so this is a
     *  method instead of an <input> listener. Returns how many ribbons it keeps,
     *  which is the number the old "N hits" readout showed. */
    setQuery(q: string): number {
      this.q = (q || '').trim();
      this.render();
      if (!this.q) return 0;
      const ql = this.q.toLowerCase();
      return this.items.filter((p: any) => String(p.name).toLowerCase().includes(ql)).length;
    },
    animTo(a: number, b: number) {
      if (reduceMotion()) { this.d0 = a; this.d1 = b; this.render(); return; }
      const A = this.d0, B = this.d1, t0 = performance.now();
      const step = (t: number) => {
        const p = clamp((t - t0) / 620, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        this.d0 = A + (a - A) * e; this.d1 = B + (b - B) * e; this.render(); if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };
}

// ================= ③ FLOW OF EMPIRES =================
// THE VIEW OPENS ON THE ABSOLUTE SCALE. "Flow is awesome! Keep it as-is and make the
// Absolute view the default." Share of world answers "who dominated THIS century", which
// is a second question; absolute answers the first one — how big, against everything else
// — and it is the one the ribbons are shaped to tell. Nothing remembers the reader's
// choice (no mode is written to localStorage anywhere in this app), so this constant is
// the whole of the default: every reload starts here, and the toggle is one click away.
export const Flow = Ribbons({
  canvas: '#flowCanvas', d0: -1200, d1: 2026, height: 600, mode: 'abs', colorBy: 'region',
  onRender(r) {
    const n = r.items.length;
    $('#flowCap')!.innerHTML = `<b>${n} polities, ${r.mode === 'norm' ? 'share of world weight' : 'absolute weight'}.</b> ` +
      `Thickness is an editorial estimate of scale and influence (10 = the dominant power on Earth of its era, 1 = a small local culture) — an argument, not a measurement. ` +
      `Dashed curves are lineage links that jump across the stack: a conquest, a partition, a revival.`;
  },
});

/** ONE VOCABULARY FOR THE TWO VIEWS THAT CARRY THIS TOGGLE. Empires and Beliefs draw the
 *  same two scales out of the same engine, so they must not describe them in two different
 *  sets of words — and neither of them may hardcode a resting label, because the label
 *  names the mode a click would GO TO, which is a function of the live mode and nothing
 *  else. Braid's button is minted in braid.ts and lands here for its wording. */
export function labelModeButton(btn: HTMLButtonElement, mode: string) {
  btn.textContent = mode === 'norm' ? 'Absolute scale' : 'Share of world';
  btn.title = mode === 'norm'
    ? 'Every year fills the plate — thickness is a share of that year’s world. Switch to one fixed scale for the whole span.'
    : 'One fixed scale for the whole span — equal weight, equal thickness in every year. Switch to each year filling the plate.';
}

export const REGIONNAMES: Record<string, string> = { EU: 'Europe', ME: 'MidEast & Africa', AS: 'Asia', AM: 'Americas & Oceania', AF: 'Africa' };

// ================= region filter — All / None / only =================
// "Disable/enable all categories so I can choose just specific ones" shipped for the
// timeline's #catRow and stopped there; these chips are the same need, so they get the
// same three verbs, the same words and the same restore-what-I-had behaviour. Flow.off is
// the single source of truth — everything below is only a different way of writing it.
let REGIONS: string[] = [];
// what the reader was looking at before they isolated one region, so "back" can restore it
let regionPrevOff: Set<string> | null = null;
const regionIsSolo = (rg?: string) =>
  REGIONS.length > 1 && Flow.off.size === REGIONS.length - 1 && (rg === undefined || !Flow.off.has(rg));

function regionAll() { Flow.off.clear(); regionPrevOff = null; syncRegionChips(); Flow.render(); }
function regionNone() {
  if (Flow.off.size !== REGIONS.length) regionPrevOff = new Set(Flow.off);
  Flow.off = new Set(REGIONS);
  syncRegionChips(); Flow.render();
}
function regionToggle(rg: string) {
  if (Flow.off.has(rg)) Flow.off.delete(rg); else Flow.off.add(rg);
  syncRegionChips(); Flow.render();
}
function regionSolo(rg: string) {
  if (regionIsSolo(rg)) {
    Flow.off = regionPrevOff ? new Set(regionPrevOff) : new Set<string>();
    regionPrevOff = null;
  } else {
    if (!regionIsSolo()) regionPrevOff = new Set(Flow.off);   // don't clobber it while hopping solo→solo
    Flow.off = new Set(REGIONS.filter(r => r !== rg));
  }
  syncRegionChips(); Flow.render();
}
function syncRegionChips() {
  document.querySelectorAll<HTMLElement>('#flowRegionRow .chip[data-region]').forEach(ch => {
    const rg = ch.dataset.region!, name = REGIONNAMES[rg] || rg;
    const shown = !Flow.off.has(rg), solo = regionIsSolo(rg);
    ch.classList.toggle('on', shown);
    ch.setAttribute('aria-pressed', String(shown));
    const only = ch.querySelector<HTMLElement>('.only');
    if (only) only.textContent = solo ? 'back' : 'only';
    ch.title = solo
      ? `${name} is the only region showing. BACK (or ⌥/Alt-click, or Alt+Enter) restores the set you had before.`
      : `${name} — click to show or hide. ONLY (or ⌥/Alt-click, or Alt+Enter) isolates this region.`;
  });
  const cnt = $('#flowRegionCount');
  if (cnt) cnt.textContent = `${REGIONS.length - Flow.off.size} of ${REGIONS.length}`;
}
// Appends into the EXISTING #flowRegionRow (Lab.tsx owns that element) — append only,
// never restructure.
function buildRegionRow() {
  const row = $('#flowRegionRow'); if (!row) return;
  REGIONS = [...new Set(POLITIES.map(p => p.region))].filter(Boolean) as string[];
  if (row.querySelector('[data-region]')) { syncRegionChips(); return; }   // already built (HMR / re-init)
  const OFF = '.45';                                             // resting opacity of the "only" affordance

  // All / None are VERBS, not filters — .chip.catall in globals.css deliberately gives
  // them no swatch and no pressed state, so nothing is set inline. The live state they act
  // on is carried by the "n of 5" readout instead.
  const master = (kind: 'all' | 'none', label: string, hint: string) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip catall'; b.dataset.regionall = kind;
    b.textContent = label; b.title = hint;
    b.addEventListener('click', () => (kind === 'all' ? regionAll() : regionNone()));
    row.appendChild(b);
  };
  master('all', 'All', 'Show every region');
  master('none', 'None', 'Hide every region — then click the one or two you want');

  const cnt = document.createElement('span');
  cnt.className = 'note'; cnt.id = 'flowRegionCount';
  cnt.style.cssText = 'font-variant-numeric:tabular-nums';
  row.appendChild(cnt);

  const sep = document.createElement('span');
  sep.setAttribute('aria-hidden', 'true');
  sep.style.cssText = 'flex:none;align-self:center;width:1px;height:15px;background:var(--line)';
  row.appendChild(sep);

  for (const rg of REGIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip on'; b.dataset.region = rg;
    b.setAttribute('aria-pressed', 'true');
    // the "only" tag is a mouse target INSIDE the button, so it must not be focusable
    // itself (interactive content may not nest). aria-keyshortcuts is the keyboard route
    // and, unlike a title tooltip, screen readers announce it.
    b.setAttribute('aria-keyshortcuts', 'Alt+Enter');
    const hue = Flow.hues[rg] !== undefined ? Flow.hues[rg] : 280;
    b.innerHTML = `<span class="dot" style="background:hsl(${hue} 45% 52%)"></span>${REGIONNAMES[rg] || rg}` +
      `<span class="only" aria-hidden="true" style="padding-left:7px;` +
      `border-left:1px solid var(--line);font-size:var(--tl-text-2xs,10px);` +
      `letter-spacing:var(--tl-track-caps,.06em);text-transform:uppercase;` +
      `opacity:${OFF}">only</span>`;
    b.addEventListener('click', e => {
      const t = e.target as HTMLElement | null;
      if ((t && t.closest && t.closest('.only')) || e.altKey || e.metaKey) regionSolo(rg);
      else regionToggle(rg);
    });
    // a keyboard-activated click carries no modifier state in Chromium, so Alt+Enter /
    // Alt+Space must be caught here or the isolate has no keyboard route at all
    b.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); regionSolo(rg); }
    });
    const only = b.querySelector<HTMLElement>('.only')!;
    const fade = (v: string) => { only.style.opacity = v; };
    b.addEventListener('pointerenter', () => fade('1'));
    b.addEventListener('pointerleave', () => fade(OFF));
    b.addEventListener('focus', () => fade('1'));
    b.addEventListener('blur', () => fade(OFF));
    row.appendChild(b);
  }
  syncRegionChips();
}

export function initFlow() {
  Flow.items = POLITIES;
  Flow.init();
  buildRegionRow();
  // Reset the query too: "Follow Rome" is a framing, and arriving at year -300
  // with two thirds of the plate still dimmed by a stale filter reads as broken.
  $('#flowRome')!.addEventListener('click', () => { Flow.setQuery(''); Flow.animTo(-300, 900); });
  $('#flowSplit')!.addEventListener('click', () => Flow.animTo(180, 820));
  $('#flowAll')!.addEventListener('click', () => Flow.animTo(-1200, 2026));
  /* THE BUTTON NAMES WHAT A CLICK WILL DO, not what is on the plate — so its resting
     label is the OTHER mode. Lab.tsx ships it reading "Absolute scale", which was right
     while this view booted in share-of-world and is a lie the moment the default changes.
     The label is therefore written from the LIVE mode at init, by the same expression the
     click uses, and there is nothing left to keep in step by hand. */
  const modeBtn = $<HTMLButtonElement>('#flowMode')!;
  const syncModeBtn = () => labelModeButton(modeBtn, Flow.mode);
  syncModeBtn();
  modeBtn.addEventListener('click', () => {
    Flow.mode = Flow.mode === 'norm' ? 'abs' : 'norm';
    syncModeBtn();
    Flow.render();
  });
  /* THIS VIEW NO LONGER HAS A SEARCH FIELD OF ITS OWN. #flowSearch and #flowCnt
     were a second, weaker search sitting three inches from the global one: they
     could only match a substring of a polity NAME, only inside this one view,
     and only by dimming. "Search anything…" is the only search in the app now.
     What the field could do survives as Flow.setQuery(q) above — call that to
     filter the ribbons, or write the global selection to light exactly one. */
}
