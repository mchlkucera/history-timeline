/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   selcard.ts — THE SELECTION CARD.

   A small floating card beside the thing you clicked. NOT a modal: no backdrop,
   no focus trap, no scroll lock. The canvas stays live underneath — you can pan,
   zoom and hover while it is open, because the card's whole job is to be read
   AGAINST the timeline, not instead of it.

   WHAT IT IS FOR, in the founder's words: "I want to see Cubism in perspective —
   what did the world look like, what wars, what technology, what was going on in
   other spheres of my interests?" So the card is thin and the ACTIONS are the
   point. Its relations are garnish: four of them, quiet, with the full ranked
   list one click away in the dock.

   THE IRON RULE: THE YEAR NEVER MOVES UNLESS THE USER PRESSES A THING THAT SAYS
   SO. Exactly one control in here writes TimeStore — "Go to its peak", which
   names the year on its own face before you press it. "In perspective" moves the
   timeline's WINDOW; "See on map" moves the VIEW. Neither touches the moment.

   PLACEMENT: it may never cover the thing it describes. The anchor rect comes
   from whichever renderer handled the click, in viewport coordinates, and the
   card goes right / left / below / above it, whichever fits, then clamps into
   the viewport. Below 760px CSS turns it into the bottom sheet the panels
   already use and placement is skipped entirely.

   THIS FILE IMPORTS NO RENDERER. Everything it can DO arrives through wire() at
   boot, from Lab.tsx, which is the only module that already knows all eleven
   views — so there is no cycle back through timeline.ts, map.ts or cube.ts.
   ============================================================================= */

import { $, SelStore, TimeStore, catColor, fmtBig, fmtY, tokens } from './shared';
import { esc, relDir } from './relations';
import {
  aliveAt, bandLabel, catLabel, describe, perspectiveSpan, relCount, territoryAt, topRelations,
  typeLabel, type Subject,
} from './subject';
import { FOLD, roleWord } from './fold';

const GAP = 10;          // breathing room between the card and the thing it names
const MARGIN = 10;       // hard viewport inset
const NARROW = 760;

// Connections has a docked "Related" panel that IS this card's content, in more
// depth, permanently — a card over it would be the same words twice on a canvas
// that is already 826px of ribbon. The selection still persists; only the card
// stands down.
const SUPPRESS = new Set(['conn']);

/** Everything the card can do, injected by Lab.tsx at boot. */
export interface CardWiring {
  /** frame the horizontal timeline on [a, b] — must NOT move the global year */
  perspective(a: number, b: number): void;
  /** show the map, at the current global year */
  seeOnMap(): void;
  /** show the cube with this polity id traced */
  traceInCube(polityId: string): void;
  /** reveal the full ranked relation list in the docked panel */
  allConnections(): void;
  /** the snapshot year the map is actually showing right now */
  mapYear(): number;
  /** where this id is drawn on the CURRENT view, if it is drawn at all */
  anchorOf(id: string): DOMRect | null;
}

export const SelCard = {
  el: null as HTMLElement | null,
  wiring: null as CardWiring | null,
  anchor: null as DOMRect | null,
  view: '' as string,
  open: false,
  dismissed: false,        // Esc / × — sticky until the selection changes
  _hint: null as DOMRect | null,
  _bound: false,

  wire(w: CardWiring) { this.wiring = w; },

  init() {
    const el = this.el = $<HTMLElement>('#selCard');
    if (!el || this._bound) return;
    this._bound = true;

    el.addEventListener('click', (e: any) => {
      const t = e.target as HTMLElement | null;
      const act = t?.closest?.('[data-act]') as HTMLElement | null;
      if (act) { e.preventDefault(); this.act(act.dataset.act!); return; }
      const row = t?.closest?.('[data-goid]') as HTMLElement | null;
      if (row) { e.preventDefault(); this.select(row.dataset.goid!, null); }
    });

    // Esc closes the card. It does NOT clear the selection: the selection is
    // application state shared by every view, the card is one reading of it.
    // Capture phase, and stopPropagation, so Lab's global handler does not also
    // close the field notes underneath.
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.open) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.stopPropagation();
      this.hide(true);
    }, true);

    addEventListener('resize', () => { if (this.open) this.place(); });

    SelStore.subscribe(() => {
      this.dismissed = false;                     // a NEW selection un-dismisses
      const r = this._hint; this._hint = null;
      if (!SelStore.id) { this.hide(); return; }
      this.show(SelStore.id, r ?? this.resolveAnchor(SelStore.id));
    });
    // "Go to its peak" moves the year and the card's honest line is about the
    // year, so the card has to re-read itself whenever the year moves.
    //
    // ON A MICROTASK, because the line also quotes the SNAPSHOT the map settled
    // on, and the map is another subscriber of the same store. The card is
    // initialised before the renderers (boot() needs it in place before anything
    // can call SelCard.select), so it is notified first — and repainting there
    // read the map's previous snapshot: pressing "Go to its peak · 117" left the
    // card saying "not on the map in 117 (nearest snapshot 1783)" over a map
    // that was, by then, showing Rome at 1 BCE.
    TimeStore.subscribe(() => {
      if (!this.open) return;
      queueMicrotask(() => { if (this.open) this.paint(); });
    });
  },

  /**
   * THE ONE ENTRY POINT FOR RENDERERS. Select this id and put the card beside
   * that rect. Passing null for the id clears the selection, which is what an
   * empty-canvas click means.
   */
  select(id: string | null, rect: DOMRect | null) {
    if (id === SelStore.id) {                     // re-click: the store will not fire
      this.dismissed = false;
      if (id) this.show(id, rect ?? this.resolveAnchor(id)); else this.hide();
      return;
    }
    this._hint = rect;
    SelStore.set(id);
    this._hint = null;
  },

  /** Lab tells the card which view is on screen — the honest line depends on it. */
  setView(v: string) {
    if (this.view === v) return;
    this.view = v;
    if (!SelStore.id || this.dismissed) { this.hide(); return; }
    this.show(SelStore.id, this.resolveAnchor(SelStore.id));
  },

  /**
   * The thing moved under the card. "In perspective" re-frames the window, so
   * the mark that was at the right edge when it was clicked is at the centre a
   * heartbeat later — and a card still parked at the old anchor is now covering
   * a piece of the very context the button just went and fetched.
   */
  reanchor() {
    if (!this.open || !SelStore.id) return;
    this.anchor = this.resolveAnchor(SelStore.id);
    this.place();
  },

  /** The right edge of the docked control column, or 0 when panels float. */
  dockRight(): number {
    const st = document.getElementById('stage');
    if (!st || st.dataset.dock !== 'left') return 0;
    const col = st.querySelector('.tl-col--l') as HTMLElement | null;
    if (!col) return 0;
    const r = col.getBoundingClientRect();
    return r.width ? r.right + 8 : 0;
  },

  resolveAnchor(id: string): DOMRect | null {
    try { return this.wiring ? this.wiring.anchorOf(id) : null; } catch { return null; }
  },

  show(id: string, rect: DOMRect | null) {
    const el = this.el; if (!el) return;
    if (this.dismissed || SUPPRESS.has(this.view) || !describe(id)) { this.hide(); return; }
    this.anchor = rect;
    this.open = true;
    el.hidden = false;
    this.paint();
    this.place();
  },

  hide(byUser = false) {
    if (byUser) this.dismissed = true;
    this.open = false;
    if (this.el) this.el.hidden = true;
  },

  // ── the body ──────────────────────────────────────────────────────────────
  paint() {
    const el = this.el; if (!el) return;
    const s = describe(SelStore.id);
    if (!s) { this.hide(); return; }
    const T = tokens();
    const dates = s.end > s.start ? `${fmtBig(s.start)} – ${fmtY(s.end)}` : fmtBig(s.start);
    const band = bandLabel(s);
    const folded = foldedInto(s.id);
    const rels = topRelations(s.id, 4);
    const total = relCount(s.id);

    let html =
      `<div class="tl-selcard__hd">` +
      `<h3 class="tl-selcard__name">${esc(s.name)}</h3>` +
      `<button class="tl-selcard__x" data-act="close" aria-label="Close" title="Close  Esc">` +
      `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">` +
      `<path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>` +
      `<div class="tl-selcard__dates">${esc(dates)}</div>`;

    if (s.note) html += `<p class="tl-selcard__note">${esc(s.note)}</p>`;

    html += `<div class="tl-selcard__tags">` +
      `<span class="tl-selcard__chip"><i style="background:${catColor(s.cat, T)}"></i>${esc(catLabel(s))}</span>` +
      `<span class="tl-selcard__kind">${esc(typeLabel(s))}${band ? ' · ' + esc(band) : ''}</span>` +
      `</div>`;

    for (const f of folded) {
      html += `<div class="tl-selcard__fold"><b>${esc(roleWord(FOLD[f].role))}</b> — ` +
        `${esc(f)}, ${esc(fmtY(foldYear(f)))}</div>`;
    }

    const honest = this.honestLine(s);
    if (honest) html += `<div class="tl-selcard__honest">${esc(honest)}</div>`;

    // ── the actions. Exactly one moves time, and it says which year. ──
    html += `<div class="tl-selcard__acts">` +
      `<button class="btn hero" data-act="persp" ` +
      `title="Frame the timeline around this — the year does not move">In perspective</button>`;
    if (s.polity) {
      html += `<button class="btn" data-act="map" title="The map, at the year you are already on">See on map</button>`;
    }
    if (this.offerPeak(s)) {
      html += `<button class="btn" data-act="peak" ` +
        `title="The one control here that moves the year">Go to its peak · ${esc(fmtY(s.peakYear))}</button>`;
    }
    if (s.polity) html += `<button class="btn" data-act="cube">Trace in cube</button>`;
    html += `</div>`;

    // ── relations: quiet, secondary, never the point ──
    if (rels.length) {
      html += `<div class="tl-selcard__rels">`;
      for (const r of rels) {
        html += `<button class="tl-selcard__rel" data-goid="${esc(r.id)}">` +
          `<span class="n">${esc(r.name)}</span><span class="k">${esc(r.kind)}</span></button>`;
      }
      html += `</div><button class="tl-selcard__all" data-act="all">` +
        (total > rels.length ? `All ${total} connections →` : `All connections →`) + `</button>`;
    } else {
      html += `<div class="tl-selcard__rels tl-selcard__rels--none">No curated connections yet.</div>`;
    }

    el.innerHTML = html;
  },

  /**
   * THE HONEST LINE. The map cannot draw a polity that has no territory in the
   * snapshot it is showing, and covering that up — by silently dimming nothing,
   * or by moving the year without being asked — is the lie this line refuses.
   */
  honestLine(s: Subject): string | null {
    const y = TimeStore.year;
    if (s.polity && this.view === 'map') {
      // The map draws the nearest of eighteen snapshots, which is usually not
      // the year you are standing in. Naming only one of the two would be a
      // small lie in either direction, so it names both whenever they differ.
      const snap = this.wiring ? this.wiring.mapYear() : y;
      const when = snap === y ? fmtY(y) : `${fmtY(y)} (nearest snapshot ${fmtY(snap)})`;
      const n = territoryAt(s.polity, snap).size;
      return n
        ? `${n} ${n === 1 ? 'territory' : 'territories'} highlighted in ${when}`
        : `not on the map in ${when}`;
    }
    if (!aliveAt(s, y)) return `not there in ${fmtY(y)} — you are outside its span`;
    return null;
  },

  /** "only when absent": the control that moves time shows up when the thing is
   *  not there at the moment you are standing in. */
  offerPeak(s: Subject): boolean {
    if (s.peakYear === TimeStore.year) return false;
    if (!aliveAt(s, TimeStore.year)) return true;
    if (s.polity && this.view === 'map') {
      const snap = this.wiring ? this.wiring.mapYear() : TimeStore.year;
      return territoryAt(s.polity, snap).size === 0;
    }
    return false;
  },

  // ── the actions ───────────────────────────────────────────────────────────
  act(a: string) {
    const s = describe(SelStore.id); if (!s) return;
    const w = this.wiring;
    switch (a) {
      case 'close': this.hide(true); break;
      case 'persp': { const [a0, a1] = perspectiveSpan(s); w?.perspective(a0, a1); break; }
      case 'map': w?.seeOnMap(); break;
      case 'cube': if (s.polity) w?.traceInCube(s.polity); break;
      case 'peak': TimeStore.set(s.peakYear, 'ui'); break;   // THE ONE that moves time
      case 'all': w?.allConnections(); break;
    }
  },

  // ── placement ─────────────────────────────────────────────────────────────
  place() {
    const el = this.el; if (!el || el.hidden) return;
    // CSS owns the sheet below 760px — clear every inline override placement set
    if (innerWidth < NARROW) { el.style.left = ''; el.style.top = ''; el.style.maxHeight = ''; return; }

    el.style.left = '0px'; el.style.top = '0px';        // measure at a known origin
    el.style.maxHeight = '';                            // …and at its natural height
    const w = el.offsetWidth;
    let h = el.offsetHeight;
    const vw = innerWidth, vh = innerHeight;
    // THE DOCK IS NOT FAIR GAME. Five views give the control column a strip of
    // its own and the canvas takes the rest (shell.css §04); the card sits above
    // panels in z-order, so a spread wide enough to force a stacked placement
    // used to put the card down at x = 10 — on top of the domain chips. The
    // canvas's own left edge is the dock's right edge, so that is the floor.
    const minX = Math.max(MARGIN, this.dockRight());
    const maxX = Math.max(minX, vw - MARGIN - w);
    const a = this.anchor;
    let x: number, y: number;

    if (a) {
      const fitsR = a.right + GAP <= maxX;
      const fitsL = a.left - GAP - w >= minX;
      x = fitsR ? a.right + GAP
        : fitsL ? a.left - GAP - w
          : clampN(a.left, minX, maxX);
      y = clampN(a.top - 6, MARGIN, vh - MARGIN - h);
      if (!fitsR && !fitsL) {
        // NEITHER SIDE FITS, so it has to stack — and a spread wide enough to
        // force that is usually wider than the window (Ancient Egypt at a 600
        // year span runs 5243px, right off both edges), which means "above" and
        // "below" are the only two places left and the card has to be short
        // enough to be in one of them. So it takes the taller gap and SHRINKS
        // into it, scrolling its own body, rather than parking on top of the
        // bar it is describing.
        const above = a.top - GAP - MARGIN;
        const below = vh - MARGIN - (a.bottom + GAP);
        const room = Math.max(above, below);
        if (h > room) { h = Math.max(180, room); el.style.maxHeight = h + 'px'; }
        y = below >= above ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - h);
      }
      if (overlaps(x, y, w, h, a)) {                    // it may NEVER cover its subject
        y = a.bottom + GAP + h <= vh - MARGIN ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - h);
        if (overlaps(x, y, w, h, a)) x = clampN(a.right + GAP, minX, maxX);
      }
    } else {
      // Parked: the top-right of the stage. Empty on every view that docks its
      // panels left, and ocean on the map.
      const st = document.getElementById('stage');
      const r = st ? st.getBoundingClientRect() : null;
      x = clampN((r ? r.right : vw) - w - 12, minX, maxX);
      y = clampN((r ? r.top : 60) + 12, MARGIN, vh - MARGIN - h);
    }
    // FINAL CLAMP. A mark can be drawn a little past the canvas edge (the layout
    // culls at cw + 40), so "the side that fits" can be chosen off an anchor that
    // is itself off-screen and push the card's far edge out of the window. The
    // clamp only ever pulls the card back INTO the viewport, which moves it away
    // from an off-screen anchor, so it cannot introduce an overlap.
    x = clampN(x, minX, maxX);
    y = clampN(y, MARGIN, Math.max(MARGIN, vh - MARGIN - h));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  },
};

/** The founding/dissolution events this spread has swallowed. */
function foldedInto(id: string): string[] {
  const out: string[] = [];
  for (const t in FOLD) if (FOLD[t].spread === id) out.push(t);
  return out;
}
function foldYear(title: string): number {
  const d = relDir.get('event:' + title);
  return d ? d.start : 0;
}
function clampN(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function overlaps(x: number, y: number, w: number, h: number, a: DOMRect) {
  return x < a.right && x + w > a.left && y < a.bottom && y + h > a.top;
}
