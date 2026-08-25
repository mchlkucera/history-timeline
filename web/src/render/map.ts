/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ① MAP =================
// Ported from prototypes/partB.html. Only change: `cv` is resolved in init() instead of
// at module load, because in Next the module is evaluated before the DOM exists.
import {
  $, GEO, YEARS, CAPSULES, SelStore, TimeStore, clamp, fitCanvas, fmtY, featureAt, fontUI,
  hexHsl, hexOklch, hslHex, maxChroma, mix, oklchHex, repaintOnFonts, showTip, hideTip,
  sovColor, textW, tokens,
} from './shared';
import { SelCard } from './selcard';
import { describe, featureLabel, polityForFeature, registerSubject, territoryAt } from './subject';

/* =============================================================================
   THE ATLAS TINT — why 1492 was a soup, and what it is now.

   MEASURED, not guessed. Three faults stacked, and only the first is the one
   everybody sees:

   1. THE POLYGONS GENUINELY OVERLAP, and only in 1492. Sampling the Americas
      on a 1° grid: 1492 runs a mean stack depth of 1.96 with a maximum of 8 —
      the source atlas (aourednik/historical-basemaps) draws indigenous nation
      extents that legitimately nest and cross. 1600 and 1715 measure 1.00 flat
      and 1279 measures 1.00. So the 881-feature year was not adjacent shapes
      bleeding at the seams; it was up to eight translucent fills multiplying
      on top of one another, which is the definition of mud. Alpha could never
      have survived that, so the fills are now OPAQUE and the overlap is
      resolved by Z-ORDER instead — see buildPaths.

   2. THE COLOUR VARIATION WAS FREE JITTER. sovColor() hands an unfamous
      sovereign `hsl(h 34-52% 52-66%)`, and HSL lightness is not lightness:
      across 1492's 830 distinct sovereigns that band spans OKLab L 0.400 →
      0.828 and chroma 0.055 → 0.203. Half the perceptual range and a 3.7×
      chroma spread, at random, on adjacent ground — that is the psychedelia.
      The territory pigment now keeps the sovereign's HUE (so one empire is
      still one hue on the map, in the core sample's swatch and in the cube)
      and BOUNDS the other two axes to a three-rung ladder inside one narrow
      band: ΔL 0.09 total, one chroma. It is the same discipline the timeline's
      catLadder applies, spelled for a field of contiguous fills rather than
      for rectangles floating on whitespace.

   3. THE LABELS NEVER CHECKED EACH OTHER. See labels() below.

   The band is chosen where sRGB actually has room. The tightest hue holds
   C 0.111 at L 0.78 and C 0.088 at the top rung L 0.825, so the 0.086 target
   is reached at EVERY hue: the tint is genuinely uniform, nothing clips, and
   therefore nothing drifts in hue — the one thing a sovereign's colour may not
   lose. Dark ground gets its own band (L 0.395–0.485, C 0.066) for the same
   reason, measured the same way.
============================================================================= */
const TINT = {
  light: { L: [0.735, 0.780, 0.825], C: 0.086, neutral: 0.830 },
  dark: { L: [0.395, 0.440, 0.485], C: 0.066, neutral: 0.375 },
};
/** Chroma for ground the atlas does not attribute to anyone. Not zero — it is
 *  still land and still needs to sit on the sea — but far enough below the
 *  0.086/0.066 the named powers get (ΔE ≈ 7) to read as "nobody said". */
const NEUTRAL_C = 0.010;
/** Which of the three rungs this sovereign takes. Decorrelated from the hue on
 *  purpose: two neighbours that landed on near-identical hues then still have a
 *  2-in-3 chance of differing by ΔL 0.045 (≈ΔE 4.5) as well as by their border. */
const rungOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) % 3;
};
const _tint = new Map<string, [string, string]>();
/** [fill, dimmed fill] for one sovereign on this ground. The dim is a real
 *  colour mixed toward the sea, NEVER an alpha: alpha over eight stacked
 *  polygons is the bug this whole file just walked away from. */
function territoryFill(sov: string, light: boolean, sea: string): [string, string] {
  const key = (light ? 'L' : 'D') + sov;
  const hit = _tint.get(key); if (hit) return hit;
  const band = light ? TINT.light : TINT.dark;
  const named = (sov || '').trim() && (sov || '').trim() !== '?';
  let L: number, C: number, h: number;
  if (named) {
    const src = sovColor(sov);                       // the sovereign's identity hue
    const m = /^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/.exec(src);
    const hex = m ? hslHex(+m[1], +m[2], +m[3]) : src;
    h = hexOklch(hex)[2];
    L = band.L[rungOf(sov)];
    C = band.C;
  } else {
    // GROUND NOBODY IS NAMED FOR. 51 of 75 features at 3000 BCE, 91 of 617 at
    // 1600 — the source atlas draws the shape and leaves the label blank, and
    // the old palette handed all of it one arbitrary olive, which claimed
    // there was a polity called '?' holding two thirds of the Bronze Age. It
    // gets the sea's own hue at almost no chroma instead: unmistakably land,
    // unmistakably unattributed, and the handful of named powers on those
    // snapshots finally stand out of it.
    h = hexOklch(sea)[2];
    L = band.neutral;
    C = NEUTRAL_C;
  }
  const fill = oklchHex(L, Math.min(C, maxChroma(L, h) * 0.97), h);
  const out: [string, string] = [fill, mix(sea, fill, 0.30)];
  if (_tint.size > 6000) _tint.clear();
  _tint.set(key, out);
  return out;
}

export const WorldMap = {
  cv: null as unknown as HTMLCanvasElement, ix: 11, k: 1, tx: 0, ty: 0, playing: null as any,
  MW: 1000, MH: 403,
  _placed: false,                                  // has the first pan been centred?
  px(lon: number) { return (lon + 180) / 360 * this.MW; },
  py(lat: number) { return (85 - lat) / 145 * this.MH; },
  ilon(x: number) { return x / this.MW * 360 - 180; },
  ilat(y: number) { return 85 - y / this.MH * 145; },
  paths: {} as Record<number, { f: any; p: Path2D }[]>,
  /**
   * THE DRAW ORDER IS BIGGEST FIRST, and that is load-bearing now that the
   * fills are opaque. Where the source genuinely overlaps — 1492's indigenous
   * nations, up to eight deep — the polygon left on top is the SMALLEST one
   * covering the pixel, which is exactly the feature featureAt() returns for a
   * click there. Before this the order was whatever the file happened to list,
   * so the thing you saw and the thing you selected were two different
   * territories about a third of the time in the Americas. Sorted once per
   * snapshot, with the paths, and memoised with them.
   */
  buildPaths(y: number) {
    if (this.paths[y]) return this.paths[y];
    const built = GEO[y].map((f: any) => {
      const p = new Path2D();
      for (const r of f.rings) {
        p.moveTo(this.px(r[0]), this.py(r[1]));
        for (let i = 2; i < r.length; i += 2) p.lineTo(this.px(r[i]), this.py(r[i + 1]));
        p.closePath();
      }
      return { f, p };
    });
    built.sort((a: any, b: any) => b.f.area - a.f.area);
    return this.paths[y] = built;
  },
  year() { return YEARS[this.ix]; },

  /**
   * THE SELECTED POLITY'S TERRITORY IN THIS SNAPSHOT — or nothing at all.
   *
   * The join runs through the time-gated alias table in public/data/
   * polities.json (subject.ts), the same one the cube traces with: polity id →
   * snapshot year → the sovereign strings the border data actually uses that
   * year. Looked up PER SNAPSHOT and never pooled across them, because the
   * whole value of the table is that "Egypt" means Ancient Egypt in 3000 BCE
   * and nothing whatsoever in 1994.
   *
   * null means "nothing is selected, draw the world as it is". An EMPTY SET
   * means "something is selected and it is honestly not here" — and in that
   * case the map dims nothing and the Reading capsule says so, because dimming
   * the whole world to highlight nothing is a map telling you it found
   * something.
   */
  highlight(): Set<string> | null {
    const s = describe(SelStore.id);
    if (!s) return null;
    // A BARE FEATURE selected by clicking it: no curated polity, so no alias
    // table to join through — it is highlighted under the very strings the
    // border data draws it with, and ONLY while a snapshot still uses them.
    // Verified against this snapshot rather than assumed, because a set that
    // matches nothing would dim the whole world to highlight nothing, which is
    // a map telling you it found something.
    if (s.sovs && s.sovs.length) {
      const want = new Set(s.sovs.filter(Boolean));
      for (const f of (GEO[this.year()] || [])) if (want.has(f.sov) || want.has(f.name)) return want;
      return null;
    }
    if (!s.polity) return null;
    const hit = territoryAt(s.polity, this.year());
    return hit.size ? hit : null;
  },

  /**
   * THE ONE PATCH OF NAMELESS GROUND THAT WAS CLICKED — or nothing.
   *
   * A bare feature is normally highlighted through the sovereign strings the
   * border data draws it with (see above). An UNNAMED one has no such string:
   * its name and its sovereign are both '?', and 51 of the 75 features at 3000
   * BCE share that. Joining on it dimmed the world to highlight two thirds of
   * it, which is not a highlight. So a nameless feature is held by OBJECT
   * IDENTITY instead — GEO's arrays are built once and never replaced — and
   * only while the map is still on the snapshot it was clicked in.
   */
  soloFeature(): any | null {
    const s = describe(SelStore.id);
    if (!s || !s.minimal || !s.feat) return null;
    if (s.sovs && s.sovs.length) return null;        // it has a string; join on it
    return s.fyear === this.year() ? s.feat : null;
  },

  /** Move to the snapshot nearest a year WITHOUT writing TimeStore — the map
   *  follows the global moment here, it does not set it. */
  syncToYear(year: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < YEARS.length; i++) { const d = Math.abs(YEARS[i] - year); if (d < bd) { bd = d; best = i; } }
    this.ix = best;
  },
  /**
   * THE MAP COVERS THE STAGE — it does not letterbox inside it.
   *
   * The canvas used to derive its height from its width at the atlas's own
   * 1000:403, which on any stage taller than that left a band of the chart-film
   * graticule above and below the world: "the map does not show for full height
   * of what it can - i can see squares above and below it."
   *
   * So the canvas takes the whole stage height and the projection COVERS it:
   * s0 = max(width/1000, height/403). Whichever axis has spare world runs off
   * the edge and is reached with the pan that was already there — clamped in
   * clampPan() so there is never void beyond ±180° or beyond 85°N/60°S. It is
   * the same equirectangular projection at a different scale, so px/py/ilon/
   * ilat, the click resolution and the highlight all keep working untouched:
   * every one of them goes through s0.
   *
   * The height is read off .tl-view — the stage-sized box the section fills —
   * and NOT off .tl-canvasbox, whose height is the canvas's own and would be
   * circular. A hidden view measures 0 on both axes and size() returns null,
   * which is the no-op every renderer here relies on.
   */
  availH(cw: number) {
    const view = this.cv.closest('.tl-view') as HTMLElement | null;
    const st = document.getElementById('stage');
    const h = (view && view.clientHeight) || (st && st.clientHeight) || 0;
    return h ? Math.max(200, h) : Math.round(cw * this.MH / this.MW);
  },
  size() {
    if (!this.cv) return null;
    const cw = this.cv.clientWidth || this.cv.parentElement!.clientWidth; if (!cw) return null;
    const ch = this.availH(cw);
    const d = fitCanvas(this.cv, ch); if (!d) return null;
    return { cw: d.cw, ch, ctx: d.ctx, s0: Math.max(d.cw / this.MW, ch / this.MH) };
  },
  render() {
    const dim = this.size(); if (!dim) return;
    // The world is now bigger than the frame, so the pan is load-bearing: it is
    // re-fitted on every paint (cheap, and idempotent) so a resize or a theme
    // repaint can never leave the viewport parked off the edge of the world.
    this.fitPan(dim, !this._placed); this._placed = true;
    const { cw, ch, ctx, s0 } = dim; const T = tokens(); const y = this.year();
    const hsl = hexHsl(T.sea); const lightGround = (hsl ? hsl[2] : 92) > 50;
    ctx.fillStyle = T.sea; ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(this.tx, this.ty); ctx.scale(this.k * s0, this.k * s0);
    ctx.lineWidth = 0.6 / (this.k * s0); ctx.strokeStyle = T.line; ctx.globalAlpha = .5;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) { ctx.moveTo(this.px(lon), 0); ctx.lineTo(this.px(lon), this.MH); }
    for (let lat = -60; lat <= 85; lat += 30) { ctx.moveTo(0, this.py(lat)); ctx.lineTo(this.MW, this.py(lat)); }
    ctx.stroke(); ctx.globalAlpha = 1;
    const paths = this.buildPaths(y);
    const solo = this.soloFeature();
    const hi = solo ? null : this.highlight();
    const onSel = (f: any) => (solo ? f === solo : !!hi && (hi.has(f.sov) || hi.has(f.name)));
    const dimming = !!solo || !!hi;
    const nSel = solo ? 1 : (hi ? hi.size : 0);   // what the Reading capsule counts
    /**
     * ONE PASS, OPAQUE, IN Z-ORDER. Each territory is filled at full opacity
     * and then hairlined, so adjacency reads as a BORDER instead of as a blend
     * and eight-deep overlap reads as the smallest claim on top instead of as
     * a bruise. Only the hairline still spends alpha — a shared edge stroked
     * twice just comes out a shade firmer, which is what a shared edge is.
     */
    ctx.lineWidth = 0.7 / (this.k * s0);
    ctx.strokeStyle = T.stroke;
    for (const { f, p } of paths) {
      const on = !dimming || onSel(f);
      const [fill, dimmed] = territoryFill(f.sov, lightGround, T.sea);
      ctx.globalAlpha = 1;
      ctx.fillStyle = on ? fill : dimmed;
      ctx.fill(p, 'evenodd');
      ctx.globalAlpha = on ? .85 : .3;
      ctx.stroke(p);
    }
    // the selection outline, drawn last so it is never cut by a neighbour
    if (dimming) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.7 / (this.k * s0);
      ctx.strokeStyle = T.ink;
      for (const { f, p } of paths) if (onSel(f)) ctx.stroke(p);
      ctx.lineWidth = 0.7 / (this.k * s0);
    }
    ctx.globalAlpha = 1;
    this.labels(ctx, paths, dim, T);
    ctx.restore(); ctx.textAlign = 'left';
    $('#yearLabel')!.textContent = fmtY(y);
    ($('#yearSlider') as HTMLInputElement).value = String(this.ix);
    $('#yearSlider')!.setAttribute('aria-valuetext', fmtY(y));
    const near = TimeStore.year !== y ? `Nearest snapshot to <b>${fmtY(TimeStore.year)}</b> — ` : '';
    // The selection's own line comes FIRST: if you pressed "See on map", the
    // answer to "where is it" outranks the capsule prose about the year.
    const sel = describe(SelStore.id);
    let lede = '';
    if (sel && (sel.polity || sel.minimal)) {
      const when = TimeStore.year === y ? fmtY(y) : `${fmtY(TimeStore.year)} (nearest snapshot ${fmtY(y)})`;
      const n = nSel;
      const span = `${fmtY(sel.start)} – ${fmtY(sel.end)}`;
      lede = n
        ? `<b>${sel.name}</b> · ${span} · ${n} ${n === 1 ? 'territory' : 'territories'} highlighted in ${when}.<br>`
        : `<b>${sel.name}</b> · ${span} · <b>not on the map in ${when}</b>.<br>`;
    }
    $('#capsule')!.innerHTML = `${lede}${near}<b>The world in ${fmtY(y)}.</b> ${CAPSULES[String(y)] || ''}`;
  },
  /**
   * PLACE NAMES — and the four rules that stop 881 of them from becoming a
   * second kind of noise.
   *
   * The old pass took the 60 largest features in the WORLD, drew a name on any
   * whose label box cleared 52px, and stopped after 14 + 10k of them. Nothing
   * in that ever asked whether a name was on screen or whether it landed on
   * top of another one, so 1279's North America carried "Desert hunter-
   * gatherers", "Great Basin hunters" and "Eastern North American hunter-
   * gatherers" stacked into one illegible smear — and at any zoom most of the
   * budget was spent on names outside the viewport that were never painted.
   *
   *   1. ON SCREEN FIRST. Candidates are clipped to the visible world rect
   *      before they are ranked, so zooming into the Andes spends the whole
   *      budget on the Andes.
   *   2. BIGGEST FIRST. Ranked by extent, so when two names cannot both be
   *      drawn the larger territory keeps its name — the graceful degradation
   *      a reader can predict.
   *   3. THE NAME MUST FIT THE GROUND. A territory has to be worth ~30px and
   *      the name may not run more than 2.4× its width; an unnamed feature
   *      ('?' in the source atlas) is never labelled at all, and a name is
   *      never painted twice (1600 draws "Ottoman Empire" as two features).
   *   4. NOTHING COLLIDES, EVER. Every accepted label reserves its box; a
   *      candidate that intersects one already placed is dropped, not nudged.
   *      Dropping is honest — a nudged label points at the wrong ground.
   *
   * All of it in world units, because that is the space the canvas is in while
   * the transform is up; the font is 11/scale so its metrics are too.
   */
  labels(ctx: CanvasRenderingContext2D, paths: { f: any; p: Path2D }[], dim: { cw: number; ch: number; s0: number }, T: any) {
    const scale = this.k * dim.s0;
    const font = fontUI(11 / scale, 600);            // a place name is language
    ctx.font = font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const x0 = -this.tx / scale, x1 = (dim.cw - this.tx) / scale;
    const y0 = -this.ty / scale, y1 = (dim.ch - this.ty) / scale;
    const cand: { f: any; nm: string; cx: number; cy: number }[] = [];
    for (const { f } of paths) {
      // '?' is the atlas's "no name"; so is a run of spaces, which is what one
      // feature actually carries — drawn, it would spend a slot on nothing.
      const nm = typeof f.name === 'string' ? f.name.trim() : '';
      if (!f.lc || !nm || nm === '?') continue;
      const cx = this.px(f.lc[0]), cy = this.py(f.lc[1]);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      cand.push({ f, nm, cx, cy });
    }
    cand.sort((a, b) => b.f.area - a.f.area);
    const pad = 3 / scale, halfH = 7 / scale;
    const boxes: number[][] = [];
    const seen = new Set<string>();
    for (const c of cand) {
      if (boxes.length >= 44) break;                 // a ceiling on the ink, not on the truth
      if (seen.has(c.nm)) continue;
      const fw = c.f.lw / 360 * this.MW;             // the ground's own width, world units
      if (fw * scale < 30) continue;                 // too small on screen to own a name
      const w = textW(ctx, c.nm, font);
      if (w > fw * 2.4) continue;                    // the name would swamp the ground
      const hw = w / 2 + pad, hh = halfH + pad;
      const b = [c.cx - hw, c.cy - hh, c.cx + hw, c.cy + hh];
      // A HALF-LABEL IS A COLLISION WITH THE FRAME. The centre test above only
      // says the anchor is on screen; a long name anchored two pixels inside
      // the left edge still runs off it, which is how "Madagascar" came to be
      // painted as "adagascar" against the bezel.
      if (b[0] < x0 || b[2] > x1 || b[1] < y0 || b[3] > y1) continue;
      let clash = false;
      for (const o of boxes) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) { clash = true; break; }
      if (clash) continue;
      boxes.push(b); seen.add(c.nm);
      ctx.lineWidth = 3 / scale; ctx.strokeStyle = T.bg; ctx.globalAlpha = .55;
      ctx.strokeText(c.nm, c.cx, c.cy);
      ctx.globalAlpha = .95; ctx.fillStyle = T.ink;
      ctx.fillText(c.nm, c.cx, c.cy);
    }
    ctx.globalAlpha = 1;
  },
  screenToLonLat(sx: number, sy: number) {
    const dim = this.size()!; const s0 = dim.s0;
    const mx = (sx - this.tx) / (this.k * s0), my = (sy - this.ty) / (this.k * s0);
    return [this.ilon(mx), this.ilat(my)];
  },
  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#mapCanvas')!;
    TimeStore.subscribe(() => {
      if (TimeStore.source === 'map') return;          // our own write — no-op (anti-loop)
      this.stop();
      let best = 0, bd = Infinity;
      for (let i = 0; i < YEARS.length; i++) { const d = Math.abs(YEARS[i] - TimeStore.year); if (d < bd) { bd = d; best = i; } }
      this.ix = best;
      this.render();
    });
    // SelStore is global, so the map has to answer it too — this is what makes
    // a selection made on the timeline still mean something over here.
    SelStore.subscribe(() => this.render());
    $('#yearSlider')!.addEventListener('input', (e: any) => { this.ix = +e.target.value; this.render(); TimeStore.set(YEARS[this.ix], 'map'); });
    $('#btnReset')!.addEventListener('click', () => { this.k = 1; this.centrePan(); this.render(); });
    $('#btnPlay')!.addEventListener('click', () => { this.playing ? this.stop() : this.play(); });
    this.setPlayLabel(false);                        // strips the shell's placeholder glyph on mount
    repaintOnFonts(() => this.render());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.pow(1.0015, -e.deltaY); const nk = clamp(this.k * f, this.kMin(), 9);
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      // zoom about the cursor, in canvas pixels — independent of s0, so it
      // survives the cover scale unchanged
      this.tx = sx - (sx - this.tx) * (nk / this.k); this.ty = sy - (sy - this.ty) * (nk / this.k);
      this.k = nk; this.clampPan(); this.render();
    }, { passive: false });
    let drag: any = null;
    cv.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
      // A pointer that has already ended — or a synthetic one — has no active
      // id, and setPointerCapture THROWS on it rather than returning false.
      // Uncaught, that aborts the handler and the pan never starts.
      try { cv.setPointerCapture(e.pointerId); } catch { /* uncaptured, still panning */ }
    });
    cv.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.tx = drag.tx + dx; this.ty = drag.ty + dy; this.clampPan(); this.render();
      } else {
        const r = cv.getBoundingClientRect();
        const [lon, lat] = this.screenToLonLat(e.clientX - r.left, e.clientY - r.top);
        const f = (lon >= -180 && lon <= 180 && lat >= -60 && lat <= 85) ? featureAt(this.year(), lon, lat) : null;
        // The hover name is the SAME name the card will show — nameless ground
        // says so here too rather than hovering a bare "?".
        if (f) {
          const nm = featureLabel(f, this.year());
          const of = nm.named && f.sov !== f.name && f.sov && f.sov !== '?' ? `<div class=m>part of <b>${f.sov}</b></div>` : '';
          showTip(e.clientX, e.clientY, `<div class=t>${nm.title}</div>${of}<div class=m>${fmtY(this.year())} · click to select</div>`);
        } else hideTip();
      }
    });
    /**
     * A CLICK ON THE MAP SELECTS WHAT IS UNDER IT — and the card that comes up
     * beside the cursor is the same card the timeline shows, because it IS the
     * same selection: SelStore is global, so the highlight, the cube's trace
     * and the Related panel all follow one click.
     *
     * Clicking the map used to drill a core sample outright. That move is not
     * gone, it has become the card's "Drill down here" — one click further
     * away, and now at the exact spot the cursor was on rather than at whatever
     * the view decided was the middle of the thing.
     *
     * OPEN OCEAN CLEARS, exactly like empty canvas on the timeline. That is the
     * other half of "Once I click see on map theres no way to un-click the
     * highlight."
     */
    cv.addEventListener('pointerup', e => {
      const wasDrag = drag && drag.moved; drag = null;
      if (wasDrag) return;
      const r = cv.getBoundingClientRect();
      const [lon, lat] = this.screenToLonLat(e.clientX - r.left, e.clientY - r.top);
      const inWorld = lon >= -180 && lon <= 180 && lat >= -60 && lat <= 85;
      const f = inWorld ? featureAt(this.year(), lon, lat) : null;
      if (!f) { SelCard.select(null, null); return; }
      const y = this.year();
      const nm = featureLabel(f, y);
      // The PLACE label is a place ("this point" where the atlas has no name),
      // never the subject's sentence — Core.drill prints it as "Drilling at …".
      const pt = { lon, lat, label: nm.where };
      // The card dodges its anchor, so a point anchor is a small box AT the
      // cursor: the card lands beside the click, never under it.
      const rect = new DOMRect(e.clientX - 7, e.clientY - 7, 14, 14);
      const pid = nm.named ? polityForFeature(f.sov, f.name, y) : null;
      if (pid) { SelCard.select('polity:' + pid, rect, pt); return; }
      // No curated record for this ground. Mint the minimal subject the core
      // sample would show anyway: what it is called, whose it is, and the
      // stratum of years this snapshot stands for. NAMELESS ground gets an id
      // of its own per patch — '?' is not an identity, and two clicks on two
      // different anonymous polygons are two different subjects.
      const i = YEARS.indexOf(y);
      const id = nm.named
        ? `feature:${y}:${f.sov}|${f.name}`
        : `feature:${y}:@${lon.toFixed(2)},${lat.toFixed(2)}`;
      registerSubject({
        id, name: nm.title, start: y, end: (i >= 0 && i < YEARS.length - 1) ? YEARS[i + 1] : 2026,
        cat: 'power', type: 'zone',
        note: nm.named && f.sov && f.sov !== f.name ? `Part of ${f.sov}.` : '',
        lvl: 4, peakYear: y, hasCurve: false, polity: null, band: null,
        place: pt, sovs: nm.sovs, minimal: true, feat: f, fyear: y,
      });
      SelCard.select(id, rect, pt);
    });
    cv.addEventListener('pointerleave', hideTip);
  },
  /**
   * NO VOID BEYOND THE WORLD. The drawn world is MW×MH at k·s0, which under
   * cover is at least as big as the canvas on one axis and usually on both — so
   * the pan is clamped to keep the frame inside it. When it is NOT (the user
   * has zoomed out past the cover scale, which the wheel now allows so a phone
   * can still see the whole planet), there is no clamp that helps and the world
   * is centred instead.
   */
  fitPan(dim: { cw: number; ch: number; s0: number }, centre = false) {
    const ww = this.MW * dim.s0 * this.k, wh = this.MH * dim.s0 * this.k;
    this.tx = (centre || ww <= dim.cw) ? (dim.cw - ww) / 2 : clamp(this.tx, dim.cw - ww, 0);
    this.ty = (centre || wh <= dim.ch) ? (dim.ch - wh) / 2 : clamp(this.ty, dim.ch - wh, 0);
  },
  clampPan() { const d = this.size(); if (d) this.fitPan(d); },
  centrePan() { const d = this.size(); if (d) this.fitPan(d, true); },
  /** The scale at which the whole world fits: 1 under a square-ish stage, less
   *  under a tall one — the floor the wheel may zoom out to. */
  kMin() {
    const d = this.size(); if (!d) return 1;
    return Math.min(1, Math.min(d.cw / this.MW, d.ch / this.MH) / d.s0);
  },
  // The transport button is a TOGGLE, so its state is carried by aria-pressed — the ▶/⏸
  // glyphs are gone: they were a second icon language sitting next to the shell's real
  // icon buttons, and a glyph swap says nothing to a screen reader. Same contract as
  // population.ts's #popPlay: the label text is ours only while the button is a text
  // button. If the shell ever puts an <svg> in there, leave the icon alone and let
  // aria-pressed do the talking.
  setPlayLabel(on: boolean) {
    const pl = $('#btnPlay'); if (!pl) return;
    pl.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!pl.firstElementChild) pl.textContent = on ? 'Pause' : 'Play';
  },
  play() {
    this.setPlayLabel(true);
    this.playing = setInterval(() => { this.ix = (this.ix + 1) % YEARS.length; this.render(); TimeStore.set(YEARS[this.ix], 'map'); }, 1400);
  },
  stop() { this.setPlayLabel(false); clearInterval(this.playing); this.playing = null; },
};
