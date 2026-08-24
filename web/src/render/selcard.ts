/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   selcard.ts — THE SELECTION CARD.

   A small floating card beside the thing you clicked. NOT a modal: no backdrop,
   no focus trap, no scroll lock. The canvas stays live underneath — you can pan,
   zoom and hover while it is open, because the card's whole job is to be read
   AGAINST the timeline, not instead of it.

   THE ACTION MODEL (design/selcard/SELCARD.md §2). These are NOT four commands.
   They are ONE command — *look at this* — through four of the app's own views:

       Show this in
       [ TIMELINE ][ MAP ][ CUBE ][ CORE ]

   so the subject's name can never appear in an action label ("Zoom to
   Polish-Lithuanian Commonwealth" is not shortened, it is structurally
   impossible), scanning drops from four phrases to four nouns, and the verb no
   longer flips per view. The card looks IDENTICAL on every view; only which
   cell carries aria-current changes.

   HIERARCHY. Timeline is primary on every view, expressed with three
   NON-CHROMATIC signals — position (always first, never reordered), weight (a
   solid ink block) and full width when it is the only survivor. The accent is
   never spent on a button: minium means "where you are", and the only two marks
   of it on this card are the span index and the focus ring.

   DEGRADATION is the difference between NEVER and NOT NOW. A life can never
   have a territory, so Map and Cube are NOT RENDERED for it — a permanently
   dead cell on all thirty-nine lives teaches the user the app is broken. Rome
   HAS territory, just not in 1783, so Map is rendered HATCHED with its reason
   on the button: hiding it there would imply Rome never had a map presence,
   which is a lie about the corpus. Order is never touched either way.

   NOTHING IN HERE WRITES TimeStore. "Timeline" moves the timeline's WINDOW, and
   the year follows the window's centre by the global centre-year rule that lives
   in Lab.tsx — so the moment moves as a CONSEQUENCE of the framing, in one
   place, rather than being written from four. Map, Cube and Core move the VIEW
   and nothing else. ("Go to its peak" is gone: it was the one control that wrote
   the year, and the centre-year rule made it a second, contradictory way to say
   the same thing.)

   PLACEMENT: it may never cover the thing it describes. The anchor rect comes
   from whichever renderer handled the click, in viewport coordinates, and the
   card goes right / left / below / above it, whichever fits, then clamps into
   the viewport. Below 760px CSS turns it into the bottom sheet the panels
   already use and placement is skipped entirely.

   THIS FILE IMPORTS NO RENDERER. Everything it can DO arrives through wire() at
   boot, from Lab.tsx, which is the only module that already knows all eleven
   views — so there is no cycle back through timeline.ts, map.ts or cube.ts.
   ============================================================================= */

import { $, CATBY, SelStore, TimeStore, YEARS, fmtBig, fmtY } from './shared';
import { esc, relDir } from './relations';
import {
  aliveAt, bandLabel, catLabel, describe, perspectiveSpan, placeOf, relCount, territoryAt,
  topRelations, typeLabel, type Place, type Subject,
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

/** Which view each destination lands you on — the aria-current join. */
const LANDS_ON: Record<string, string> = { persp: 'zoom', map: 'map', cube: 'cube', drill: 'core' };

/** Everything the card can do, injected by Lab.tsx at boot. */
export interface CardWiring {
  /** show the horizontal timeline framed on [a, b] — the TIMELINE destination */
  perspective(a: number, b: number): void;
  /** show the map, at the current global year */
  seeOnMap(): void;
  /** show the cube with this polity id traced */
  traceInCube(polityId: string): void;
  /** show the core sample, drilled at this point */
  drillAt(lon: number, lat: number, label: string): void;
  /** reveal the full ranked relation list in the docked panel */
  allConnections(): void;
  /** the snapshot year the map is actually showing right now */
  mapYear(): number;
  /** where this id is drawn on the CURRENT view, if it is drawn at all */
  anchorOf(id: string): DOMRect | null;
}

/** One cell of the destination group. Built in a fixed order and only filtered. */
interface Dest {
  act: string;
  label: string;
  title: string;
  off?: boolean;          // rendered, hatched, reason on the button — "not now"
  primary?: boolean;
  current?: boolean;      // you are standing here
}

/** relations.ts's esc() is a TEXT escaper — it leaves quotes alone, which is
 *  fine between tags and wrong inside title="…". Every attribute value on this
 *  card is composed from corpus strings, so they go through this instead. */
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** The field notes own Escape while open. (The ⌘K palette used to as well; it
 *  is gone — the one search is an <input>, and the guard below already refuses
 *  to act on any input, so Escape there closes its own dropdown instead.) */
const modalOpen = () =>
  !!document.querySelector('#fieldNotes:not([hidden])');

export const SelCard = {
  el: null as HTMLElement | null,
  wiring: null as CardWiring | null,
  anchor: null as DOMRect | null,
  view: '' as string,
  open: false,
  dismissed: false,        // × — sticky until the selection changes
  /** the exact spot the user pointed at, when the selection came from the map */
  point: null as Place | null,
  _hint: null as DOMRect | null,
  _pt: null as Place | null,
  _bound: false,

  wire(w: CardWiring) { this.wiring = w; },

  init() {
    const el = this.el = $<HTMLElement>('#selCard');
    if (!el || this._bound) return;
    this._bound = true;

    el.addEventListener('click', (e: any) => {
      const t = e.target as HTMLElement | null;
      const act = t?.closest?.('[data-act]') as HTMLElement | null;
      if (act) {
        e.preventDefault();
        // A HATCHED CELL IS FOCUSABLE, NOT DEAD. It keeps aria-disabled rather
        // than [disabled] so its reason stays reachable by keyboard and by
        // pointer — which means the no-op has to live here, not in the DOM.
        if (act.getAttribute('aria-disabled') === 'true') return;
        this.act(act.dataset.act!);
        return;
      }
      const row = t?.closest?.('[data-goid]') as HTMLElement | null;
      if (row) { e.preventDefault(); this.select(row.dataset.goid!, null); }
    });

    // ESC CLEARS THE SELECTION, EVERYWHERE.
    //
    // It used to close the card and deliberately KEEP the selection — the
    // selection being application state and the card only one reading of it.
    // That reasoning left the founder with a highlighted empire on the map and
    // no way to un-highlight it: "Once I click see on map theres no way to
    // un-click the highlight." The old rule is revoked by that bug. One Escape
    // now closes the card AND drops the selection, which is the only reading
    // that means the same thing on all eleven views.
    //
    // Capture phase, and stopPropagation, so Lab's global handler does not also
    // close the field notes underneath — but the two things that own Escape
    // when they are open (⌘K, the field notes) are handed it first.
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (modalOpen()) return;
      if (!this.open && !SelStore.id) return;
      e.stopPropagation();
      this.hide();
      SelStore.set(null);                         // the highlight goes with it
    }, true);

    addEventListener('resize', () => { if (this.open) this.place(); });

    SelStore.subscribe(() => {
      this.dismissed = false;                     // a NEW selection un-dismisses
      const r = this._hint; this._hint = null;
      const p = this._pt; this._pt = null;
      this.point = p;                             // …and a new selection re-points
      if (!SelStore.id) { this.hide(); return; }
      this.show(SelStore.id, r ?? this.resolveAnchor(SelStore.id));
    });
    // The card's span strip and presence line are about the YEAR, and the year
    // now moves on its own whenever the timeline is panned (the centre-year
    // rule), so the card has to re-read itself whenever the year moves.
    //
    // ON A MICROTASK, because the line also quotes the SNAPSHOT the map settled
    // on, and the map is another subscriber of the same store. The card is
    // initialised before the renderers (boot() needs it in place before anything
    // can call SelCard.select), so it is notified first — and repainting there
    // read the map's previous snapshot: a year move to 117 left the card saying
    // "not on the map in 117 (nearest snapshot 1783)" over a map that was, by
    // then, showing Rome at 1 BCE.
    TimeStore.subscribe(() => {
      if (!this.open) return;
      queueMicrotask(() => { if (this.open) this.paint(); });
    });
  },

  /**
   * THE ONE ENTRY POINT FOR RENDERERS. Select this id and put the card beside
   * that rect. Passing null for the id clears the selection, which is what an
   * empty-canvas click — and an empty-OCEAN click — means.
   *
   * `pt` is the exact point on the globe the user pointed at, which only the
   * map can know. It is what CORE drills: someone who clicked the Tibetan
   * corner of the Qing asked about Tibet, not about Beijing.
   */
  select(id: string | null, rect: DOMRect | null, pt: Place | null = null) {
    if (id === SelStore.id) {                     // re-click: the store will not fire
      this.dismissed = false;
      this.point = pt;
      if (id) this.show(id, rect ?? this.resolveAnchor(id)); else this.hide();
      return;
    }
    this._hint = rect; this._pt = pt;
    SelStore.set(id);
    this._hint = null; this._pt = null;
  },

  /** Lab tells the card which view is on screen — aria-current depends on it. */
  setView(v: string) {
    if (this.view === v) return;
    this.view = v;
    if (!SelStore.id || this.dismissed) { this.hide(); return; }
    this.show(SelStore.id, this.resolveAnchor(SelStore.id));
  },

  /**
   * The thing moved under the card. TIMELINE re-frames the window, so the mark
   * that was at the right edge when it was clicked is at the centre a heartbeat
   * later — and a card still parked at the old anchor is now covering a piece of
   * the very context the button just went and fetched.
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

  /**
   * THE SNAPSHOT THE MAP WOULD DRAW. On the map view that is whatever the map
   * is actually showing; anywhere else the map is STALE — nothing syncs it
   * until you arrive — and the honest answer is the snapshot pressing MAP would
   * land you on, which is `seeOnMap()`'s own `syncToYear(TimeStore.year)`.
   * Computed here from the corpus's own eighteen snapshot years rather than
   * asked of map.ts, which this file may not import.
   */
  snapYear(): number {
    const y = TimeStore.year;
    if (this.view === 'map' && this.wiring) {
      try { const m = this.wiring.mapYear(); if (Number.isFinite(m)) return m; } catch { /* stale map */ }
    }
    if (!YEARS.length) return y;
    let best = YEARS[0], bd = Infinity;
    for (const s of YEARS) { const d = Math.abs(s - y); if (d < bd) { bd = d; best = s; } }
    return best;
  },

  /** "1783", or "1776 (nearest snapshot 1783)" — the map draws one of eighteen. */
  whenOnMap(): string {
    const y = TimeStore.year, snap = this.snapYear();
    return snap === y ? fmtY(y) : `${fmtY(y)} (nearest snapshot ${fmtY(snap)})`;
  },

  // ── the body ──────────────────────────────────────────────────────────────
  paint() {
    const el = this.el; if (!el) return;
    const s = describe(SelStore.id);
    if (!s) { this.hide(); return; }
    const year = TimeStore.year;
    el.setAttribute('aria-label', s.name);

    const dates = s.end > s.start ? `${fmtBig(s.start)} – ${fmtY(s.end)}` : fmtBig(s.start);
    const band = bandLabel(s);
    const folded = foldedInto(s.id);
    const rels = topRelations(s.id, 4);
    const total = relCount(s.id);
    const present = this.presence(s);
    const sp = spanPct(s, year);

    // ── head: identity, then the measurement ───────────────────────────────
    // The two quietest things on the card share the top line, so the name below
    // gets the full width and a forty-character title never has to wrap around a
    // floating ×. The domain marker is the card's ONE data hue — its legend key,
    // the thing that lets you match the card to the mark you clicked.
    const dot = CATBY[s.cat] ? ` style="--tl-dot: var(--tl-cat-${s.cat})"` : '';
    let html =
      `<div class="tl-selcard__grip" aria-hidden="true"></div>` +
      `<div class="tl-selcard__head">` +
      `<div class="tl-selcard__top">` +
      `<div class="tl-selcard__meta"${dot}>` +
      `<span class="tl-selcard__dot" aria-hidden="true"></span>` +
      `<span><b>${esc(catLabel(s))}</b> · ${esc(typeLabel(s))}${band ? ' · ' + esc(band) : ''}</span>` +
      `</div>` +
      `<button type="button" class="tl-selcard__x" data-act="close" aria-label="Close" title="Close  Esc">` +
      `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">` +
      `<path d="M4 4l8 8M12 4l-8 8"/></svg></button>` +
      `</div>` +
      `<h3 class="tl-selcard__name">${esc(s.name)}</h3>`;

    // THE SPAN STRIP — the card's one graphic and the FIRST INFORMATION on it: a
    // miniature of the shell's engraved rail scoped to this object's life, with
    // the global year as the same minium index the rail flies. "You are outside
    // its span" is a picture before it is a sentence — the index simply sits in
    // the empty margin past the end of the bar.
    html += `<div class="tl-selcard__span" data-kind="${s.end === s.start ? 'moment' : 'span'}"` +
      ` style="--sc-a:${sp.a};--sc-b:${sp.b};--sc-i:${sp.i}">` +
      `<div class="tl-selcard__track" aria-hidden="true">` +
      `<span class="tl-selcard__life"></span><span class="tl-selcard__idx"></span></div>` +
      `<div class="tl-selcard__ends"><b>${esc(dates)}</b><span>${esc(fmtY(year))}</span></div>` +
      (present ? `<div class="tl-selcard__present">${esc(present)}</div>` : '') +
      `</div>`;

    if (s.note) html += `<p class="tl-selcard__note">${esc(s.note)}</p>`;

    // A founding or dissolution event fold.ts swallowed into this spread. One
    // fact about the SUBJECT, not a connection to something else, so it sits
    // with the note rather than in the Connections list.
    if (folded.length) {
      html += `<div class="tl-selcard__folds">`;
      for (const f of folded) {
        html += `<div class="tl-selcard__fold"><b>${esc(roleWord(FOLD[f].role))}</b> — ` +
          `${esc(f)}, <time>${esc(fmtY(foldYear(f)))}</time></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;                                   // /head

    // ── the destinations ───────────────────────────────────────────────────
    html += `<div class="tl-selcard__go">` +
      `<span class="tl-selcard__lead" id="tlSelcardShowIn">Show this in</span>` +
      `<div class="tl-selcard__dests" role="group" aria-labelledby="tlSelcardShowIn">`;
    for (const d of this.dests(s)) {
      const a = [
        `type="button"`,
        `class="tl-selcard__dest${d.primary ? ' tl-selcard__dest--primary' : ''}"`,
        `data-act="${d.act}"`,
        `title="${attr(d.title)}"`,
      ];
      if (d.current) a.push(`aria-current="true"`);
      if (d.off) a.push(`aria-disabled="true"`);
      html += `<button ${a.join(' ')}>${esc(d.label)}` +
        (d.off ? `<span class="tl-selcard__sr">unavailable — ${esc(d.title)}</span>` : '') +
        `</button>`;
    }
    html += `</div></div>`;

    // ── connections: a ranked micro-chart, never a list of links ───────────
    // Each row carries the counterpart, the KIND (origin vs opposed-to is a
    // completely different fact about the same pair) and the weight as a bar, so
    // four rows read as a little histogram down the right edge: you learn the
    // SHAPE of the neighbourhood in one fixation. The bar is ink at one value on
    // a neutral track, never a kind hue — a --tl-cat-* may only be a legend key,
    // and this card's legend key is already spent on the domain dot.
    if (rels.length) {
      html += `<div class="tl-selcard__rels">` +
        `<div class="tl-selcard__relshd">` +
        `<span class="tl-selcard__section">Connections</span>` +
        `<button type="button" class="tl-selcard__all" data-act="all">All ${total} →</button>` +
        `</div><ul class="tl-selcard__rellist">`;
      for (const r of rels) {
        html += `<li><button type="button" class="tl-selcard__rel" data-goid="${attr(r.id)}">` +
          `<span class="tl-selcard__rel-n">${esc(r.name)}</span>` +
          `<span class="tl-selcard__rel-k">${esc(r.kind)}</span>` +
          `<span class="tl-selcard__bar" style="--sc-w:${Math.round(r.w * 100)}%" aria-hidden="true"><i></i></span>` +
          `<span class="tl-selcard__sr">strength ${r.w.toFixed(2)}</span>` +
          `</button></li>`;
      }
      html += `</ul></div>`;
    } else {
      // The header absorbs the empty state and the whole block costs one line.
      // "Yet" is doing work: the corpus is growing, and a subject with no
      // curated links is not thereby unimportant.
      html += `<div class="tl-selcard__rels" data-empty="true">` +
        `<div class="tl-selcard__relshd">` +
        `<span class="tl-selcard__section">Connections</span>` +
        `<span class="tl-selcard__none">None curated yet.</span>` +
        `</div></div>`;
    }

    el.innerHTML = html;
  },

  /**
   * THE DESTINATION GROUP. Built as [timeline, map, cube, core] and only ever
   * FILTERED — never sorted, never re-ordered. If Map is missing, Cube does not
   * slide left into its slot; the group just gets shorter and Timeline is still
   * the first cell. Reordering by relevance makes each card individually optimal
   * and the set of cards unlearnable.
   */
  dests(s: Subject): Dest[] {
    const out: Dest[] = [];
    const place = this.point ?? placeOf(s);

    // TIMELINE — always, for everything with a curated span. It is the only
    // destination that exists for every object in the corpus, and a primary that
    // can disappear is not a primary. (A bare border feature has no span of its
    // own worth framing — its dates ARE one snapshot's stratum — so it is
    // suppressed there exactly as it always was.)
    if (!s.minimal) {
      const [a0, a1] = perspectiveSpan(s);
      const deep = fmtBig(a0) !== fmtY(a0);            // beyond 20,000 years
      out.push({
        act: 'persp', label: 'Timeline',
        title: deep
          ? `Frame the timeline on the ${a1 - a0} years around it`
          : `Frame the timeline on ${fmtY(a0)} – ${fmtY(a1)} — what else was going on`,
      });
    }

    // MAP — only for something that HAS a territory, and hatched rather than
    // hidden when that territory is empty at this year. Hiding it there would
    // imply the subject never had a map presence, which is a lie about the
    // corpus; the user has to be able to see that the door exists and is shut.
    if (!s.minimal && s.polity) {
      const n = territoryAt(s.polity, this.snapYear()).size;
      out.push({
        act: 'map', label: 'Map',
        title: n
          ? 'Highlight its territory on the map, at the year you are already on'
          : `Nothing to highlight — no ${s.name} borders at ${this.whenOnMap()}`,
        off: !n,
      });
    }

    // CUBE — never disabled by the year: it traces the whole life as a solid.
    if (!s.minimal && s.polity) {
      out.push({ act: 'cube', label: 'Cube', title: 'Trace its territory through time as a solid' });
    }

    // CORE — never disabled by the year either: it shows every sovereign that
    // ever held that ground. "HERE" IS A PROMISE ABOUT A PIXEL, so it is only
    // made when there is one: a selection that arrived from a map click carries
    // the exact spot, one from the search box or the timeline does not. That
    // promise now lives in the TITLE, where a per-instance detail belongs, so
    // the cell can stay CORE and the group keeps the same shape on every card.
    if (place) {
      const where = this.point ? 'at the point you clicked'
        : place.label && place.label !== s.name ? `at ${place.label}`
          : 'where it stood';
      out.push({ act: 'drill', label: 'Core', title: `Core sample ${where} — every sovereign that ever held that ground` });
    }

    for (const d of out) {
      // FILL = do this first. UNDERLINE = you are standing here. The two signals
      // are different on purpose and never collide: the shell's top rail already
      // marks the active view with a 2px ink underline and never with a fill.
      d.current = LANDS_ON[d.act] === this.view;
      // A ONE-CELL SEGMENTED CONTROL LOOKS LIKE A BUG, so a lone survivor is a
      // plain full-width primary instead — which for a bare border feature means
      // Core, the only door that thing has.
      d.primary = d.act === 'persp' || out.length === 1;
    }
    return out;
  },

  /**
   * THE PRESENCE LINE — a measurement, never a warning.
   *
   * The map cannot draw a polity that has no territory in the snapshot it is
   * showing, and covering that up — by silently dimming nothing, or by moving
   * the year without being asked — is the lie this line refuses. But an absence
   * in a historical atlas is DATA: Rome not being on the 1783 map is the single
   * most ordinary fact in the corpus, so it gets no box, no tint, no icon and no
   * accent. It is mono because it is a measurement, and it sits inside the span
   * strip because it is the caption of the strip.
   */
  presence(s: Subject): string | null {
    const y = TimeStore.year;
    // A bare border feature is only ever selected FROM the snapshot it is drawn
    // in, and its dates ARE that snapshot's stratum, so there is nothing here it
    // could be honest about that the dates line has not already said.
    if (s.minimal) return null;

    if (s.polity && this.view === 'map') {
      const n = territoryAt(s.polity, this.snapYear()).size;
      const when = this.whenOnMap();
      if (n) return `${n} ${n === 1 ? 'territory' : 'territories'} shown at ${when}`;
      // Nothing drawn. When the year is also outside its life the DISTANCE below
      // says strictly more than "not on the map" does, and the hatched Map cell
      // already carries the map's own reason — so only a subject that is alive
      // and still missing needs this sentence.
      if (aliveAt(s, y)) return `not on the map at ${when}`;
    }

    if (aliveAt(s, y)) return null;
    // SUPPRESSED WHEN IT WOULD REPEAT THE DATE. Beyond 20,000 years fmtBig
    // renders the date itself as a relative string, so "541 million yrs ago"
    // and "541 million yrs before 1783" would be one sentence too many.
    if (fmtBig(s.start) !== fmtY(s.start)) return null;

    const moment = s.end === s.start;
    if (y > s.end) {
      const n = (y - s.end).toLocaleString('en-US');
      return moment ? `${n} yrs before ${fmtY(y)}` : `ended ${n} yrs before ${fmtY(y)}`;
    }
    const n = (s.start - y).toLocaleString('en-US');
    return moment ? `${n} yrs after ${fmtY(y)}` : `begins ${n} yrs after ${fmtY(y)}`;
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
      case 'drill': {
        // this.point first, ALWAYS: on the map that is the pixel the user put
        // the cursor on, and it outranks the polity's own centroid.
        const p = this.point ?? placeOf(s);
        if (p) w?.drillAt(p.lon, p.lat, p.label);
        break;
      }
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
    let x: number, y: number, side = '';

    if (a) {
      const fitsR = a.right + GAP <= maxX;
      const fitsL = a.left - GAP - w >= minX;
      x = fitsR ? a.right + GAP
        : fitsL ? a.left - GAP - w
          : clampN(a.left, minX, maxX);
      side = fitsR ? 'r' : fitsL ? 'l' : '';
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
        // THE FLOOR IS MEASURED, NOT GUESSED. It used to be a flat 180px, which
        // was safe while the whole card scrolled; it no longer does — only the
        // connections list gives up height (SELCARD.md §3.7), so squeezing below
        // the head-plus-destinations block now CLIPS the actions rather than
        // scrolling them, and the actions are the card's entire purpose. So the
        // floor is whatever those two blocks actually measure, and the list is
        // the only thing that ever ends up at zero.
        if (h > room) { h = Math.max(this.keepH(), room); el.style.maxHeight = h + 'px'; }
        const belowFirst = below >= above;
        y = belowFirst ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - h);
        side = belowFirst ? '' : 't';
      }
      if (overlaps(x, y, w, h, a)) {                    // it may NEVER cover its subject
        const fitsBelow = a.bottom + GAP + h <= vh - MARGIN;
        y = fitsBelow ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - h);
        side = fitsBelow ? '' : 't';
        if (overlaps(x, y, w, h, a)) { x = clampN(a.right + GAP, minX, maxX); side = 'r'; }
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
    // THE CARD SLIDES OUT OF THE THING IT NAMES. Written only when it changes,
    // because animation-name is what the keyframe hangs off and rewriting it
    // would replay the entry on every resize and every re-anchor.
    if ((el.dataset.side || '') !== side) {
      if (side) el.dataset.side = side; else delete el.dataset.side;
    }
  },

  /** The height of the blocks that may never be scrolled or clipped away: the
   *  identity, the measurement and the destinations, plus the card's padding. */
  keepH(): number {
    const el = this.el; if (!el) return 180;
    const head = el.querySelector('.tl-selcard__head') as HTMLElement | null;
    const go = el.querySelector('.tl-selcard__go') as HTMLElement | null;
    if (!head || !go) return 180;
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.rowGap) || 0;
    return Math.ceil(head.offsetHeight + go.offsetHeight + pad + gap * 2);
  },
};

/**
 * THE STRIP DOMAIN. It always contains BOTH the subject's life and the current
 * year, padded 10% each side, so the index is always on the strip and the gap
 * between them is always to scale — which is what makes "you are outside its
 * span" a picture. A life that brackets the year lands at 8.3% / 91.7%.
 */
function spanPct(s: Subject, year: number) {
  const lo = Math.min(s.start, year), hi = Math.max(s.end, year);
  const pad = (hi - lo) * 0.1 || 1;
  const d0 = lo - pad, d1 = hi + pad;
  const pct = (v: number) => (((v - d0) / (d1 - d0)) * 100).toFixed(1) + '%';
  return { a: pct(s.start), b: pct(s.end), i: pct(year) };
}

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
