/* =============================================================================
   ④ SPACE-TIME CUBE — the Survey side of the volumetric block.

   This file is deliberately small and deliberately three.js-free. It owns the
   panel: resolving every control by id exactly once, painting them from state,
   and forwarding what the reader does to the engine. Everything volumetric
   lives in ./cube3d/*, which is reached ONLY through the dynamic import below.

   WHY THE DYNAMIC IMPORT. three.js + earcut are ~206 KB gzipped. Ten other
   views share this page and most sessions never open the cube, so paying for a
   WebGL renderer at first paint would be a tax on all of them. `import()` puts
   the whole cube3d directory in its own chunk that is fetched the first time
   this view is actually rendered — which is also the first moment the canvas
   has a size, so nothing is lost by waiting.

   THE HIDDEN-VIEW CONTRACT, same as every other renderer here: a display:none
   view has clientWidth 0, so render() bails when the canvas has no size. That
   is necessary but NOT sufficient for a WebGL view — see the
   IntersectionObserver in init() for why, and for what actually stops the frame
   loop when you leave.
   ============================================================================= */
import { $, repaintOnFonts, tokens, fmtY } from './shared';
import type {
  CubeEngine, CubeState, CutInfo, MeshRes, Projection, SliceInfo,
  SolidMode, Spacing, CubeStats, TraceInfo, ViewName,
} from './cube3d/engine';

// The optgroup labels and their order. The engine has its own copy of the
// order: everything above is imported `import type`, which erases at compile
// time, and a single VALUE import from ./cube3d/engine would pull three.js
// straight back into the first-paint bundle.
const REGION: Record<string, string> = {
  EU: 'Europe', ME: 'Middle East', AF: 'Africa', AS: 'Asia', AM: 'Americas & Oceania',
};
const REG_ORDER = ['EU', 'ME', 'AF', 'AS', 'AM'];

/** the resting state — here, not in the engine, for the same erasure reason */
const INITIAL: CubeState = {
  polity: 'roman-republic', lineage: 3, mode: 'lofted', ghost: 0.16, spacing: 'even',
  res: 'normal', outlines: false, ghostLines: true, cutLo: 0, cutHi: 1, caps: true,
  slice: false, sliceI: 0, slicePlay: false, proj: 'persp', spin: false,
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const Cube = {
  /** sizeRenderers() writes this; the canvas fills the stage */
  H: 600,
  cv: null as unknown as HTMLCanvasElement,
  engine: null as CubeEngine | null,
  S: { ...INITIAL } as CubeState,
  loading: false,
  error: null as string | null,
  themeSig: '',

  // ── boot ──────────────────────────────────────────────────────────────────
  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#cubeCanvas')!;
    if (!cv) return;

    // Every control writes into `this.S`, which is the SAME object the engine
    // is later handed — so anything toggled before the chunk arrives is already
    // true when it boots. Only the calls that need geometry rebuilt are guarded.
    const E = () => this.engine;

    // trace ------------------------------------------------------------------
    const filter = $<HTMLInputElement>('#cubeFilter');
    const sel = $<HTMLSelectElement>('#cubeSov');
    let traceTimer = 0;
    filter?.addEventListener('input', () => {
      const q = filter.value.trim();
      const hits = this.fillSelect(q);
      clearTimeout(traceTimer);
      if (!q) return;
      // debounce: meshing the solid costs 100-400 ms, so do not rebuild per keystroke
      traceTimer = window.setTimeout(() => { if (hits.length) this.select(hits[0]); }, 280);
    });
    filter?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        clearTimeout(traceTimer);
        const h = E()?.rank(filter.value) ?? [];
        if (h.length) this.select(h[0].id);
        filter.blur();
      } else if (ev.key === 'Escape') {
        filter.value = ''; this.fillSelect(''); filter.blur();
      }
    });
    sel?.addEventListener('change', () => { clearTimeout(traceTimer); this.select(sel.value); });

    // segmented controls -----------------------------------------------------
    this.seg('#cubeLineage', v => { this.S.lineage = +v; E()?.buildEmpire(); });
    this.seg('#cubeMode', v => { this.S.mode = v as SolidMode; E()?.buildEmpire(); E()?.applyCut(); });
    this.seg('#cubeRes', v => { this.S.res = v as MeshRes; E()?.buildEmpire(); });
    this.seg('#cubeProj', v => { this.S.proj = v as Projection; E()?.setProjection(this.S.proj); });
    this.seg('#cubeSpacing', v => {
      this.S.spacing = v as Spacing;
      const e = E(); if (e) { e.layoutSlices(); e.buildEmpire(); e.applyCut(); }
    });

    // view presets -----------------------------------------------------------
    $('#cubeViews')?.querySelectorAll<HTMLElement>('[data-v]').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.dataset.v!;
        if (v === 'focus') E()?.frameEmpire(); else E()?.flyTo(v as ViewName);
      });
    });

    // ghost ------------------------------------------------------------------
    const ghost = $<HTMLInputElement>('#cubeGhost');
    ghost?.addEventListener('input', () => {
      this.S.ghost = +ghost.value; E()?.applyGhost(); this.paintGhost();
    });

    // the cut ----------------------------------------------------------------
    this.bindCut();
    this.toggle('#cubeCaps', v => { this.S.caps = v; E()?.setCaps(v); });

    // single slice -----------------------------------------------------------
    this.toggle('#cubeSlice', v => {
      const e = E(); if (e) e.setSlice(v); else this.S.slice = v;
      this.paint();
    });
    const idx = $<HTMLInputElement>('#cubeSliceIdx');
    idx?.addEventListener('input', () => {
      const e = E(); if (!e) { this.S.sliceI = +idx.value; return; }
      e.setPlay(false); e.sliceGoto(+idx.value); this.paintPlay();
    });
    $('#cubeStep')?.querySelectorAll<HTMLElement>('[data-a]').forEach(b => {
      b.addEventListener('click', () => {
        const e = E(); if (!e) return;
        if (!this.S.slice) e.setSlice(true);
        const a = b.dataset.a!;
        if (a === 'play') { e.setPlay(!this.S.slicePlay); this.paintPlay(); return; }
        e.setPlay(false);
        e.sliceGoto(this.S.sliceI + (a === 'prev' ? -1 : 1));
        this.paint();
      });
    });

    // the small toggles ------------------------------------------------------
    this.toggle('#cubeOutlines', v => { this.S.outlines = v; E()?.buildEmpire(); });
    this.toggle('#cubeGhostLines', v => {
      this.S.ghostLines = v;
      const e = E(); if (e) { e.applyGhost(); if (this.S.slice) e.applySlice(); }
    });
    this.toggle('#cubeSpin', v => { this.S.spin = v; E()?.setSpin(v); });

    // Canvas text does not reflow when a webfont lands, and the block's year
    // labels are canvas textures — so redraw them when the faces arrive.
    repaintOnFonts(() => this.engine?.retheme());

    /**
     * THE FRAME LOOP MUST STOP WHEN THIS VIEW IS NOT ON SCREEN, and render()
     * alone cannot do it: Lab's renderTab() only calls the renderer of the view
     * you switched TO, so leaving the cube never runs a line of this file.
     * Without this the WebGL loop kept drawing 470k triangles into a
     * display:none canvas for the rest of the session.
     *
     * IntersectionObserver rather than a per-frame clientWidth read: a
     * display:none element reports isIntersecting false, the callback is
     * event-driven, and it costs nothing per frame.
     */
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver((es) => {
        for (const e of es) {
          if (e.isIntersecting) this.render();
          else this.engine?.stop();
        }
      }).observe(cv);
    }

    this.paint();
    this.busy(null);
  },

  // ── the frame the shell calls ─────────────────────────────────────────────
  render() {
    const cv = this.cv;
    if (!cv) return;
    const w = cv.clientWidth || cv.parentElement?.clientWidth || 0;
    if (!w) { this.engine?.stop(); return; }      // hidden view — and the loop stops

    const h = Math.max(320, Math.round(this.H));
    cv.style.height = h + 'px';

    if (this.engine) {
      this.engine.resize(w, h);
      // rerenderAll() fires on resize AND on a theme change; only the second
      // needs 23 label textures redrawn, so tell them apart by the tokens.
      const sig = this.themeSignature();
      if (sig !== this.themeSig) { this.themeSig = sig; this.engine.retheme(); }
      this.engine.start();
      return;
    }
    if (this.loading || this.error) return;
    this.load(w, h);
  },

  themeSignature() { const T = tokens(); return T.bg + T.ink + T.accent; },

  async load(w: number, h: number) {
    this.loading = true;
    this.themeSig = this.themeSignature();
    // sized before the renderer exists, so the first frame is never 300x150
    this.cv.style.height = h + 'px';
    try {
      // THE dynamic import. three.js and earcut live behind exactly this line.
      const mod = await import('./cube3d/engine');
      this.engine = await mod.CubeEngine.create(this.cv, this.S, {
        onBusy: (m) => this.busy(m),
        onTrace: (t) => this.paintTrace(t),
        onStats: (s) => this.paintStats(s),
        onSlice: (s) => this.paintSlice(s),
        onCut: (c) => this.paintCut(c),
        onState: () => this.paint(),
      });
      this.engine.resize(w, h);
      this.fillSelect('');
      const idx = $<HTMLInputElement>('#cubeSliceIdx');
      if (idx) idx.max = String(this.engine.years.length - 1);
      this.paint();
      this.engine.start();
    } catch (e) {
      this.error = String((e as Error)?.message || e);
      console.error('[cube] ' + this.error);
      this.busy('the block could not be built — ' + this.error);
    } finally {
      this.loading = false;
    }
  },

  // ── control plumbing ──────────────────────────────────────────────────────
  /** a .tl-seg whose buttons carry data-v; selection lives in aria-pressed */
  seg(sel: string, on: (v: string) => void) {
    const el = $(sel); if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-v]').forEach(b => {
      b.addEventListener('click', () => { on(b.dataset.v!); this.paint(); });
    });
  },
  toggle(sel: string, on: (v: boolean) => void) {
    const el = $<HTMLInputElement>(sel); if (!el) return;
    el.addEventListener('change', () => on(el.checked));
  },
  paintSeg(sel: string, value: string | number) {
    $(sel)?.querySelectorAll<HTMLElement>('[data-v]')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(value))));
  },

  select(id: string) {
    const e = this.engine;
    if (!e) { this.S.polity = id; return; }
    if (e.select(id)) { const s = $<HTMLSelectElement>('#cubeSov'); if (s) s.value = id; }
  },

  /**
   * The filter box and the select are ONE control. The prototype's bug worth
   * not repeating: assigning `select.value` from script does not fire `change`,
   * so a filtered list narrowed while the view kept tracing whatever it had.
   * Typing picks the best match and traces it (debounced, in init()).
   */
  fillSelect(q = ''): string[] {
    const sel = $<HTMLSelectElement>('#cubeSov');
    const e = this.engine;
    if (!sel || !e) return [];
    const hits = q ? e.rank(q) : e.polities();
    const groups: string[] = [];
    for (const rg of REG_ORDER) {
      const rows = hits.filter(p => p.region === rg);
      if (!rows.length) continue;
      groups.push(`<optgroup label="${esc(REGION[rg])} (${rows.length})">` +
        rows.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.span ? ` · ${p.span}` : ' · –'}</option>`).join('') +
        '</optgroup>');
    }
    sel.innerHTML = groups.join('') || '<option disabled>no match</option>';
    const set = new Set(hits.map(p => p.id));
    if (set.has(this.S.polity)) sel.value = this.S.polity;
    else if (hits.length) sel.value = hits[0].id;
    const cnt = $('#cubeCnt');
    if (cnt) cnt.textContent = `${hits.length}/${e.polities().length}`;
    return hits.map(p => p.id);
  },

  /**
   * The two-handle cut. Two overlaid <input type=range> is the usual hack and
   * they fight over pointer capture at the ends; forty lines of pointer maths is
   * less code and behaves. Snapping to slab faces lives in the engine, which is
   * the only thing that knows where the slabs are.
   */
  bindCut() {
    const el = $('#cubeCut'); if (!el) return;
    let drag: 'lo' | 'hi' | null = null;
    const fOf = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    };
    const set = (f: number, which: 'lo' | 'hi') => {
      const e = this.engine;
      if (!e) { if (which === 'lo') this.S.cutLo = f; else this.S.cutHi = f; this.paintCutBar(); return; }
      e.setCut(f, which);
    };
    el.addEventListener('pointerdown', (ev) => {
      const f = fOf(ev as PointerEvent);
      drag = Math.abs(f - this.S.cutLo) <= Math.abs(f - this.S.cutHi) ? 'lo' : 'hi';
      $(drag === 'lo' ? '#cubeCutLo' : '#cubeCutHi')?.setAttribute('data-drag', 'true');
      el.setPointerCapture((ev as PointerEvent).pointerId);
      set(f, drag);
    });
    el.addEventListener('pointermove', (ev) => { if (drag) set(fOf(ev as PointerEvent), drag); });
    const end = () => {
      if (!drag) return;
      $(drag === 'lo' ? '#cubeCutLo' : '#cubeCutHi')?.removeAttribute('data-drag');
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  },

  // ── painting ──────────────────────────────────────────────────────────────
  /** every control, from state. The engine calls this whenever it moves state. */
  paint() {
    const S = this.S;
    this.paintSeg('#cubeLineage', S.lineage);
    this.paintSeg('#cubeMode', S.mode);
    this.paintSeg('#cubeRes', S.res);
    this.paintSeg('#cubeProj', S.proj);
    this.paintSeg('#cubeSpacing', S.spacing);
    const lin = $('#cubeLineageV');
    if (lin) lin.textContent = S.lineage ? `${S.lineage} link${S.lineage > 1 ? 's' : ''}` : 'single';
    const g = $<HTMLInputElement>('#cubeGhost'); if (g) g.value = String(S.ghost);
    this.paintGhost();
    for (const [id, v] of [['#cubeCaps', S.caps], ['#cubeSlice', S.slice], ['#cubeOutlines', S.outlines],
      ['#cubeGhostLines', S.ghostLines], ['#cubeSpin', S.spin]] as [string, boolean][]) {
      const el = $<HTMLInputElement>(id); if (el) el.checked = v;
    }
    const idx = $<HTMLInputElement>('#cubeSliceIdx'); if (idx) idx.value = String(S.sliceI);
    // slice mode owns the time axis while it is on, so the cut is inert
    $('#cubeCutRow')?.setAttribute('data-off', String(S.slice));
    $('#cubeSliceRow')?.setAttribute('data-off', String(!S.slice));
    this.paintCutBar();
    this.paintPlay();
    this.paintDisc();
  },

  /**
   * THE RULE FOR A FOLDED CONTROL: it may be out of sight only while it is at
   * rest. So each disclosure summary carries what is switched on inside it, and
   * a group whose contents have left their default OPENS ITSELF — once. That
   * matters most for the keyboard: A and P turn single slice on from anywhere
   * on the page, and without this the block would start stepping through
   * snapshots with the control that did it folded away.
   *
   * It opens but never closes: shutting a group the reader deliberately opened,
   * because they happened to put a setting back, would be the panel arguing
   * with them.
   */
  paintDisc() {
    const S = this.S, D = INITIAL;
    const cutOn = S.cutLo > 0.001 || S.cutHi < 0.999, sliceOn = S.slice;
    const view = [
      S.proj !== D.proj ? 'isometric' : '',
      S.res !== D.res ? S.res : '',
      S.spacing !== D.spacing ? 'true years' : '',
      Math.abs(S.ghost - D.ghost) > 0.005 ? 'ghost ' + S.ghost.toFixed(2) : '',
      S.outlines ? 'outlines' : '',
      S.ghostLines === D.ghostLines ? '' : 'no coastlines',
      S.spin ? 'orbiting' : '',
    ].filter(Boolean);
    const cut = [cutOn ? 'cut' : '', sliceOn ? 'slice' : ''].filter(Boolean);
    const set = (id: string, parts: string[], rest: string) => {
      const v = $('#' + id + 'V'); if (v) v.textContent = parts.length ? parts.join(' · ') : rest;
      if (parts.length) {
        const d = $<HTMLDetailsElement>('#' + id);
        if (d && !d.open) d.open = true;
      }
    };
    set('cubeDiscCut', cut, 'whole block');
    set('cubeDiscView', view, '');
  },

  paintGhost() { const v = $('#cubeGhostV'); if (v) v.textContent = this.S.ghost.toFixed(2); },

  paintPlay() {
    const b = $<HTMLButtonElement>('#cubePlay'); if (!b) return;
    const on = this.S.slicePlay;
    // A toggle, so the state lives in aria-pressed and not in a ▶/⏸ glyph that
    // no screen reader announces — the same contract as map.ts's #btnPlay.
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'Pause' : 'Play';
  },

  paintCutBar() {
    const a = this.S.cutLo * 100, b = this.S.cutHi * 100;
    const lo = $<HTMLElement>('#cubeCutLo'), hi = $<HTMLElement>('#cubeCutHi'), fill = $<HTMLElement>('#cubeCutFill');
    if (lo) lo.style.left = a + '%';
    if (hi) hi.style.left = b + '%';
    if (fill) { fill.style.left = a + '%'; fill.style.width = (b - a) + '%'; }
  },

  paintCut(c: CutInfo) {
    const v = $('#cubeCutV'); if (v) v.textContent = c.label;
    $('#cubeCut')?.setAttribute('data-cutting', String(c.cutting));
    this.paintCutBar();
    this.paintDisc();
  },

  paintSlice(s: SliceInfo) {
    const v = $('#cubeSliceV');
    if (v) v.textContent = s.on ? `${s.i + 1}/${s.n}` : 'off';
    this.paintDisc();
    const idx = $<HTMLInputElement>('#cubeSliceIdx');
    if (idx && document.activeElement !== idx) idx.value = String(s.i);
    const box = $<HTMLElement>('#cubeYear');
    if (!box) return;
    box.hidden = !s.on;
    if (!s.on) return;
    const big = $('#cubeYearBig'), sub = $('#cubeYearSub');
    if (s.interpolated) {
      // NEVER claim a map for an in-between date. The ghost cross-fades between
      // two real snapshots; the solid slides; the readout says which it is.
      if (big) big.textContent = `${fmtY(s.fromYear)} → ${fmtY(s.year)}`;
      if (sub) sub.textContent = 'between snapshots · interpolated';
    } else {
      if (big) big.textContent = fmtY(s.year);
      if (sub) sub.textContent = `snapshot ${s.i + 1} of ${s.n} · measured`;
    }
  },

  paintTrace(t: TraceInfo) {
    const note = $('#cubeNote'); if (note) note.textContent = t.note || '';
    const chain = $('#cubeChain');
    if (chain) {
      chain.innerHTML = t.chain.map(p =>
        `<span class="chip" data-pol="${esc(p.id)}"${p.sel ? ' aria-pressed="true"' : ''}` +
        `${p.span ? '' : ' data-empty="true"'} title="${p.span ? p.span + ' snapshots' : 'no geometry in this dataset'}">` +
        `${esc(p.name)}</span>`).join('');
      chain.querySelectorAll<HTMLElement>('[data-pol]').forEach(c =>
        c.addEventListener('click', () => this.select(c.dataset.pol!)));
    }
    const count = t.present.length
      ? `${t.present.length} of ${t.total} snapshots · ${fmtY(t.present[0])} → ${fmtY(t.present[t.present.length - 1])}`
      : `no geometry in any of the ${t.total} snapshots`;
    const cap = $('#cubeCap');
    if (cap) {
      // A SWATCH quotes the trace colour and the name stays in ink. Colouring
      // the text itself would put a mid-tone data hue on a panel surface, which
      // fails contrast in the dark theme — globals.css is explicit that a dot is
      // the only place the data hues may cross into the chrome.
      cap.innerHTML =
        `<b>Reading the block:</b> X is longitude, Y latitude, Z time — a horizontal cut is a world map at one date, ` +
        `a vertical column is a state that lasted. ` +
        `<span style="white-space:nowrap"><span aria-hidden="true" style="display:inline-block;width:8px;height:8px;` +
        `border-radius:999px;background:${t.colour};vertical-align:baseline"></span> <b>${esc(t.name)}</b></span>` +
        (t.linked ? ` and ${t.linked} linked ${t.linked === 1 ? 'polity' : 'polities'}` : '') +
        ` is traced as a solid — ${count}. ` +
        `Bright rules mark the measured snapshots; the darker material between them is interpolation.`;
    }
  },

  /**
   * ONE short line — it lives in the panel header, beside the word "Reading",
   * where it costs no body height. Everything a person would only want
   * occasionally (min fps, draw calls, cell size, cluster count, mesh time)
   * is in the title, one hover away.
   */
  paintStats(s: CubeStats) {
    const el = $('#cubeStats'); if (!el) return;
    const sol = s.solid;
    const k = (n: number) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(n));
    el.textContent = `${s.fps.toFixed(0)} fps · ${k(s.tris)} tri`;
    el.setAttribute('title',
      `${s.fps.toFixed(0)} fps, worst frame ${s.minFps ? s.minFps.toFixed(0) : '–'} fps · ` +
      `${s.tris.toLocaleString()} triangles in ${s.calls} draw calls\n` +
      `ghost world ${s.ghostTris.toLocaleString()} tri, extruded in ${s.ghostMs} ms\n` +
      (sol
        ? `traced solid ${sol.triangles.toLocaleString()} tri from ${sol.vertices.toLocaleString()} vertices, ` +
          `${sol.mode === 'lofted' ? 'surface nets' : 'extruded prisms'}` +
          (sol.mode === 'lofted' ? `, ${sol.cell}° cell, ${sol.clusters} ${sol.clusters === 1 ? 'part' : 'parts'}` : '') +
          `, built in ${sol.ms} ms`
        : 'the traced solid is switched off'));
  },

  busy(msg: string | null) {
    const el = $<HTMLElement>('#cubeBusy'); if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  },
};
