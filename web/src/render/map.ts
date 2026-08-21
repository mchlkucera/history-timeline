/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ① MAP =================
// Ported from prototypes/partB.html. Only change: `cv` is resolved in init() instead of
// at module load, because in Next the module is evaluated before the DOM exists.
import {
  $, GEO, YEARS, CAPSULES, SelStore, TimeStore, clamp, fitCanvas, fmtY, featureAt, fontUI,
  repaintOnFonts, showTip, hideTip, sovColor, tokens, gotoTab,
} from './shared';
import { Core } from './core';
import { describe, territoryAt } from './subject';

export const WorldMap = {
  cv: null as unknown as HTMLCanvasElement, ix: 11, k: 1, tx: 0, ty: 0, playing: null as any,
  MW: 1000, MH: 403,
  px(lon: number) { return (lon + 180) / 360 * this.MW; },
  py(lat: number) { return (85 - lat) / 145 * this.MH; },
  ilon(x: number) { return x / this.MW * 360 - 180; },
  ilat(y: number) { return 85 - y / this.MH * 145; },
  paths: {} as Record<number, { f: any; p: Path2D }[]>,
  buildPaths(y: number) {
    if (this.paths[y]) return this.paths[y];
    return this.paths[y] = GEO[y].map((f: any) => {
      const p = new Path2D();
      for (const r of f.rings) {
        p.moveTo(this.px(r[0]), this.py(r[1]));
        for (let i = 2; i < r.length; i += 2) p.lineTo(this.px(r[i]), this.py(r[i + 1]));
        p.closePath();
      }
      return { f, p };
    });
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
    if (!s || !s.polity) return null;
    const hit = territoryAt(s.polity, this.year());
    return hit.size ? hit : null;
  },

  /** Move to the snapshot nearest a year WITHOUT writing TimeStore — the map
   *  follows the global moment here, it does not set it. */
  syncToYear(year: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < YEARS.length; i++) { const d = Math.abs(YEARS[i] - year); if (d < bd) { bd = d; best = i; } }
    this.ix = best;
  },
  size() {
    if (!this.cv) return null;
    const cw = this.cv.clientWidth || this.cv.parentElement!.clientWidth; if (!cw) return null;
    const ch = Math.round(cw * this.MH / this.MW);
    const d = fitCanvas(this.cv, ch); if (!d) return null;
    return { cw: d.cw, ch, ctx: d.ctx, s0: d.cw / this.MW };
  },
  render() {
    const dim = this.size(); if (!dim) return;
    const { cw, ch, ctx, s0 } = dim; const T = tokens(); const y = this.year();
    ctx.fillStyle = T.sea; ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(this.tx, this.ty); ctx.scale(this.k * s0, this.k * s0);
    ctx.lineWidth = 0.6 / (this.k * s0); ctx.strokeStyle = T.line; ctx.globalAlpha = .5;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) { ctx.moveTo(this.px(lon), 0); ctx.lineTo(this.px(lon), this.MH); }
    for (let lat = -60; lat <= 85; lat += 30) { ctx.moveTo(0, this.py(lat)); ctx.lineTo(this.MW, this.py(lat)); }
    ctx.stroke(); ctx.globalAlpha = 1;
    const paths = this.buildPaths(y);
    const hi = this.highlight();
    const onSel = (f: any) => !!hi && (hi.has(f.sov) || hi.has(f.name));
    ctx.lineWidth = 0.7 / (this.k * s0);
    for (const { f, p } of paths) {
      const on = !hi || onSel(f);
      ctx.fillStyle = sovColor(f.sov);
      ctx.globalAlpha = hi ? (on ? .95 : .35) : .82;
      ctx.fill(p, 'evenodd');
      ctx.globalAlpha = hi && !on ? .28 : .9;
      ctx.strokeStyle = T.stroke; ctx.stroke(p);
    }
    // the selection outline, drawn last so it is never cut by a neighbour
    if (hi) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.7 / (this.k * s0);
      ctx.strokeStyle = T.ink;
      for (const { f, p } of paths) if (onSel(f)) ctx.stroke(p);
      ctx.lineWidth = 0.7 / (this.k * s0);
    }
    ctx.globalAlpha = 1;
    const scale = this.k * s0;
    const labeled = [...paths].sort((a, b) => b.f.area - a.f.area).slice(0, 60);
    ctx.font = fontUI(11 / scale, 600);              // a place name is language
    ctx.textAlign = 'center';
    let drawn = 0;
    for (const { f } of labeled) {
      const wpx = f.lw / 360 * this.MW * scale * 1.6;
      if (wpx < 52 || !f.lc || f.name === '?') continue;
      const cx = this.px(f.lc[0]), cy = this.py(f.lc[1]);
      ctx.lineWidth = 3 / scale; ctx.strokeStyle = T.bg; ctx.globalAlpha = .55; ctx.strokeText(f.name, cx, cy);
      ctx.globalAlpha = .95; ctx.fillStyle = T.ink; ctx.fillText(f.name, cx, cy);
      if (++drawn >= (14 + this.k * 10)) break;
    }
    ctx.restore(); ctx.textAlign = 'left';
    $('#yearLabel')!.textContent = fmtY(y);
    ($('#yearSlider') as HTMLInputElement).value = String(this.ix);
    $('#yearSlider')!.setAttribute('aria-valuetext', fmtY(y));
    const near = TimeStore.year !== y ? `Nearest snapshot to <b>${fmtY(TimeStore.year)}</b> — ` : '';
    // The selection's own line comes FIRST: if you pressed "See on map", the
    // answer to "where is it" outranks the capsule prose about the year.
    const sel = describe(SelStore.id);
    let lede = '';
    if (sel && sel.polity) {
      const when = TimeStore.year === y ? fmtY(y) : `${fmtY(TimeStore.year)} (nearest snapshot ${fmtY(y)})`;
      const n = hi ? hi.size : 0;
      const span = `${fmtY(sel.start)} – ${fmtY(sel.end)}`;
      lede = n
        ? `<b>${sel.name}</b> · ${span} · ${n} ${n === 1 ? 'territory' : 'territories'} highlighted in ${when}.<br>`
        : `<b>${sel.name}</b> · ${span} · <b>not on the map in ${when}</b>.<br>`;
    }
    $('#capsule')!.innerHTML = `${lede}${near}<b>The world in ${fmtY(y)}.</b> ${CAPSULES[String(y)] || ''}`;
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
    $('#btn1776')!.addEventListener('click', () => { this.stop(); this.ix = YEARS.indexOf(1783); this.render(); TimeStore.set(1776, 'ui'); });
    $('#btnReset')!.addEventListener('click', () => { this.k = 1; this.tx = 0; this.ty = 0; this.render(); });
    $('#btnPlay')!.addEventListener('click', () => { this.playing ? this.stop() : this.play(); });
    this.setPlayLabel(false);                        // strips the shell's placeholder glyph on mount
    repaintOnFonts(() => this.render());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.pow(1.0015, -e.deltaY); const nk = clamp(this.k * f, 1, 9);
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      this.tx = sx - (sx - this.tx) * (nk / this.k); this.ty = sy - (sy - this.ty) * (nk / this.k);
      this.k = nk; if (this.k === 1) { this.tx = 0; this.ty = 0; } this.clampPan(); this.render();
    }, { passive: false });
    let drag: any = null;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.tx = drag.tx + dx; this.ty = drag.ty + dy; this.clampPan(); this.render();
      } else {
        const r = cv.getBoundingClientRect();
        const [lon, lat] = this.screenToLonLat(e.clientX - r.left, e.clientY - r.top);
        const f = (lon >= -180 && lon <= 180 && lat >= -60 && lat <= 85) ? featureAt(this.year(), lon, lat) : null;
        if (f) showTip(e.clientX, e.clientY, `<div class=t>${f.name}</div>${f.sov !== f.name ? `<div class=m>part of <b>${f.sov}</b></div>` : ''}<div class=m>${fmtY(this.year())} · click to drill core sample</div>`);
        else hideTip();
      }
    });
    cv.addEventListener('pointerup', e => {
      const wasDrag = drag && drag.moved; drag = null;
      if (wasDrag) return;
      const r = cv.getBoundingClientRect();
      const [lon, lat] = this.screenToLonLat(e.clientX - r.left, e.clientY - r.top);
      if (lon < -180 || lon > 180 || lat < -60 || lat > 85) return;
      const f = featureAt(this.year(), lon, lat);
      Core.drill(lon, lat, f ? f.name : `${lat.toFixed(1)}, ${lon.toFixed(1)}`);
      gotoTab('core');
    });
    cv.addEventListener('pointerleave', hideTip);
  },
  clampPan() {
    const dim = this.size(); if (!dim) return; const w = dim.cw * this.k, h = dim.ch * this.k;
    this.tx = clamp(this.tx, dim.cw - w, 0); this.ty = clamp(this.ty, dim.ch - h, 0);
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
