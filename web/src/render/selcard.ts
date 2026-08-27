/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   selcard.ts — THE SELECTION CARD.

   A small floating card beside the thing you clicked. NOT a modal: no backdrop,
   no focus trap, no scroll lock. The canvas stays live underneath — you can pan,
   zoom and hover while it is open, because the card's whole job is to be read
   AGAINST the timeline, not instead of it.

   THE ACTION MODEL (design/selcard/SELCARD.md §2). These are NOT four
   commands. They are ONE command — *look at this* — through four of the app's
   own views:

       Show this in
       [ TIMELINE ][ FLOW ][ MAP ][ CUBE ]

   so the subject's name can never appear in an action label ("Zoom to
   Polish-Lithuanian Commonwealth" is not shortened, it is structurally
   impossible), scanning drops from three phrases to three nouns, and the verb
   no longer flips per view. (CORE is gone: the founder cut the view.)

   FLOW IS THE FOURTH, and it went in SECOND rather than last. The row runs
   time then space: Timeline and Flow are the two projections onto a year axis,
   Map is the projection onto the ground, Cube fuses them — a line, a line with
   thickness, a surface, a solid. Flow draws polities as ribbons through time,
   so for anything with a polity it is a genuine perspective on the same
   subject, and it was the only one of the five views the card could not send
   you to. Founder: "Timeline / Map / Cube — i am missing Flow here".

   ONE SIGNAL, ONE MEANING. The inverted cell — a solid ink block with an
   inverted label — means WHERE YOU ARE, and nothing else. On the Map view the
   MAP cell is inverted; on the Timeline view the TIMELINE cell is; on a view
   that is not a destination at all (Braid, Connections, …) none of them is.
   Exactly one is ever lit.

   This replaces a strip that tried to carry two ideas at once: the ink block
   used to mean "do this first" and was hard-coded to TIMELINE on every view,
   while "you are standing here" was a 2px bottom bar. So Timeline permanently
   LOOKED active, and the real marker was the quieter of the two. Founder:
   "right now it looks like 'Timeline' is always active". The bottom bar and the
   whole primary concept are gone; Timeline is just the cell that is always
   first. The accent is still never spent on a button — minium means "where you
   are", and the focus ring is the card's only mark of it.

   DEGRADATION is the difference between NEVER and NOWHERE. A life can never
   have a territory and is not a polity, so Flow, Map and Cube are NOT RENDERED
   for it — a permanently dead cell on all thirty-nine lives teaches the user
   the app is broken. All three hang off the same test, `s.polity`, because
   that is the one join all three views are reached through.

   A polity that HAS territory is always reachable, whatever year you are on.
   Map used to hatch whenever the CURRENT year had no borders — Rome selected
   in 1783 — but with 18 atlas snapshots across five millennia that is the
   normal case for almost every polity almost all of the time, and it left the
   map unreachable for a subject that is very much on it. The cell now travels:
   it goes to the first snapshot the thing is actually drawn in, and its title
   names that year before you press it. Only a polity drawn in NO snapshot is
   still hatched, because there the door really does open onto nothing. Order is
   never touched either way.

   NOTHING IN HERE WRITES TimeStore. "Timeline" moves the timeline's WINDOW, and
   the year follows the window's centre by the global centre-year rule that lives
   in Lab.tsx — so the moment moves as a CONSEQUENCE of the framing, in one
   place, rather than being written from three. Map and Cube move the VIEW
   and nothing else. ("Go to its peak" is gone: it was the one control that wrote
   the year, and the centre-year rule made it a second, contradictory way to say
   the same thing.)

   PLACEMENT DEPENDS ON WHETHER YOU POINTED AT ANYTHING.

   YOU POINTED (a click, a tap, a row in the card's own connections list): the
   card goes beside the thing, and may never cover it. The anchor rect comes
   from whichever renderer handled the click, in viewport coordinates, and the
   card goes right / left / below / above it, whichever fits, then clamps into
   the viewport.

   YOU DID NOT POINT (the search): the card PARKS at the top-right and stays
   there for the life of that selection. Anchoring after a search puts the card
   wherever the hit happens to have landed, which on the timeline is the left
   edge as often as not — a position the reader cannot predict and did not
   choose. Founder: "After search is done, show the card always on top right".
   The parked corner is shared with the control panels, so the card takes the
   slot BELOW them in the same right-hand column rather than the corner itself
   (see place()); it never covers chrome, and it never has to know which corner
   the chrome is in, because it measures.

   Below 760px CSS turns it into the bottom sheet the panels already use and
   placement is skipped entirely — both rules stop at that width.

   THIS FILE IMPORTS NO RENDERER. Everything it can DO arrives through wire() at
   boot, from Lab.tsx, which is the only module that already knows all eleven
   views — so there is no cycle back through timeline.ts, map.ts or cube.ts.
   ============================================================================= */

import { $, CATBY, POLITIES, SelStore, TimeStore, YEARS, atlasState, fmtBig, fmtY } from './shared';
import { esc, relDir } from './relations';
import {
  bandLabel, catLabel, describe, perspectiveSpan, relCount, territoryAt,
  topRelations, typeLabel, type Place, type Subject,
} from './subject';
import { FOLD, roleWord } from './fold';
// The layer MODEL, not a renderer — it is the file that knows whether any lane
// on the board (or in the library) would draw a given id, and it knows nothing
// about the canvas. See "THIS FILE IMPORTS NO RENDERER" above.
import { planReveal } from './layers';

const GAP = 10;          // breathing room between the card and the thing it names
const MARGIN = 10;       // hard viewport inset
const NARROW = 760;

// NOTHING SUPPRESSES THE CARD ANY MORE. Connections used to, on the grounds
// that its docked "Related" panel is this card's content in more depth. But the
// TIMELINE renders its own relations panel AND opens the card — the identical
// duplication, accepted there — so the rule made one view behave differently
// from every other for a reason the reader could not have guessed. "One place
// can be viewed in different perspectives" is the whole brief; a perspective
// that silently withholds the card is not one of them. The docked panel stays
// as the deep list, exactly as on the timeline.
const SUPPRESS = new Set<string>();

/** Which view each destination lands you on — the aria-current join. */
const LANDS_ON: Record<string, string> = { persp: 'zoom', flow: 'flow', map: 'map', cube: 'cube', braid: 'braid', conn: 'conn' };

/**
 * IS THIS POLITY A RIBBON AT ALL? Flow draws POLITIES and only POLITIES, so a
 * polity id that is not in that array carries no weight curve and can never be
 * a ribbon — whatever you do with the region chips or the pan.
 *
 * Such ids exist: describe() falls back to the map's ALIAS table for a polity
 * the flow corpus does not carry (subject.ts), and that subject still reports a
 * `polity`, so it still gets a Map cell. The two sets happen to coincide today
 * (147 = 147) but they are separate files with separate build scripts, and the
 * corpus grows on both sides independently.
 *
 * Read from the CORPUS, never from flow.ts — same rule, and same reason, as
 * firstMapYear() reading YEARS instead of asking map.ts: this file imports no
 * renderer, so there is no cycle back through it.
 */
function isRibbon(polity: string | null): boolean {
  return !!polity && POLITIES.some((p: any) => p.id === polity);
}

/**
 * THE FIRST SNAPSHOT THIS POLITY IS ACTUALLY DRAWN IN, or null if it is drawn
 * in none of them. This is what makes the MAP destination reachable from any
 * year: the atlas holds 18 snapshots across five millennia, so "no borders at
 * the year you happen to be standing on" is the normal case for almost every
 * polity almost all of the time, and it is not a reason to shut the door.
 *
 * The ascending scan is deliberate over "nearest snapshot": the founder asked
 * for the BEGINNING of the thing, and a fixed destination is predictable —
 * the same click from 3000 BCE and from 1994 lands you in the same place, and
 * the cell's title names that year before you press it. territoryAt is a lookup
 * into a table built at load, so 18 of them cost nothing per render.
 */
function firstMapYear(polity: string | null): number | null {
  if (!polity) return null;
  // NO ATLAS, NO DESTINATION. The atlas is lazy now, and it can fail. This
  // function reads polities.json and ATLAS_YEARS, neither of which needs the
  // geometry — so without the guard the card would keep offering "go to 1279,
  // where its borders first appear" for a map that cannot draw a border. It
  // would not crash; it would just promise a room with nothing in it.
  if (atlasState() === 'failed') return null;
  for (const y of YEARS) if (territoryAt(polity, y).size) return y;
  return null;
}

/** Everything the card can do, injected by Lab.tsx at boot. */
export interface CardWiring {
  /**
   * THE TIMELINE DESTINATION — show THIS subject on the horizontal timeline.
   *
   * It replaced `perspective(a, b)`, which took a SPAN and could therefore only
   * do half the job: frame two numbers and hope something was drawn between
   * them. A span cannot be asked whether a lane draws it; an id can. So Lab
   * plans the reveal, adds the lane and raises its dial, selects, frames, and
   * says what it took — the same call the search box makes, so
   * "Make sure its impossible to zoom in on something that does not exist"
   * finally holds for this cell too.
   */
  showOnTimeline(id: string): void;
  /**
   * GO TO ANOTHER SUBJECT — a row in the Connections list.
   *
   * A DIFFERENT VERB FROM THE ONE ABOVE, because it is a different sentence.
   * The destination row says "show this subject in THAT view" and names the
   * view on the button. A connections row says "take me to that subject", full
   * stop — and the reader is standing somewhere. So Lab answers it from HERE:
   * on the map a related empire highlights on the map, on the timeline a
   * related event reveals its lane and frames. Only when the thing cannot be
   * drawn where the reader is standing does anything move, and then it asks
   * first rather than teleporting, because a row in a list gives no warning of
   * a view switch the way a search row's "shown on Beliefs" does.
   */
  goTo(id: string): void;
  /** show the map — at `year` when the subject is not drawn at the current one,
   *  otherwise (undefined) at the current global year, leaving it untouched */
  seeOnMap(year?: number): void;
  /**
   * show the flow of empires with this polity's ribbon lit — the FLOW
   * destination.
   *
   * Flow already lights the selection from its own SelStore subscription, so
   * this does NOT have to select anything: it has to make the ribbon VISIBLE.
   * Which means, exactly as seeOnMap() travels to the snapshot the thing is
   * actually drawn in, it must turn the polity's REGION chip back on when the
   * reader has that region hidden — landing on Flow with the ribbon filtered
   * out is the same broken promise as landing on the map at a year with no
   * borders. It writes no year: Flow spans the whole corpus and the ribbon is
   * lit along its entire length, so there is no moment to move to.
   *
   * Lab.tsx implements it — it is the module that knows the views. It must not
   * SELECT anything (flow lights the selection from its own SelStore
   * subscription); its job is to make the ribbon VISIBLE, which means pressing
   * the region chip back on when the reader has that region hidden, the same
   * way seeOnMap() travels to a snapshot. It writes no year.
   */
  showInFlow(polityId: string): void;
  /** show the cube with this polity id traced */
  traceInCube(polityId: string): void;
  /**
   * SHOW THIS BELIEF STREAM ON THE BRAIDED RIVERS — the BELIEFS destination.
   *
   * It exists because the founder asked for it twice: "Remove the 'Show in
   * Beliefs' - instead the card should be able to reach ALL the views." Beliefs
   * used to be reachable only through a button on the notice, which is a
   * control that appears for a moment, in a corner, for one class of subject —
   * while every other view had a permanent cell in this row. Now it is a cell
   * like the rest of them, and the notice carries no buttons at all.
   *
   * Lab.tsx implements it, and its implementation must also SWITCH THE SYSTEM:
   * braid draws religions OR ideologies, so landing on it with the other one up
   * is the same broken promise as landing on Flow with the region filtered out
   * or on the map at a year with no borders. Same shape, same contract.
   */
  showInBeliefs(id: string): void;
  /** show Connections with this subject selected and lit. Lab.tsx resolves the
   *  same-as twin on the way in, so a lane id and the spread it names land on
   *  the one mark Connections actually draws. */
  showInConnections(id: string): void;
  /** reveal the full ranked relation list in the docked panel */
  allConnections(): void;
  /** the snapshot year the map is actually showing right now */
  mapYear(): number;
  /** where this id is drawn on the CURRENT view, if it is drawn at all */
  anchorOf(id: string): DOMRect | null;
}

/**
 * WHERE THE SELECTION CAME FROM, which is the whole question of where the card
 * goes.
 *
 * 'point' — you touched the thing. A mark on the timeline, a ribbon, a country,
 *   a row in the card's own connections list. There is a place on screen you
 *   were looking at, and the card belongs beside it.
 *
 * 'search' — you typed a name and pressed a row in a dropdown. You pointed at
 *   NOTHING on the canvas, so anchoring the card to wherever the hit happens to
 *   have landed is a coincidence dressed up as an intention: on the timeline it
 *   parks the card at the left edge as often as not. Founder: "After search is
 *   done, show the card always on top right (not on left as currently on
 *   timeline it is)." So it parks, and it STAYS parked for the life of that
 *   selection — through a pan, through a view switch — because a card that
 *   silently jumps to the mark the first time the surface moves is worse than
 *   either rule on its own.
 *
 * The anchor argument could NOT carry this. `null` there already means
 * something else and has since the beginning: "I do not know where it is, ask
 * the renderer" — select() falls through to resolveAnchor() on null, which is
 * exactly how the search's own `select(id, null)` call gets an anchor today.
 * Overloading it would have made a null anchor mean two opposite things.
 */
export type SelSource = 'point' | 'search';

/** One cell of the destination group. Built in a fixed order and only filtered. */
interface Dest {
  act: string;
  label: string;
  title: string;
  off?: boolean;          // rendered, hatched, reason on the button — "not now"
  current?: boolean;      // the view you are standing on — the inverted cell
}

/** relations.ts's esc() is a TEXT escaper — it leaves quotes alone, which is
 *  fine between tags and wrong inside title="…". Every attribute value on this
 *  card is composed from corpus strings, so they go through this instead. */
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** The field notes and the wordmark's menu own Escape while open. (The ⌘K
 *  palette used to as well; it is gone — the one search is an <input>, and the
 *  guard below already refuses to act on any input, so Escape there closes its
 *  own dropdown instead.)
 *
 *  #markMenu joined the list rather than becoming a fourth owner of the key:
 *  Lab.tsx closes both from its ONE Escape branch, and this is the one place
 *  that has to know the card stands down while either is up. */
const modalOpen = () =>
  !!document.querySelector('#fieldNotes:not([hidden]), #markMenu:not([hidden])');

export const SelCard = {
  el: null as HTMLElement | null,
  wiring: null as CardWiring | null,
  anchor: null as DOMRect | null,
  view: '' as string,
  open: false,
  dismissed: false,        // × — sticky until the selection changes
  /** the exact spot the user pointed at, when the selection came from the map */
  point: null as Place | null,
  /** this selection came from the search box, so the card parks instead of
   *  anchoring — and keeps parking until the selection changes */
  parked: false,
  _hint: null as DOMRect | null,
  _pt: null as Place | null,
  _src: 'point' as SelSource,
  _bound: false,
  _ro: null as ResizeObserver | null,
  _settle: 0,

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
      if (row) { e.preventDefault(); this.go(row.dataset.goid!); }
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
      const src = this._src; this._src = 'point';
      this.point = p;                             // …and a new selection re-points
      this.parked = src === 'search';             // …and re-decides where it goes
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
   * map can know. It is the coordinate the card prints for a nameless patch of
   * the atlas — the one thing that says WHERE such a patch is.
   *
   * `from` says whether the reader pointed at anything at all — see SelSource.
   * It defaults to 'point', so every renderer call site is unchanged and means
   * what it always meant; only the search passes 'search'.
   */
  select(id: string | null, rect: DOMRect | null, pt: Place | null = null, from: SelSource = 'point') {
    if (id === SelStore.id) {                     // re-click: the store will not fire
      this.dismissed = false;
      this.point = pt;
      // RE-SELECTING DECIDES AGAIN. Searching up the thing you already have
      // selected has to park it, or the one case where the founder is most
      // likely to look — search, glance, search the same name again — is the
      // one case that does not obey. And it runs the other way too: clicking
      // the mark of something you had searched for IS a point, so the card
      // comes off its park and opens beside your finger.
      this.parked = from === 'search';
      if (id) this.show(id, rect ?? this.resolveAnchor(id)); else this.hide();
      return;
    }
    this._hint = rect; this._pt = pt; this._src = from;
    SelStore.set(id);
    this._hint = null; this._pt = null; this._src = 'point';
  },

  /**
   * NAVIGATE TO ANOTHER SUBJECT — the Connections rows, and the docked "All N"
   * list, which Lab routes to the same place.
   *
   * It is deliberately NOT select(). select() writes the store and stops, which
   * is right for a renderer reporting a click on something it has already
   * drawn, and wrong for the card, because the card's list is the WHOLE
   * neighbourhood of a subject and most of that neighbourhood is not on the
   * board. Clicking Confucius ▸ Daoism used to select a belief stream no lane
   * anywhere draws, and light nothing. goTo() asks Lab, which owns the layer
   * model and the ten views, to make the thing visible or to say honestly that
   * it cannot — see CardWiring.goTo.
   *
   * The select() fallback is for the window between init() and wire(), where
   * there is no board to reveal against yet; nothing can click the card there.
   */
  go(id: string) {
    const w = this.wiring;
    if (w) w.goTo(id); else this.select(id, null);
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

  /**
   * EVERY PIECE OF CHROME ACTUALLY ON SCREEN, as viewport rects.
   *
   * The card sits ABOVE panels in z-order (--tl-z-pop over --tl-z-panel), so
   * anything it lands on it HIDES — and a parked card lands somewhere nobody
   * pointed at, which is exactly where a corner panel likes to live. dockRight()
   * has always refused the left dock for this reason; this is the same refusal
   * generalised, and it is measured rather than assumed.
   *
   * BY GEOMETRY, NEVER BY CORNER CLASS. Which corner Controls occupies is a
   * shell decision that has changed before and will change again — it is being
   * moved to the top-right as this lands. Reading the rects means the card is
   * correct under every one of those arrangements without knowing about any of
   * them, and gains nothing to keep in sync.
   *
   * .tl-notice IS IN THE LIST for exactly the same reason, and it is the piece
   * this card is most likely to be opened AT THE SAME MOMENT AS: the notice
   * says which lane had to be added to show the thing this card is describing,
   * so one covering the other would hide half of one gesture behind the other
   * half. It is one line at the foot of the stage; the card gives way to it the
   * same way it gives way to Controls.
   */
  panelRects(): DOMRect[] {
    const st = document.getElementById('stage'); if (!st) return [];
    const out: DOMRect[] = [];
    st.querySelectorAll<HTMLElement>('.tl-panel, .tl-notice').forEach((p) => {
      if (p.hidden) return;
      const r = p.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(r);         // display:none measures 0
    });
    return out;
  },

  /**
   * THE PARKED CARD FOLLOWS THE COLUMN.
   *
   * place() reads the panel rects ONCE, and on a view switch it runs before the
   * new view's panel has finished laying out — Cube's Controls is 584px tall
   * with six sections, and the card was placed against a stub of it and landed
   * 76px INSIDE it. A one-shot measurement of something that is still growing is
   * not a measurement.
   *
   * So the panels are watched instead of sampled. This also buys the case the
   * one-shot version could never have handled at all: the reader collapses
   * Controls with its chevron, and the card slides up to meet it, because "the
   * next thing down the column" is a relationship, not a coordinate.
   *
   * No loop is possible — the card is not observed, only the panels, and no
   * panel's size depends on where the card is. Coalesced to one place() per
   * frame, because a panel animating its collapse fires this on every frame.
   */
  /**
   * KEEP PLACING IT WHILE THE VIEW SETTLES — a few frames, then stop.
   *
   * One extra frame is not enough and a single measurement is not either. The
   * card is shown in the same tick that React begins committing the incoming
   * view's panel, and that panel keeps growing for several frames afterwards:
   * Cube's Controls gains its FOLLOW LINEAGE chips only once the polity is
   * selected, taking it from ~470px to 584px, and a card placed against the
   * first number lands well inside the last one.
   *
   * Bounded, so it is a settle and not a poll: six frames (~100ms), cancelled
   * the moment the card closes, and re-armed from the top on the next show().
   * place() is a handful of getBoundingClientRect calls against at most a few
   * panels, so this is far cheaper than the ResizeObserver it backs up — and
   * unlike that observer it cannot be defeated by React swapping the panel node
   * out from under it, which is exactly the failure it exists to cover.
   */
  placeSoon() {
    if (this._settle) cancelAnimationFrame(this._settle);
    let n = 0;
    const tick = () => {
      if (!this.open) { this._settle = 0; return; }
      this.place();
      this._settle = ++n < 6 ? requestAnimationFrame(tick) : 0;
    };
    this._settle = requestAnimationFrame(tick);
  },

  watchPanels() {
    if (typeof ResizeObserver === 'undefined') return;     // jsdom, older Safari
    if (!this._ro) this._ro = new ResizeObserver(() => this.placeSoon());
    this._ro.disconnect();
    const st = document.getElementById('stage'); if (!st) return;
    st.querySelectorAll<HTMLElement>('.tl-panel, .tl-notice').forEach(p => this._ro!.observe(p));
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
    this.watchPanels();          // …and keep placing it as the panels settle
    // AND ONCE MORE NEXT FRAME, unconditionally. A view switch shows this card
    // in the same tick that React is still committing the incoming view's
    // panel, so the first place() can only ever measure a stub of it — Cube's
    // Controls grows from ~470px to 584px as its lineage chips arrive, and the
    // card was landing 76px inside it. The observer above catches later growth,
    // but it cannot catch a panel that reached its size before it was observed,
    // and it is watching nodes React is free to replace. One extra frame is the
    // cheap, unconditional half of the pair.
    this.placeSoon();
  },

  hide(byUser = false) {
    if (byUser) this.dismissed = true;
    this.open = false;
    this._ro?.disconnect();      // nothing to follow while it is shut
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

    // THE DATES. The miniature rail that used to sit above them — a scaled bar
    // for the life with the global year as a minium index — is gone at the
    // founder's request. It was the card's one graphic and it was carrying a
    // fact the two lines below already state in words: the dates, the year you
    // are on, and (on the map) whether anything of it is actually drawn there.
    // A picture that only restates its own caption is decoration, and this card
    // is read at a glance beside the thing it describes.
    html += `<div class="tl-selcard__span" data-kind="${s.end === s.start ? 'moment' : 'span'}">` +
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
    // A bare border feature has no destination at all now that Core is gone, so
    // the whole block stands down rather than printing a lead over an empty row.
    const dests = this.dests(s);
    if (dests.length) {
      html += `<div class="tl-selcard__go">` +
        `<span class="tl-selcard__lead" id="tlSelcardShowIn">Show this in</span>` +
        `<div class="tl-selcard__dests" role="group" aria-labelledby="tlSelcardShowIn">`;
      for (const d of dests) {
        const a = [
          `type="button"`,
          `class="tl-selcard__dest"`,
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
    }

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
   * THE DESTINATION GROUP. Built as [timeline, flow, map, cube, beliefs,
   * connections] and only ever FILTERED — never sorted, never re-ordered. If
   * Map is missing, Cube does not slide left into its slot; the group just gets
   * shorter and Timeline is still the first cell. Reordering by relevance makes
   * each card individually optimal and the set of cards unlearnable.
   */
  dests(s: Subject): Dest[] {
    const out: Dest[] = [];

    // TIMELINE — always, for everything with a curated span. It is the only
    // destination that exists for every object in the corpus. (A bare border
    // feature has no span of its own worth framing — its dates ARE one
    // snapshot's stratum — so it is suppressed there exactly as it always was.)
    if (!s.minimal) {
      const [a0, a1] = perspectiveSpan(s);
      const deep = fmtBig(a0) !== fmtY(a0);            // beyond 20,000 years
      // NEVER vs NOT NOW, in the one cell where the difference had never been
      // drawn. A subject whose lane is merely absent or under-detailed is
      // NOT NOW — pressing this adds it (see act('persp')), so the cell
      // stays live. A belief stream is on no lane at all and no lane can be
      // added that would draw it: the door opens onto nothing, so it is shown
      // SHUT with the reason on it, exactly as the Map cell is for a polity
      // drawn in no snapshot. Otherwise this framed five thousand empty years,
      // which is the phantom zoom the search box was fixed for.
      const plan = planReveal(s.id);
      const nowhere = plan.need === 'never';
      out.push({
        act: 'persp', label: 'Timeline',
        title: nowhere
          ? `${s.name} is ${plan.why || 'not drawn on this timeline'} — there is no lane to add`
          : deep
            ? `Frame the timeline on the ${a1 - a0} years around it`
            : `Frame the timeline on ${fmtY(a0)} – ${fmtY(a1)} — what else was going on`,
        off: nowhere,
      });
    }

    // FLOW — SECOND, because the row runs TIME then SPACE. Timeline and Flow
    // are the two projections onto a year axis (a bar on the line; a ribbon
    // whose thickness is weight); Map is the projection onto the ground; Cube
    // fuses the two. Splitting the pair around the two spatial views would put
    // the row's one real adjacency — the same span, drawn flat then drawn
    // thick — at opposite ends of the strip. It is also the increasing-
    // dimension reading the row already had: a line, a line with thickness, a
    // surface, a solid. The founder's own words put it in the same place:
    // "Timeline / Map / Cube — i am missing Flow here".
    //
    // This is the group's fixed order changing ONCE, deliberately, as a new
    // destination is added. It is not the per-card reordering the header
    // forbids: [timeline, flow, map, cube] is now the order on EVERY card, and
    // a card without a polity still shows Timeline alone in the first slot.
    if (!s.minimal && s.polity) {
      const ribbon = isRibbon(s.polity);
      out.push({
        act: 'flow', label: 'Flow',
        title: ribbon
          ? 'Follow its ribbon through the flow of empires — how its weight rose and fell against every other power'
          : `${s.name} carries no weight curve, so it is drawn in the flow of empires as no ribbon`,
        // NEVER vs NOT NOW, decided exactly as the Map cell decides it. A
        // polity the flow corpus does not carry has nothing behind the door at
        // any year, any pan, any region — so the door is shown SHUT, with the
        // reason on it, rather than hidden: hiding would claim the subject is
        // the wrong KIND of thing for this view, and it is not; it is the right
        // kind with no data. (A polity whose REGION chip is merely switched off
        // is the other case entirely — genuinely "not now", and recoverable by
        // the click itself, so the wiring travels there and this cell stays
        // live. Nothing transient is ever hatched.)
        off: !ribbon,
      });
    }

    // MAP — only for something that HAS a territory, and hatched rather than
    // hidden when that territory is empty at this year. Hiding it there would
    // imply the subject never had a map presence, which is a lie about the
    // corpus; the user has to be able to see that the door exists and is shut.
    if (!s.minimal && s.polity) {
      const shown = territoryAt(s.polity, this.snapYear()).size;
      const first = firstMapYear(s.polity);
      out.push({
        act: 'map', label: 'Map',
        title: shown
          ? 'Highlight its territory on the map, at the year you are already on'
          : first !== null
            ? `Not drawn at ${this.whenOnMap()} — go to ${fmtY(first)}, where its borders first appear`
            : atlasState() === 'failed'
            ? 'The atlas could not be loaded — the map is unavailable'
            : `${s.name} is never drawn on any of the ${YEARS.length} atlas snapshots`,
        // A DOOR IS ONLY SHUT WHEN THERE IS NOTHING BEHIND IT. This used to be
        // shut whenever the CURRENT year had no borders, which made the map
        // unreachable for a polity you were merely standing in the wrong century
        // for — the overwhelmingly common case, since the atlas has 18 snapshots
        // across 5,000 years. Now it is shut only when the thing is drawn in no
        // snapshot at all, and otherwise the click travels to where it is (see
        // act()). That is the difference between "not here" and "nowhere".
        off: first === null,
      });
    }

    // CUBE — never disabled by the year: it traces the whole life as a solid.
    if (!s.minimal && s.polity) {
      out.push({ act: 'cube', label: 'Cube', title: 'Trace its territory through time as a solid' });
    }

    /* BELIEFS — for a belief stream, and there is no shut version of this door.
       The founder, twice: "Remove the 'Show in Beliefs' - instead the card
       should be able to reach ALL the views."

       THE TEST IS WHAT THE THING IS, which for once is the whole of the
       question. Flow has to ask whether a polity carries a weight curve and Map
       has to ask whether any of eighteen snapshots draws it, because those
       views draw a SUBSET of what they are handed. Braid draws the belief
       corpus entire — both systems, every stream in it — and describe() only
       ever answers type 'belief' for an id it found in that corpus. So a
       subject that is a stream is a subject braid draws, and the cell is live
       whenever it is offered at all. That is the same shape as `s.polity` for
       Flow/Map/Cube and relCount for Connections: a fact about the subject,
       read here, with no renderer imported to answer it.

       WHICH SYSTEM IS SHOWING IS NOT THIS CELL'S PROBLEM. It is a transient —
       recoverable by the click itself, because the wiring presses braid's own
       preset on the way in — and nothing transient is ever hatched in this row.

       The slot is after Cube and before Connections: the four cells above are
       the projections that draw the SUBJECT (a line, a line with thickness, a
       surface, a solid — and now a stream), and Connections, which draws its
       LINKS, stays last. */
    if (!s.minimal && s.type === 'belief') {
      out.push({
        act: 'braid', label: 'Beliefs',
        title: 'Follow it as a river of ideas — where it forked, and what it ran alongside',
      });
    }

    // CONNECTIONS — for anything the relation corpus actually links. The
    // founder, with Leonardo open IN Connections: "I should be able to see
    // Connections are in active state and an option to view him in Timeline.
    // Now he just shows Timeline button in non-active state." He was standing
    // in a view the row did not contain, so the row could not say "you are
    // here" and the one cell it did show looked inert.
    //
    // The test is the CORPUS, not the renderer — this file imports none.
    // relCount is the same count the card already prints over the connections
    // list, so a card that shows relations can always reach the view that draws
    // them, and one with none never offers an empty room. Leonardo has two.
    if (!s.minimal && SelStore.id && relCount(SelStore.id) > 0) {
      out.push({ act: 'conn', label: 'Connections', title: 'See what it is linked to, and how strongly' });
    }

    // ONE SIGNAL, ONE MEANING: the inverted cell is the view you are standing
    // on, and nothing else. Timeline is not specially styled — it just keeps
    // the first slot. So exactly one cell is ever inverted, and on a view that
    // is not a destination at all (Flow, Braid, …) none of them is.
    for (const d of out) {
      // BELIEFS IS TWO VIEWS NOW. The Flow group's seg split into Empires ·
      // Beliefs · Ideologies, so one destination lands on whichever of the two
      // belief views holds this stream — Lab.tsx routes it by corpus, not by
      // chip. LANDS_ON is a static id-to-view map and cannot express "either",
      // so the Beliefs cell asks the pair. Without this it never inverted on
      // Ideologies: routing was right, but the row would not say "you are here"
      // for a view you were plainly standing on.
      d.current = d.act === 'braid'
        ? (this.view === 'braid' || this.view === 'ideology')
        : LANDS_ON[d.act] === this.view;
    }
    return out;
  },

  /**
   * WHAT THE MAP IS ACTUALLY DRAWING — a measurement, never a warning.
   *
   * This used to also print the DISTANCE from the year you are standing on to
   * the subject's span ("ended 30 yrs before 1851"). The founder cut it, and he
   * was right: both dates and the current year are already on the line directly
   * above, so the sentence was arithmetic the reader had already done.
   *
   * What is left is the one fact the dates cannot give you. The map draws one
   * of eighteen atlas snapshots, so whether anything of this polity is on
   * screen — and at which snapshot — is not derivable from anything else on the
   * card. An absence there is DATA, not an error: Rome not being on the 1783
   * map is the most ordinary fact in the corpus, so it gets no box, no tint, no
   * icon and no accent. Mono, because it is a measurement.
   *
   * The other survivor is the coordinate of a bare border feature, which is the
   * only statement anywhere of WHERE a nameless patch of the atlas is. A
   * coordinate is not a name, so it lives here with the other measurements
   * rather than in the title.
   */
  presence(s: Subject): string | null {
    if (s.minimal) {
      const p = this.point ?? s.place;
      return p ? `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} · ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}` : null;
    }
    if (s.polity && this.view === 'map') {
      const n = territoryAt(s.polity, this.snapYear()).size;
      const when = this.whenOnMap();
      return n ? `${n} ${n === 1 ? 'territory' : 'territories'} shown at ${when}`
        : `not on the map at ${when}`;
    }
    return null;
  },

  // ── the actions ───────────────────────────────────────────────────────────
  act(a: string) {
    const s = describe(SelStore.id); if (!s) return;
    const w = this.wiring;
    switch (a) {
      // THE × MEANS THE SAME THING AS ESCAPE. It used to hide the card and
      // LEAVE the selection in the store, so the highlight went on burning with
      // its explanation gone — the founder hit this from two directions on the
      // same day: "In Cube clicking X on card should be the same as getting rid
      // of highlight in map - should clean the map", and, of Flow, "If you dont
      // want it highlighted you should just close it via cross, then you can
      // hover as you like". Both describe a × that clears. The card is one
      // reading of the selection, but it is the only reading that carries a
      // dismiss control, so dismissing it has to mean dismissing the thing.
      case 'close': SelStore.set(null); this.hide(true); break;
      // THE SAME VERB AS A CONNECTIONS ROW. It used to hand over a SPAN, which
      // framed two numbers whether or not any lane drew anything between them —
      // "Make sure its impossible to zoom in on something that does not exist"
      // held for the search box and not for this cell. Now it hands over the
      // ID, and the reveal is earned before the frame. (The cell is hatched
      // outright for a subject no lane can ever draw; see dests().)
      case 'persp': w?.showOnTimeline(s.id); break;
      // IF IT IS NOT HERE, GO WHERE IT IS. Standing outside a polity's span —
      // or on one of the 5,000 years between two of the 18 atlas snapshots —
      // used to leave this cell hatched and the map unreachable. It now travels
      // to the first snapshot the thing is actually drawn in, so the click
      // always ends with the territory on screen rather than with an explanation
      // of why it is not. When it IS drawn here, the year does not move at all.
      case 'map': {
        const here = s.polity ? territoryAt(s.polity, this.snapYear()).size : 0;
        const first = here ? null : firstMapYear(s.polity);
        w?.seeOnMap(first ?? undefined);
        break;
      }
      // No year, no framing: the ribbon is lit along its whole length and Flow
      // already spans the corpus. All this has to do is get you there with the
      // region showing — see showInFlow's contract.
      case 'flow': if (s.polity) w?.showInFlow(s.polity); break;
      case 'cube': if (s.polity) w?.traceInCube(s.polity); break;
      // The system it belongs to may not be the one on the canvas, so this
      // hands over the ID and lets the wiring press braid's own preset — the
      // same shape as 'flow' turning a hidden region back on.
      case 'braid': w?.showInBeliefs(s.id); break;
      case 'conn': if (SelStore.id) w?.showInConnections(SelStore.id); break;
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
    // A SEARCHED SELECTION HAS NO ANCHOR EVEN WHEN IT HAS ONE. The renderer can
    // say perfectly well where the hit is drawn — that is not the question. The
    // question is whether the reader was LOOKING there, and after a search they
    // were looking at the search box. So the anchor is dropped on the floor
    // here rather than never resolved, which keeps `this.anchor` truthful for
    // everything else that reads it.
    const a = this.parked ? null : this.anchor;
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
      // ── PARKED: the top-right of the stage ────────────────────────────────
      //
      // Two things arrive here. A selection whose subject is not DRAWN on this
      // view at all (no anchor to be had), and a selection that came from the
      // SEARCH (an anchor exists and is deliberately ignored — see SelSource).
      // They want the same thing for the same reason: one fixed, learnable
      // place, chosen once, so the reader's eye knows where to go before the
      // card is there.
      //
      // THE CORNER IS NOT EMPTY ANY MORE. It used to be — "empty on every view
      // that docks its panels left, and ocean on the map" — and Controls is
      // moving into it. The card is above panels in z-order, so parking on top
      // of Controls does not look crowded, it looks like Controls is GONE, and
      // the reader has no way to know a card they never positioned is what ate
      // their toggles.
      //
      // THE RULE, in one line: the card is the next thing DOWN the right-hand
      // column, never a second thing in the same corner. It right-aligns to the
      // stage's right inset — the same margin the panels use, so the two read
      // as one column rather than two floating boxes — and starts under
      // whatever is already there.
      const st = document.getElementById('stage');
      const r = st ? st.getBoundingClientRect() : null;
      const right = (r ? r.right : vw) - 12;
      const top = (r ? r.top : 60) + 12;
      x = clampN(right - w, minX, maxX);
      y = clampN(top, MARGIN, Math.max(MARGIN, vh - MARGIN - h));

      const hitting = () => this.panelRects().filter(p => overlaps(x, y, w, h, p));
      const on = hitting();
      if (on.length) {
        let bot = MARGIN, lft = vw;
        for (const p of on) { bot = Math.max(bot, p.bottom); lft = Math.min(lft, p.left); }
        const under = bot + GAP;                  // the top of the slot below the stack
        const room = vh - MARGIN - under;         // …and how much height that slot has
        const beside = lft - GAP - w;             // the x of the slot inboard of it

        // THE ORDER IS BELOW, THEN BESIDE, THEN SQUEEZE — and "below" has to
        // mean the card FITS below, at the height it actually wants.
        //
        // Ranking a squeezed below-slot above a full-height one beside is what
        // made this knife-edge on Cube: Controls there is 584px tall, the slot
        // under it holds 191px, keepH is 207px, and the two were close enough
        // that a dozen pixels of late panel growth decided it. The card either
        // took a slot it did not fit in or overlapped by two pixels, when there
        // was a 320x294 hole to its left the whole time. Fitting beats staying
        // in the column: a card that has to scroll its connections away to sit
        // under Controls is worse than one sitting next to it whole.
        if (h <= room) {
          y = under;                              // 1. below, whole
        } else if (beside >= minX) {
          x = beside;                             // 2. beside, whole
        } else if (room >= this.keepH()) {
          // 3. NOWHERE WHOLE, so squeeze into the taller of the two — but never
          // below the part that cannot scroll: the identity, the measurement
          // and the destinations. Past that the card starts CLIPPING its
          // actions rather than scrolling its list, and the actions are the
          // card's entire purpose.
          y = under; h = room; el.style.maxHeight = h + 'px';
        }
        // Below minX with no room under, there is genuinely nowhere left — a
        // window too narrow to hold a 264px panel and a 320px card side by
        // side. It keeps the corner and the clamp catches it; a few px narrower
        // and CSS takes over with the bottom sheet, placement skipped entirely.

        // ONE CORRECTION PASS: dropping down can walk into a BOTTOM-corner
        // panel, which the first measurement had no reason to look at.
        if (hitting().length && beside >= minX) {
          x = beside;
          y = clampN(top, MARGIN, Math.max(MARGIN, vh - MARGIN - h));
        }
      }
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
