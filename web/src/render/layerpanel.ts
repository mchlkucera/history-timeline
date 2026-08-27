/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   layerpanel.ts — the panel that is not a sidebar.

   THE GEOMETRY LOCK. The canvas layout is the source of truth for where a band
   is and how tall it is. Every row here is positioned and sized from THE VERY
   SAME NUMBERS, in the same frame, after the slew limiter has had its say — so
   a lane that packs six rows of rectangles gets a six-rows-tall row in the
   panel, at the same y, at every fractional state of every transition. Nothing
   here measures itself; nothing here has a height of its own.

   AND THEY SCROLL AS ONE SURFACE. This element is an ordinary flex item of
   .tl-view, which is the scroll container the canvas already lives in, so there
   is exactly ONE scroll offset and it is the browser's. Neither side can scroll
   independently because neither side has a scroller. (The earlier arrangement —
   an absolutely-positioned column with its own overflow — could not be made to
   agree with the canvas during a fling.)

   "MAKE THE LAYERS BLEND SEAMLESSLY TO THE WORKSPACE." The panel takes the
   colour the canvas paints itself (--tl-surface, what tokens() calls `panel`),
   carries no border, no radius and no shadow, and is separated from the plot by
   nothing at all. See the seam note in app.css.

   NO HOVER-DRIVEN LAYOUT. The detail word and the × appear on hover by OPACITY.
   Nothing moves, nothing reflows, nothing grows. The jelly rule stands.

   ── THE SWITCH ───────────────────────────────────────────────────────────────

   The founder, after an hour on a phone and an iPad: "The mobile works also,
   but theres not enough space on the screen, could we somehow show/hide the
   layers." That is ONE sentence about TWO different failures, and the switch
   below has to answer both with the same idea.

     · On a tablet the column is THERE and eating the plot — 232px of a 1024px
       iPad in landscape, permanently. He wants it gone and the space back.
     · On a phone the column was NOT there at all. app.css hid it under 760px,
       and with it went every route to hiding a lane, adding one, grouping, or
       moving a layer's detail dial: those controls have no other home in the
       app. He wants it summoned.

   ONE CONTROL, ONE COMPOSITION, ONE CORNER. `.tl-lswitch` is the first thing
   on the layer bar — the strip that is already the panel's own chrome, already
   pinned to the bottom-left corner of the stage, and now the ONLY part of the
   panel that is on screen at every width in every state. Pressing it shows the
   column; pressing it again takes it away. Same glyph, same corner, same verb
   on a phone and on a desktop.

   THE WORD APPEARS EXACTLY WHEN THE THING IT NAMES DOES NOT. Open, the button
   is the glyph alone — the column is right there above it, saying what it is,
   and the bar's 232px will not seat a fourth worded control (the count already
   drops "shown" below 1181px to fit three). Closed, the glyph takes the word
   "Layers" and the chip treatment every other float-over-the-canvas element in
   this app uses, because then it is the only evidence the feature exists.

   AND IT DRIVES THE PATH THAT WAS ALREADY THERE. timeline.ts asks ONE question
   — does #layerPanel have any width (panelOn) — and paints the band names back
   into a 118px gutter when the answer is no. The switch does not answer that
   question and does not carry a second copy of it: it sets `display:none` on
   the panel, which makes clientWidth 0, which is the same answer the phone
   breakpoint used to give. There is exactly one notion of "is the panel there"
   and the canvas and the panel read it from the same element.

   BELOW 760px IT IS A DRAWER, NOT A COLUMN. app.css takes the panel out of
   flow there and floats it over the plot at the same left edge, which is the
   one arrangement that keeps the GEOMETRY LOCK literally true on a phone: the
   rows still sit at the lanes' own y, at the lanes' own heights, over the very
   lanes they name, and the one scroller is still the browser's. A bottom sheet
   — the app's other narrow idiom, and the obvious guess — cannot do that: a
   sheet has a geometry of its own, which is the one thing every row in this
   file is forbidden to have.

   WHERE THE STATE LIVES. localStorage, beside the arrangement itself (which
   layers, their order, their groups, what is hidden, every detail dial —
   layers.ts, same store, same reasoning). NOT the URL. `?v=&y=&s=` is a
   COORDINATE — the view, the year, the span — and it is meant to be shared:
   whether the person who sent you a link had their column open on a phone is
   not part of where they were standing, and inheriting it would be a stranger
   resizing your workspace. Unset means "whatever this screen's default is",
   so a first visit still gets a column on a desktop and a clear canvas on a
   phone; one press makes the choice this device's own and keeps it.
   ============================================================================= */

import { $, clamp } from './shared';
import { TAP_SLOP } from './gesture';
import {
  DETAIL_TEXT, DETAIL_WORDS, Layers, layerDef, resetCatalogue,
  type Detail, type GNode, type LayerDef,
} from './layers';
import { SelCard } from './selcard';
import { TL } from './timeline';

const el = (t: string, c?: string, h?: string) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (h != null) n.innerHTML = h;
  return n;
};

/* THE SWITCH'S GLYPH IS THE PANEL ITSELF: a frame, a column split off its left
   edge, and three rows in that column. It does not change between the two
   states — a glyph that flipped would read as two controls rather than one —
   so the state is carried by aria-pressed, by the word, and by whether the
   column it draws is standing beside it. */
const COLS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1.7" y="2.7" width="12.6" height="10.6" rx="1.6" stroke-width="1.3"/><path d="M6.5 2.7v10.6" stroke-width="1.3"/><path d="M3.5 5.9h1.6M3.5 8h1.6M3.5 10.1h1.6" stroke-width="1.1"/></svg>';

const EYE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>';
const EYEOFF = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2.6 5.4C1.9 6.3 1.5 8 1.5 8S3.9 12.2 8 12.2c1 0 1.9-.2 2.7-.6M6.2 4c.6-.1 1.2-.2 1.8-.2 4.1 0 6.5 4.2 6.5 4.2s-.6 1.1-1.7 2.2"/><path d="M2.5 2.5l11 11"/></svg>';

interface Row {
  el: HTMLElement;
  key: string;                       // matches the lane key: layer id, or 'g:<id>'
  type: 'layer' | 'group';
  g?: GNode;
}

/** Where the switch's answer is kept. See "WHERE THE STATE LIVES" above. */
const OPEN_KEY = 'tl-layers-open';
/** The width at or above which a column is the default. Same 760px seam every
 *  panel in this app turns into a sheet at — app.css and shell.css §13. */
const WIDE = '(min-width: 760px)';

export const LayerPanel = {
  host: null as HTMLElement | null,
  bar: null as HTMLElement | null,
  addBtn: null as HTMLButtonElement | null,
  swBtn: null as HTMLButtonElement | null,
  open: true,
  rows: [] as Row[],
  _lay: null as any,
  _drag: null as null | { id: string; isG: boolean; x: number; y: number; live: boolean; slop: number },
  _built: false,

  init() {
    const host = this.host = $<HTMLElement>('#layerPanel');
    const bar = this.bar = $<HTMLElement>('#layerBar');
    if (!host) return;
    if (this._built) { this.build(); this.apply(); return; }
    this._built = true;
    this.open = this.readOpen();
    resetCatalogue();                   // the corpus is loaded by now — measure it
    Layers.load();

    host.addEventListener('click', e => this.onClick(e));
    host.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    /* POINTERCANCEL WAS MISSING, and on touch it is not an edge case — it is the
       ORDINARY ending. The browser fires it the moment it decides a touch belongs
       to a scroll or to iOS's selection magnifier, and this panel lives inside
       .tl-view's scroller, so that decision was being made a few pixels into
       every drag. With nothing listening, `_drag` stayed set and the ghost stayed
       parked on screen with no way to dismiss it. app.css §5 stops the browser
       claiming the gesture in the first place; this makes the failure survivable
       if anything ever claims it again. */
    window.addEventListener('pointercancel', () => this.onUp());
    document.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement;
      if (!t.closest('.tl-lpop') && !t.closest('[data-a="detail"]') && !t.closest('[data-lbar]')) closePops();
    }, true);

    /* THE TWO VERBS ARE BUTTONS THAT LOOK LIKE BUTTONS.
       The founder: "make add lane or add group more prominent — it's almost not
       seeable." They were borderless text in --tl-ink-2 on the panel's own
       surface, i.e. two words that read as a caption. The only way into the
       library was a label you had to already know was clickable.

       So each one is now a real bordered control with its own fill and a lead
       "+", built as ELEMENTS rather than a text label, because the glyph and
       the word carry different weight: the + is the affordance and stays quiet
       ink, the word is the language. app.css §THE BAR does the rest. */
    if (bar) {
      const mk = (verb: string, word: string) => {
        const b = el('button', 'tl-lbtn') as HTMLButtonElement;
        b.type = 'button';
        b.append(el('span', 'tl-lbtn__plus', verb), el('span', 'tl-lbtn__w', word));
        return b;
      };
      const add = this.addBtn = mk('+', 'Add layer');
      add.dataset.lbar = 'add';
      add.addEventListener('click', () => openLibrary(add));
      /* "+ GROUP IS HIDDEN, NOT GONE. "Also hide the + Group button for now" —
         and `for now` is load-bearing, so nothing behind it is touched. The
         button is still built, still titled and still wired to Layers.newGroup;
         it is only kept out of the reader's way. DELETE THE `grp.hidden` LINE
         AND IT IS BACK, with its place on the strip and its behaviour intact.

         WHAT A READER CAN STILL DO. Grouping is a whole feature and only its
         front door is shut: a group that already exists in a saved layout still
         draws its own row with its chevron, its eye, its count and its × to
         ungroup, and layers still drag into and out of it. The one thing that
         cannot be done is making a NEW empty group — which is exactly the verb
         on the button. So nothing anybody has can be stranded by this. */
      const grp = mk('+', 'Group');
      grp.dataset.lbar = 'group';
      grp.title = 'Make an empty group, then drag layers into it';
      grp.addEventListener('click', () => { Layers.newGroup(); TL.ease(); });
      grp.hidden = true;
      const cnt = el('span', 'tl-lcount'); cnt.id = 'layerCount';
      /* THE SWITCH GOES FIRST, and it is the only member of this strip that
         survives the strip being closed — when the panel is away the bar keeps
         nothing but this one chip in the corner it always occupied. */
      const sw = this.swBtn = el('button', 'tl-lswitch') as HTMLButtonElement;
      sw.type = 'button';
      sw.dataset.lbar = 'switch';
      sw.append(el('span', 'tl-lswitch__g', COLS), el('span', 'tl-lswitch__w', 'Layers'));
      sw.addEventListener('click', () => this.setOpen(!this.open));
      bar.append(sw, add, grp, cnt);
    }
    /* The width can change under a stored answer — a rotation, a split view, a
       window dragged narrow — but only an UNSET answer follows the width. Once
       the reader has pressed the switch, that is this device's arrangement and
       a rotation is not a request to undo it. */
    if (typeof matchMedia !== 'undefined') {
      matchMedia(WIDE).addEventListener('change', () => {
        if (this.stored() === null) this.setOpen(this.readOpen(), false);
      });
    }
    this.apply();

    // Any change to the model rebuilds the rows and re-eases the workspace.
    Layers.subscribe(() => { this.build(); TL.ease(); TL.paint(); });
    TL.onLayout(lay => this.place(lay));
    this.build();
  },

  // ── the switch ────────────────────────────────────────────────────────────
  /** The reader's own answer, or null for "never asked". */
  stored(): boolean | null {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(OPEN_KEY) : null;
      if (raw === 'on') return true;
      if (raw === 'off') return false;
    } catch { /* private mode — the session still works, it just will not survive */ }
    return null;
  },
  /** …falling back to what this screen can afford: a column on anything at or
   *  above the sheet breakpoint, a clear canvas below it. That default is
   *  exactly the behaviour that shipped before the switch existed, so a first
   *  visit at any width sees no change at all. */
  readOpen(): boolean {
    const s = this.stored();
    if (s !== null) return s;
    return typeof matchMedia !== 'undefined' ? matchMedia(WIDE).matches : true;
  },
  /** Write the state onto the DOM. THIS IS THE WHOLE MECHANISM: `data-open` is
   *  a CSS hook and nothing more, and the one thing the CSS does with it is
   *  take the panel's width away — which is the same question timeline.ts's
   *  panelOn() was already asking of this element. No second flag, no second
   *  answer, no way for the canvas and the panel to disagree about who is
   *  naming the bands. */
  apply() {
    const on = this.open;
    if (this.host) this.host.dataset.open = String(on);
    if (this.bar) this.bar.dataset.open = String(on);
    const sw = this.swBtn;
    if (sw) {
      sw.setAttribute('aria-pressed', String(on));
      sw.setAttribute('aria-label', on ? 'Hide the layers' : 'Show the layers');
      sw.title = on
        ? 'Hide the layers column — the band names go back onto the chart'
        : 'Show the layers column — hide, reorder, group and add layers';
    }
  },
  /**
   * Show or hide the column.
   *
   * THE CANVAS WIDTH JUST CHANGED, AND THAT IS A RESIZE, NOT A ZOOM. d0/d1 are
   * not touched here, so the v-span is not touched, so stepTick() cannot cross
   * a rung and the latched layout window cannot move: the year under any given
   * fraction of the plot is exactly where it was. What DOES change is `cw`, and
   * layout()'s own `_lastCw !== cw` test reads that as a new look and arrives
   * whole — the same treatment a window resize gets, and the reason this must
   * NOT call TL.ease(), which would ask for a ramp under a step change.
   *
   * One synchronous render is enough: size() reads clientWidth, which flushes
   * the style change above it, and render() ends by handing the finished lane
   * geometry to place() through TL.onLayout — so the rows land on the new
   * geometry in the SAME frame the canvas is drawn at it, which is what keeps
   * the lock at 0.000px across a collapse-and-expand.
   */
  setOpen(v: boolean, remember = true) {
    this.open = v;
    if (remember) {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(OPEN_KEY, v ? 'on' : 'off'); }
      catch { /* private mode, quota — the switch still works for this session */ }
    }
    closePops();
    this.apply();
    TL.render();
    // A mark's x moves with the gutter, so a card anchored to one is anchored
    // to where that mark USED to be. Same repair a pan makes (TL.onScroll).
    SelCard.reanchor();
  },

  /** Rebuild the rows. Structure only — never geometry; place() owns that. */
  build() {
    const host = this.host; if (!host) return;
    host.textContent = '';
    this.rows = [];
    for (const nd of Layers.root) {
      if (nd.t === 'L') { this.pushLayer(nd.id, false); continue; }
      const g = nd;
      const gh = el('div', 'tl-lrow tl-lrow--group');
      gh.dataset.gid = g.id;
      if (Layers.gvis[g.id] === false) gh.classList.add('is-off');
      const chev = el('button', 'tl-lchev', g.collapsed ? '›' : '⌄') as HTMLButtonElement;
      chev.type = 'button'; chev.dataset.a = 'collapse';
      chev.title = g.collapsed ? 'Expand the group in this panel' : 'Collapse the group in this panel (the lanes stay on the workspace)';
      const eye = el('button', 'tl-leye', Layers.gvis[g.id] === false ? EYEOFF : EYE) as HTMLButtonElement;
      eye.type = 'button'; eye.dataset.a = 'geye';
      eye.title = 'Show or hide every layer in this group';
      const nm = el('div', 'tl-lname tl-lname--group'); nm.textContent = g.name; nm.dataset.a = 'gdrag';
      const ct = el('div', 'tl-lcnt'); ct.textContent = String(g.kids.length);
      const x = el('button', 'tl-lx', '×') as HTMLButtonElement;
      x.type = 'button'; x.dataset.a = 'ungroup'; x.title = 'Ungroup — the layers stay, the group goes';
      gh.append(chev, eye, nm, ct, x);
      host.append(gh);
      this.rows.push({ el: gh, key: 'g:' + g.id, type: 'group', g });
      if (!g.collapsed) for (const k of g.kids) this.pushLayer(k.id, true);
    }
    const ids = Layers.ids();
    const cnt = document.getElementById('layerCount');
    if (cnt) {
      cnt.textContent = '';
      cnt.append(
        document.createTextNode(ids.filter(i => Layers.visible(i)).length + '/' + ids.length),
        el('span', 'tl-lcount__w', ' shown'),                 // dropped when the panel narrows
      );
    }
    /* AN EMPTY LIBRARY IS A STATE, NOT AN ABSENCE. When everything is already
       on the board there is nothing to add — but a button that disappears at
       that moment takes the reader's only route to the library with it, and
       they have no way to learn it will come back the moment they remove a
       layer. So it stays, in the dashed + tertiary-ink treatment the cube's
       chain already uses for "this slot is empty", still clickable, and the
       popover it opens says so in words. */
    const add = this.addBtn;
    if (add) {
      const left = Layers.library().length;
      add.dataset.empty = String(left === 0);
      add.title = left
        ? `Add one of ${left} more layers from the library`
        : 'Every layer in the library is already on the board — remove one and it comes back here';
    }
    if (this._lay) this.place(this._lay);
  },

  pushLayer(id: string, indent: boolean) {
    const host = this.host!;
    const d = layerDef(id); if (!d) return;
    const on = Layers.visible(id);
    const r = el('div', 'tl-lrow tl-lrow--layer' + (indent ? ' tl-lrow--in' : '') + (on ? '' : ' is-off'));
    r.dataset.lid = id;
    const eye = el('button', 'tl-leye', on ? EYE : EYEOFF) as HTMLButtonElement;
    eye.type = 'button'; eye.dataset.a = 'eye';
    eye.title = on ? 'Hide this layer' : 'Show this layer';
    eye.setAttribute('aria-pressed', String(on));
    const dot = el('span', 'tl-ldot');
    dot.style.background = d.si === null ? 'var(--tl-ink-3)' : `var(--s${d.si + 1})`;
    const nm = el('div', 'tl-lname'); nm.textContent = d.name; nm.dataset.a = 'drag';
    nm.title = d.name + ' — drag to reorder';
    const lv = el('button', 'tl-ldetail') as HTMLButtonElement;
    lv.type = 'button'; lv.dataset.a = 'detail';
    lv.textContent = DETAIL_WORDS[Layers.detail(id)];
    lv.title = 'How much of this layer to show — click to choose';
    const x = el('button', 'tl-lx', '×') as HTMLButtonElement;
    x.type = 'button'; x.dataset.a = 'remove'; x.title = 'Remove — it goes back to the library';
    r.append(eye, dot, nm, lv, x);
    host.append(r);
    this.rows.push({ el: r, key: id, type: 'layer' });
  },

  /* ── THE LOCK ─────────────────────────────────────────────────────────────
     top and height come straight off the lane, every frame, drawn geometry and
     not target geometry. A collapsed group stands in for the bands it is
     hiding, so its row is as tall as its header strip plus every child band. */
  place(lay: any) {
    this._lay = lay;
    const host = this.host; if (!host || !lay) return;
    host.style.height = lay.H + 'px';
    const byKey = new Map<string, any>();
    for (const L of lay.lanes) byKey.set(L.key, L);
    for (const r of this.rows) {
      const L = byKey.get(r.key);
      if (!L) { r.el.style.display = 'none'; continue; }
      r.el.style.display = '';
      let h = L.h;
      if (r.type === 'group' && r.g && r.g.collapsed) {
        for (const k of r.g.kids) { const c = byKey.get(k.id); if (c) h += c.h; }
      }
      r.el.style.top = L.top + 'px';
      r.el.style.height = Math.max(0, h) + 'px';
      // the label line sits where the lane's FIRST row of marks sits, so the row
      // reads as that band's name rather than as a floating caption
      const pad = r.type === 'group' ? 0 : clamp(L.headH - 3, 0, Math.max(0, h - 20));
      r.el.style.paddingTop = pad + 'px';
      r.el.classList.toggle('is-thin', h < 26);
    }
  },

  // ── the five operations ───────────────────────────────────────────────────
  onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t) return;
    const row = (e.target as HTMLElement).closest('.tl-lrow') as HTMLElement | null;
    const lid = row?.dataset.lid, gid = row?.dataset.gid;
    switch (t.dataset.a) {
      case 'eye': if (lid) Layers.toggle(lid); break;
      case 'geye': if (gid) Layers.toggleGroup(gid); break;
      case 'collapse': if (gid) Layers.collapse(gid); break;
      case 'ungroup': if (gid) Layers.ungroup(gid); break;
      case 'remove': if (lid) {
        // hand the lane to the slew limiter at the index it was standing in, so
        // it closes where it stood instead of disappearing between two frames
        TL.closeLayer(lid, Layers.lanes().findIndex(r => r.t === 'L' && r.id === lid));
        Layers.remove(lid);
      } break;
      case 'detail': if (lid) openDetail(t, lid); break;
    }
  },

  // ── drag: live move, root ⇄ group, both directions ────────────────────────
  onDown(e: PointerEvent) {
    const t = (e.target as HTMLElement).closest('[data-a="drag"],[data-a="gdrag"]') as HTMLElement | null;
    if (!t || e.button !== 0) return;
    e.preventDefault();
    const isG = t.dataset.a === 'gdrag';
    const host = (e.target as HTMLElement).closest('.tl-lrow') as HTMLElement;
    const id = isG ? host.dataset.gid! : host.dataset.lid!;
    // CAPTURE THE POINTER. The move/up listeners are on `window`, which is enough
    // for a mouse; a finger that leaves the row mid-drag can have its events
    // retargeted or swallowed without one, and the drop lands nowhere.
    try { t.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    // 4px was this panel's own mouse threshold and it keeps it; a finger gets
    // the touch slop (see gesture.ts) because a fingertip's centroid rolls
    // several pixels just pressing down, and at 4px every tap on a layer name
    // became a reorder.
    this._drag = { id, isG, x: e.clientX, y: e.clientY, live: false, slop: e.pointerType === 'mouse' ? 4 : TAP_SLOP };
  },
  onMove(e: PointerEvent) {
    const d = this._drag; if (!d) return;
    if (!d.live) {
      if (Math.abs(e.clientY - d.y) + Math.abs(e.clientX - d.x) < d.slop) return;
      d.live = true; closePops();
      ghost().style.display = 'block';
      ghost().textContent = d.isG
        ? (Layers.root.find(n => n.t === 'G' && n.id === d.id) as GNode | undefined)?.name || ''
        : layerDef(d.id)?.name || '';
      document.body.classList.add('tl-dragging');
    }
    const gh = ghost();
    gh.style.left = (e.clientX + 12) + 'px';
    gh.style.top = (e.clientY - 10) + 'px';
    const slot = this.slotAt(e.clientY);
    if (slot && Layers.moveTo(d.id, d.isG, slot.list, slot.i)) {
      const sel = this.rows.find(r => r.key === (d.isG ? 'g:' + d.id : d.id));
      if (sel) sel.el.classList.add('is-dragging');
    }
  },
  onUp() {
    if (!this._drag) return;
    this._drag = null;
    ghost().style.display = 'none';
    document.body.classList.remove('tl-dragging');
    this.build();
  },
  /** Every legal insertion point: over the root rows, and inside every open group. */
  slotAt(py: number): { list: any; i: number } | null {
    const cands: { list: any; i: number; y: number }[] = [];
    const push = (list: any, i: number, y: number) => cands.push({ list, i, y });
    for (const r of this.rows) {
      if (r.el.style.display === 'none') continue;
      const b = r.el.getBoundingClientRect();
      if (r.type === 'layer') {
        const w = Layers.walk().find(x => x.n.t === 'L' && x.n.id === r.key);
        if (!w) continue;
        push(w.list, w.i, b.top); push(w.list, w.i + 1, b.bottom);
      } else if (r.g) {
        const i = Layers.root.indexOf(r.g);
        push(Layers.root, i, b.top);
        if (r.g.collapsed) push(Layers.root, i + 1, b.bottom);
        else if (!r.g.kids.length) push(r.g.kids, 0, b.bottom);      // drop INTO an empty group
      }
    }
    const last = this.rows.filter(r => r.el.style.display !== 'none').pop();
    if (last) push(Layers.root, Layers.root.length, last.el.getBoundingClientRect().bottom);
    let best: any = null, bd = 1e9;
    for (const c of cands) { const d = Math.abs(py - c.y); if (d < bd) { bd = d; best = c; } }
    return best;
  },
};

// ── the two popovers ─────────────────────────────────────────────────────────
// Fixed to the viewport and parented to <body>: a popover inside the scrolling
// surface would travel with the surface while the reader is reading it.
let _ghost: HTMLElement | null = null;
function ghost() {
  if (!_ghost) { _ghost = el('div', 'tl-lghost'); document.body.appendChild(_ghost); }
  return _ghost;
}
let _pop: HTMLElement | null = null;
function pop() {
  if (!_pop) { _pop = el('div', 'tl-lpop'); document.body.appendChild(_pop); }
  return _pop;
}
export function closePops() {
  if (_pop) _pop.style.display = 'none';
  document.querySelectorAll('.tl-ldetail.is-open').forEach(n => n.classList.remove('is-open'));
}
function place(anchor: HTMLElement) {
  const p = pop();
  p.style.display = 'block';
  p.style.top = '-9999px';                       // measure before deciding which way to open
  const r = anchor.getBoundingClientRect();
  const h = p.offsetHeight;
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 10)) + 'px';
  // FLIP RATHER THAN SLIDE. "+ Add layer" lives on the bar at the bottom of the
  // panel, so a popover that always opens downward would be shoved back up over
  // its own button and end under the time rail. Below when it fits, above when
  // it does not; sliding it up until it fitted covered the anchor every time.
  const below = r.bottom + 4;
  p.style.top = (below + h <= innerHeight - 10 ? below : Math.max(8, r.top - 4 - h)) + 'px';
}

/**
 * THE DETAIL PICKER. Three named steps, each with the sentence that says what
 * the word means for THIS kind of layer — the founder's requirement that the
 * dial be worded, not numbered: "hover shows the current level as a word; click
 * opens a compact named-step picker".
 */
function openDetail(anchor: HTMLElement, id: string) {
  closePops();
  const d = layerDef(id); if (!d) return;
  anchor.classList.add('is-open');
  const p = pop();
  p.textContent = '';
  p.append(el('h4', undefined, 'How much of “' + d.name + '”'));
  const cur = Layers.detail(id);
  DETAIL_TEXT[d.kind].forEach(([word, desc], i) => {
    const o = el('button', 'tl-lopt' + (i === cur ? ' is-on' : '')) as HTMLButtonElement;
    o.type = 'button';
    o.append(el('b', undefined, word), el('span', undefined, desc));
    o.addEventListener('click', () => { Layers.setDetail(id, i as Detail); closePops(); });
    p.append(o);
  });
  place(anchor);
}

/** THE LIBRARY. Everything not on the board; clicking one puts it back. */
function openLibrary(anchor: HTMLElement) {
  const p = pop();
  if (p.style.display === 'block' && p.dataset.kind === 'lib') { closePops(); return; }
  closePops();
  p.textContent = ''; p.dataset.kind = 'lib';
  p.append(el('h4', undefined, 'Add a layer'));
  const lib: LayerDef[] = Layers.library();
  if (!lib.length) p.append(el('div', 'tl-lempty', 'Everything is already on the board.'));
  for (const d of lib) {
    const it = el('button', 'tl-litem') as HTMLButtonElement;
    it.type = 'button';
    const dot = el('span', 'tl-ldot');
    dot.style.background = d.si === null ? 'var(--tl-ink-3)' : `var(--s${d.si + 1})`;
    const n = el('span', 'tl-ln'); n.textContent = String(d.n);
    it.append(dot, el('span', 'tl-lt', d.name), n);
    it.addEventListener('click', () => { Layers.add(d.id); closePops(); });
    p.append(it);
  }
  place(anchor);
  p.dataset.kind = 'lib';
}
