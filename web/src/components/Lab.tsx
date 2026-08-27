'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   Lab.tsx — the Survey shell.

   ONE fixed grid: 44px top rail / 1fr stage / 64px time rail. No page scroll,
   no centred column, no cards, no lede paragraphs. The essay moved into the
   field-notes popover; the controls moved into floating panels over the canvas.

   HARD RULES this file obeys, because renderers in src/render/* are owned by
   other agents right now and resolve their DOM by querySelector exactly once:
     · every canvas id and every renderer init call site survives;
     · all ten views are MOUNTED AT BOOT — visibility is CSS only;
     · containers a renderer appendChild()s into (#catRow, #lensRow,
       #flowRegionRow) ship EMPTY;
     · legacy class names (.chip/.on, .btn/.hero, .card, .caption, .note …) are
       frozen vocabulary — re-skinned in globals.css, never renamed here.

   And the one that bites hardest: a display:none view has clientWidth 0, so
   fitCanvas() returns null and the renderer no-ops in silence. renderTab()
   below therefore covers all ten ids.
   ============================================================================= */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  catColor, clampDomain, fmtBig, fmtSpan, fmtY, initData, onAtlas, setGotoTab, setLanes, SelStore,
  TimeStore, tokens, warmAtlas, YMAX, YMIN,
  type Datasets,
} from '@/render/shared';
import { buildRelIndex } from '@/render/relations';
import { SelCard, type SelSource } from '@/render/selcard';
import { WorldMap } from '@/render/map';
import { TL } from '@/render/timeline';
import { LayerPanel } from '@/render/layerpanel';
import { VT } from '@/render/vertical';
import { Flow, initFlow } from '@/render/flow';
import { Cube } from '@/render/cube';
import { beliefSystemOf, braidHome, BRAID_IDS, Braids, initBraid } from '@/render/braid';
import { Horizon } from '@/render/horizon';
import { Pop, loadPopulation } from '@/render/population';
import { buildGallery } from '@/render/gallery';
import { Conn, initConn, loadRelations } from '@/render/connections';
import { searchCorpus, searchLayers, type Hit, type LayerHit } from '@/render/search';
import { Layers, planReveal, reveal, type RevealPlan } from '@/render/layers';
import { describe, perspectiveSpan, setPolityAliases, type Subject } from '@/render/subject';
import { railPos, railYear, railNum, railEraOf, SNAPSHOTS } from './rail';

// The extent the engraved scale actually covers (rail.ts's first and last stop).
// A subject that runs past either end is drawn with an OPEN edge there rather
// than a cap, because railPos clamps and a cap would claim a date it does not have.
const RAIL_FLOOR = -3000, RAIL_CEIL = 2060;

// ── The information architecture ────────────────────────────────────────────
// Ten flat tabs do not fit a 44px rail: ten uppercase items is ~700px of
// switcher and .tl-rail__end alone is ~450px. So the IA is two levels — six
// groups in .tl-switch, and a .tl-seg sub-switcher for the two groups that
// still show one (the Timeline group's moved into its own panel). Views
// therefore sit behind a seg, which is why the search field's "Views" group —
// reached by typing, or by ⌘K — is load-bearing rather than a nicety.

type ViewId =
  | 'map' | 'pop' | 'horizon'
  | 'vertical' | 'zoom'
  | 'flow' | 'braid' | 'ideology'
  | 'conn' | 'cube' | 'concepts';

type RailMode = 'live' | 'span' | 'legend' | 'off';

// THE TIMELINE COMES FIRST, because the timeline is what this product IS. The
// map led the rail for as long as it was the only view with real data behind
// it; that stopped being true two rounds ago, and a rail that opens on MAP
// tells a first visitor the product is an atlas. Order here IS the reading
// order of the switcher, and the first group is where an empty localStorage
// and a bare URL land.
const GROUPS: { id: string; label: string; members: ViewId[] }[] = [
  { id: 'g-time', label: 'Timeline', members: ['vertical', 'zoom'] },
  { id: 'g-map', label: 'Map', members: ['map', 'pop', 'horizon'] },
  // EMPIRES · BELIEFS · IDEOLOGIES. "I think it should be Empires/Beliefs/
  // Ideologies." The two belief corpora used to be one member of this seg with
  // a preset chip inside its own panel — a view that offered to become another
  // view. They are peers here now, which is what they always were.
  { id: 'g-flow', label: 'Flow', members: ['flow', 'braid', 'ideology'] },
  { id: 'g-conn', label: 'Connections', members: ['conn'] },
  { id: 'g-cube', label: 'Cube', members: ['cube'] },
];

// Per-group landing member. Timeline lands on 'zoom': the horizontal projection is
// the FLAGSHIP now — it carries the new spread-lane layout, the sharpness fades and
// the piecewise deep-time zoom. Vertical keeps its seat in the seg, and coming back
// to the group returns you to whichever you last used.
const GROUP_DEFAULT: Record<string, ViewId> = {
  'g-time': 'zoom', 'g-map': 'map', 'g-flow': 'flow', 'g-conn': 'conn', 'g-cube': 'cube',
};
// A first-ever visitor — empty localStorage, no ?v= — lands on the horizontal
// timeline. Read off GROUP_DEFAULT via the first group so the landing view and
// the first tab in the rail can never drift apart.
const DEFAULT_VIEW: ViewId = GROUP_DEFAULT[GROUPS[0].id];

// "Reset view" on the timeline means the whole RECORDED span, not the Big Bang:
// timeline.ts boots on [-3000, 2026] and that is the framing the reader arrived
// on. Deep time is a place you go on purpose, never a place a reset drops you.
const TL_HOME: [number, number] = [-3000, 2026];


// Concepts is deliberately NOT in the switcher: it is documentation about the
// tool — ten rated sketches of ways to see history — not a view of history, and
// a tab is a claim to be part of the product. It has a home instead: the
// wordmark's menu. "Hide concepts under the main Timeline brand view dropdown,
// make it hidden."
//
// It stays in ORDER, and ORDER is not the switcher — the switcher renders
// GROUPS, which has never contained it. ORDER is what validates ?v= (so the URL
// keeps working) and what the ⌘K view rows are built from (so its name still
// finds it). Its old third route, a "Concepts, rated →" footer on the field
// notes, is gone: "Remove the Concepts rated footer of fields notes."
const groupOf = (v: ViewId): string => GROUPS.find(g => g.members.includes(v))?.id || 'g-map';

// The eight domain tokens, by the name tokens.css spells them. The chip's dot
// quotes one AS A CUSTOM PROPERTY (`var(--tl-cat-power)`) rather than as a
// resolved hex, which is the difference between a dot that follows a theme
// switch and one frozen in whichever theme was live when it mounted. This is
// the sanctioned crossing between the data palette and the chrome — DESIGN.md
// §3, "a legend key or chip dot quotes a data hue" — and the only one here.
const CAT_TOKENS = new Set(['power', 'war', 'belief', 'sci', 'art', 'nature', 'society', 'reach']);
const dotVar = (cat: string) => (CAT_TOKENS.has(cat) ? `var(--tl-cat-${cat})` : 'var(--tl-ink-3)');

interface ViewMeta { seg: string; name: string; gist: string; meta: string; rail: RailMode }

const VIEWS: Record<ViewId, ViewMeta> = {
  map: {
    seg: 'Borders', name: 'World map + time dial', rail: 'live',
    gist: 'Fix a moment, show me everywhere — drag the index to move the world.',
    meta: '18 snapshots · 3000 BCE – 1994',
  },
  // HABITATION, NOT "PEOPLE". "People shuold be called something else, it seems
  // like it will show positions of people. instead it should be like people
  // density or habitation or something." The seg row reads Borders | Habitation
  // | Horizon — three concrete nouns of the same kind, which is why this and not
  // "Density": only the eight macro-region TOTALS are measured scholarship
  // (McEvedy & Jones · Biraben · UN), and the distribution inside a region is a
  // hand-written table of 101 centres plus a geography field — population.ts's
  // own words: "Nobody measured this." "Density" names a measured field this
  // view does not have; "Population" names the measured QUANTITY and hands the
  // honest word to the modelled half, which is the shape. Habitation claims only
  // "people lived here", which is exactly what the data will carry.
  //
  // `name` keeps the word "people" so a reader who types it still finds this
  // view (buildRows matches name + seg + gist), and drops the "not land"
  // contrast, which only ever made sense against a seg called People. `gist`
  // loses "actually are" for the file's own register — an illustration of
  // shape, not a census. `meta` stands: "density field · 2° cells" describes how
  // the picture is DRAWN, and beside a name that no longer promises measurement
  // it reads as the technique rather than as a claim.
  pop: {
    seg: 'Habitation', name: 'Where people lived', rail: 'live',
    gist: 'Where people concentrated — an illustration of shape, cell by cell, not a census.',
    meta: 'density field · 2° cells',
  },
  horizon: {
    seg: 'Horizon', name: 'Information horizon', rail: 'live',
    gist: 'Not what happened — what a person standing here could have known yet.',
    meta: 'news at the speed of a horse',
  },
  vertical: {
    seg: 'Vertical', name: 'Vertical timeline', rail: 'span',
    gist: 'Time runs down, past at top. Bands become columns; a label gets a full line, not a gap.',
    meta: 'drag ↕ time · ↔ columns',
  },
  zoom: {
    seg: 'Horizontal', name: 'Zoomable timeline', rail: 'span',
    gist: 'A map of time with level of detail — zoom from a decade to the Big Bang.',
    meta: 'spreads & events · colour = domain',
  },
  flow: {
    seg: 'Empires', name: 'Flow of empires', rail: 'span',
    gist: 'Ribbons whose thickness is weight in the world, forking along real lineage.',
    meta: 'lineage · 1200 BCE – 2026',
  },
  braid: {
    seg: 'Beliefs', name: 'Braided rivers of ideas', rail: 'span',
    gist: 'Beliefs as streams that fork at schisms and occasionally merge again.',
    meta: 'thickness is an estimate',
  },
  // The second belief corpus, as its own view rather than a preset inside the
  // first. `name` carries "ideologies" AND "isms" so both find it by typing;
  // `meta` prints the opening year, because 1848 is the one fact about this
  // view a reader could not guess from the seg (see braid.ts for why 1848).
  ideology: {
    seg: 'Ideologies', name: 'Braided rivers of ideologies', rail: 'span',
    gist: 'The isms as streams — liberalism, marxism, nationalism — forking out of one Enlightenment trunk.',
    meta: 'opens at 1848 · thickness is an estimate',
  },
  conn: {
    seg: 'Connections', name: 'Connections', rail: 'span',
    gist: 'Click anything — everything related stays lit in proportion to how related.',
    meta: 'four lanes · queries, overlapping',
  },
  cube: {
    seg: 'Cube', name: 'Space-time cube', rail: 'legend',
    gist: 'Latitude × longitude × time as one solid block — an empire is a volume you can cut.',
    meta: '18 sheets · WebGL · orbit what you look at',
  },
  concepts: {
    seg: 'Concepts', name: 'Concepts, rated', rail: 'off',
    gist: 'The divergent set, scored and pruned. Every good view is a slice of one block.',
    meta: '10 concepts · 5 axes',
  },
};

const ORDER: ViewId[] = ['zoom', 'vertical', 'map', 'pop', 'horizon', 'flow', 'braid', 'ideology', 'conn', 'cube', 'concepts'];

// ── Which views dock the panel column instead of floating it ────────────────
// A floating panel is honest over a MAP — it sits on ocean, and the map has no
// furniture under it. It is a lie over a CHART. Every view in the timeline
// family draws row furniture in a fixed left gutter of its own canvas that the
// renderer cannot move: timeline band names at x=20 (timeline.ts), connections
// lane names at x=22 (connections.ts), and Flow's earliest ribbons starting at
// x=0. The 264px panel sat exactly there, so the first sight of the primary
// timeline was six unlabelled bands.
//
// ── THE DOCK IS GONE, AND WITH IT THE LAST VIEW THAT WAS NOT FULL-BLEED ─────
// "Flow should span all the screen like others."
//
// Five views used to hand the panel COLUMN a strip of its own and let the
// canvas take what was left. That was the right trade for exactly as long as
// the column was a bordered panel standing on the canvas's own left gutter,
// where the renderers park furniture they cannot move: band names at x=20,
// lane names at x=22, the earliest ribbons in Flow at x=0. A 264px panel there
// did not cover "some chart", it covered the legend.
//
// Controls is a floating top-right panel on all ten views now, and there is no
// furniture at any of their right edges — so the strip was reserving 288px
// (264 + two gutters) for a column that had already left. Measured at 1440x900:
// stage 1440x791, flow's canvas 1152x791, short by exactly the reservation,
// while Map and Cube — never docked — had the whole 1440. That is the founder's
// complaint, and it was in this file rather than in flow.ts.
//
// CONNECTIONS GOES WITH THEM, and that is the one judgement call here. It kept
// a dock longer than the other two because it floated a SECOND panel, "Related",
// on the same chart. Related is not a panel any more — it is the disclosure at
// the head of the field notes — so what is left is one short Controls (a reset,
// a note and a folded legend) over the top-right corner of an 826px canvas.
// A corner, at last, is a thing a floating panel may have.
//
// The mechanism was `data-dock` on #stage plus a padding rule in shell.css §04;
// both are deleted. fitCanvas() reads canvas clientWidth, so every renderer
// re-fits to the new width by itself with no change on its side.


// ── Field notes ─────────────────────────────────────────────────────────────
// "Make the field notes way shorter, they should be 5s introduction what am I
// seeing, not in depth manual."
//
// THEY OPEN BY THEMSELVES ON A FIRST VISIT, and that is the whole argument. A
// popover a reader ASKED for may be a page; one that appears unbidden over the
// thing it is describing has about five seconds of goodwill, and 200 words spent
// them before the first line was read. So each view gets at most three short
// sentences, in a fixed order that is the same order on all ten:
//
//   1. WHAT THIS IS      — one clause naming the view
//   2. WHAT A MARK MEANS — the grammar, because nothing else on screen says it
//   3. ONE GESTURE       — the single move this view is operated with
//
// AND NOTHING ELSE. Everything cut was one of four things: the reasoning behind
// a design (which belongs in this file, and is in this file), a caveat about the
// data (the Habitation caption prints its own every frame; the cube's readout says
// "interpolated" while it is interpolating), a keyboard list (every cube camera
// move is also a button in its own Controls panel), or a sentence defending the
// view to a critic rather than introducing it to a newcomer.
//
// `src` SURVIVES IN ONE PLACE ONLY. It is now what the name always said it was —
// a source line — and the map's is an attribution to a GPL-3.0 dataset, which is
// an obligation rather than an explanation. Every other one was prose.
interface Notes { body: React.ReactNode; src?: React.ReactNode }

const NOTES: Record<ViewId, Notes> = {
  map: {
    body: <p>Every border on Earth at eighteen real dates, 3000 BCE to 1994, coloured by whoever ruled. <strong>Drag the rail along the bottom</strong> and the world moves with it.</p>,
    src: <>Borders: aourednik/historical-basemaps (GPL-3.0) &mdash; a scholarly approximation, since historical borders are fuzzy and contested by nature.</>,
  },
  pop: {
    body: <p>Where people concentrated, not who owned the ground &mdash; a density field, one cell at a time. It is an illustration of shape, not a census. <strong>Press play.</strong></p>,
  },
  horizon: {
    body: <p>Not what happened &mdash; what word had reached you yet. The rings are how far news had travelled after a week, a month, six months. <strong>Pick a city and a year.</strong></p>,
  },
  vertical: {
    body: <p>The same timeline read downward, past at the top, so every mark has a full line for its name. <strong>Drag it like a map</strong> &mdash; through time, and across the world.</p>,
  },
  zoom: {
    body: <p>A map of time with level of detail: zoom in and smaller things fade in. A bar lasted, a dot is a moment, colour says which domain. <strong>Click anything to select it</strong> &mdash; everything related stays lit.</p>,
  },
  flow: {
    body: <p>Empires as ribbons whose thickness is their weight in the world, forking and merging as they inherit one another. <strong>Hover one</strong> to light its whole ancestry.</p>,
  },
  braid: {
    body: <p>Beliefs as streams that fork at schisms and occasionally merge &mdash; Christianity at 1054 and 1517, Islam at 632. Thickness is reach. <strong>Hover one</strong> to light its lineage.</p>,
  },
  ideology: {
    body: <p>The same rivers, two centuries wide: liberalism, socialism, nationalism forking out of the Enlightenment. Thickness is reach. <strong>Hover one</strong> to light its lineage.</p>,
  },
  conn: {
    body: <p>What is linked to what. Ribbons last, dots are moments inside them, and the four lanes overlap on purpose. <strong>Click anything</strong>: its relations stay lit and everything else dims to context.</p>,
  },
  cube: {
    body: <p>Latitude &times; longitude &times; time as one solid block: eighteen world maps stacked, and a traced empire is a volume through them. <strong>Drag to orbit, scroll to zoom.</strong></p>,
  },
  concepts: {
    body: <p>The divergent ideas, scored and pruned &mdash; and the unlock underneath them: <strong>history is one 3-D block, and every good view is a slice of it.</strong></p>,
  },
};

// ── Boot ────────────────────────────────────────────────────────────────────
function boot() {
  // The shared link index + node directory first: TL.init() and initConn() both read
  // it (selection dimming, Related panels). Then VT.init() after TL.init(): the
  // vertical projection reads its state off TL and registers itself with TL.paint(),
  // and TL owns every shared control.
  buildRelIndex();
  SelCard.init();                    // before the renderers: they call SelCard.select()
  // LayerPanel.init() goes between the two timeline projections: it needs TL's
  // canvas bound (it subscribes to TL.onLayout) and VT reads the layer model
  // through TL, so the model has to be loaded before VT's first render.
  WorldMap.init(); TL.init(); LayerPanel.init(); VT.init(); initFlow(); Cube.init(); initBraid(); Horizon.init(); Pop.init(); buildGallery();
  initConn();
  WorldMap.render();
  // diagnostic handle for acceptance probes and console debugging — reads only
  // Flow and the braids are all Ribbons() instances and were the only canvas
  // views with no handle here, which made them the only ones a gesture probe
  // could not measure. `Braids` is the whole table — one probe reaches either
  // belief view by name. Reads only, like the rest.
  (window as any).__tl = { TL, VT, Conn, WorldMap, Cube, Flow, Braids, TimeStore, SelStore, SelCard, Layers, LayerPanel };
}


const stageHeight = () => {
  const s = document.getElementById('stage');
  const h = s ? s.clientHeight : 0;
  return Math.max(420, Math.min(1200, h || 700));
};

// Five renderers expose a writable height, so they can fill the stage. WorldMap and
// Conn compute their own — never try to set those. TL is content-driven WITH a budget:
// sizeRenderers writes TL.HMAX (the stage height) and TL's layout() grows lanes to
// their content, trimming rows to fit under that budget. (The VERTICAL projection of
// the same state is viewport-driven instead, because down the page is the time axis
// there.)
//
// Horizon and the cartogram are the exception: both project 360° × 145° of the
// globe onto (width × H), so giving them the full stage height stretches the
// world vertically. They get the map's own 1000:403 aspect instead, capped by
// the stage, and app.css centres the short canvas.
function sizeRenderers() {
  const H = stageHeight();
  const s = document.getElementById('stage');
  const W = s ? s.clientWidth : 0;
  const geoH = Math.max(300, Math.min(H, Math.round(W * 403 / 1000)));
  Flow.H = H; Cube.H = H;
  for (const id of BRAID_IDS) Braids[id].H = H;
  TL.HMAX = H;                     // the lane-trim budget, not a fixed height
  // Below 760px every panel becomes a bottom SHEET fixed over the canvas
  // (shell.css §13). Every full-height view loses its bottom strip to it, but only
  // the vertical timeline keeps a CONTROL down there — the pan rail that says which
  // columns you are looking at. So it alone gets a canvas short enough to clear the
  // sheet, measured rather than assumed so it also tracks the sheet being opened.
  let vH = H;
  // HOW TALL THE SHEET IS, PUBLISHED. Two things sit in the stage's bottom-left
  // corner on a phone and only one of them is fixed to the viewport: the
  // Controls sheet, and the layers switch at the foot of the layer bar. The
  // sheet is on the higher layer, so without this the switch — the ONLY evidence
  // on a phone that layers exist at all — was underneath it. Measured rather
  // than assumed, because the sheet's height changes when it is opened.
  let sheetH = 0;
  if (typeof matchMedia !== 'undefined' && matchMedia(NARROW).matches) {
    const sheet = document.querySelector<HTMLElement>('.tl-panel--tl:not([hidden])');
    if (sheet) {
      sheetH = Math.min(sheet.offsetHeight, Math.round(H * 0.45));
      vH = Math.max(320, H - (sheetH + 6));
    }
  }
  document.getElementById('app')?.style.setProperty('--tl-sheet-h', sheetH + 'px');
  VT.H = vH;
  Horizon.H = geoH; Pop.H = geoH;
}

function renderTab(v: ViewId) {
  sizeRenderers();
  switch (v) {
    case 'map': WorldMap.render(); break;
    case 'pop': Pop.render(); break;
    case 'horizon': Horizon.render(); break;
    case 'zoom': TL.ensureYearVisible(); TL.render(); break;
    case 'vertical': TL.ensureYearVisible(); VT.render(); break;
    case 'flow': Flow.render(); break;
    case 'braid': Braids.religion.render(); break;
    case 'ideology': Braids.ideology.render(); break;
    case 'conn': Conn.dirty = true; Conn.render(); break;
    case 'cube': Cube.render(); break;
    case 'concepts': break;                       // no canvas
  }
}

const rerenderAll = () => {
  sizeRenderers();
  WorldMap.render(); TL.render(); VT.render(); Flow.render(); Cube.render(); Horizon.render(); Pop.render();
  for (const id of BRAID_IDS) Braids[id].render();
  Conn.dirty = true; Conn.render();
};

// Panels become bottom sheets below 760px and start collapsed there, so the
// canvas keeps the screen. Read as an external store rather than set from an
// effect: that keeps the server snapshot honest (false) and lets React settle
// the real value during hydration instead of cascading an extra render.
const NARROW = '(max-width: 759px)';
const subNarrow = (cb: () => void) => {
  const m = matchMedia(NARROW); m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

// THE SELECTION IS NO LONGER READ BY THE CHROME. subSel/selSnapshot existed so
// the rail could re-render its chip on every selection; with the chip gone the
// shell has nothing that names a selection, and SelStore is read where it is
// drawn — by the renderers and by the card. Dropping a selection is Escape
// (selcard.ts, "ESC CLEARS THE SELECTION") or a click on empty canvas, both of
// which live at the same level as the drawing they release.

// The one transient minium dot: this view's field notes have not been read yet.
// Painted imperatively so the seen-set never has to be React state — the markup
// ships with the dot on, which is both correct for a first visit and identical
// on the server, and this corrects it once localStorage has been consulted.
function paintUnread(seen: Set<string>, view: string) {
  const b = document.getElementById('notesBtn'); if (!b) return;
  if (seen.has(view)) b.removeAttribute('data-unread');
  else b.setAttribute('data-unread', 'true');
}

/* ── THE URL REMEMBERS WHICH VIEW YOU WERE ON ─────────────────────────────────
   "when I refresh keep the browser on the same tab (probably by saving to the
   URL query?)" — yes, and it makes a link shareable rather than merely
   refresh-proof.

   replaceState, NEVER pushState: ten views one keystroke apart would turn
   the back button into a tab-history stepper, and the way out of the app would
   be forty presses deep.

   Three params, all optional and all independently ignorable:
     v — the view id, validated against ORDER; anything else falls back silently
     y — the global moment, which on the timeline IS the window's centre
     s — the timeline window's span in years, so y ± s/2 restores the framing

   Read once at mount and never again: the URL is an OUTPUT of app state after
   that, so nothing here can fight the centre-year observer for control of d0/d1. */
/* ── ONE SEARCH ───────────────────────────────────────────────────────────────
   "Keep only one search - one at the top."

   There were two: a thread-search in the timeline's control panel that dimmed
   the canvas and offered a dropdown of things in history, and a ⌘K palette that
   went to views. The panel one is gone, which left content search unreachable —
   so the field in the top bar takes both jobs.

   THREE kinds of row now, because there are three kinds of answer to a word:

     c  WHAT HAPPENED    Cubism, the Roman Republic, the Black Death.
                         Each one carries its RevealPlan — the verdict on
                         whether the layer that draws it is on the board — so
                         the row can say "not added" before it is chosen and
                         choosing it can put that right rather than framing an
                         empty span. (search.ts + layers.ts do the deciding.)
     l  WHERE IT LIVES   the lanes themselves: Literature, Religion, Czech
                         history. On the board → locate it; not on the board →
                         add it. The founder's second ask.
     v  WHERE TO LOOK    the ten views.
*/
type SRow =
  /* `to` is WHERE TAKING THIS ROW WOULD LAND YOU, decided against the view you
     are standing on (landingFor). null means nothing in the app can draw it, and
     that is now the only thing that makes a row dead — it used to be
     `p.need === 'never'`, which was the timeline's verdict standing in for the
     whole app and was wrong on exactly the views that could have helped: a
     belief stream is never on the timeline and is the entire subject of the
     Beliefs view. */
  | { k: 'c'; h: Hit; p: RevealPlan; to: ViewId | null }
  | { k: 'l'; l: LayerHit }
  | { k: 'v'; v: ViewId };

/**
 * THE ROW'S SECOND LINE — what stands between this hit and the canvas, in the
 * fewest words that are still true. Null when nothing does, which is the
 * common case and draws no line at all.
 */
function needLine(r: { p: RevealPlan; to: ViewId | null }, here: ViewId): string | null {
  // A ROW THAT IS ABOUT TO MOVE YOU SAYS SO FIRST. It is the more surprising
  // fact of the two, and it is the one the reader can act on by pressing the
  // seg instead. The layer verdict below only ever applied to the timeline
  // family anyway, so on any other landing it would have been describing work
  // that is not going to happen.
  if (r.to === null) return r.p.why || 'not drawn anywhere in the app';
  if (r.to !== here) return `shown on ${VIEWS[r.to].seg}`;
  if (!r.p.layerName) return null;
  if (r.p.need === 'add') return `in ${r.p.layerName} — not added`;
  if (r.p.need === 'detail') return `in ${r.p.layerName} — needs more detail`;
  return null;
}

/** The same verdict as a whole sentence, for the row's title attribute. */
function needTitle(r: { p: RevealPlan; to: ViewId | null }, name: string, here: ViewId): string | null {
  const p = r.p;
  const raise = p.detailWord ? ` and sets it to “${p.detailWord}”` : '';
  if (r.to === null) return `${name} is ${p.why || 'not drawn on this timeline'}, and no other view draws it either — there is nothing to go to.`;
  // THE HONEST SENTENCE FOR A VIEW THAT CANNOT SHOW IT. Habitation and the
  // information horizon draw aggregates, Concepts is documentation: none of
  // them can put one named thing on screen, so taking the row travels, and it
  // says where and why before it is pressed rather than after.
  if (r.to !== here) {
    return `${VIEWS[here].seg} cannot show one thing on its own, `
      + `so this opens ${name} on ${VIEWS[r.to].name}.`;
  }
  if (p.need === 'add') return `Adds the “${p.layerName}” layer${raise}, then selects ${name} and frames it.`;
  if (p.need === 'detail') return `Raises “${p.layerName}” to “${p.detailWord}”, then selects ${name} and frames it.`;
  return null;
}

/* ── WHERE A SEARCH RESULT LANDS ──────────────────────────────────────────────
   "Search by default opens the entity there where you are — you're on timeline
   you see on timeline, you're on cube you see it on cube."

   Every hit used to land on the horizontal timeline. That is the right answer
   for one view out of ten and a teleport out of the other nine: search "Rome"
   while you are orbiting the cube and the cube vanished, taking the camera, the
   cut and the lineage chain with it, to show you a bar.

   THE VERDICT IS NOT INVENTED HERE. The selection card already had to answer
   exactly this question for its "Show this in" row, and it already distinguishes
   NEVER from NOT NOW — a life has no territory, so the map can never draw it,
   while a polity you are simply standing 900 years away from is one snapshot
   away. That verdict is SelCard.dests(), and this reads it rather than writing a
   second copy that could disagree with the card sitting on the same screen.

   Three sources of truth, each owned by the module that has the facts:
     · SelCard.dests(sub)  — map and cube: has it a territory at all
     · planReveal(id)      — the timeline family: is a layer drawing it
     · the renderer's own item list — flow and beliefs: is it in this corpus

   AND WHEN THE VIEW GENUINELY CANNOT: fall back to the horizontal timeline,
   which is the one destination that exists for everything with a span. Habitation,
   the information horizon and Concepts can never show one named thing — they
   draw aggregates and documentation — so a hit taken there always travels. The
   row says so before it is taken (needLine / needTitle below).
*/
interface Landing { view: ViewId; act: () => void }

/** Everything the card's "Show this in" row would offer for this subject. */
const destsOf = (sub: Subject): { act: string; off?: boolean }[] => {
  try { return SelCard.dests(sub); } catch { return []; }
};
const destOpen = (sub: Subject, act: string) =>
  destsOf(sub).some(d => d.act === act && !d.off);

/**
 * DOES CONNECTIONS DRAW THIS THING? — the view's own two answers, in order.
 *
 * anchorOf() is the LIVE one: a rect means the mark is on that canvas at this
 * instant, which is the only unarguable form of "yes". The corpus is the second,
 * and it is why this is not simply `nodes.has(id)`: a landing on Connections
 * FRAMES the subject before you look at it (animTo), so a thing the corpus
 * carries and a lane will take is a mark this view is about to draw, even though
 * the current window has scrolled past it. What the corpus cannot promise is the
 * lane: connections.ts scores every item against four lane queries and leaves
 * home = -1 when none of them wants it (a non-European `nature` event is the
 * live example), and an item with no lane is drawn at no span, no pan and no
 * zoom. Counting it would put the reader on a canvas with nothing lit.
 */
const connDraws = (id: string): boolean => {
  const C = Conn as unknown as {
    anchorOf?: (id: string) => DOMRect | null;
    nodes?: Map<string, { home?: number }>;
  };
  try { if (C?.anchorOf?.(id)) return true; } catch { /* mid-redraw: ask the corpus */ }
  const n = C?.nodes?.get?.(id);
  return !!n && (n.home ?? -1) >= 0;
};

/**
 * …AND UNDER WHICH NAME. Returns the id Connections would actually draw for this
 * subject, or null when it draws nothing for it at all.
 *
 * 'same-as' is the one relation kind that is not a relation: relations.ts defines
 * it as "the SAME thing seen through two lanes" — "Renaissance" as a timeline
 * lane item, "The Renaissance" as a spread, weight 1.00. Connections carries the
 * spread and not the lane id, and the lane id is the FIRST row of that spread's
 * own card. So the founder clicked "Renaissance" in a card he had opened by
 * clicking the Renaissance ribbon, and was told "Renaissance is not drawn on
 * Connections". Both sentences cannot be true of one thing, so when this view
 * does not carry the id itself, its same-as twin answers for it.
 */
const connShown = (id: string): string | null => {
  if (connDraws(id)) return id;
  const C = Conn as unknown as { relsOf?: (id: string) => { other: string; kind: string }[] };
  let twins: string[] = [];
  try { twins = (C?.relsOf?.(id) || []).filter(r => r.kind === 'same-as').map(r => r.other); } catch { twins = []; }
  return twins.find(connDraws) ?? null;
};

/**
 * PUT A SUBJECT ON THE CONNECTIONS CANVAS — the one implementation, shared by
 * the selection card's Connections cell and by a relation click taken while
 * already standing on Connections, exactly as showInFlow() is shared by the
 * search and the card's Flow cell.
 *
 * It does NOT navigate; the two callers decide that for themselves, because one
 * of them is already there. Selecting is the whole of the lighting: connections.ts
 * draws off the global selection, so a store write lights the mark, dims the rest
 * to context and threads the relations without this file knowing how. Framing is
 * a courtesy on top — a subject the current window has scrolled past is in the
 * corpus but not on the glass, and animTo brings it back.
 */
function showInConnections(id: string, from: SelSource = 'point') {
  const shown = connShown(id) ?? id;
  SelCard.select(shown, null, null, from);
  const sub = describe(shown);
  if (!sub) return;
  const [f0, f1] = padSpan(...perspectiveSpan(sub));
  try { (Conn as unknown as { animTo?: (a: number, b: number) => void }).animTo?.(f0, f1); } catch { /* framing is a courtesy */ }
}

/* ribbonHas() lived here — "is this id one of the ribbons THIS engine is
   drawing?" — and it was only ever asked of Braid, to refuse a stream from the
   system not currently up. showInBeliefs() switches the system instead, so the
   question has no answer left that matters. */

/** A little air either side, so a framed ribbon is not flush with the edges. */
const padSpan = (a: number, b: number): [number, number] => {
  const pad = Math.max(40, Math.round((b - a) * 0.18));
  return [a - pad, Math.min(2026, b + pad)];
};

/**
 * PUT A POLITY ON THE FLOW CANVAS — the one implementation, shared by the
 * card's "Show this in ▸ Flow" and by taking a search result while standing on
 * Flow. It does NOT navigate; both callers decide that for themselves.
 *
 * THE STORE IS THE TRACE. flow.ts's localSel() reads the global selection and
 * lights the matching ribbon and its whole lineage, so a 'polity:<id>' write is
 * the entire gesture — exactly as it is for the cube. Framing is a courtesy on
 * top: the flow window belongs to the reader and may be parked a millennium
 * from the thing they just asked for.
 *
 * AND A HIDDEN REGION COMES BACK ON. The region chips are a browsing filter,
 * not a verdict — but a hidden region is CULLED from flow's layout before
 * anything is drawn, so without this the destination lands on a canvas with
 * nothing on it. Done by pressing flow's own chip rather than by writing
 * Flow.off: the set, the chips' pressed state and the "n of 5" readout are one
 * thing kept in step by flow.ts's private regionToggle(), and reaching past it
 * would light the ribbon while the panel still claimed the region was hidden.
 * A synthetic click carries no modifier, so it toggles rather than isolating,
 * and it is only ever sent when the region is genuinely off.
 */
function showInFlow(pid: string) {
  const item = (Flow.items as any[]).find(p => p && p.id === pid);
  if (item && item.region && Flow.off.has(item.region)) {
    document.querySelector<HTMLElement>(
      `#flowRegionRow .chip[data-region="${CSS.escape(item.region)}"]`)?.click();
  }
  SelStore.set('polity:' + pid);
  const sub = describe('polity:' + pid);
  if (sub) { const [f0, f1] = padSpan(...perspectiveSpan(sub)); Flow.animTo(f0, f1); }
}

/**
 * WHICH VIEW DRAWS THIS BELIEF STREAM — 'braid' for a religion, 'ideology' for
 * an ideology, null when the id is not a stream at all.
 *
 * It used to answer a SYSTEM, because there was one canvas and the answer was
 * "which corpus does it have to be switched to". Now the two corpora are two
 * views, so the answer is a destination — and the routing is a lookup in the
 * data rather than a chip press with a guard around it.
 *
 * The corpus is the authority, not either instance's `items`: the question has
 * to be answerable before either canvas has ever rendered, and it must not
 * change when a reader filters or pans. beliefSystemOf() is braid.ts's, so the
 * table that says which streams a view holds and the routing that sends a
 * reader there cannot disagree.
 */
const BELIEF_VIEW_OF: Record<string, ViewId> = { religion: 'braid', ideology: 'ideology' };

function beliefView(id: string): ViewId | null {
  if (!id.startsWith('belief:')) return null;
  const sys = beliefSystemOf(id.slice(7));
  return sys ? (BELIEF_VIEW_OF[sys] ?? null) : null;
}

/**
 * PUT A BELIEF STREAM ON THE BRAIDED RIVERS — the one implementation, shared by
 * the search and by the selection card's offer, exactly as showInFlow() above
 * is shared by the search and the card's Flow cell.
 *
 * It does NOT navigate; it RETURNS WHERE IT PUT THE THING, and both callers
 * decide for themselves whether to travel there.
 *
 * THE SYSTEM SWITCH IS GONE, AND WITH IT THE THING THAT COULD GO WRONG. This
 * used to press a preset chip on braid's own panel — the item list, the pressed
 * state of the two switches, the note and the framing were one bundle kept in
 * step by initBraid()'s private pick(), and the guard that decided whether to
 * press read `aria-pressed` off the DOM. Every part of that was a way for a
 * reader arriving from search to land on the wrong corpus: rename the attribute
 * and the guard silently stops firing.
 *
 * Now the two corpora are two views, each holding its own items for the whole
 * life of the page, so there is nothing to switch and nothing to keep in step.
 * The routing is a table lookup against the corpus, the instance is picked by
 * the same lookup, and being on the wrong view is not a state the app can
 * reach — the caller navigates to the view this returns.
 */
function showInBeliefs(id: string): ViewId {
  const v = beliefView(id) ?? 'braid';
  const b = Braids[v === 'ideology' ? 'ideology' : 'religion'];
  b.setQuery('');                              // a leftover filter would dim the stream
  // 'search' rather than 'point': the braids draw no anchor this card could hang
  // off (Lab's anchorOf answers only for the timeline family and Connections),
  // and the parked corner is the one place the reader can predict.
  SelCard.select(id, null, null, 'search');
  const sub = describe(id);
  if (sub) { const [f0, f1] = padSpan(...perspectiveSpan(sub)); b.animTo(f0, f1); }
  return v;
}

/* ── THE NOTICE ───────────────────────────────────────────────────────────────
   "when I click Confucius - Daoism and daoisms lane isnt showed up we need to
   somehow present that daoism is in lane that is not here."

   Going to a subject can quietly change the board — a lane arrives, a dial goes
   up — and a board that changed without being asked is only honest if it SAYS
   SO. One line, and nothing else:

     Added “Asia · Beliefs”
     Daoism is not drawn on this timeline

   IT SAYS; IT DOES NOT DO. It carried a button once — [Undo] on the first line,
   [Show in Beliefs] on the second — and both are gone, for the same reason in
   two shapes. The founder on the first: "get rid of the undo - you can just
   remove the lane if you like" — the lane the line names is flashed in the
   panel as the line appears, with its own × on it. And on the second: "Remove
   the 'Show in Beliefs' - instead the card should be able to reach ALL the
   views" — the selection card opens on the same gesture, a hand's width below,
   and its destination row now carries every view including Beliefs. Both
   buttons were a second control for a control already on screen.

   NOT A CONFIRMATION, EITHER. The search has revealed lanes silently since the
   phantom-zoom fix, and gating the identical move behind a dialog when it comes
   from a card would be one app doing one thing two ways.

   NOT THE ACCENT. Minium means WHERE YOU ARE IN TIME and nothing else, so the
   notice is ink on the same over-surface every panel uses. */
interface Notice {
  /** what changed, or why nothing could — one line, past tense, no jargon */
  text: string;
  /** a fresh id per notice, so an identical message re-plays its entry */
  n: number;
}
let noticeN = 0;

/** WHAT TO CALL A VIEW ON THE ONE BUTTON THAT GOES THERE. The rail's own word
 *  for it — except the horizontal timeline, where the rail says "Horizontal"
 *  because it is one of two projections in the Timeline group, and the card has
 *  called that destination "Timeline" since it had destinations. */
const destWord = (v: ViewId) => v === 'zoom' ? 'Timeline' : VIEWS[v].seg;

/** WHAT THE REVEAL ACTUALLY TOOK, in the panel's own vocabulary. The
 *  two needs are two different events and they are spelled differently; the
 *  dial is named only when it actually moved (an `add` can carry one too). */
function didLine(p: RevealPlan): string {
  const at = p.detailWord ? ` at “${p.detailWord}”` : '';
  if (p.need === 'add') return `Added “${p.layerName}”${at}`;
  return `Raised “${p.layerName}” to “${p.detailWord}”`;
}

/* A ROW THAT CANNOT ACT IS NOT IN THE ARROW ORDER. A content hit whose thing is
   not drawn on this timeline at all (a belief stream, a spread with no
   footprint) stays in the list because it is still a truthful answer to the
   word, but the cursor steps over it and Enter cannot land on it — the same
   rule the group headers have always followed. */
const canTake = (r: SRow) => !(r.k === 'c' && r.to === null);
const stepSel = (rows: SRow[], from: number, dir: number) => {
  for (let n = 1; n <= rows.length; n++) {
    const i = ((from + dir * n) % rows.length + rows.length) % rows.length;
    if (canTake(rows[i])) return i;
  }
  return from;
};
const firstSel = (rows: SRow[]) => {
  const i = rows.findIndex(canTake);
  return i < 0 ? 0 : i;
};

/* WHAT THE FRAME LOOP WOULD HAVE DONE. The rail readout and the URL are both
   written from the app's ONE rAF loop, so a browser that is not compositing
   leaves them on whatever they booted with — which is how a dropped framing
   shows up as "#railYear still says 1783" rather than as a still canvas.
   frameSettled is module-level and they are component state, so the component
   registers them here, exactly the way it already registers go() through
   shared.ts's setGotoTab. Null whenever no Lab is mounted. */
let settleChrome: (() => void) | null = null;

/**
 * FRAME IT — AND MAKE SURE THE FRAME ACTUALLY LANDS.
 *
 * TL.frameTo does its whole job inside requestAnimationFrame: a 650ms tween
 * whose every step writes d0/d1. A tab that is hidden, occluded, throttled or
 * otherwise not compositing never receives a frame, so the tween never takes a
 * single step and the window never moves at all.
 *
 * Everything else in this gesture is synchronous — the layer is added, the
 * thing is selected, the card opens — so the failure is silent and lopsided,
 * and it wears the exact shape of the bug this whole pass exists to kill: a
 * card open on Cubism over five thousand undisturbed years. Reproduced
 * deterministically by stubbing requestAnimationFrame to a no-op: lane added,
 * card open, selection set, span still [-3000, 2026], #railYear still on the
 * year it booted with.
 *
 * #railYear is stuck for the same reason and it is worth naming: the rail's
 * centre-year observer (and the URL's y=/s=, written from it) rides ONE rAF
 * loop for the whole app. No frames, no publication — so even a window that had
 * moved would not show it.
 *
 * Timers survive that state — clamped to about 1/s in a background tab, but
 * they do run — so one checks up on the tween after it should have finished and
 * lands the window by hand if no frame ever arrived. The by-hand landing is not
 * invented here: it is what animTo already does for itself under
 * prefers-reduced-motion (clamp, write, relatch, paint), plus the centre-year
 * publication the observer would have made a frame later — which is the same
 * thing the URL-restore path at mount already does for the same reason.
 */
function frameSettled(a: number, b: number) {
  const was0 = TL.d0, was1 = TL.d1;
  TL.frameTo(a, b);
  setTimeout(() => {
    if (TL.d0 !== was0 || TL.d1 !== was1) return;    // the tween ran; it owns the window
    const [ca, cb] = clampDomain(a, b);              // never skip the clamp frameTo applies
    TL.d0 = ca; TL.d1 = cb;
    TL._relatch = true;
    TL.paint();
    SelCard.reanchor();
    const c = Math.round((ca + cb) / 2);
    if (Number.isFinite(c)) TimeStore.set(c, 'tl');
    // the rail and the URL ride the same dead loop — push them by hand too
    settleChrome?.();
  }, 900);                                           // animTo's tween is 650ms
}

interface UrlState { v: ViewId | null; y: number | null; s: number | null }

function readUrl(): UrlState {
  const none: UrlState = { v: null, y: null, s: null };
  if (typeof location === 'undefined') return none;
  try {
    const q = new URLSearchParams(location.search);
    const rv = q.get('v'), ry = q.get('y'), rs = q.get('s');
    const y = ry === null ? NaN : Number(ry);
    const sp = rs === null ? NaN : Number(rs);
    return {
      v: rv && (ORDER as string[]).includes(rv) ? rv as ViewId : null,
      y: Number.isFinite(y) && y >= YMIN && y <= YMAX ? Math.round(y) : null,
      s: Number.isFinite(sp) && sp > 0 ? sp : null,
    };
  } catch { return none; }
}

// ── Icons ───────────────────────────────────────────────────────────────────
const I = {
  mark: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6" /><path d="M8 2v12M2 8h12" /><ellipse cx="8" cy="8" rx="2.7" ry="6" /></svg>,
  search: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>,
  // A QUESTION MARK, NOT AN i. "Turn it instead to help icon." The ⓘ said
  // "there is information about this" — true, and useless, because everything
  // on screen is information. The popover behind it answers "what am I looking
  // at and what can I do here", which is a question, and the keyboard route to
  // it has always been the ? key. Now the glyph, the shortcut and the footer
  // hint all spell the same character.
  help: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.2" /><path d="M6.15 6.1a1.95 1.95 0 1 1 2.15 2.72v1.05" strokeLinecap="round" /><path d="M8.3 11.9v.5" strokeLinecap="round" /></svg>,
  theme: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" /></svg>,
  prev: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>,
  next: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>,
  close: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  // The wordmark's one affordance. 1.5 rather than the 1.3 the mark's own glyph
  // uses, because it is drawn at 9px and a 1.3 stroke disappears there — and it
  // is painted --tl-ink-3 by shell.css, a step quieter than the word it follows,
  // so it announces the menu without making the mark loud again.
  chev: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3.5 6L8 10.5 12.5 6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

/* ONE RESET, SIX VIEWS. "Reset view" was implemented separately in six places
   — #tlReset, #btnReset, #flowAll, braid's re-press of the active preset,
   #connReset and the cube's [data-v=home] — with three different titles and two
   different label texts ("Whole span", "Home"). The act is identical everywhere:
   put the framing back. So there is one component that draws it, and a view
   supplies either a handler or the id its own renderer already binds. First
   child of WHERE YOU ARE, on every view that has one. */
function ResetBtn(o: { id?: string; dataV?: string; title: string; onClick?: () => void }) {
  return <button className="btn" id={o.id} data-v={o.dataV} title={o.title} onClick={o.onClick}>Reset view</button>;
}

/* ONE TRANSPORT, THREE VIEWS. Map's play, Habitation's play and the Cube's play
   were three separately-written buttons doing one thing, in two different orders,
   with two different initial labels ("▶ Play" on the map, which map.ts then
   rewrote to "Play" the first time you pressed it) and only two of the three
   carrying aria-pressed.

   The label of the middle button belongs to whichever renderer owns the clock —
   map.ts, population.ts and cube.ts all write its textContent — so it must stay a
   TEXT button and must never be given an <svg> child. That contract used to be
   stated in three separate comments in three files; it is stated once, here.

   `unit` is the noun the tooltips use (snapshot, slice); `data` is the cube,
   which reaches its three buttons through #cubeStep [data-a] and keys its
   tooltips to [ and ] rather than ← and →.

   THESE TWO ARE MODULE-LEVEL COMPONENTS, NOT CLOSURES IN THE BODY. A component
   declared inside a render gets a new identity every render, so React unmounts
   and remounts its subtree — which would throw away the label map.ts had written
   into #btnPlay on every state change in the shell. */
function Transport(o: {
  prevId?: string; playId: string; nextId?: string; unit: string;
  onPrev?: () => void; onNext?: () => void; data?: boolean;
}) {
  return (
    <div className="tl-cluster tl-transport" id={o.data ? 'cubeStep' : undefined}>
      <button className="tl-iconbtn" id={o.prevId} data-a={o.data ? 'prev' : undefined}
        aria-label={`Previous ${o.unit}`} title={`Previous  ${o.data ? '[' : '←'}`}
        onClick={o.onPrev}>{I.prev}</button>
      <button className="btn" id={o.playId} data-a={o.data ? 'play' : undefined}
        aria-label="Play through time" aria-pressed="false">Play</button>
      <button className="tl-iconbtn" id={o.nextId} data-a={o.data ? 'next' : undefined}
        aria-label={`Next ${o.unit}`} title={`Next  ${o.data ? ']' : '→'}`}
        onClick={o.onNext}>{I.next}</button>
    </div>
  );
}

export default function Lab() {
  const [view, setView] = useState<ViewId>(DEFAULT_VIEW);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  /* THE WORDMARK'S MENU. "Hide concepts under the main Timeline brand view
     dropdown, make it hidden." One item today; the markup is a list so a second
     costs nothing. It is NOT in the switcher and must never be: Concepts is
     documentation about the tool, which is exactly why it needed a home that is
     not a tab. */
  const [markOpen, setMarkOpen] = useState(false);
  /* TWO FLAGS FOR ONE POPOVER, because it has to be seen LEAVING.
     `notesOpen` is what the reader asked for; `notesVis` is whether the element
     is still in the layout. Opening sets both; closing drops `notesOpen` at
     once — so aria-expanded, the ? key and Escape are all instantly honest —
     and holds `notesVis` until the exit animation has actually run
     (onAnimationEnd below). Without the second flag `hidden` lands on the same
     frame as the close and there is nothing left on screen to animate. */
  const [notesVis, setNotesVis] = useState(false);
  // TWO PANELS, TWO ANSWERS. "you might want to hide/show both" — so Controls
  // and Reading each keep their own, and each wears the same chevron in the
  // same corner of its own header. Null means "nobody has said", which resolves
  // to the width: a column on a desktop, a folded sheet on a phone.
  const [collapsedBy, setCollapsedBy] = useState<boolean | null>(null);
  const [readCollapsedBy, setReadCollapsedBy] = useState<boolean | null>(null);
  // THE DOCKED "RELATED" PANEL IS CLOSED BY DEFAULT. The selection card carries
  // the top three or four relations already; the dock exists for the moment you
  // want the whole ranked list, and it is reached from the card's
  // "All connections →". Opening it costs 92px of a shared column otherwise.
  const [relOpen, setRelOpen] = useState(false);
  // What the last navigation had to change about the board, and how to take it
  // back. Null almost always — the common case is that nothing had to change.
  const [notice, setNotice] = useState<Notice | null>(null);
  const booted = useRef(false);
  // WHERE CONNECTIONS OPENS. Conn computes its own default span from the corpus
  // (connections.ts, "default span: everything the spreads cover"), so the only
  // honest reset is the framing it actually arrived at — read once, after init,
  // rather than a second copy of those numbers written down here.
  const connHome = useRef<[number, number] | null>(null);
  // Coming back to a group should return you to where you were in it. Seeded
  // from GROUP_DEFAULT; the vertical port flips that seed, not this.
  const lastMember = useRef<Record<string, ViewId>>({ ...GROUP_DEFAULT });
  // Which views' field notes have been read. Deliberately NOT React state: the
  // markup ships with the dot on (correct for a first visit, and identical on
  // the server), and an effect clears it once localStorage has been consulted.
  const seen = useRef<Set<string>>(new Set());
  const narrow = useSyncExternalStore(subNarrow, () => matchMedia(NARROW).matches, () => false);
  const collapsed = collapsedBy ?? narrow;
  const readCollapsed = readCollapsedBy ?? narrow;
  const viewRef = useRef<ViewId>(view);
  // Declared FIRST so it is up to date before any effect below reads it.
  useEffect(() => { viewRef.current = view; });
  // The card is wired ONCE, at boot, and its two navigation verbs are defined
  // far below (they need go() and flashLayer()). Same shape as viewRef: the
  // wiring closure reads the ref, so it can never be holding a stale copy.
  const goToRef = useRef<((id: string) => void) | null>(null);
  const showTlRef = useRef<((id: string) => void) | null>(null);

  const meta = VIEWS[view];
  // Concepts is outside the switcher, so NOTHING in the switcher is selected
  // while it is open — a rail that says MAP over a page of concept cards lies.
  const group = view === 'concepts' ? '' : groupOf(view);
  const members = group ? GROUPS.find(g => g.id === group)!.members : [];
  // The group's own word, so the sub-switcher can NAME the thing it lives
  // inside ("Map views") instead of repeating the generic "View" the six group
  // tabs already carry. The chevron in the markup below is the same statement
  // for the eye; this is it for a screen reader.
  const groupLabel = group ? GROUPS.find(g => g.id === group)!.label : '';

  // ── view state ────────────────────────────────────────────────────────────
  // Tolerates unknown ids, and maps the legacy alias 'sketch' -> 'braid'.
  // gallery.ts still emits data-goto="sketch" on three cards (SHELL does not own
  // that file in this pass), so all three land on Beliefs rather than on Beliefs,
  // Horizon and Habitation respectively. Logged as a follow-up.
  // ── field notes ───────────────────────────────────────────────────────────
  // Declared HERE, above go(), because the first-visit auto-open below has to
  // run from inside the navigation itself rather than from an effect on `view`.
  // `at` is passed explicitly on that path: viewRef is synced by an effect, so
  // during the click that changes the view it still holds the OLD one.
  const openNotes = useCallback((open: boolean, at?: ViewId) => {
    const v = at ?? viewRef.current;
    setNotesOpen(open);
    if (open) setNotesVis(true);           // unhide NOW; the exit is what waits
    if (!open) return;
    if (!seen.current.has(v)) {
      seen.current.add(v);
      try { localStorage.setItem('tl-notes-seen', JSON.stringify([...seen.current])); } catch { /* ignore */ }
    }
    paintUnread(seen.current, v);
  }, []);

  /* ── THE NOTES OPEN THEMSELVES, ONCE, ON THE FIRST VISIT TO EACH VIEW ──────
     "When clicking for a view for the first time, show the Field notes (the
     help button) automatically (show and hide with a little animation)."

     Ten views, ten different pictures, and until now the only way to learn what
     any of them was FOR was to notice a small round button at the far end of
     the rail and press it. The notes answer "what am I looking at"; a reader
     who has never seen this view is exactly the reader with that question, so
     it is answered before it is asked. The animation is shell.css §10.

     ONCE, AND PERSISTED THE WAY THE UNREAD DOT ALREADY WAS. The seen-set is the
     same set the dot has always been painted from, in the same localStorage key
     (`tl-notes-seen`), written by the same openNotes() call — so this fires the
     FIRST time a browser ever lands on a view and never again, whether it was
     dismissed in two seconds or read to the end. No second store, no second
     source of truth, nothing to keep in step.

     ON A TIMER, AND THE DELAY IS NOT A LINT DODGE. The view changes, the canvas
     repaints, and THEN the panel slides in — so the reader sees what they
     pressed for before anything is laid over it, and the entry animation has a
     settled picture to arrive on rather than racing the first frame of a new
     renderer. It is also what keeps this out of the cascading-render trap the
     suggestion list is kept out of (see leaveSearch): nothing here calls
     setState synchronously in an effect body.

     THREE THINGS CALL IT OFF, all re-checked when the timer fires rather than
     when it is set — a fifth of a second is long enough for any of them to
     become true:
       · the data has not landed (the notes must not open over the loading
         overlay, on top of a canvas that has never painted);
       · this view has been seen before;
       · the selection card is up — a reader who arrived by TAKING A SEARCH
         RESULT has already said what they came for, and dropping a panel over
         it would be the app answering a question nobody asked.
     And the cleanup cancels it outright, so flicking through four views lands
     one panel, on the view you stopped at. */
  useEffect(() => {
    if (!ready || seen.current.has(view)) return;
    const t = setTimeout(() => {
      if (seen.current.has(view) || SelCard.open) return;
      openNotes(true, view);
    }, 320);
    return () => clearTimeout(t);
  }, [ready, view, openNotes]);

  const go = useCallback((id: string) => {
    const v = (id === 'sketch' ? 'braid' : id) as ViewId;
    if (!VIEWS[v]) return;
    setView(v);
  }, []);
  useEffect(() => { setGotoTab(go); }, [go]);

  /**
   * The URL, written from state. Every route into a view goes through setView
   * — the switcher, the seg, ⌘K, the gallery's data-goto, the card's actions —
   * so writing it from the view EFFECT covers all of them at once instead of
   * from five call sites.
   *
   * Throttled at 500ms rather than the 300 you would guess: Safari rate-limits
   * replaceState to 100 calls per 30 seconds and starts throwing after that,
   * and 300ms of continuous panning sits exactly on that limit. The string is
   * compared first, so a still app writes nothing at all.
   *
   * IT REPORTS WHETHER THE URL IS NOW THE STATE. The old note here claimed
   * there was no trailing-edge problem, "the rAF loop this rides keeps running
   * after a gesture ends — so the last state always lands". The loop does keep
   * running, but it only CALLS this when its key changes, and the key stops
   * changing the instant a tween finishes. So the final write of any gesture
   * that settled inside the 500ms window was refused and never asked for again:
   * a frame to 1875–1955 left ?y=1543&s=338 in the bar, a mid-tween state,
   * permanently. Returning false for "deferred, ask me again" is what lets the
   * loop below close that edge.
   */
  const urlRef = useRef({ t: 0, q: '' });
  const writeUrl = useCallback((force = false): boolean => {
    if (typeof history === 'undefined' || !history.replaceState) return true;
    try {
      const p = new URLSearchParams(location.search);
      p.set('v', viewRef.current);
      p.set('y', String(Math.round(TimeStore.year)));
      const span = Math.round(TL.d1 - TL.d0);
      if (Number.isFinite(span) && span > 0) p.set('s', String(span));
      const q = p.toString();
      if (q === urlRef.current.q) return true;                      // already the state
      const now = performance.now();
      if (!force && now - urlRef.current.t < 500) return false;     // deferred — ask again
      urlRef.current = { t: now, q };
      history.replaceState(history.state, '', location.pathname + '?' + q + location.hash);
      return true;
    } catch { return true; /* a URL is a convenience; it may never break the app */ }
  }, []);

  // READ ONCE, DURING THE FIRST RENDER, and never again — because writeUrl()
  // starts overwriting these params from the view effect on the very same
  // commit, and the boot fetches only land several hundred milliseconds later.
  // Reading the URL again inside boot() would read our own default state back.
  // Populating a ref during render is safe here: it is not rendered output, so
  // there is nothing for hydration to mismatch on.
  const url0 = useRef<UrlState | undefined>(undefined);
  if (url0.current == null) url0.current = readUrl();

  // Restoring the VIEW is a mount effect rather than a lazy useState initial
  // value, because the page is prerendered: reading location during the first
  // render would be a hydration mismatch. It costs one extra render, which is
  // invisible — the data has not landed yet, so the loading overlay is still up
  // and no canvas has painted.
  useEffect(() => {
    const v0 = url0.current?.v;
    if (v0) setView(v0);
  }, []);

  // ── boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    try {
      const raw = localStorage.getItem('tl-notes-seen');
      if (raw) seen.current = new Set(JSON.parse(raw) as string[]);
    } catch { /* private mode — the dot just stays on */ }
    paintUnread(seen.current, viewRef.current);
    (async () => {
      try {
        const grab = async (u: string) => {
          const r = await fetch(u); if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`); return r.json();
        };
        // THE ATLAS IS NOT HERE. worlds.json is 599 KB of border geometry — 87%
        // of what this Promise.all used to weigh — and the default view draws no
        // map. It is fetched after first paint instead (warmAtlas below), and
        // forced early by any view that actually needs borders.
        const [datasets, lanes, polities] = await Promise.all([
          grab('/data/datasets.json') as Promise<Datasets>,
          grab('/data/lanes.json').catch(() => ({ lanes: [] })),   // curated lanes; tolerant
          // The time-gated polity → sovereign alias table. The cube already
          // fetches this from inside its own chunk; the map's territory
          // highlight needs it WITHOUT paying for three.js, so it is loaded
          // here and handed to subject.ts. Same posture as the rest: tolerant.
          grab('/data/polities.json').catch(() => ({ polities: [] })),
          loadRelations(),                       // Connections; a miss must not stop the boot
          loadPopulation(),                      // Map · Habitation; same posture
        ]);
        initData(datasets);
        setLanes(lanes);                         // AFTER initData: lane members append to EVENTS pre-classified
        setPolityAliases(polities);
        boot();
        // THE TIME STATE, restored before the first paint. Both halves matter:
        // the window WITHOUT the moment would be undone the instant the tab
        // renders, because ensureYearVisible() re-centres the window on a
        // moment that falls outside it — the restored framing would lose an
        // argument with a courtesy. Setting the moment to the window's centre
        // is exactly what the centre-year observer would do a frame later, so
        // the two agree from the start and nothing moves.
        const u0 = url0.current ?? readUrl();
        if (u0.y !== null) {
          if (u0.s !== null) { TL.d0 = u0.y - u0.s / 2; TL.d1 = u0.y + u0.s / 2; }
          WorldMap.syncToYear(u0.y);
          TimeStore.set(u0.y, 'ui');
        }
        // WHAT THE SELECTION CARD CAN DO. Lab is the only module that knows all
        // ten views, so the card's verbs are injected from here rather than
        // imported — which is also why selcard.ts can be imported BY the
        // renderers without a cycle.
        SelCard.wire({
          // THE CORE LOOP. "Zoom to X" on the timeline, "See on timeline" on
          // the map and a row in the card's own Connections list are all the
          // same move — put that subject on the timeline — so they are all one
          // call now. goToSubject() earns the frame first (plan, reveal, then
          // select and frame) exactly as the search box does, and says what the
          // board had to give up. It writes no year of its own: the centre-year
          // observer below turns the new window into the new moment, once, in
          // one place.
          showOnTimeline: (id) => { showTlRef.current?.(id); },
          goTo: (id) => { goToRef.current?.(id); },
          // AT THE CURRENT GLOBAL YEAR — syncToYear moves the map to the nearest
          // snapshot without writing TimeStore back, so the rail keeps reading
          // where YOU are while the map draws the nearest atlas it has.
          //
          // WITH A YEAR, the card has decided the subject is not drawn at the
          // current one and is sending you to where it is. That IS a move
          // through time, not a projection of the year you are on, so the store
          // is written and the whole app follows — rail, URL, timeline cursor.
          // The two cases differ exactly in whether the year was your choice.
          seeOnMap: (year) => {
            if (year != null && Number.isFinite(year)) {
              // stop(), then repaint BY HAND. syncToYear only moves the index —
              // it does not draw — and go('map') is a no-op when the card was
              // pressed FROM the map, which is the common case for this branch.
              // Without the explicit render the borders changed underneath a
              // headline still reading the year you left. Same order the rail's
              // own map scrub uses: store first, then paint.
              WorldMap.stop();
              WorldMap.syncToYear(year);
              TimeStore.set((WorldMap as any).year(), 'map');
              WorldMap.render();
            } else {
              WorldMap.syncToYear(TimeStore.year);
            }
            go('map');
          },
          /* SHOW THIS IN FLOW. "Timeline / Map / Cube — i am missing Flow here!"
             The card knows the destination exists; this file is the only module
             that knows what to do about it. The doing is showInFlow() above —
             shared with the search, so one polity cannot be revealed two
             different ways depending on which control asked. */
          showInFlow: (pid) => { showInFlow(pid); go('flow'); },
          /* SHOW THIS IN CONNECTIONS. "I should be able to see Connections are
             in active state and an option to view him in Timeline. Now he just
             shows Timeline button in non-active state." Standing on Connections
             with Leonardo open, the card's destination row did not contain
             Connections at all, so it could not mark "you are here" and its one
             Timeline cell read as inert.

             THE SAME CALL landingFor MAKES. A relation clicked while already on
             this view and this cell pressed from another one are the same act
             with two triggers, so they are one function — showInConnections()
             above, which also resolves the same-as twin. go() is the only part
             that belongs here, and it is a no-op when you are already on conn,
             which is exactly when the cell is drawn inverted. */
          showInConnections: (id) => { showInConnections(id); go('conn'); },
          traceInCube: (pid) => { Cube.select(pid); go('cube'); },
          /* SHOW THIS IN BELIEFS. "Remove the 'Show in Beliefs' - instead the
             card should be able to reach ALL the views." The doing did not
             change at all — showInBeliefs() above is the same function that
             used to hang off the notice's button. Only the control it hangs off
             did: it is a cell in the card's destination row now, beside Timeline
             and Cube, permanent rather than a button that appears for twelve
             seconds.

             AND IT IS ONE CELL LANDING ON TWO VIEWS. The card offers "Beliefs"
             for anything describe() calls a stream, and half those streams are
             ideologies — so where the cell goes is a fact about the SUBJECT, not
             a constant. showInBeliefs() answers with the view it put the stream
             on and go() takes that, which is why the card can keep one cell and
             one label while the app has two belief views. */
          showInBeliefs: (id) => go(showInBeliefs(id)),
          allConnections: () => setRelOpen(true),
          mapYear: () => (WorldMap as any).year(),
          anchorOf: (id) => {
            const v = viewRef.current;
            if (v === 'zoom') return TL.anchorOf(id);
            if (v === 'vertical') return VT.anchorOf(id);
            // Connections draws the same marks as the timeline now, so it can
            // say where they are — without this the card opened there but had
            // nowhere to point, and fell back to its parked corner.
            if (v === 'conn') return Conn.anchorOf(id);
            return null;
          },
        });
        connHome.current = [Conn.d0, Conn.d1];
        SelCard.setView(viewRef.current);
        setReady(true);
        // THE ATLAS, AFTER THE PIXELS. warmAtlas() waits for the first idle after
        // this paint, so a reader who never opens the map pays nothing for it and
        // a reader who does finds it already in hand; a view that needs it sooner
        // (?v=map) forces it from its own render. The repaint is for the views
        // that read GEO without asking for it — Borders repaints itself, Horizon
        // and Habitation do not.
        warmAtlas();
        onAtlas(() => rerenderAll());
      } catch (e: any) {
        console.error(e);
        setError(String(e?.message || e));
      }
    })();
    // `go` is a useCallback([]) — stable, so listing it cannot re-run the boot
    // (and booted.current would refuse a second run anyway). It is listed
    // because the card's wiring closes over it.
  }, [go]);

  // ═══ THE TIME RAIL ═══════════════════════════════════════════════════════
  // One scale mapping (rail.ts) drives the index, the snapshot ticks and the
  // span bracket. Both runtime inputs are set every time the index moves and on
  // resize: --tl-index-pos is a percentage of the SCALE, --tl-index-x is that
  // same point in stage pixels (the scale is inset by the readout and the
  // transport, the canvas is not). Driving both from the percentage alone puts
  // them about 9% apart at 1440px.
  /**
   * WHERE THE READER IS POINTING, IN YEARS — asked of the renderer, in the
   * renderer's own coordinates, and null when the pointer is not on the canvas.
   *
   * "Where you're in cursor is the specific date where you are in time." On a
   * span view the window's CENTRE is an artefact of the arithmetic — the
   * founder's "the middle orange line in timeline is pretty arbitrary" — and
   * the cursor is the one moment on a span view that a person actually chose.
   * So minium keeps its single sanctioned meaning, "where you are in TIME", and
   * points at the thing the reader is pointing at.
   *
   * EACH RENDERER IS ASKED IN ITS OWN LANGUAGE, because each one has its own
   * plot inset and its own axis. Two of them publish a real inverse — TL.ix()
   * and VT.it() — and those are called rather than reimplemented; flow and
   * connections are linear in years across their plot, so the window and the
   * inset are the whole mapping. Every constant here is the renderer's own
   * public property (TL.gutter(), VT.GY/PAD/H, Flow.PAD) except the 12px
   * connections gutter, which that file writes as a literal in every one of its
   * own handlers and has no accessor for. Braid draws no cursor year at all, so
   * it answers null and the index falls back below.
   */
  const cursorYear = (v: ViewId): number | null => {
    try {
      if (v === 'zoom') {
        const cv = TL.cv; if (!cv || TL.hoverX == null) return null;
        const G = TL.gutter();
        return TL.ix(TL.hoverX, G, cv.clientWidth - G - 10);
      }
      if (v === 'vertical') {
        const cv = VT.cv; if (!cv || VT.hoverY == null) return null;
        return VT.it(VT.hoverY, VT.GY, VT.H - VT.GY - VT.PAD);
      }
      if (v === 'flow') {
        const cv = Flow.cv; if (!cv || Flow.hoverX == null) return null;
        const G = Flow.PAD;
        return Flow.d0 + (Flow.hoverX - G) / (cv.clientWidth - G * 2) * (Flow.d1 - Flow.d0);
      }
      if (v === 'conn') {
        const cv = Conn.cv; if (!cv || Conn.hoverX == null) return null;
        return Conn.d0 + (Conn.hoverX - 12) / (cv.clientWidth - 24) * (Conn.d1 - Conn.d0);
      }
    } catch { /* a renderer mid-boot has no canvas — the fallback covers it */ }
    return null;
  };
  /* THE POINTER LEAVES; THE MOMENT DOES NOT. A cursor that took the index with
     it off the canvas would blank the one mark that says where you are every
     time the hand went to a panel. So the last place pointed at is held, and
     only a reader who has not pointed at this canvas at all falls back to the
     global moment — which is what the rest of the app means by "where you are"
     and, on the timeline, is the window's centre. */
  const heldCursor = useRef<number | null>(null);

  const syncRail = useCallback(() => {
    const app = document.getElementById('app');
    const scale = document.getElementById('railScale');
    if (!app || !scale) return;
    const v = viewRef.current;
    const mode = VIEWS[v].rail;

    const setIndex = (pct: number) => {
      app.style.setProperty('--tl-index-pos', pct + '%');
      app.style.setProperty('--tl-index-x', (scale.offsetLeft + pct / 100 * scale.offsetWidth) + 'px');
    };
    const txt = (id: string, s: string) => { const el = document.getElementById(id); if (el && el.textContent !== s) el.textContent = s; };

    const stops = scale.querySelectorAll<HTMLElement>('.tl-scale__stop');
    const span = document.getElementById('railSpan');
    const index = document.getElementById('railIndex');
    const line = document.getElementById('indexLine');
    const generic = document.getElementById('railRange') as HTMLInputElement | null;

    /* THE SELECTED THING'S SPAN. Runs before every mode branch below, because
       it is true in all of them: the map has no time axis of its own and the
       cube's rail is a legend, but "when did this exist" has the same answer on
       both. Clamped to the scale's extent, and a subject that begins before
       3000 BCE says so with an open edge rather than by pretending to start
       exactly where the ruler does. */
    const selEl = document.getElementById('railSel');
    if (selEl) {
      const sub = SelStore.id ? describe(SelStore.id) : null;
      if (!sub || !Number.isFinite(sub.start) || !Number.isFinite(sub.end)) selEl.hidden = true;
      else {
        const a0 = railPos(Math.min(sub.start, sub.end));
        const b0 = railPos(Math.max(sub.start, sub.end));
        selEl.hidden = false;
        selEl.style.left = a0 + '%';
        // A MOMENT IS NOT A ZERO-WIDTH SPAN ON A 5,000-YEAR RULER. Anything
        // narrower than this is invisible, so an event gets a mark rather than
        // nothing at all — the same floor #railSpan uses.
        selEl.style.width = Math.max(0.5, b0 - a0) + '%';
        selEl.style.setProperty('--tl-sel-hue', dotVar(sub.cat));
        selEl.dataset.open = (Math.min(sub.start, sub.end) < RAIL_FLOOR ? 'l' : '') + (Math.max(sub.start, sub.end) > RAIL_CEIL ? 'r' : '');
      }
    }

    if (mode === 'off') return;

    if (mode === 'legend') {                     // cube: read-only. No index, no thumb.
      stops.forEach(s => s.dataset.here = 'false');
      if (span) span.hidden = true;
      if (index) index.hidden = true;
      if (line) line.hidden = true;
      txt('railYear', '3000 BCE → 1994'); txt('railEra', 'the block’s third axis');
      return;
    }
    if (index) index.hidden = false;
    if (line) line.hidden = false;

    if (mode === 'live') {
      if (span) span.hidden = true;
      let year = 0, era = '';
      if (v === 'map') {
        // The index sits at the GLOBAL moment, the same rule spelled out for
        // the span views below — and #yearLabel now reads TimeStore too. The
        // atlas year only earns a mention when it is NOT the year you are at,
        // which happens exactly when a card sent you here off-snapshot.
        year = TimeStore.year;
        const shot = (WorldMap as any).year();
        era = shot === year
          ? `${railEraOf(year)} · ${WorldMap.ix + 1}/18`
          // fmtY, not railNum: railNum drops the era, so the 1 BCE snapshot
          // came out as a bare "ATLAS 1" — indistinguishable from 1 CE, which
          // is the one place on this line where the era actually decides the
          // meaning.
          : `${railEraOf(year)} · ATLAS ${fmtY(shot)} · ${WorldMap.ix + 1}/18`;
      } else if (v === 'pop') {
        year = Pop.year();
        era = `${railEraOf(year)} · slice ${Math.round(Pop.ix) + 1}/${Math.max(1, Pop.slices().length)}`;
      } else {
        year = Horizon.year;
        era = `${railEraOf(year)} · standing still`;
      }
      const pct = railPos(year);
      setIndex(pct);
      const flag = document.getElementById('railFlag');
      if (flag) flag.textContent = railNum(year);
      if (v !== 'map' && v !== 'pop') { txt('railYear', railNum(year)); txt('railEra', era); }
      else { txt(v === 'map' ? 'mapEra' : 'popEra', era); }
      stops.forEach(s => { s.dataset.here = String(Math.abs(railPos(+s.dataset.year!) - pct) < 0.35); });
      if (v === 'horizon' && generic && document.activeElement !== generic) generic.value = String(Math.round(pct * 10));
      return;
    }

    /* mode === 'span': the canvas axis IS time, but the view is a zoom WINDOW,
       not a moment — and the readout now says so.

       "Lets instead of keeping the middle year in the counter keep FROM-TO
       years, the middle orange line in timeline is pretty arbitrary." He is
       right, and structurally so: on a LIVE view the canvas draws one snapshot,
       so one year is the truth; on a SPAN view the truth is the window, and the
       single year the counter used to show was that window's centre — arithmetic,
       not a fact anyone chose. So the counter holds the window's two ends, in the
       slot the counter already occupies at the bottom of the view, and the index
       goes to the cursor (see cursorYear above).

       fmtBig ON BOTH ENDS, and this is not a nicety. The timeline's window
       reaches the Big Bang, and a raw d0 printed there is -13797812398: "make
       sure on timeline the years get clever, like when you zoom all the way,
       show truncated readable number not 13797812398123". fmtBig is the app's
       own ladder — billions, millions, thousands, then ordinary years with their
       era — and it already prints every deep-time year on both canvases, so the
       rail now says exactly what the plot says. Same reason the flag and the
       span caption use fmtBig and fmtSpan: those are the other two places in
       this rail where a year or a count of years reaches the screen. */
    const src: any = v === 'flow' ? Flow : v === 'braid' ? Braids.religion
      : v === 'ideology' ? Braids.ideology : v === 'conn' ? Conn : TL;
    const d0 = Number(src.d0), d1 = Number(src.d1);
    const a = railPos(d0), b = railPos(d1);
    const cur = cursorYear(v);
    if (cur !== null && Number.isFinite(cur)) heldCursor.current = cur;
    const at = heldCursor.current ?? TimeStore.year;
    const pct = railPos(at);
    setIndex(pct);
    if (span) { span.hidden = false; span.style.left = a + '%'; span.style.width = Math.max(0.4, b - a) + '%'; }
    stops.forEach(s => s.dataset.here = 'false');
    const flag = document.getElementById('railFlag');
    if (flag) flag.textContent = fmtBig(at);
    txt('railYear', `${fmtBig(d0)} – ${fmtBig(d1)}`);
    // The era word is gone from this caption: the range above carries BCE/CE on
    // each end already, and the one it used to print was the CENTRE's — the very
    // year this pass exists to stop reporting. What is left is the fact the
    // range cannot state on its own, how much time is on screen, and fmtSpan is
    // the app's own formatter for it (13.8 Gyr, not 13,797,812,398 yrs).
    txt('railEra', `SPAN ${fmtSpan(Math.max(0, d1 - d0))}`);
    if (generic && document.activeElement !== generic) generic.value = String(Math.round(pct * 10));
  }, []);

  // ── resize + theme, exactly as the prototype wired them ───────────────────
  // Both listeners repaint the canvases on a theme change and must stay.
  useEffect(() => {
    if (!ready) return;
    const onResize = () => { rerenderAll(); syncRail(); };
    addEventListener('resize', onResize);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', rerenderAll);
    const mo = new MutationObserver(rerenderAll);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { removeEventListener('resize', onResize); mq.removeEventListener('change', rerenderAll); mo.disconnect(); };
  }, [ready, syncRail]);

  // Opening or closing the bottom sheet changes how much canvas is left under it,
  // which sizeRenderers() measures — so the canvases have to re-fit when it moves.
  useEffect(() => { if (ready) renderTab(viewRef.current); }, [collapsed, readCollapsed, ready]);

  // (The selection used to force a re-fit here too: below 760px the chip took a
  // rail row of its own, so selecting something changed the height of the stage.
  // The chip is gone and a selection now costs no chrome, so there is nothing to
  // re-fit — the panels above are the only thing left that moves.)

  useEffect(() => {
    const g = groupOf(view);
    if (view !== 'concepts') lastMember.current[g] = view;
    paintUnread(seen.current, view);
    writeUrl(true);                       // the view is a deliberate move: write it now
    if (ready) { renderTab(view); syncRail(); SelCard.setView(view); }
  }, [view, ready, syncRail, writeUrl]);

  // Selecting something else closes the full list again — the dock is a place
  // you go on purpose, not a panel that latches open for the rest of the session.
  useEffect(() => SelStore.subscribe(() => setRelOpen(false)), []);

  // Below 1024 the switcher takes its own scrolling row (shell.css §13), and on
  // a phone that row is still wider than the screen. So after a deliberate move,
  // park the tab you are now on inside it.
  // It used to park the .tl-seg instead, when there was one in this row and it
  // was the payload; the seg is a row of Controls now, so the ACTIVE TAB is the
  // only contextual thing left up here and it is what has to be in view.
  // Skipped on first paint: yanking the row sideways before the user has
  // touched anything would just hide the switcher they arrived on.
  // Compares the previous view rather than "have I run before", because Strict
  // Mode double-invokes effects in dev and a run-once flag would fire the
  // scroll on the very first paint in dev and not in production.
  const prevView = useRef<ViewId | null>(null);
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (prev === null || prev === view) return;
    const mid = document.querySelector<HTMLElement>('.tl-rail__mid');
    if (!mid || mid.scrollWidth <= mid.clientWidth + 1) return;
    mid.querySelector<HTMLElement>('.tl-switch__item[aria-selected="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [view]);

  /* ═══ THE SWITCHER ROW'S OVERFLOW, SAID OUT LOUD ═══════════════════════════

     At 390px the row wants 623px: six group names are 377 of it and the Map
     group's seg — Borders / Habitation / Horizon — is another 190, so the seg sits
     entirely past the right edge. It cannot be made to fit: shortening the
     padding buys single-digit pixels against a 233px deficit, and the two real
     alternatives (hiding the seg, or hiding the group names behind icons) each
     delete a control to avoid admitting the row scrolls.

     So the row scrolls — and now it SAYS SO. It said nothing before: shell.css
     put an unconditional fade on the right edge, which on the Map view lands on
     22px of empty rail past "CORE" and is therefore invisible, and there was no
     other cue anywhere. A reader had no way to learn that three more controls
     existed 3px past the edge.

     Two changes, and this effect is the first: the row's real scroll state is
     published as `data-ovf` ("l", "r", or "l r"), which app.css uses to fade
     only the sides that actually run on and to reveal a chevron the reader can
     press. Measured rather than assumed — the widths move with the group (a
     one-member group has no seg at all), with the font, and with the viewport,
     so a media query could not know this. */
  const midRef = useRef<HTMLDivElement | null>(null);
  const [ovf, setOvf] = useState('');
  const readOvf = useCallback(() => {
    const el = midRef.current;
    if (!el) return;
    /* MEASURED AGAINST THE CONTENT, NOT THE SCROLL BOX. The naive test —
       scrollLeft > 0 — is wrong here, and visibly so: the row carries 12px of
       inline padding and `scroll-snap-align: start` on every switcher item, so
       the browser snaps the resting position to the FIRST ITEM'S left edge,
       which is scrollLeft 12 with nothing whatever hidden. Reading that as
       "scrolled" put a left chevron over the M of MAP on a freshly loaded page.
       So both ends are measured as how much CONTENT the padding boxes are
       hiding, which is zero at either rest position by construction. 2px of
       slack absorbs sub-pixel layout. */
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const l = el.scrollLeft - padL > 2;
    const r = (el.scrollWidth - padR) - (el.scrollLeft + el.clientWidth) > 2;
    setOvf(l && r ? 'l r' : l ? 'l' : r ? 'r' : '');
  }, []);
  useEffect(() => {
    const el = midRef.current;
    if (!el) return;
    readOvf();
    el.addEventListener('scroll', readOvf, { passive: true });
    // The row's own width AND its children's: the seg appears and disappears
    // with the group, which changes the overflow without resizing anything else.
    const ro = new ResizeObserver(readOvf);
    ro.observe(el);
    for (const kid of Array.from(el.children)) ro.observe(kid);
    return () => { el.removeEventListener('scroll', readOvf); ro.disconnect(); };
  }, [readOvf]);
  useEffect(() => { readOvf(); }, [view, readOvf]);

  /** The chevron's move: a screenful-ish of the row, in the direction pressed. */
  const nudgeRow = useCallback((dir: 1 | -1) => {
    const el = midRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(140, el.clientWidth * 0.6),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  // ═══ THE CENTRE-YEAR RULE ════════════════════════════════════════════════
  //
  // "when I move on the timeline the time changes always to be that at the
  // center of screen — when I move right or left the time (year) changes."
  //
  // So on the timeline the global moment IS the centre of the viewport, and it
  // follows the pan continuously rather than waiting for a click on the axis.
  // Implemented HERE, as an observer, for two reasons: timeline.ts is owned by
  // another agent this round, and — more permanently — the timeline should not
  // have to know that a global moment exists in order to be panned.
  //
  // NO FEEDBACK LOOP, by construction:
  //   · the flow is one-way, d0/d1 → TimeStore, and never back. Nothing that
  //     subscribes to TimeStore writes d0/d1: timeline.ts's subscriber is
  //     `() => this.paint()`, the map re-indexes its own snapshot, the card
  //     repaints. The one thing that CAN move the window from the year —
  //     ensureYearVisible() — runs on tab entry only, and cannot fire from a
  //     pan anyway: the centre of the window is by definition inside it.
  //   · TimeStore.set is a no-op when the rounded year is unchanged, so a
  //     still timeline publishes nothing at all;
  //   · and every publication is stamped 'tl' — the timeline's own source tag,
  //     the one the axis click already uses — so any future subscriber can
  //     recognise its own echo the way the map already does with 'map'.
  //     (shared.ts belongs to another agent this round, so the observer reuses
  //     the existing tag rather than minting a sixth one.)
  //
  // THROTTLE: at most one publication every CENTRE_MS, and only when the centre
  // has moved a whole year. The floor exists because each publication fans out
  // to a full TL.paint(), which the drag is already doing — 11/s of overlap is
  // invisible, 60/s would double the paint cost of every pan. There is no
  // trailing-edge problem: the loop keeps running after the gesture ends, so
  // the last centre is published within CENTRE_MS of the pan stopping.
  const CENTRE_MS = 90;
  const centreRef = useRef({ t: 0, y: NaN });

  useEffect(() => {
    settleChrome = () => { syncRail(); writeUrl(true); };
    return () => { settleChrome = null; };
  }, [syncRail, writeUrl]);

  // Renderers own their own state and emit no events, so the rail follows them
  // by watching. One rAF loop, four number reads, DOM touched only on change.
  useEffect(() => {
    if (!ready) return;
    let raf = 0, last = '', urlPending = false;
    const tick = () => {
      const v = viewRef.current;
      // the centre-year observer rides the rail's loop: same cadence, same
      // reads, and one rAF for the app instead of two
      if (v === 'zoom' || v === 'vertical') {
        const c = Math.round((TL.d0 + TL.d1) / 2);
        const st = centreRef.current;
        const now = performance.now();
        if (c !== st.y && now - st.t >= CENTRE_MS && Number.isFinite(c)) {
          st.t = now; st.y = c;
          TimeStore.set(c, 'tl');
        }
      } else {
        centreRef.current.y = NaN;     // off the timeline: forget the last centre
      }
      const key = (v === 'map' ? `m${WorldMap.ix}`
        : v === 'pop' ? `p${Pop.ix.toFixed(3)}`
          : v === 'horizon' ? `h${Horizon.year}`
            : v === 'flow' ? `f${Flow.d0}|${Flow.d1}`
              : v === 'braid' ? `b${Braids.religion.d0}|${Braids.religion.d1}`
                : v === 'ideology' ? `i${Braids.ideology.d0}|${Braids.ideology.d1}`
                  : v === 'conn' ? `c${Conn.d0}|${Conn.d1}`
                    : `t${TL.d0}|${TL.d1}|${TL.log}`)
        + `|${TimeStore.year}|${SelStore.id ?? ''}`   // the global stores nudge the rail too
        // …and so does the CURSOR, on the four span views whose index follows it.
        // Without this the rail would only notice the pointer when the window or
        // the selection happened to change underneath it, and the index would
        // lag a gesture behind the crosshair the canvas is already drawing.
        + `|${TL.hoverX ?? ''}|${VT.hoverY ?? ''}|${Flow.hoverX ?? ''}|${Conn.hoverX ?? ''}`;
      // THE TRAILING EDGE. writeUrl's throttle refuses a write inside 500ms of
      // the last one, and `key` goes still the moment a tween lands — so the
      // final state of every gesture that finished inside that window used to
      // be dropped. Now a refusal leaves the loop asking on each frame until it
      // is taken, which costs one URLSearchParams for the half-second after a
      // gesture and nothing at all while the app is still.
      if (key !== last) { last = key; syncRail(); urlPending = !writeUrl(); }
      else if (urlPending) urlPending = !writeUrl();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, syncRail, writeUrl]);

  /* ═══ THE RAIL IS A DRAG SURFACE ═════════════════════════════════════════

     "make it possible to drag bottom line. Cursor changes now but you cant
     drag."

     It really was only a cursor. The scale's drag surface was a transparent
     <input type=range> stretched over it, and on the three window views every
     one of its `input` events called TL.animTo() — a 650ms eased tween. Held
     down, that is sixty tweens a second, each starting from wherever the
     previous one had got to and re-targeting: they damp each other almost to a
     standstill, so the window creeps a few years and stops. What looked like a
     dead control was a control fighting itself.

     So the gesture is taken over properly. The whole scale is the surface, the
     pointer is CAPTURED on press, and every move writes the window DIRECTLY and
     repaints — no tween in the loop. A press that never moves still eases, via
     the same animTo: a jump of four millennia that teleports is unreadable,
     while a drag that eases is broken.

     The <input>s stay for the keyboard (they are the only reason the rail is
     operable without a mouse) but give up their pointer events in app.css, so
     there is exactly ONE thing handling the gesture. That also fixes a quieter
     lie: the map slider was a linear 0..17 index laid over a NON-linear scale,
     so dragging to the engraved 1492 stop landed on 1279. Everything now goes
     through railYear(), which is the same mapping the engraving is drawn with.
  */
  const railDrag = useRef<{ down: boolean; moved: boolean; y: number }>({ down: false, moved: false, y: 0 });

  /** The year under a client x on the scale, clamped to the scale's extent. */
  const railYearAt = (clientX: number): number | null => {
    const scale = document.getElementById('railScale');
    if (!scale) return null;
    const r = scale.getBoundingClientRect();
    if (!r.width) return null;
    return railYear(Math.max(0, Math.min(100, (clientX - r.left) / r.width * 100)));
  };

  /**
   * Move to a year. `live` is true while the pointer is down: the window is
   * written and painted directly, so it tracks the finger frame for frame.
   */
  const scrubTo = (y: number, live: boolean) => {
    const v = viewRef.current;
    if (v === 'map') {
      WorldMap.stop(); WorldMap.syncToYear(y); WorldMap.render();
      TimeStore.set((WorldMap as any).year(), 'map'); return;
    }
    if (v === 'pop') {
      const S = Pop.slices();
      if (!S.length) return;
      let best = 0;
      for (let i = 0; i < S.length; i++) if (Math.abs(S[i].year - y) < Math.abs(S[best].year - y)) best = i;
      Pop.stop(); Pop.ix = best; Pop.render(); return;
    }
    if (v === 'horizon') {
      const inp = document.getElementById('hzYear') as HTMLInputElement | null;
      if (inp) { inp.value = String(y); inp.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    const src: any = v === 'flow' ? Flow : v === 'braid' ? Braids.religion
      : v === 'ideology' ? Braids.ideology : v === 'conn' ? Conn : TL;
    const half = (Number(src.d1) - Number(src.d0)) / 2;
    // the same domain clamp-shift the wheel enforces — a rail grab near the
    // edge must not centre the window past YMIN/YMAX (defect: d1 landed at 4464)
    let a = y - half, b = y + half;
    if (b > YMAX) { a -= b - YMAX; b = YMAX; }
    if (a < YMIN) { b += YMIN - a; a = YMIN; }
    b = Math.min(b, YMAX);
    if (v === 'zoom' || v === 'vertical') {
      if (live) { TL.d0 = a; TL.d1 = b; TL.paint(); }   // paint() also drives the vertical projection
      else TL.animTo(a, b);
      return;
    }
    src.d0 = a; src.d1 = b;
    if (v === 'conn') Conn.dirty = true;
    src.render();
  };

  /* ═══ THE SEARCH DROPDOWN ════════════════════════════════════════════════

     "When searching add a dropdown with the listed options so that I can click
     them."

     The box has always dimmed the canvas to 12% and left you to FIND the lit
     ones — on a surface that at a five-thousand-year span is wider than the
     window. Dimming answers "how many"; it never answered "which", and it can
     never be clicked.

     So the same keystrokes now also fill a list. It is chrome, not canvas: it
     is drawn here, from search.ts, and timeline.ts is untouched — the box keeps
     its own input listener and its own dimming, and this one rides alongside on
     the same element. Two listeners, one input, no coordination needed.

     Choosing a row does the whole gesture at once: select it, clear the query
     (so the framing lands on a full world rather than on 12% of one), and frame
     it — the same frameTo path as the card's "Zoom to view", so the two ways of
     arriving at a thing agree about where they leave you.

     The list is FIXED-positioned against the box's rect rather than absolutely
     positioned inside the panel: .tl-panel__bd scrolls, and an absolute child
     of a scroll container is clipped by it. Same reasoning as the card and the
     tooltip, which are both out at document level for exactly this. */
  const SEARCH_CAP = 10;
  const LAYER_CAP = 4;
  const VIEW_CAP = 5;
  const [sRows, setSRows] = useState<SRow[]>([]);
  const [sTotal, setSTotal] = useState(0);          // content matches BEYOND the cap
  const [sSel, setSSel] = useState(0);
  const [sBox, setSBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const sOpen = sRows.length > 0 && !!sBox;
  const sRowsRef = useRef<SRow[]>([]);
  const sSelRef = useRef(0);
  useEffect(() => { sRowsRef.current = sRows; sSelRef.current = sSel; });

  const placeSearch = useCallback(() => {
    const box = document.getElementById('cmdk');
    if (!box) { setSBox(null); return; }
    const r = box.getBoundingClientRect();
    if (!r.width) { setSBox(null); return; }
    // hung off the FIELD, not the input inside it, so the list lines up with the
    // control the user can see
    const field = box.closest('.tl-field') as HTMLElement | null;
    const fr = field ? field.getBoundingClientRect() : r;
    // The list has a 320px floor, so on a phone — where the field is narrower
    // than that — hanging it off the field's left edge would push it off the
    // right of the screen. Clamp it into the window, the way the tooltip and
    // the layer popovers already do.
    const w = Math.max(fr.width, 320);
    setSBox({ left: Math.max(8, Math.min(fr.left, innerWidth - w - 8)), top: fr.bottom + 4, width: w });
  }, []);

  const closeSearch = useCallback(() => { setSRows([]); setSTotal(0); setSSel(0); }, [setSRows, setSTotal, setSSel]);

  /* ── EMPTYING THE FIELD IS ONE ACT, AND IT IS THIS ONE ─────────────────────
     "Search bar is missing X to remove contents of search."

     The ✕ and Escape-in-an-empty-list are the same gesture with two triggers,
     so they are one function rather than two that will drift. And it is three
     things, not one: a search leaves TEXT in the field, a LIST hanging under
     it, and a DIM on every canvas that matched nothing. Blanking only the input
     is the bug this exists to avoid — the founder's board would stay dimmed to
     12% by a query no longer written anywhere on screen.

     WHERE THEY DIFFER IS FOCUS, and only because the two gestures mean opposite
     things about the field: Escape is "I am done here", so it hands the field
     back to the page; pressing ✕ is "wrong words", so the caret stays where the
     right ones go. Nothing else about the two paths is allowed to differ.

     hasQ is the one piece of React state the uncontrolled input needs: the ✕
     may only exist while there is something to clear. timeline.ts still owns
     the input's own listener, so this reads box.value rather than holding it. */
  const [hasQ, setHasQ] = useState(false);
  const clearField = useCallback((keepFocus: boolean) => {
    const box = document.getElementById('cmdk') as HTMLInputElement | null;
    if (box) { box.value = ''; if (keepFocus) box.focus(); else box.blur(); }
    setHasQ(false);
    closeSearch();
    TL.clearSearch();
  }, [closeSearch]);


  /* THE LANE ROW'S GESTURE. Add-or-locate, and the difference is only whether
     the lane is already on the board — the founder's "I could also search for
     existing lane, which would just highlight it."

     The flash has to happen AFTER the panel has rebuilt: Layers.emit() runs
     LayerPanel.build(), which replaces every row element, so a class set before
     the add would be thrown away with the node it was on. And the panel only
     exists on the horizontal timeline, so a lane row also navigates there —
     locating a lane on a view that has no lanes is not locating anything. */
  const flashLayer = useCallback((id: string) => {
    // AND A CLOSED PANEL HAS NO ROWS AT ALL. "Locate it in the panel" has to
    // put the panel back first, or the loop below spends 40 frames looking for
    // a row with no height and gives up without a word — which is exactly what
    // this did on a phone before the switch existed, every time.
    LayerPanel.setOpen(true);
    // A COLLAPSED GROUP HAS NO ROW TO FLASH. layerpanel.ts skips a collapsed
    // group's children entirely (the lanes still draw — collapsing is a panel
    // gesture, not a visibility one), so "find it in the panel" has to open the
    // group first or there is nothing in the panel to find.
    const g = Layers.groupOf(id);
    if (g && g.collapsed) Layers.collapse(g.id);
    const find = () => document.querySelector(`.tl-lrow[data-lid="${CSS.escape(id)}"]`) as HTMLElement | null;
    const bring = () => { const r = find(); if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    let tries = 0;
    const tick = () => {
      const row = find();
      // the panel is React's to mount and layerpanel.ts's to fill; on a view
      // change neither has happened yet, so give it a few frames before giving up
      if (!row || !row.clientHeight) { if (tries++ < 40) requestAnimationFrame(tick); return; }
      bring();
      row.classList.remove('is-found');
      void row.offsetWidth;                        // restart the animation on a re-locate
      row.classList.add('is-found');
      // AND AGAIN WHEN IT HAS FINISHED OPENING. A lane does not arrive at its
      // full height — the slew limiter walks it open over about half a second,
      // so the row we just scrolled to was 20px tall and grew to 90 underneath
      // us, back off the bottom of the window. `nearest` moves the least it can,
      // which means the first call did nothing at all once the lane was taller.
      // The second call is against the settled geometry.
      setTimeout(bring, 750);
      setTimeout(() => { const r = find(); if (r) r.classList.remove('is-found'); }, 1600);
    };
    requestAnimationFrame(tick);
  }, []);

  /**
   * ═══ GO TO A SUBJECT — THE ONE IMPLEMENTATION ═══════════════════════════
   *
   * Three controls used to answer "put that thing on the timeline" and only one
   * of them was right. The SEARCH earned its frame first — planReveal, then
   * reveal, then select and frame — while the selection card's Connections rows
   * and its own Timeline cell just wrote the selection and hoped. Click
   * Confucius ▸ Daoism and you got a card for Daoism with nothing lit anywhere:
   * a selection pointing at something invisible. Founder: "when I click
   * Confucius - Daoism and daoisms lane isnt showed up we need to somehow
   * present that daoism is in lane that is not here."
   *
   * So there is now one function and every one of them calls it. In order:
   *
   *   1. PLAN against the board as it is now (never against a stale plan).
   *   2. REVEAL — add the lane and raise its dial, in one emit.
   *   3. only then select, frame and go.
   *   4. and if the board moved, SAY SO. Saying so is the whole of step 4:
   *      the founder — "get rid of the undo - you can just remove the lane if
   *      you like" — and he is right, because the lane the notice names is
   *      flashed in the panel a few pixels away with its own × on it.
   *
   * `to` is which timeline projection to land on: the vertical one when the
   * reader is already standing there, horizontal otherwise. `from` is the
   * card's own placement question — did the reader point at anything.
   *
   * A `never` plan cannot arrive here, and it is neither caller's afterthought:
   * the search plans first and routes a belief stream to Beliefs instead, and
   * the card's Timeline cell is drawn SHUT for a subject no lane can draw. If
   * one ever did arrive, the guard below frames nothing — the phantom zoom
   * stays impossible whichever way the mistake is made.
   */
  const goToSubject = useCallback((id: string, to: ViewId = 'zoom', from: SelSource = 'point') => {
    const sub = describe(id);
    if (!sub) return;
    const plan = planReveal(id);
    if (plan.need === 'never') return;                 // frame nothing
    const moved = reveal(plan);
    TL.clearSearch();                                  // frame a full world, never 12% of one
    // A REVEAL MEANS YOU POINTED AT NOTHING. selcard.ts's two placements ask
    // one question — was the reader LOOKING at the thing? — and when the lane
    // had to be added or turned up, the answer is no: a moment ago
    // there was nothing on the canvas to look at. So the card parks in its one
    // learnable corner, exactly as it does after a search, instead of appearing
    // beside a mark that has just this instant been drawn somewhere the reader
    // was not looking. It also keeps the card out of the notice explaining it.
    SelCard.select(id, null, null, moved ? 'search' : from);
    const [a, b] = perspectiveSpan(sub);
    frameSettled(a, b);
    go(to);
    if (moved && plan.layer) {
      flashLayer(plan.layer);                          // …and locate the lane it took
      setNotice({ text: didLine(plan), n: ++noticeN });
    } else setNotice(null);                            // nothing changed, nothing to say
  }, [go, flashLayer]);
  useEffect(() => { showTlRef.current = (id: string) => goToSubject(id, 'zoom', 'point'); }, [goToSubject]);


  /* THE NOTICE LEAVES ON ITS OWN. Twelve seconds, restarted by each new one —
     long enough to read a line and look at what changed on the board, short
     enough that it is not furniture. The × is the way out before then; there is
     no way to bring it back, because it is a remark about a change you just
     watched happen, not a history. */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(t);
  }, [notice]);

  /* AND THE CARD RE-MEASURES WHEN IT ARRIVES OR LEAVES. The card is shown by
     the same call that sets the notice, so it is placed one React commit before
     the notice exists — and the notice is one of the rects it refuses to cover
     (selcard.ts panelRects). Its ResizeObserver cannot help: it observes nodes,
     and this node was not there to observe. placeSoon() is the settle the card
     already runs after a view switch, for the identical reason. */
  useEffect(() => { if (SelCard.open) SelCard.placeSoon(); }, [notice]);

  /**
   * REVEAL IT WHERE THE READER IS STANDING, or say where it had to go.
   *
   * Returns the landing for a content hit taken from `here`, or null when
   * nothing anywhere can draw the thing (a belief stream searched from Habitation:
   * the timeline does not draw beliefs and Habitation does not draw one thing).
   *
   * READ TOP TO BOTTOM AS "CAN HERE DO IT?", then the fallback. Every branch
   * ends in the same two acts in the same order — put the selection in the
   * store, then move the view's own window onto it — because the selection is
   * global and every renderer in the app already lights whatever is selected.
   * That is why flow and the cube need no new API at all: cube.ts traces on a
   * 'polity:*' store write, flow.ts's localSel() lights the matching ribbon.
   */
  const landingFor = useCallback((here: ViewId, sub: Subject, plan: RevealPlan,
    from: SelSource = 'search'): Landing | null => {
    const id = sub.id;
    // (The span used to be read here for the Connections branch's own framing.
    // That framing moved into showInConnections(), which the card's cell shares,
    // so this function no longer measures anything itself.)
    const pid = sub.polity;
    const onTimeline = plan.need !== 'never';

    /* THE FALLBACK, AND A DESTINATION IN ITS OWN RIGHT — and not one line of
       its own any more. Earn the frame first (reveal() adds the layer and
       raises its dial), only then select and frame, and scroll the
       panel row into view when the board actually changed: that is
       goToSubject(), which the selection card now calls for the identical
       move. One behaviour, one implementation, so the search and a relation
       click cannot drift apart again. */
    const toTimeline = (to: ViewId): Landing => ({
      view: to,
      act: () => goToSubject(id, to, from),
    });

    switch (here) {
      // THE MAP travels through time to reach it — the card's own act, so the
      // "not drawn at 1783, go to 500 BCE where its borders first appear" rule
      // is the identical rule in both places rather than a second one here.
      case 'map':
        if (destOpen(sub, 'map')) {
          return { view: 'map', act: () => { SelCard.select(id, null, null, from); SelCard.act('map'); } };
        }
        break;
      // THE CUBE never has a "not now": it traces the whole life as a solid.
      case 'cube':
        if (destOpen(sub, 'cube')) {
          return { view: 'cube', act: () => { SelCard.select(id, null, null, from); SelCard.act('cube'); } };
        }
        break;
      // FLOW lights the ribbon off the global selection and frames its span.
      // setQuery('') first: a leftover filter would dim the very ribbon this
      // gesture exists to show.
      case 'flow':
        // The card's own "is there a ribbon behind this door" verdict, so the
        // search row and the card's Flow cell can never disagree about the same
        // polity on the same screen. showInFlow carries the rest of the
        // contract, including turning a hidden region back on.
        if (pid && destOpen(sub, 'flow')) {
          return { view: 'flow', act: () => { Flow.setQuery(''); showInFlow(pid); } };
        }
        break;
      // BELIEFS is not a case any more. It used to answer only for the system
      // currently showing, which made "the Beliefs view draws these" true of
      // the app and false of the canvas — a stream from the other system fell
      // through to a dead row. The fallback below answers for BOTH systems and
      // for every view, so the one place that knows where a belief goes is the
      // one place, and standing on Beliefs is no longer a precondition.
      // CONNECTIONS DRAWS THINGS, and this case is the whole of that admission.
      // It used to be missing, which is why a relation clicked on Connections
      // offered to show it in the Timeline — over the very ribbon it was named
      // after. connShown() decides whether this canvas has the subject and under
      // which name (see it, above), and showInConnections() is the same call the
      // card's own Connections cell makes, so the two can never drift.
      case 'conn':
        if (connShown(id)) return { view: 'conn', act: () => showInConnections(id, from) };
        break;
      // THE VERTICAL PROJECTION is the same timeline and the same window, so it
      // stays where it is rather than being flipped to horizontal underneath
      // the reader.
      case 'vertical':
        if (onTimeline) return toTimeline('vertical');
        break;
      case 'zoom':
        if (onTimeline) return toTimeline('zoom');
        break;
      // Habitation, the information horizon and Concepts draw no single named
      // thing. Nothing to try — fall through to the timeline.
      default: break;
    }
    // A BELIEF STREAM IS NOT A DEAD END. This USED to call showInBeliefs()
    // itself — a route hand-wired here, past the card, for one class of
    // subject. It goes through the card's own destination now, exactly as the
    // map and cube cases above do (select, then act), so there is one
    // implementation of "put this stream on braid" and the search row and the
    // card's Beliefs cell cannot disagree about the same stream. destOpen is
    // the card's verdict, and the card's verdict is that a stream is drawn.
    // It navigates on its own, unlike the cases above: those only ever fire
    // when the landing IS the view you are standing on, and this one fires from
    // anywhere — including the timeline, where the row would otherwise be dead.
    // The card's one Beliefs act lands on whichever of the two belief views
    // holds the stream, so the view named here is read the same way the act
    // itself reads it — never assumed to be the religions one.
    if (destOpen(sub, 'braid')) {
      return {
        view: beliefView(id) ?? 'braid',
        act: () => { SelCard.select(id, null, null, from); SelCard.act('braid'); },
      };
    }
    return onTimeline ? toTimeline('zoom') : null;
  }, [goToSubject]);

  /**
   * ═══ TAKE ME TO THAT SUBJECT — answered from where the reader is standing ═══
   *
   * The card's Connections list and the docked "All N" list both mean this, and
   * both used to mean SelStore.set() and nothing else: a card for Daoism with
   * nothing lit anywhere. This routes them through landingFor() — the same
   * function that decides where a search result lands — so a related empire
   * clicked on the map highlights ON THE MAP, a related event clicked on the
   * timeline reveals its lane and frames, and one rule covers both lists.
   *
   * WITH ONE RULE OF ITS OWN: IT NEVER TELEPORTS. A search row says "shown on
   * Beliefs" in its own second line before you press it; a row in a list of
   * names says nothing, so a view switch out of it would be a surprise. When
   * the landing is not the view you are on, this SELECTS and SAYS SO, and the
   * going is left to the card — which opens on the same call, and whose
   * destination row now reaches every view there is. The notice used to carry
   * its own [Show in …] button; the founder: "Remove the 'Show in Beliefs' -
   * instead the card should be able to reach ALL the views." One control, in
   * the place the reader already looks for controls, for both of the ways a
   * subject can be missing from the screen they are looking at:
   *
   *   NOT DRAWN HERE     an event on the map, an empire on Connections
   *   NOT DRAWN AT ALL   a belief stream on the timeline — planReveal says
   *                      `never`, and the card's Beliefs cell is lit
   */
  const goHere = useCallback((id: string) => {
    const sub = describe(id); if (!sub) return;
    const here = viewRef.current;
    const plan = planReveal(id);
    const land = landingFor(here, sub, plan, 'point');
    if (land && land.view === here) { land.act(); return; }

    // Selected either way: the card is the reader's answer to "what is that",
    // and it is a true answer whether or not this canvas can draw the thing.
    SelCard.select(id, null, null, 'point');
    const why = plan.need === 'never' && plan.why ? plan.why : `not drawn on ${VIEWS[here].seg}`;
    setNotice({
      text: land
        ? `${sub.name} is ${why} — the card can show it in ${destWord(land.view)}`
        : `${sub.name} is ${why}, and no other view draws it either`,
      n: ++noticeN,
    });
  }, [landingFor]);
  useEffect(() => { goToRef.current = goHere; }, [goHere]);

  /* ── "ALL N →" IS THE SAME LIST, SO IT IS THE SAME GESTURE ─────────────────
     The card shows the top four connections; "All 23 →" opens the docked
     Related panel with the whole ranked list. Same neighbourhood, same click,
     same reader — but the panel is drawn by relations.ts, which is shared with
     the Connections view and whose row handler writes SelStore directly. So a
     row in the card's four revealed the lane and a row in the same subject's
     full list did not, which is the bug this pass exists to kill, one control
     further along.

     Intercepted rather than reimplemented: relations.ts binds its handler on
     this same element in the BUBBLE phase, so a CAPTURE listener here sees the
     click first and stopPropagation() keeps the old one from also firing. The
     panel keeps its markup, its ranking and its Wikipedia link; only what a row
     MEANS changes, and it now means what a row in the card means. */
  useEffect(() => {
    const el = document.getElementById('tlRelPanel');
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      const row = (e.target as HTMLElement | null)?.closest?.('.relrow') as HTMLElement | null;
      const id = row?.dataset.id;
      if (!id) return;
      e.stopPropagation();
      goHere(id);
    };
    el.addEventListener('click', onDown, true);
    return () => el.removeEventListener('click', onDown, true);
  }, [goHere]);

  /**
   * ONE QUERY, TWO KINDS OF ANSWER.
   *
   * Content comes from search.ts (the same corpus the canvas dims); views come
   * from the VIEWS table, which only this file has. They are ranked as one list
   * with content first — because "what happened" is the question this app is
   * for, and the ten views are a fixed set the user learns once.
   *
   * The exception is a query that NAMES a view outright — "cube", "connections",
   * "horizon", whatever is written on the rail. Someone who typed the whole word
   * is navigating, and making them arrow past ten empires to reach the view they
   * just named would be the wrong default.
   *
   * It has to be the WHOLE word, not a prefix. "empire" is a prefix of the
   * Empires seg, and it also matches sixty-six empires in history — putting the
   * view above them because of a shared stem gets the common case backwards.
   * "cubism" is not a view at all, and leads with the movement either way.
   */
  const buildRows = useCallback((raw: string): { rows: SRow[]; total: number } => {
    const q = raw.trim().toLowerCase();
    if (q.length < 2) return { rows: [], total: 0 };
    const { hits, total } = searchCorpus(raw, SEARCH_CAP);
    const layers = searchLayers(raw, LAYER_CAP);
    const views = ORDER.filter(v => {
      const m = VIEWS[v];
      return (m.name + ' ' + m.seg + ' ' + m.gist).toLowerCase().includes(q);
    }).slice(0, VIEW_CAP);
    const navFirst = views.some(v => {
      const g = GROUPS.find(gr => gr.members.includes(v));
      return VIEWS[v].seg.toLowerCase() === q
        || VIEWS[v].name.toLowerCase() === q
        || (g ? g.label.toLowerCase() === q : false);       // the word on the rail
    });
    // A LANE'S OWN NAME LEADS. "Literature" is not an ambiguous word in this
    // app — it is a lane, and one of the four literary movements inside it is
    // not what was asked for. Anything softer than an exact-ish name match
    // (search.ts's tier 0) is a hint, and hints go under the content.
    const laneFirst = layers.some(l => l.lead);
    /* EACH HIT IS PLANNED AGAINST THE VIEW YOU ARE ON, here, once per keystroke.
       The row has to know its destination before it is pressed — that is what
       lets it say "shown on Cube" and what decides whether it is a choice at
       all — and the answer is cheap: describe() and planReveal() are table
       lookups, and the card's dests() is only consulted on the two views that
       ask for it. takeRow re-plans from scratch when the row is actually taken,
       because the board may have moved since. */
    const cRows: SRow[] = hits.map(h => {
      const p = planReveal(h.id);
      const sub = describe(h.id);
      return { k: 'c', h, p, to: sub ? (landingFor(view, sub, p)?.view ?? null) : null };
    });
    const lRows: SRow[] = layers.map(l => ({ k: 'l', l }));
    const vRows: SRow[] = views.map(v => ({ k: 'v', v }));
    const body = laneFirst ? [...lRows, ...cRows] : [...cRows, ...lRows];
    return {
      rows: navFirst ? [...vRows, ...body] : [...body, ...vRows],
      total: total - hits.length,
    };
  }, [landingFor, view]);


  /**
   * TAKE A ROW — and on the content branch, EARN THE FRAME FIRST.
   *
   * The founder: "Make sure its impossible to zoom in on something that does
   * not exist." So the order here is not decoration, it is the whole fix:
   *
   *   1. re-plan against the board AS IT IS NOW (the row was built a few
   *      keystrokes ago, and the reader may have changed the board since), and
   *      against the view as it is now;
   *   2. if nothing anywhere can draw it, do nothing at all — no selection, no
   *      frame. The row is disabled in the markup too, so this is a second lock
   *      on a door that is already bolted;
   *   3. inside the timeline branch, reveal() — add the layer, raise its
   *      dial, whatever the verdict said, in ONE emit;
   *   4. only now select and frame.
   *
   * Nothing between 3 and 4 can fail: reveal() has already made Layers.has and
   * passesDetail both true for the layer that draws it.
   */
  const takeRow = useCallback((r: SRow) => {
    if (r.k === 'c' && r.to === null) return;            // the door is bolted here too
    closeSearch();
    const box = document.getElementById('cmdk') as HTMLInputElement | null;
    if (box) { box.value = ''; box.blur(); }
    // Any dim comes off BEFORE anything else happens, on every branch: the
    // framing has to land on a full world rather than on 12% of one, and a row
    // that navigates to a VIEW would otherwise leave the timeline dimmed by a
    // query the reader can no longer see in the (now empty) field.
    TL.clearSearch();

    if (r.k === 'v') { go(r.v); return; }

    if (r.k === 'l') {
      if (!Layers.has(r.l.id)) Layers.add(r.l.id);       // add-as-a-lane
      go('zoom');                                        // the lanes live here
      flashLayer(r.l.id);                                // …and locate it either way
      return;
    }

    // WHERE IT LANDS IS DECIDED AGAINST THE VIEW YOU ARE ON, not against the
    // timeline. landingFor() carries the whole rule and the whole fallback; the
    // layer work, the framing and the panel-row flash all live inside the
    // branch that needs them (only the timeline family does).
    const sub = describe(r.h.id);
    const land = sub ? landingFor(view, sub, planReveal(r.h.id)) : null;
    if (!land) return;                                   // drawable nowhere — do nothing
    land.act();
  }, [closeSearch, landingFor, view, go, flashLayer]);

  // The box is markup this file owns but timeline.ts wires; these listeners are
  // additional, never replacements, so nothing about the dimming changes.
  useEffect(() => {
    if (!ready) return;
    const box = document.getElementById('cmdk') as HTMLInputElement | null;
    if (!box) return;

    const onInput = () => {
      setHasQ(!!box.value);
      const { rows, total } = buildRows(box.value);
      setSRows(rows); setSTotal(total); setSSel(firstSel(rows));
      if (rows.length) placeSearch(); else setSBox(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      const k = ev.key;
      if ((k === 'k' || k === 'K') && (ev.metaKey || ev.ctrlKey)) return;   // ⌘K refocuses
      const rows = sRowsRef.current;
      if (k === 'Escape') {
        // Escape in the field closes the LIST first and gives the field up
        // second — two meanings, in the order a person expects them. The
        // selcard's global handler refuses to act on an input either way, so
        // the selection and the map highlight are never collateral.
        ev.stopPropagation();
        if (rows.length) { ev.preventDefault(); closeSearch(); }
        // Emptying the field has to empty the QUERY as well, or the canvas is
        // left dimmed to 12% by a search whose text is no longer anywhere on
        // screen — a dim with nothing to explain it. Same path as the ✕, which
        // is the whole reason clearField() exists.
        else clearField(false);
        return;
      }
      if (!rows.length) return;
      if (k === 'ArrowDown') { ev.preventDefault(); setSSel(i => stepSel(rows, i, 1)); }
      else if (k === 'ArrowUp') { ev.preventDefault(); setSSel(i => stepSel(rows, i, -1)); }
      else if (k === 'Enter') {
        ev.preventDefault();
        const pick = rows[sSelRef.current] || rows[firstSel(rows)];
        if (pick && canTake(pick)) takeRow(pick);
      }
    };
    const onFocus = () => { if (box.value.trim().length >= 2) onInput(); };
    const onBlurOut = (ev: FocusEvent) => {
      // a click on a row is a mousedown that never blurs (the row prevents it),
      // so any real blur means the field has genuinely been left
      const to = ev.relatedTarget as HTMLElement | null;
      if (to && to.closest('.tl-sugg')) return;
      closeSearch();
    };
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKey);
    box.addEventListener('focus', onFocus);
    box.addEventListener('blur', onBlurOut);
    return () => {
      box.removeEventListener('input', onInput);
      box.removeEventListener('keydown', onKey);
      box.removeEventListener('focus', onFocus);
      box.removeEventListener('blur', onBlurOut);
    };
  }, [ready, placeSearch, closeSearch, takeRow, buildRows, clearField]);

  // The list hangs off a rect, so anything that moves the rect moves it too.
  useEffect(() => {
    if (!sOpen) return;
    const onMove = () => placeSearch();
    addEventListener('resize', onMove);
    return () => removeEventListener('resize', onMove);
  }, [sOpen, placeSearch]);

  /* THE LIST DOES NOT SURVIVE A NAVIGATION. The field is global chrome, but a
     dropdown hanging under it after the view has changed underneath is a list
     of answers to a question the reader has moved on from.

     Closed at the three places a view can change while the list is up, rather
     than in an effect on `view`: takeRow closes it before it navigates, the
     header's switch and seg close it below, and any click outside the list
     blurs the field, which closes it too. (An effect that calls setState
     synchronously on every view change is a cascading render for a state that
     is empty 99% of the time — and React's own lint rule says so.) */
  const leaveSearch = useCallback((v: ViewId) => { closeSearch(); setView(v); }, [closeSearch]);

  const railMode = () => VIEWS[viewRef.current].rail;

  const onRailDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = railMode();
    if (m === 'off' || m === 'legend') return;          // the cube's rail is a legend
    const y = railYearAt(e.clientX); if (y === null) return;
    e.preventDefault();
    railDrag.current = { down: true, moved: false, y };
    // capture so the gesture survives the pointer leaving the 64px rail — which
    // it does constantly, because the useful direction is horizontal and the
    // hand drifts. try/catch: a synthetic or already-released pointer id throws
    // InvalidStateError, and losing the capture must not lose the drag.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* uncaptured, still dragging */ }
    // NOTHING MOVES ON THE PRESS. The eased jump belongs to a CLICK, and a
    // click is not known to be one until the pointer comes up without having
    // travelled — start the tween here and the next 650ms of a drag are spent
    // fighting it. (Measured: a drag that ended at 1500 settled at 1538 as the
    // press's tween finished on top of it.)
  };
  const onRailMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = railDrag.current;
    if (!g.down) return;
    const y = railYearAt(e.clientX); if (y === null) return;
    if (!g.moved && y === g.y) return;                  // jitter inside one year is not a drag
    g.moved = true;
    scrubTo(y, true);                                   // continuous, written straight through
  };
  const onRailUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = railDrag.current;
    if (!g.down) return;
    railDrag.current = { down: false, moved: false, y: 0 };
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* never captured */ }
    if (!g.moved) {
      const y = railYearAt(e.clientX);                  // a click: now it can ease
      if (y !== null) scrubTo(y, false);
    }
  };

  // The keyboard path. The range inputs keep their arrow keys — they are the
  // only way to operate the rail without a pointer — and land on the same code.
  const onRailRange = (e: React.FormEvent<HTMLInputElement>) => {
    if (railDrag.current.down) return;                  // the pointer owns the gesture
    const y = railYear(+(e.currentTarget.value) / 10);
    scrubTo(y, false);
  };

  const step = (d: number) => {
    const v = viewRef.current;
    if (v === 'map') { WorldMap.stop(); WorldMap.ix = Math.max(0, Math.min(17, WorldMap.ix + d)); WorldMap.render(); TimeStore.set((WorldMap as any).year(), 'map'); }
    else if (v === 'pop') {
      const n = Pop.slices().length;
      Pop.stop(); Pop.ix = Math.max(0, Math.min(n - 1, Math.round(Pop.ix) + d)); Pop.render();
    } else if (v === 'horizon') {
      const inp = document.getElementById('hzYear') as HTMLInputElement | null;
      if (inp) { inp.value = String(Horizon.year + d); inp.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  };


  /* THE EXIT, LANDED — TWICE, AND THE SECOND ONE IS NOT BELT AND BRACES.
     data-anim flips to "out" on the same frame the reader closes it, shell.css
     §10 plays the 120ms leave, and something then has to take the element out
     of the layout.

     animationend is the precise answer and it is not a reliable one. A CSS
     animation only runs while the page is being RENDERED: in a background tab,
     an occluded window or a throttled one it never starts, so its end event
     never arrives — the same class of failure frameSettled() exists to survive,
     and it was reproduced here in a browser pane that had been hidden. The
     popover then sits at opacity 0 with fill-mode `both`, invisible and still
     mounted, holding pointer events over the top-right corner of the stage —
     which is where Controls now lives. An animation that did not run must not
     be able to eat the instrument.

     So a timer is the authority and animationend is the early-out. Timers are
     clamped in a background tab but they do run, which is exactly the property
     that is wanted. 240ms is the 120ms leave with room to spare; landing late
     costs nothing, because the thing is already invisible by then.
     (shell.css also takes the pointer events away for the same duration, so
     even a stuck exit cannot block a click.) */
  const onNotesAnimEnd = useCallback(() => { setNotesVis(o => (notesOpen ? o : false)); }, [notesOpen]);
  useEffect(() => {
    if (notesOpen || !notesVis) return;
    const t = setTimeout(() => setNotesVis(false), 240);
    return () => clearTimeout(t);
  }, [notesOpen, notesVis]);

  // ── theme: system → dark → light → system ─────────────────────────────────
  const cycleTheme = () => {
    const el = document.documentElement;
    const cur = el.getAttribute('data-theme');
    const next = cur === null ? 'dark' : cur === 'dark' ? 'light' : null;
    if (next) { el.setAttribute('data-theme', next); try { localStorage.setItem('tl-theme', next); } catch { /* ignore */ } }
    else { el.removeAttribute('data-theme'); try { localStorage.removeItem('tl-theme'); } catch { /* ignore */ } }
  };

  /* THE PLACEHOLDER IS SHORTER ON A FINGER, because the type is bigger there.
     iOS zooms the whole page in when a sub-16px field takes focus, so app.css
     §1 forces 16px on coarse pointers — and 16px "Search anything…" measures
     130px inside an 89px input at an iPad's portrait width, which renders as
     "Search anytl" and reads as a broken layout rather than as a hint. The
     field itself cannot simply grow: .tl-app's one grid column is max-content
     and a rigid field pushes the right-hand end of the rail off the clip (see
     the note beside the markup). So the WORDS step down instead of the box.

     Set from an effect rather than in the JSX: matchMedia does not exist during
     the server render, and a placeholder that differs between the two passes is
     a hydration mismatch. */
  useEffect(() => {
    const box = document.getElementById('cmdk') as HTMLInputElement | null;
    if (!box) return;
    // …AND ON ANY NARROW WINDOW, not only a coarse one. Below 760px the field is
    // 124px wide whatever is pointing at it, and "Search anything…" renders as
    // "Search anytl" — which reads as a broken layout rather than as a hint.
    // Re-read on resize, because the field crosses that width by being dragged
    // as often as by being loaded.
    const set = () => {
      box.placeholder = matchMedia('(pointer: coarse), (max-width: 759px)').matches
        ? 'Search…' : 'Search anything…';
    };
    set();
    addEventListener('resize', set);
    return () => removeEventListener('resize', set);
  }, []);

  // ── ⌘K ────────────────────────────────────────────────────────────────────
  // It used to open a modal palette. There is no modal any more — the shortcut
  // puts the cursor in the one field, selecting whatever is already there so a
  // second query replaces the first without a trip to the delete key.
  const focusSearch = () => {
    const box = document.getElementById('cmdk') as HTMLInputElement | null;
    if (!box) return;
    box.focus(); box.select();
    if (box.value.trim().length >= 2) box.dispatchEvent(new Event('input', { bubbles: true }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); focusSearch(); return; }
      /* ONE ESCAPE OWNER IN THIS FILE, NOT TWO. The card takes Escape in the
         capture phase and stands down while a modal is open (selcard.ts
         modalOpen, which now names the mark menu as well as the field notes),
         so this branch is the whole of "close the thing that is open" — and it
         closes the SMALLEST thing first. The menu is a popover over the notes,
         never under them, so a reader with both open means the menu. Focus goes
         back to whatever was pressed to open it, in both cases. */
      if (e.key === 'Escape') {
        if (markOpen) { setMarkOpen(false); document.getElementById('markBtn')?.focus(); }
        else if (notesOpen) { setNotesOpen(false); document.getElementById('notesBtn')?.focus(); }
        return;
      }
      if (typing) return;
      if (e.key === '?') { e.preventDefault(); openNotes(true); return; }
      const m = VIEWS[viewRef.current].rail;
      if (m !== 'live') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === ' ') {
        e.preventDefault();
        const v = viewRef.current;
        if (v === 'map') { if (WorldMap.playing) WorldMap.stop(); else WorldMap.play(); }
        if (v === 'pop') { if (Pop.playing) Pop.stop(); else Pop.play(); }
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /* A CLICK ANYWHERE ELSE SHUTS THE MARK MENU. Every other popover in the app
     closes this way and a menu that did not would be the one thing on screen
     you have to dismiss on purpose. `pointerdown`, not `click`, so it goes
     before whatever was pressed rather than after it, and only while the menu
     is actually open — a listener that spends the whole session waiting for a
     menu nobody has opened is a cost with no reader behind it. The trigger is
     inside `.tl-mark`, so pressing it again toggles through its own handler
     rather than being closed here and reopened. */
  useEffect(() => {
    if (!markOpen) return;
    const away = (ev: PointerEvent) => {
      if (!(ev.target as HTMLElement | null)?.closest?.('.tl-mark')) setMarkOpen(false);
    };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [markOpen]);

  // ── derived flags ─────────────────────────────────────────────────────────
  const railOn = meta.rail !== 'off';
  const scaleCell = meta.rail === 'live'
    ? (view === 'map' ? 'yearSlider' : view === 'pop' ? 'popSlider' : 'railRange')
    : meta.rail === 'span' ? 'railRange' : 'none';
  const yearCell = view === 'map' ? 'map' : view === 'pop' ? 'pop' : 'rail';

  // THE HEADER CARRIES THE SIX GROUPS AND GLOBAL CHROME, NOTHING ELSE.
  //
  // "Flow still has the ugly Empires - Beliefs - should be in controls!"
  //
  // It was the last of three sub-switchers and the argument had already been
  // made twice. The Timeline group's seg (Vertical | Horizontal) came out of
  // the header two rounds ago and became the "Projection" row of Controls,
  // because two drawings of one state is a control of the view rather than a
  // way to another one. Flow's is the same object: Empires and Beliefs are one
  // ribbon engine, one span, one selection, one set of regions, drawn over two
  // corpora. So is Map's — Borders, Habitation and Horizon are three readings of
  // one atlas at one moment, and the rail already says you are in MAP.
  //
  // So EVERY group with siblings now states them the same way, as the first
  // row of Controls, and the header is left with exactly one level: which of
  // the six groups am I in. The breadcrumb chevron went with the seg — with
  // nothing to point at, it was pointing at the fade.
  //
  // NOT THE TOP OF THE LAYER PANEL, the other candidate: every row in that
  // panel is positioned from the canvas's own lane geometry, every frame, and a
  // control row would be the one element in it with a height of its own —
  // against the 0.000px lock the whole panel is built on. It is also absent in
  // the vertical projection, which would make the switch a one-way door.
  //
  // THE ROW ITSELF, BUILT ONCE. Three groups have siblings — Timeline, Map and
  // Flow — and Connections, Cube and Concepts have none, so this returns null
  // for them and their Controls simply opens on its own first row. The label is
  // the group's own word off GROUPS, so the row can never drift from the tab
  // that leads to it, and `leaveSearch` is the same gesture the header tabs
  // use: close the suggestion list, then move.
  const groupSeg = (): React.ReactNode => {
    if (members.length < 2) return null;
    const timeline = group === 'g-time';
    return (
      /* THE MASTHEAD WEARS THE GROUP'S NAME ON EVERY GROUP, and this row used to
         be the exception: the Timeline group's read "Projection" while Map's read
         "Map" and Flow's read "Flow". One word for one thing — the cube's
         Perspective/Isometric switch is the only "Projection" in the app now, it
         lives in HOW IT IS DRAWN where a statement about the drawing belongs, and
         a reader crossing views no longer meets the word in two different slots
         meaning two different things. The buttons still say Vertical and
         Horizontal, and the assistive labels still say "projection", so nothing
         about what this row DOES has changed. */
      <div className="tl-field-group">
        <span className="tl-label">{groupLabel}</span>
        <div className="tl-seg" id={timeline ? 'projSeg' : 'viewSeg'} role="group"
          aria-label={timeline ? 'Projection' : `${groupLabel} views`}>
          {members.map(m => (
            <button key={m} className="tl-seg__item" aria-pressed={m === view}
              aria-label={timeline ? `${VIEWS[m].seg} projection` : `${VIEWS[m].seg} — ${VIEWS[m].name}`}
              title={timeline
                ? `Draw the same timeline ${m === 'vertical' ? 'down the page' : 'across the page'}`
                : VIEWS[m].gist}
              onClick={() => leaveSearch(m)}>
              {VIEWS[m].seg}
            </button>
          ))}
        </div>
      </div>
    );
  };
  // The engraving on the scale: the 18 world snapshots for Map and Cube, the
  // population slices for Habitation, nothing for the span views (they get a bracket).
  const stopYears: number[] =
    meta.rail === 'legend' || view === 'map' ? SNAPSHOTS
      : view === 'pop' && ready ? (Pop.slices() as any[]).map(s => s.year)
        : [];

  const sect = (id: ViewId) => ({
    className: 'tl-view', id: `tab-${id}`, 'data-view': id,
    'data-active': String(view === id), role: 'tabpanel' as const,
  });
  const panel = (corner: string, forViews: ViewId[], title: string, extra?: string) => ({
    className: `tl-panel tl-panel--${corner}${extra ? ' ' + extra : ''}`,
    'data-panelfor': forViews.join(' '),
    // WHICH PANEL THIS CHEVRON OWNS — read off the TITLE, not off the corner.
    // Controls and Reading are the only two collapsible objects in the app and
    // each answers to its own switch; every other panel in either column
    // ("Related", "In transit") is furniture that opens and closes by its own
    // rules. Keying on the corner was only ever a proxy for "is this Controls",
    // and it stopped being true the moment Controls moved to the right column
    // and started sharing it with "Related".
    'data-collapsed': (title === 'Reading' ? readCollapsed
      : title === 'Controls' && collapsed) ? 'true' : undefined,
    hidden: !forViews.includes(view),
    'aria-label': title,
  });

  /* ONE HEADER, ONE AFFORDANCE, BOTH PANELS.
     Controls and Reading are the same object in two roles, so they wear the
     same 30px header, the same caps title and the same chevron in the same
     corner — the reader learns the gesture once and it works on every panel of
     every view. Collapsed, .tl-panel keeps its glass, its rule and its shadow
     and shrinks to that header, which is the same "the thing is here, folded
     into a chip" shape the layers switch takes when its column is away. */
  const hd = (title: string, extra?: React.ReactNode) => {
    const reading = title === 'Reading';
    const off = reading ? readCollapsed : collapsed;
    const set = reading ? setReadCollapsedBy : setCollapsedBy;
    return (
      <div className="tl-panel__hd">
        <span className="tl-panel__title">{title}</span>
        {extra}
        <button className="tl-iconbtn" style={{ width: 24, height: 24 }}
          aria-label={`${off ? 'Show' : 'Hide'} ${title.toLowerCase()}`} aria-expanded={!off}
          onClick={() => set(!off)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
            style={off ? { transform: 'rotate(180deg)' } : undefined}><path d="M4 6.5L8 10.5L12 6.5" /></svg>
        </button>
      </div>
    );
  };

  /* ══ ONE CONTROL SYSTEM ═══════════════════════════════════════════════════
     "There should be one agent unifying the system of all controls of all
     views, they're a bit fragmented now."

     They were fragmented in two ways at once, and only one of them was visible.

     THE VISIBLE ONE: within a single panel, unrelated ideas sat as peers. Flow's
     first row read [Reset view] [Absolute scale] [Follow Rome] [The great split]
     — a navigation verb, a statement about what the DATA MEANS, and two saved
     camera positions, in one undifferentiated cluster. A reader could not learn
     the row, because the row was not about anything.

     THE INVISIBLE ONE: there was no single place that knew what controls a view
     has. Sixty-six of them stood in this file's markup and four renderers
     appended more of their own at runtime, so "what is on the Habitation panel"
     was a question you answered by reading two files and guessing the order they
     ran in.

     THE SPINE. Every Controls panel now answers three questions, always in this
     order, and a view that has no answer to one of them OMITS the row rather
     than reshuffling the rest:

       1. WHERE YOU ARE   — reset, play/step, framing. Navigation.
       2. HOW IT IS DRAWN — projection, scale mode, detail. The picture.
       3. WHAT IS IN IT   — regions, systems, filters. The contents.

     Omitting rather than reshuffling is the whole property: the reader who
     crosses from Borders to Empires to Cube finds Reset view in the same place
     on all three, because nothing above it ever changes and nothing below it can
     push it down. `ctrlPanel` is the only way a Controls panel is built in this
     file, so that order is a fact about the code and not a habit.

     THE GROUP SWITCH IS THE MASTHEAD, above all three. It is not a control of
     this view — it chooses WHICH VIEW — so it sits outside the spine, on the
     other side of a rule, in the one slot it has always had. */
  const ctrlPanel = (views: ViewId[], g: {
    /** the group's view switch, when the group has siblings */
    seg?: React.ReactNode;
    where?: React.ReactNode;
    how?: React.ReactNode;
    what?: React.ReactNode;
    /** the one-line "scroll to zoom" register, always last */
    note?: React.ReactNode;
  }) => (
    <aside {...panel('br', views, 'Controls')}>
      <div className="tl-panel__grip" aria-hidden="true" />
      {hd('Controls')}
      <div className="tl-panel__bd">
        {g.seg}
        {g.where && <div className="tl-group" data-g="where">{g.where}</div>}
        {g.how && <div className="tl-group" data-g="how">{g.how}</div>}
        {g.what && <div className="tl-group" data-g="what">{g.what}</div>}
        {g.note}
      </div>
    </aside>
  );

  /* A LABELLED ROW. Every "here is a name, here is the switch under it" in the
     app was hand-rolled; three of them were hand-rolled at RUNTIME with inline
     flexbox instead of .tl-field-group, which is why Habitation's rows sat 6px
     out of step with everything above them. */
  const field = (label: string, body: React.ReactNode, extra?: React.ReactNode) => (
    <div className="tl-field-group">
      <span className="tl-label">{label}{extra}</span>
      {body}
    </div>
  );

  return (
    <>
      <div className="tl-app" id="app" data-rail={railOn ? 'on' : 'off'}>

        {/* ══ TOP RAIL ═════════════════════════════════════════════════════ */}
        <header className="tl-rail">
          {/* THE MARK, AND THE ONE DOOR BEHIND IT. The glyph stays a glyph —
              identity, not a control. The WORD is the trigger, and its resting
              appearance is unchanged: same serif, same 15px, same --tl-ink-2
              (see shell.css, which was at pains to demote it and stays that
              way). The chevron is the only new pixel, and it is drawn a step
              quieter than the word. */}
          <span className="tl-mark">
            <span className="tl-mark__glyph" aria-hidden="true">{I.mark}</span>
            <button type="button" id="markBtn" className="tl-mark__word"
              aria-haspopup="menu" aria-expanded={markOpen} aria-controls="markMenu"
              onClick={() => setMarkOpen(o => !o)}>
              Timeline
              <span className="tl-mark__chev" aria-hidden="true">{I.chev}</span>
            </button>
            <div className="tl-mark__menu" id="markMenu" role="menu"
              aria-labelledby="markBtn" hidden={!markOpen}>
              <button type="button" role="menuitem" className="tl-mark__item"
                aria-current={view === 'concepts' || undefined}
                onClick={() => { setMarkOpen(false); leaveSearch('concepts'); }}>
                Concepts, rated
              </button>
            </div>
          </span>

          <div className="tl-rail__mid" ref={midRef} data-ovf={ovf || undefined}>
            <nav className="tl-switch" role="tablist" aria-label="View">
              {GROUPS.map(g => (
                <button key={g.id} className="tl-switch__item" role="tab"
                  aria-selected={g.id === group}
                  aria-controls={`tab-${GROUP_DEFAULT[g.id]}`}
                  onClick={() => leaveSearch(g.members.includes(view) ? view : lastMember.current[g.id])}>
                  {g.label}
                </button>
              ))}
            </nav>

            {/* THE SEG IS GONE FROM HERE, and the breadcrumb chevron with it.
                Empires | Beliefs, Borders | Habitation | Horizon and the projection
                switch are all rows of the Controls panel now (see groupSeg
                above) — one level in the header, one place to say how a view is
                being drawn. The chevron existed only to say "the seg belongs to
                the tab on its left"; with no seg it had nothing to join. */}
          </div>

          {/* THE SCROLL AFFORDANCE — the second half of the data-ovf work above.
              Absolutely positioned against the rail rather than placed in its
              grid, so adding them cannot invent a track of their own; app.css shows
              each one only while the row is actually scrolled away from that
              edge, and only on the widths where the row is a scroller at all.

              OUT OF THE TAB ORDER ON PURPOSE. They do nothing a keyboard reader
              needs — tabbing into the switcher scrolls each item into view by
              itself — so a focus stop here would be two extra stops that only
              move pixels. They are a pointer affordance, and a pointer is the
              only thing that cannot already reach past the edge. */}
          <button type="button" className="tl-rail__more tl-rail__more--l"
            tabIndex={-1} aria-hidden="true" onClick={() => nudgeRow(-1)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3.5L5.5 8L10 12.5" /></svg>
          </button>
          <button type="button" className="tl-rail__more tl-rail__more--r"
            tabIndex={-1} aria-hidden="true" onClick={() => nudgeRow(1)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 3.5L10.5 8L6 12.5" /></svg>
          </button>

          {/* THE SELECTION CHIP IS GONE. "There should be no 'Currently
              selected' pill on top. This should be only in the form of the
              Selected Card."

              It was built to answer "we should clearly see I'm in Roman Empire"
              with something that outlives a dismissed card — and it answered it
              twice. Two objects naming one selection is two things to read, two
              ✕ buttons that mean the same act, and a rail that changes shape the
              moment you click a ribbon. The card is the answer; it carries the
              name, the span, the note, the destinations and its own way out.
              What the chip owned and did not hand back: a fourth grid track in
              the rail (shell.css §02b), a third rail row below 760px, and the
              stage re-fit that row's arrival forced. All three are gone with it,
              so a selection no longer moves one pixel of chrome. */}

          <div className="tl-rail__end">
            {/* THE ONE SEARCH. A real input, not a button that opens a modal:
                the founder asked for one search at the top, and a field you can
                type into on sight is the whole point of putting it there.
                .tl-field already styles an input, an icon and a kbd hint as one
                control (shell.css §Field), so this is the design system's own
                shape rather than a new one.

                ITS WIDTH IS IN app.css NOW, not an inline 232px, because it has
                to be able to shrink: .tl-app's one grid column is max-content,
                so a rigid field made the whole shell 428px wide inside a 390px
                phone — and .tl-app clips. Everything at the right-hand end of
                the time rail lived in that clipped 38px. */}
            <div className="tl-field tl-field--cmdk">
              {I.search}
              <input id="cmdk" type="text" autoComplete="off" spellCheck={false}
                aria-label="Search history and views" aria-autocomplete="list"
                aria-expanded={sOpen} aria-controls="searchSugg" role="combobox"
                placeholder="Search anything…" />
              {/* THE WAY OUT OF A SEARCH, and it appears only when there is one
                  to leave. "Search bar is missing X to remove contents of
                  search." It trades places with the ⌘K hint rather than sitting
                  beside it: the hint answers "how do I get into this field",
                  which is a question nobody typing has, and two glyphs at one
                  end of a 232px field is a crowd. A real <button> after the
                  input, so Tab reaches it from the caret with no tabIndex of
                  its own; its title carries Esc, which is the same act. */}
              {hasQ
                ? (
                  <button type="button" className="tl-field__x"
                    aria-label="Clear search" title="Clear search  Esc"
                    onClick={() => clearField(true)}>
                    {I.close}
                  </button>
                )
                : <kbd className="tl-kbd">⌘K</kbd>}
            </div>
            <button className="tl-iconbtn" id="notesBtn" aria-expanded={notesOpen} aria-controls="fieldNotes"
              aria-label="Field notes for this view" title="Field notes  ?"
              data-unread="true"
              onClick={() => openNotes(!notesOpen)}>
              {I.help}
            </button>
            <button className="tl-iconbtn" id="themeBtn" aria-label="Switch theme" title="Theme: system → dark → light"
              onClick={cycleTheme}>
              {I.theme}
            </button>
          </div>
        </header>

        {/* ══ STAGE ════════════════════════════════════════════════════════ */}
        <main className="tl-stage" id="stage">
          <div className="tl-graticule" aria-hidden="true" />

          {/* ── Map · Borders ─────────────────────────────────────────────── */}
          <section {...sect('map')}>
            <div className="tl-canvasbox"><canvas id="mapCanvas" height={520} /></div>
          </section>

          {/* ── Map · Habitation ──────────────────────────────────────────────── */}
          <section {...sect('pop')}>
            <div className="tl-canvasbox"><canvas id="popCanvas" height={440} /></div>
          </section>

          {/* ── Map · Horizon ─────────────────────────────────────────────── */}
          <section {...sect('horizon')}>
            <div className="tl-canvasbox"><canvas id="hzCanvas" height={420} /></div>
          </section>

          {/* ── Timeline · Vertical — THE PRIMARY TIMELINE ────────────────────
              Viewport-driven: sizeRenderers() writes VT.H from the stage, and
              vertical.ts's fitCanvas() writes the real style.height on the
              first paint. The width/height attributes only set the intrinsic
              ratio for the single frame before that — without them a
              width:100% canvas keeps the default 300×150 aspect. */}
          <section {...sect('vertical')}>
            <div className="tl-canvasbox"><canvas id="vertCanvas" width={1200} height={760} /></div>
          </section>

          {/* ── Timeline · Horizontal ───────────────────────────────────────
              THE LAYER PANEL IS INSIDE THE VIEW, not floating over the stage and
              not in the dock. Two things follow from that and both are the point:
              it shares .tl-view's scroller with the canvas, so the two can only
              ever move together; and it sits in normal flow beside the canvas,
              so there is no gutter, no hairline and no glass between them.
              layerpanel.ts fills #layerPanel — it MUST ship EMPTY, like #catRow
              did before it. #layerBar is stage-level below, because "+ Add layer"
              must stay reachable when the surface is taller than the window. */}
          <section {...sect('zoom')}>
            <div className="tl-layers" id="layerPanel" />
            <div className="tl-canvasbox"><canvas id="zoomCanvas" height={560} /></div>
          </section>

          {/* ── Flow · Empires ────────────────────────────────────────────── */}
          <section {...sect('flow')}>
            <div className="tl-canvasbox"><canvas id="flowCanvas" height={600} /></div>
          </section>

          {/* ── Flow · Beliefs ────────────────────────────────────────────── */}
          <section {...sect('braid')}>
            <div className="tl-canvasbox"><canvas id="braidCanvas" height={440} /></div>
          </section>

          {/* ── Flow · Ideologies ─────────────────────────────────────────
              ITS OWN CANVAS, WHICH IS THE WHOLE SPLIT. The two belief corpora
              shared #braidCanvas and took turns on it, so they also shared one
              window, one hover, one selection and one pan: panning the isms
              moved the religions. Two elements, two Ribbons instances, and
              neither view can move the other. */}
          <section {...sect('ideology')}>
            <div className="tl-canvasbox"><canvas id="ideologyCanvas" height={440} /></div>
          </section>

          {/* ── Connections ───────────────────────────────────────────────── */}
          <section {...sect('conn')}>
            <div className="tl-canvasbox"><canvas id="connCanvas" height={826} /></div>
          </section>

          {/* ── Cube — the one WebGL view ──────────────────────────────────
              three.js owns this canvas: cube.ts writes style.height from the
              stage and hands the element to a WebGLRenderer, so there is no
              fitCanvas() here and the width/height attributes only set the
              intrinsic ratio for the single frame before the chunk lands.
              The two overlays are readouts, never controls — pointer-events
              are off so the whole box stays draggable. */}
          <section {...sect('cube')}>
            <div className="tl-canvasbox tl-canvasbox--gl">
              <canvas id="cubeCanvas" width={1200} height={760} />
              <div className="tl-cube-readout" id="cubeYear" hidden>
                <span className="tl-cube-readout__y" id="cubeYearBig" />
                <span className="tl-cube-readout__s" id="cubeYearSub" />
              </div>
              <div className="tl-cube-busy" id="cubeBusy" role="status" hidden />
            </div>
          </section>

          {/* ── Concepts — documentation about the tool ───────────────────── */}
          <section {...sect('concepts')}>
            <div className="tl-doc">
              <div className="gallery" id="gallery" />
            </div>
          </section>

          {/* ══ FLOATING PANELS ═══════════════════════════════════════════════
              Stage-level, not inside the sections: Connections is 826px tall so
              its section scrolls, and an abspos child of a scroll container
              scrolls away with the content. Stage level also lets the Timeline
              group share ONE control panel across both projections. */}

          {/* Two columns, not four free-floating corners. Corner-anchored
              panels cannot see each other, so on a short viewport the tall
              bottom-left "Reading" grew up under "Controls" and ate its last
              row: at 900x700 the Habitation view's Names toggle was covered, not
              merely ugly. One flex column per side gives the pair a shared
              height budget they cannot exceed. Corner classes stay — they are
              what the column reads to decide which panel hugs the bottom.

              THE LEFT COLUMN IS READING'S, AND ONLY READING'S. "Put the
              controls to top right … to be in same position as other tabs."
              Controls used to head this column, and on the flagship view that
              put it exactly where the LAYER PANEL is — the one instrument the
              whole board is steered with. The reader had to fold the controls
              away to steer, or steer around the controls. So Controls left,
              and what stays here is the prose: bottom-left on every view, the
              corner a reading has always had. */}
          <div className="tl-col tl-col--l">
            <aside {...panel('bl', ['map'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="capsule" /></div>
            </aside>
            <aside {...panel('bl', ['pop'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="popCap" /></div>
            </aside>
            <aside {...panel('bl', ['horizon'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="hzCap" /></div>
            </aside>
            <aside {...panel('bl', ['flow'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="flowCap" /></div>
            </aside>
            {/* braid.ts writes #braidNote with a non-null assertion, so the id
                has to exist — it just stopped being a stray .note at the foot
                of Controls and became this view's reading, in the corner every
                other view keeps its reading in. */}
            <aside {...panel('bl', ['braid'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="braidNote" /></div>
            </aside>
            {/* Same shape for the second belief corpus: braid.ts writes one note
                per view from its own row of BELIEF_VIEWS, so neither caption is
                ever describing the other view's contents. */}
            <aside {...panel('bl', ['ideology'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="ideologyNote" /></div>
            </aside>

            {/* CONNECTIONS' "RELATED" LIST IS NOT A PANEL ANY MORE.
                "Connections > Related should be in the info icon."
                #connPanel moved into the field-notes popover, under the help
                button — see the disclosure at the foot of #fieldNotes. It kept
                its id and its class, so connections.ts writes into exactly the
                element it always wrote into. What it gave up is a permanent
                third of a shared column for a list that is empty until you
                click something. */}
            <aside {...panel('bl', ['conn'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading')}
              <div className="tl-panel__bd"><div className="caption" id="connCap" /></div>
            </aside>
            {/* The frame meter lives in the HEADER, not the body. shell.css §
                .tl-col gives a secondary panel a floor of "a header plus two
                lines" and lets the controls take the rest — so anything in the
                body below the first two lines needs a scroll, and a panel
                called Reading must lead with the reading. .tl-panel__title
                carries margin-right:auto, so a second header child sits flush
                right without a new rule. Full build detail is in its title. */}
            <aside {...panel('bl', ['cube'], 'Reading', 'tl-panel--secondary')}>
              {hd('Reading', <span className="tl-cube-stats" id="cubeStats" />)}
              <div className="tl-panel__bd"><div className="caption" id="cubeCap" /></div>
            </aside>
          </div>

          {/* ══ THE RIGHT COLUMN IS CONTROLS' COLUMN, ON ALL TEN VIEWS ═══════
              "Put the controls to top right to where layers are — to be in same
              position as other tabs."

              ONE CORNER, EVERY VIEW. Controls is the first child here and it is
              the first child for map, people, horizon, both timeline
              projections, flow, beliefs, connections and the cube alike. A
              reader who learns where the instrument is on the map knows where
              it is on the cube, and never has to look for it again — which is
              the entire content of "same position as other tabs".

              WHY THE RIGHT AND NOT THE LEFT. Every left-hand corner in this app
              is already spoken for by the DRAWING: the layer column on the
              horizontal timeline, the year axis on the vertical one, band names
              on Connections, the earliest ribbons in Flow. The right-hand side
              is the one edge no renderer parks furniture against — which is why
              the three docked views now hand their strip to this side instead
              (shell.css §04).

              WHAT ELSE USED TO LIVE HERE, AND WHERE IT WENT. Nothing was
              evicted: "Related" (timeline) and "In transit" (horizon) are both
              secondary panels, so the column's own rule already applies —
              Controls keeps its height and the prose yields — and they simply
              stack below it. The field-notes popover still hangs off its button
              in the rail and covers this column while it is open; it is a
              popover, not a resident, and Escape gives the corner back. */}
          <div className="tl-col tl-col--r">
            {/* THE TIMELINE GROUP'S CONTROLS — one panel for both projections,
                because vertical and horizontal are two drawings of ONE state:
                the same span, the same lanes, the same selection, the same
                search. The PROJECTION switch came back up from the time rail,
                where it was the odd occupant of a strip that is otherwise about
                the moment rather than about the view. It is the first row here
                for the same reason Play is the first row on the map: the top of
                Controls is where a view says how it is being drawn. */}
            {ctrlPanel(['zoom', 'vertical'], {
              seg: groupSeg(),
              where: (
                <div className="tl-cluster">
                  <ResetBtn id="tlReset" title="Frame the whole recorded span"
                    onClick={() => { TL.clearSearch(); frameSettled(TL_HOME[0], TL_HOME[1]); }} />
                </div>
              ),
              /* NO "HOW" AND NO "WHAT" ROW HERE, and both absences are the rule
                 working. The timeline's projection choice IS the group switch in
                 the masthead, and its contents are the layer board — a whole
                 instrument in its own column, which a duplicate filter row in
                 this panel could only disagree with. */
              note: <p className="note">Scroll to zoom · drag to pan · click anything to select it.</p>,
            })}
            {/* map */}
            {ctrlPanel(['map'], {
              seg: groupSeg(),
              /* RESET FIRST, THEN THE TRANSPORT — the same two rows, in the same
                 order, as Habitation and the Cube. It used to be the other way
                 round here and only here, which is exactly the kind of small
                 disagreement that makes ten views feel like ten products. */
              where: (
                <>
                  <div className="tl-cluster">
                    <ResetBtn id="btnReset" title="Frame the whole world again" />
                  </div>
                  <Transport prevId="railPrev" playId="btnPlay" nextId="railNext" unit="snapshot"
                    onPrev={() => step(-1)} onNext={() => step(1)} />
                </>
              ),
              note: <p className="note">Scroll to zoom · drag to pan · click any territory to select it.</p>,
            })}
            {/* pop */}
            {/* HABITATION'S THREE SETTINGS CAME IN OFF THE STREET.
                population.ts used to appendChild() Detail, Style and Names into
                this body at runtime, built out of inline `display:flex;gap:6px`
                rather than .tl-field-group — so they sat six pixels out of step
                with every row above them, in a font of their own, in an order
                nothing declared. They are ordinary declared controls now, in the
                two groups they always belonged to: Detail and Style say HOW the
                field is drawn, Names says WHAT is on it. population.ts binds
                them and paints them, exactly as cube.ts has always done. */}
            {ctrlPanel(['pop'], {
              seg: groupSeg(),
              /* No reset: this view has no zoom and no pan, so there is no
                 framing to put back. The row is omitted, not faked. */
              where: <Transport prevId="railPrevP" playId="popPlay" nextId="railNextP" unit="slice"
                onPrev={() => step(-1)} onNext={() => step(1)} />,
              how: (
                <>
                  {field('Detail', (
                    <div className="tl-seg" id="popDetail" role="group" aria-label="Cell size">
                      <button className="tl-seg__item" data-v="4" title="4° cells">Coarse</button>
                      <button className="tl-seg__item" data-v="2" title="2° cells">Medium</button>
                      <button className="tl-seg__item" data-v="1" title="1° cells">Fine</button>
                    </div>
                  ))}
                  {field('Style', (
                    <div className="tl-seg" id="popStyle" role="group" aria-label="How the field is drawn">
                      <button className="tl-seg__item" data-v="plate"
                        title="One square per cell — the resolution of the claim is visible">Plate</button>
                      <button className="tl-seg__item" data-v="field"
                        title="The same numbers, smoothed">Field</button>
                    </div>
                  ))}
                </>
              ),
              what: (
                <label className="tl-toggle">
                  <input type="checkbox" id="popNames" defaultChecked />
                  <span className="tl-toggle__track" /><span className="tl-toggle__label">Place names</span>
                </label>
              ),
            })}
            {/* horizon */}
            {/* HORIZON'S WHOLE PANEL IS "WHERE YOU ARE", and for once that is
                literal: a city and a year ARE the standpoint the view answers
                from. The three year chips stay where Flow's two framing presets
                went, because they are not the same kind of thing — Follow Rome
                was a camera position on a plate the reader could already reach
                by searching, while 1776 / 1492 / 1889 are the SUBJECT of this
                view, and there is no other route to a year here. */}
            {ctrlPanel(['horizon'], {
              seg: groupSeg(),
              where: (
                <>
                  {field('Standing in', <select id="hzCity" aria-label="City" defaultValue="" style={{ width: '100%' }} />)}
                  {field('In the year', (
                    <>
                      <input type="number" id="hzYear" defaultValue="1776" style={{ width: '100%' }} />
                      <div className="tl-cluster">
                        <button className="chip" data-hz="1776">1776</button>
                        <button className="chip" data-hz="1492">1492</button>
                        <button className="chip" data-hz="1889">1889</button>
                      </div>
                    </>
                  ))}
                </>
              ),
              note: <><hr className="tl-hr" /><span className="note" id="hzSpeed" /></>,
            })}
            {/* THE TIMELINE GROUP'S "CONTROLS" PANEL IS GONE.
                It held four things. PROJECTION moved DOWN, to the time rail's
                control cluster — never back into the header.
                LANES and DOMAIN were replaced outright by the layer model —
                a layer is a subject × a kind, which is the thing both of those
                chips were failing to say. GRAMMAR and the importance readout
                were standing explanation for a grammar the panel now states in
                words on every row ("less / normal / detailed") and in a coloured
                dot beside every name. #catRow, #lensRow, #grammarRowV and
                #zoomReadout are all resolved defensively in timeline.ts, so
                their absence costs nothing. The vertical projection loses the
                panel too and takes the full stage width. */}
            {/* flow */}
            {/* FLOW IS THE VIEW THAT NAMED THE PROBLEM. "The controls of Flow
                should be better, follow rome and great split - remove, we
                should separate view control and toggling of the view
                (relative/absolute)."

                The first row read [Reset view] [Absolute scale] [Follow Rome]
                [The great split]: a navigation verb, a statement about what the
                DATA MEANS, and two saved camera positions — three different
                kinds of thing, all wearing .btn, all in one cluster.

                FOLLOW ROME AND THE GREAT SPLIT ARE GONE. They were demo
                bookmarks from prototype days: a hardcoded fly to 300 BCE and
                another to 180–820. Search reaches every subject in the corpus
                and taking one frames its ribbon, so a button that can only ever
                mean one year does not earn a row in the instrument.

                THE SCALE IS SEPARATED, and it stopped being a button. #flowMode
                was a button whose label named the mode you were NOT in — press
                "Absolute scale" and it becomes "Share of world" — so the panel
                could never be read as a statement of the picture's state. It is
                a two-item .tl-seg now, in HOW IT IS DRAWN, where both readings
                are on screen at once and aria-pressed says which is live. Same
                control, same words, same corner on Beliefs. */}
            {ctrlPanel(['flow'], {
              seg: groupSeg(),
              where: (
                <div className="tl-cluster">
                  <ResetBtn id="flowAll" title="Frame the whole span" />
                </div>
              ),
              how: field('Scale', (
                <div className="tl-seg" id="flowMode" role="group" aria-label="Scale">
                  <button className="tl-seg__item" data-v="norm">Share of world</button>
                  <button className="tl-seg__item" data-v="abs">Absolute</button>
                </div>
              )),
              /* "Find a polity…" IS GONE — ONE SEARCH. It was a second box three
                 inches below the first, weaker in every direction: it matched a
                 substring of a polity name and nothing else, it only dimmed, and
                 it existed on this one view. The global field ranks the same 147
                 polities among everything else, and taking one of them while you
                 are standing here now frames the ribbon and lights it (takeRow →
                 landingFor). flow.ts kept the behaviour as Flow.setQuery() for
                 the callers that still want a filter rather than a selection. */
              what: field('Regions', (
                /* MUST ship EMPTY — flow.ts appendChild()s into it. The chips
                   are derived from the corpus (five regions, discovered from
                   POLITIES at boot), which is the one honest reason left in this
                   app for a control to be built at runtime rather than declared:
                   the shell cannot enumerate a list it does not own. */
                <div className="tl-cluster" id="flowRegionRow" />
              )),
            })}
            {/* braid + ideology */}
            {/* BELIEFS WEARS EMPIRES' PANEL, ROW FOR ROW, AND SO DOES ITS NEW
                SIBLING. The three views are one engine (Ribbons) and they were
                reading as two products: Flow had a scale switch and Braid did
                not, so braid.ts minted itself one at runtime and appended it into
                whatever .tl-cluster it found first. Both are declared here now,
                identical to Flow's, in the same spine group.

                AND "WHAT IS IN IT" IS EMPTY ON BOTH, WHICH IS THE SPLIT. That
                group used to hold a System seg — Religions | Ideologies — the
                one control this pair of views replaces. A view that IS the
                ideologies should not also offer to become the religions; that
                is the seg's job, and the seg is in the masthead above. So the
                row is OMITTED rather than filled with something else, exactly as
                the spine says: Connections has no HOW and no WHAT and its panel
                is simply short. These two are now short in the same way, and
                Empires keeps its Regions row because Empires genuinely has
                contents to filter.

                The two panels are one call each rather than one call for both,
                because the ids differ (#braidMode / #ideologyMode) and each seg
                must drive its own instance — a shared id would give the pair one
                scale between them, which is the bug the split exists to end. */}
            {ctrlPanel(['braid'], {
              seg: groupSeg(),
              where: (
                <div className="tl-cluster">
                  {/* The framing belongs to the VIEW now — religions open on
                      1000 BCE — so the reset states that year through braid.ts's
                      own table instead of re-pressing a preset and inheriting
                      whatever it happened to set. */}
                  <ResetBtn title="Frame the whole span of the religions"
                    onClick={() => braidHome('religion')} />
                </div>
              ),
              how: field('Scale', (
                <div className="tl-seg" id="braidMode" role="group" aria-label="Scale">
                  <button className="tl-seg__item" data-v="norm">Share of world</button>
                  <button className="tl-seg__item" data-v="abs">Absolute</button>
                </div>
              )),
            })}
            {ctrlPanel(['ideology'], {
              seg: groupSeg(),
              where: (
                <div className="tl-cluster">
                  <ResetBtn title="Frame the whole span of the ideologies"
                    onClick={() => braidHome('ideology')} />
                </div>
              ),
              how: field('Scale', (
                <div className="tl-seg" id="ideologyMode" role="group" aria-label="Scale">
                  <button className="tl-seg__item" data-v="norm">Share of world</button>
                  <button className="tl-seg__item" data-v="abs">Absolute</button>
                </div>
              )),
            })}
            {/* conn — every id and class from the old #tab-conn subtree, intact.
                THE GRAMMAR LEGEND IS FOLDED IN HERE rather than floating at the
                bottom right of the canvas: see the note on .tl-col--r below for
                why Connections has no right-hand panels any more.
                buildConnLegend() fills #connGrammar by id, so it does not care
                that the element now lives inside a <details>. */}
            {/* CONNECTIONS HAS ONE GROUP AND THAT IS THE POINT. The five
                random controls went two rounds ago (two guided-tour jumps, a
                zoom preset, a share-of-lane normaliser with no ribbons left to
                normalise, and a clear-selection button nothing else in the app
                carries). What is left is the one row every view has, and under
                the spine that absence now READS: there is no HOW row and no WHAT
                row here, so the panel is short — it does not promote the Grammar
                legend up into the space to look busy. */}
            {ctrlPanel(['conn'], {
              seg: groupSeg(),
              where: (
                <div className="tl-cluster">
                  {/* Wired from this file — a NEW id, so the hiding loop in
                      connections.ts cannot mistake it for the "Whole span"
                      preset it retired. */}
                  <ResetBtn id="connReset" title="Back to the framing this view opens on"
                    onClick={() => { const h = connHome.current; if (h) Conn.animTo(h[0], h[1]); }} />
                </div>
              ),
              /* THE LEGEND IS NOT A CONTROL, so it sits below all three groups
                 with the note, in the register the panel uses for things it is
                 telling you rather than things you can press. */
              note: (
                <>
                  <span className="note">scroll to zoom · drag to pan</span>
                  <details className="tl-disc">
                    <summary>Grammar<span className="tl-disc__v">shape &amp; weight</span></summary>
                    <div className="tl-disc__bd"><div className="grammar" id="connGrammar" /></div>
                  </details>
                </>
              ),
            })}
            {/* ══ THE CUBE: TWENTY-FIVE CONTROLS, RE-READ ══════════════════════
                One panel held projection, six camera presets, sovereign,
                lineage, chain, solid mode, a cut range, cut lo/hi, caps, a slice
                toggle, a slice transport, a slice index, mesh resolution, time
                spacing, a ghost opacity slider, snapshot outlines, ghost
                coastlines and auto-orbit — twenty-five things, split into three
                folds that were organised by ENGINE FEATURE ("cut & slice",
                "view & detail") rather than by what a reader is trying to do.

                FIVE ARE GONE. Each was a setting with a sane default that no
                reader was ever going to change twice:
                  · "Low" — a fourth camera angle beside Top/Front/Side, which
                    are the three axes of the block and mean something. Low was a
                    nice screenshot.
                  · "Cap the cut" — whether the cut face is filled. On by
                    default, and a hollow cut is a rendering artefact, not a
                    reading.
                  · "Ghost coastlines" — a sub-setting of the ghost world, on by
                    default. The ghost world is one thing; it does not need two
                    switches and an opacity dial.
                  · "Auto-orbit" — a screensaver. Same family as Follow Rome.
                  · the ghost OPACITY SLIDER, which became the ghost toggle: a
                    continuous 0–0.55 dial for how faint the background world is
                    was a preference, and the only two values anyone wanted were
                    "there" and "not there".
                Every one of them keeps its default in CubeState, so the block
                draws exactly as it does today; what is gone is the invitation to
                fiddle. None had a keyboard route, so nothing is orphaned.

                THE REST ARE UNDER THE SPINE. WHERE YOU ARE is the camera and
                the position in time — and the transport came UP out of the slice
                fold to get there, which is why Play now sits at the same height
                on the Cube as it does on Borders and Habitation. HOW IT IS DRAWN
                is the one folded group in the app, and it is folded on the
                founder's own test — every control in it has a sane default. WHAT
                IS IN IT is the subject: which polity, how much of its lineage,
                how the volume is built, and which part of the block you kept.

                Every id below is resolved once by cube.ts and every one of its
                helpers is null-safe, so a cut costs nothing. #cubeChain ships
                EMPTY — cube.ts writes the lineage chips into it. */}
            {ctrlPanel(['cube'], {
              seg: groupSeg(),
              where: (
                <>
                  <div className="tl-cluster" id="cubeViews">
                    <ResetBtn dataV="home" title="Fly the camera home" />
                    <button className="chip" data-v="focus">Frame the trace</button>
                    <button className="chip" data-v="top">Top</button>
                    <button className="chip" data-v="front">Front</button>
                    <button className="chip" data-v="side">Side</button>
                  </div>
                  {/* THE TRANSPORT LEFT THE FOLD. It used to live inside "Cut &
                      slice", dimmed and pointer-events:none until Single slice
                      was ticked — so the one control that TURNS SLICE ON could
                      not be clicked until slice was on. It is the same component
                      the map and Habitation use now, in the same group, and
                      pressing it enables slice mode the way it always meant to. */}
                  <Transport playId="cubePlay" unit="snapshot" data />
                </>
              ),
              how: (
                /* THE ONE FOLDED GROUP IN THE APP, and its summary names the
                   spine group rather than an engine feature, so folding it
                   teaches the structure instead of hiding it. The rule for a
                   folded control is unchanged: it may be out of sight only while
                   it is at rest, and cube.ts opens this group the moment
                   anything in it leaves its default. */
                <details className="tl-disc" id="cubeDiscView">
                  <summary>How it is drawn<span className="tl-disc__v" id="cubeDiscViewV" /></summary>
                  <div className="tl-disc__bd">
                    {field('Projection', (
                      <div className="tl-seg" id="cubeProj" role="group" aria-label="Projection">
                        <button className="tl-seg__item" data-v="persp">Perspective</button>
                        <button className="tl-seg__item" data-v="ortho">Isometric</button>
                      </div>
                    ))}
                    {field('Detail', (
                      <div className="tl-seg" id="cubeRes" role="group" aria-label="Mesh detail">
                        <button className="tl-seg__item" data-v="draft">Draft</button>
                        <button className="tl-seg__item" data-v="normal">Normal</button>
                        <button className="tl-seg__item" data-v="fine">Fine</button>
                      </div>
                    ))}
                    {field('Time axis', (
                      <div className="tl-seg" id="cubeSpacing" role="group" aria-label="Time axis spacing">
                        <button className="tl-seg__item" data-v="even">Even</button>
                        <button className="tl-seg__item" data-v="true">True years</button>
                      </div>
                    ))}
                    <label className="tl-toggle">
                      <input type="checkbox" id="cubeGhost" defaultChecked />
                      <span className="tl-toggle__track" /><span className="tl-toggle__label">Ghost world</span>
                    </label>
                    <label className="tl-toggle">
                      <input type="checkbox" id="cubeOutlines" />
                      <span className="tl-toggle__track" /><span className="tl-toggle__label">Snapshot outlines</span>
                    </label>
                  </div>
                </details>
              ),
              what: (
                <>
                  {/* TRACE A POLITY — THE BOX IS GONE, THE BROWSE STAYS.
                      "Search anything should be the same as 'Trace a polity
                      search'." #cubeFilter ranked the same 147 polities the
                      global field already ranks. The <select> is not a search: it
                      is the alphabetical BROWSE, and the readout of which polity
                      the block is traced from, whichever direction the trace
                      arrived from. */}
                  {field('Trace a polity', (
                    <>
                      <select id="cubeSov" aria-label="Polity to trace" defaultValue="" style={{ width: '100%' }} />
                      <span className="note" id="cubeNote" />
                    </>
                  ))}
                  {field('Follow lineage', (
                    /* MUST ship EMPTY — cube.ts appendChild()s the chain. */
                    <>
                      <div className="tl-seg" id="cubeLineage" role="group" aria-label="Lineage depth">
                        <button className="tl-seg__item" data-v="0">Off</button>
                        <button className="tl-seg__item" data-v="1">1</button>
                        <button className="tl-seg__item" data-v="2">2</button>
                        <button className="tl-seg__item" data-v="3">3</button>
                      </div>
                      <div className="tl-cluster" id="cubeChain" />
                    </>
                  ), <span className="tl-label__v" id="cubeLineageV" />)}
                  {field('Solid', (
                    <div className="tl-seg" id="cubeMode" role="group" aria-label="How the trace is built">
                      <button className="tl-seg__item" data-v="lofted">Volume</button>
                      <button className="tl-seg__item" data-v="prisms">Prisms</button>
                      <button className="tl-seg__item" data-v="off">Off</button>
                    </div>
                  ))}
                  {/* THE TWO VERBS, still folded and still for the same reason:
                      both are off at rest, and cube.ts opens the group the moment
                      either one stops being — including when the A or P shortcut
                      is what turned it on. */}
                  <details className="tl-disc" id="cubeDiscCut">
                    <summary>Cut &amp; slice<span className="tl-disc__v" id="cubeDiscCutV" /></summary>
                    <div className="tl-disc__bd">
                      <div className="tl-field-group" id="cubeCutRow">
                        <span className="tl-label">Cut through time<span className="tl-label__v" id="cubeCutV" /></span>
                        {/* Two handles, one track. Not two overlaid <input type=range>:
                            they fight over pointer capture at the ends. cube.ts does
                            the pointer maths; the engine snaps to slab faces. */}
                        <div className="tl-cutrange" id="cubeCut" data-cutting="false">
                          <div className="tl-cutrange__track" />
                          <div className="tl-cutrange__fill" id="cubeCutFill" />
                          <div className="tl-cutrange__h" id="cubeCutLo" title="from" />
                          <div className="tl-cutrange__h" id="cubeCutHi" title="to" />
                        </div>
                      </div>
                      <div className="tl-field-group" id="cubeSliceRow" data-off="true">
                        <span className="tl-label">Single slice<span className="tl-label__v" id="cubeSliceV">off</span></span>
                        <label className="tl-toggle">
                          <input type="checkbox" id="cubeSlice" />
                          <span className="tl-toggle__track" /><span className="tl-toggle__label">One snapshot at a time</span>
                        </label>
                        <input type="range" id="cubeSliceIdx" min="0" max="17" step="1" defaultValue="0"
                          aria-label="Which snapshot" />
                      </div>
                    </div>
                  </details>
                </>
              ),
            })}
            {/* THE TIMELINE'S "RELATED" PANEL — the same pattern as Connections'.
                Click a spread or an event on either projection and relations.ts
                renders the ranked, grouped relation list (plus the Wikipedia link,
                which moved here from the old click-through) into #tlRelPanel.

                IT MOVED TO THE RIGHT. On the left it would land exactly on top of
                the layer panel, which is permanent chrome the reader steers with;
                a panel that answers a click may cover some plot, but it may never
                cover the instrument. */}
            <aside {...panel('tr', ['zoom', 'vertical'], 'Related', 'tl-panel--secondary tl-panel--request')}
              hidden={!(view === 'zoom' || view === 'vertical') || !relOpen}>
              <div className="tl-panel__hd">
                <span className="tl-panel__title">Related</span>
                <button className="tl-iconbtn" style={{ width: 24, height: 24 }}
                  aria-label="Close the full connection list" onClick={() => setRelOpen(false)}>
                  {I.close}
                </button>
              </div>
              <div className="tl-panel__bd"><div className="relpanel" id="tlRelPanel" /></div>
            </aside>
            <aside {...panel('tr', ['horizon'], 'In transit', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">In transit</span></div>
              <div className="tl-panel__bd"><div className="newsfeed" id="hzFeed" /></div>
            </aside>
          </div>


          {/* THE LAYER BAR. Stage-level and pinned to the bottom-left corner of
              the panel column, because the panel itself has no scroller of its
              own — it is one surface with the canvas — so a footer in flow would
              be under the fold on a tall arrangement. Two verbs and a count; the
              panel's chrome budget is this row and nothing else.
              layerpanel.ts fills it, so it MUST ship EMPTY.

              AND IT IS NOW ALSO THE SWITCH'S HOME, which is why it no longer
              hides at 760px the way the panel used to. It is the one piece of
              the layer panel that is on screen at every width in every state —
              closed, the strip drops its ground and its two verbs and keeps a
              single "Layers" chip in the corner it always had. `hidden` still
              belongs to the view, because none of this means anything on the
              ten projections that have no lanes. */}
          <div className="tl-layers__bar" id="layerBar" hidden={view !== 'zoom'} />

          {/* THE INDEX IS A STUB. ALWAYS.

              It used to run the full height of the stage on the time-axis views,
              and there it was one of THREE red verticals: this line (positioned
              on the RAIL's scale), the canvas's own set-year line (positioned on
              the CANVAS's scale, so at a different x for the same year), and the
              hover crosshair. His words: "let's not make the red line from the
              bottom go all the way to top — there's two lines battling now."

              So it keeps the 22px stub the map views always used, which reads as
              part of the rail rather than as a claim about the canvas. The
              crosshair is now the only full-height vertical anywhere. */}
          <div className="tl-index-line" id="indexLine" aria-hidden="true" />

          {/* ══ FIELD NOTES ═══════════════════════════════════════════════ */}
          <aside className="tl-pop" id="fieldNotes" role="dialog" aria-label="Field notes"
            hidden={!notesVis} data-anim={notesOpen ? 'in' : 'out'}
            onAnimationEnd={onNotesAnimEnd} style={{ top: 12, right: 12 }}>
            <span className="tl-pop__arrow" style={{ right: 48 }} aria-hidden="true" />
            <div className="tl-pop__hd">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tl-pop__eyebrow">Field notes</div>
                <h2 className="tl-pop__title">{meta.name}</h2>
              </div>
              <button className="tl-iconbtn" id="notesClose" aria-label="Close field notes"
                onClick={() => { setNotesOpen(false); document.getElementById('notesBtn')?.focus(); }}>
                {I.close}
              </button>
            </div>
            <div className="tl-pop__bd">
              {/* CONNECTIONS' "RELATED" LIST, WHERE THE FOUNDER PUT IT.
                  "Connections > Related should be in the info icon."

                  It is a <details> rather than a fourth paragraph because it is
                  empty until something is selected, and an empty box under a
                  read-once explanation is worse than no box. Closed, it is one
                  summary line; open, it is the whole ranked list.

                  RENDERED ON EVERY VIEW AND HIDDEN OFF CONNECTIONS, never
                  conditionally mounted: connections.ts resolves #connPanel by
                  id and writes into it, and this file's oldest rule is that a
                  container a renderer writes into is in the DOM from boot. It
                  keeps the id and the .relpanel class exactly, so nothing on
                  the other side of that boundary changed at all.

                  AND IT LEADS. The prose in this popover is read once; this
                  list changes with every click and is the reason a reader opens
                  the panel again. Under three paragraphs and a sources note it
                  was below the fold of a 46vh scroller, which is the same
                  burial the docked panel was rescued from. */}
              <details className="tl-disc" id="connRelDisc" hidden={view !== 'conn'} open>
                <summary>Related<span className="tl-disc__v">what is linked to the selection</span></summary>
                <div className="tl-disc__bd"><div className="relpanel" id="connPanel" /></div>
              </details>
              {NOTES[view].body}
              {NOTES[view].src && <p className="tl-pop__src">{NOTES[view].src}</p>}
            </div>
            {/* THE HOTKEY STRIP IS GONE. "Dont show the hotkeys info in field
                notes lets make it real small." Four shortcuts under a
                three-line introduction was a reference table stapled to a
                greeting, and every one of them is already reachable where a
                person would look for it: ← → and Space are the step and play
                buttons in Controls, ⌘K is printed inside the search field
                itself while it is empty, and ? is in the notes button's own
                title. Nothing was lost by cutting them; a newcomer just stops
                being handed a keyboard map before they have seen the picture.

                AND SO IS THE LINK. "Remove the Concepts rated footer of fields
                notes." It was kept on the grounds that it was the only route to
                a view that is not on the switcher — but Concepts is
                documentation about the tool, not a view of history, and a
                permanent footer on every view, on every open, pointing at a
                design document is not the product. It has a home of its own
                now — the wordmark's menu, top left — and ⌘K still finds it by
                name, and ?v=concepts still opens it. With the strip and the link
                both gone the notes have no footer at all, so the element goes
                with them. */}
          </aside>

          {/* ══ THE NOTICE ═══════════════════════════════════════════════════
              What going to a subject had to change about the board, or why it
              could change nothing. One line, one action, and it lives at the
              BOTTOM of the stage between the two panel columns — the one strip
              of canvas that no panel, and no parked card, is ever in. (Below
              760px the columns are gone and every surface is a bottom sheet,
              so app.css moves it to the top instead; see §Notice.)

              role="status" and not an alert: it reports something the reader
              just asked for. `key` on the id restarts the entry animation when
              two reveals in a row happen to say the same thing. */}
          {notice && (
            <div className="tl-notice" role="status" aria-live="polite" key={notice.n}>
              <span className="tl-notice__msg">{notice.text}</span>
              <button type="button" className="tl-notice__x" aria-label="Dismiss"
                title="Dismiss" onClick={() => setNotice(null)}>{I.close}</button>
            </div>
          )}
        </main>

        {/* ══ TIME RAIL ════════════════════════════════════════════════════
            Shared chrome, but "time" means three things across ten views, so
            each cell holds a stack of per-view children, all present from boot.
            That is what lets #yearLabel, #yearSlider and #btnPlay keep working
            untouched while other views drive the same rail differently. */}
        <footer className="tl-timerail" id="timerail">
          {/* data-range says the counter is holding a WINDOW, not a moment, and
              the two are not the same typographic object: one year is four
              numerals and a range is up to "13.8 billion yrs ago – 2026". The
              flag is read off VIEWS[v].rail, the same classification syncRail
              switches on, so the shell and the readout can never disagree about
              which kind of view this is. */}
          <div className="tl-timerail__year" data-legend={String(meta.rail === 'legend')}
            data-range={String(meta.rail === 'span')}>
            <div data-railcell="year-map" data-on={String(yearCell === 'map')}>
              <span className="tl-year" id="yearLabel">1783</span>
              <span className="tl-year__era" id="mapEra">CE · 12/18</span>
            </div>
            <div data-railcell="year-pop" data-on={String(yearCell === 'pop')}>
              <span className="tl-year" id="popYear">1700</span>
              <span className="tl-year__era" id="popEra">CE</span>
            </div>
            <div data-railcell="year-rail" data-on={String(yearCell === 'rail')}>
              <span className="tl-year" id="railYear">—</span>
              <span className="tl-year__era" id="railEra" />
            </div>
          </div>

          {/* THE DRAG SURFACE. The pointer gesture is handled here, not by the
              range inputs stacked on top of it — see scrubTo() above. They keep
              the keyboard; app.css takes their pointer events away. */}
          <div className="tl-scale" id="railScale" data-inert={String(meta.rail === 'legend')}
            onPointerDown={onRailDown} onPointerMove={onRailMove}
            onPointerUp={onRailUp} onPointerCancel={onRailUp}>
            {/* The era bands are gone. They shaded the scale at a FIXED
                32/58/78% of its width regardless of what years those positions
                actually held, so the stripes claimed era boundaries they had no
                knowledge of — decoration wearing the costume of data. The ticks
                and the labels below carry the structure, and they are true. */}
            <span className="tl-scale__label tl-scale__label--start" data-edge>3000 BCE</span>
            {([[-1000, '1000 BCE', true], [1, '1 CE', false], [500, '500', true], [1000, '1000', true],
            [1500, '1500', true], [1800, '1800', false], [1900, '1900', true]] as [number, string, boolean][])
              .map(([y, lab, minor]) => (
                <span key={lab} className="tl-scale__label" style={{ left: railPos(y) + '%' }}
                  {...(minor ? { 'data-minor': true } : {})}>{lab}</span>
              ))}
            <span className="tl-scale__label tl-scale__label--end" data-edge>2000</span>

            <div className="tl-scale__ticks" aria-hidden="true" />
            <div className="tl-scale__ticks tl-scale__ticks--major" aria-hidden="true" />

            {/* The 18 world snapshots, engraved. The generic 2%/10% ruling
                underneath stays as the ruler. */}
            {stopYears.map(y => (
              <i key={y} className="tl-scale__stop" data-year={y} style={{ left: railPos(y) + '%' }} aria-hidden="true" />
            ))}

            {/* TWO BRACKETS, TWO DIFFERENT FACTS, AND THEY MUST NOT BE THE SAME
                INK. #railSpan is the WINDOW — how much of time the canvas is
                showing — and it exists only where the canvas axis is time.
                #railSel is the SELECTED THING'S OWN LIFE: "When an entity is
                selected in Map, show its span on the timeline down below so
                that we can know when it existed." It is drawn on EVERY view,
                because the selection is global and "one place, many
                perspectives" means the rail answers the same question wherever
                you are standing.

                Neither of them spends the accent. Minium means WHERE YOU ARE IN
                TIME and belongs to the index alone; a span is a different fact,
                so this one quotes the subject's own domain hue — the same
                crossing the selection chip's dot already makes, and the same
                one it makes right above this. */}
            <div className="tl-scale__span" id="railSpan" aria-hidden="true" hidden />
            <div className="tl-scale__sel" id="railSel" aria-hidden="true" hidden />
            <div className="tl-index" id="railIndex" aria-hidden="true"><span className="tl-index__flag" id="railFlag" /></div>

            <input className="tl-range" type="range" id="yearSlider" min="0" max="17" step="1" defaultValue="11"
              aria-label="Year" data-railcell="scale-map" data-on={String(scaleCell === 'yearSlider')} />
            <input className="tl-range" type="range" id="popSlider" min="0" max="15" step="1" defaultValue="10"
              aria-label="Year" data-railcell="scale-pop" data-on={String(scaleCell === 'popSlider')} />
            <input className="tl-range" type="range" id="railRange" min="0" max="1000" step="1" defaultValue="745"
              aria-label="Year" data-railcell="scale-generic" data-on={String(scaleCell === 'railRange')}
              onInput={onRailRange} />
          </div>

          {/* THE TRANSPORT TRACK IS GONE, and its three occupants with it.

              "I am thinking we have Controls (unify projection settings,
              play/go forward/backward, reset view) / Reading / Card on all
              pages, to keep it unified."

              Play and the two steppers were the map's and Habitation's; the
              PROJECTION switch was the two timeline projections'. All three
              were the same kind of thing — a control of the VIEW — parked in
              the one strip that is not about the view but about the MOMENT.
              They are all in Controls now, in the same two rows, on every view
              that has them. The rail is the time index and nothing else, which
              is why it can look identical on all ten. */}
        </footer>
      </div>

      {/* #tip stays OUTSIDE .tl-app: shared.ts showTip clamps against
          innerWidth / innerHeight, so it must not be reparented into a
          positioned ancestor. */}
      <div className="tooltip" id="tip" />

      {/* THE SELECTION CARD. Ships EMPTY — selcard.ts fills and positions it —
          and lives out here for the same reason as #tip: it is placed in
          viewport coordinates against the anchor the renderer measured, so a
          positioned ancestor would silently shift every one of them. */}
      <div className="tl-selcard" id="selCard" role="dialog" aria-label="Selection" hidden />

      {/* THE SEARCH SUGGESTIONS. Out here with #tip and #selCard, for the same
          reason: it is positioned in VIEWPORT coordinates against the box's
          rect, so a positioned ancestor would silently shift it — and
          .tl-panel__bd scrolls, which would clip it. */}
      {sOpen && sBox && (
        <div className="tl-sugg" id="searchSugg" role="listbox" aria-label="Search results"
          style={{ left: sBox.left, top: sBox.top, width: sBox.width }}>
          {sRows.map((r, i) => {
            // A header wherever the KIND changes: the three groups are
            // contiguous by construction, so this needs no grouping pass — it
            // just notices the seam.
            const head = i === 0 || sRows[i - 1].k !== r.k
              ? (r.k === 'c' ? 'In history' : r.k === 'l' ? 'Lanes' : 'Views')
              : null;
            const sel = i === sSel;
            const key = r.k === 'c' ? r.h.id : r.k === 'l' ? 'l:' + r.l.id : 'v:' + r.v;
            return (
              <div key={key}>
                {head && <div className="tl-sugg__group">{head}</div>}
                {r.k === 'c' ? (() => {
                  // A HIT WHOSE LAYER CANNOT BE MADE TO DRAW IT IS NOT A
                  // CHOICE. It stays in the list (it is a truthful answer to
                  // the word) and says why, but it cannot be clicked, cannot
                  // be arrowed onto and cannot frame anything.
                  const dead = r.to === null;
                  const note = needLine(r, view);
                  return (
                    <button className="tl-sugg__row" role="option" aria-selected={sel} data-sel={String(sel)}
                      /* THE STYLING FOLLOWS THE LANDING, NOT THE TIMELINE'S
                         PLAN. `p.need === 'never'` only ever meant "no layer on
                         the timeline draws this", and on the Beliefs view — the
                         one view whose entire subject is belief streams — that
                         verdict was greying out a row that works perfectly.
                         Once the row lands HERE, the layer plan has nothing
                         left to say about it. */
                      data-need={dead ? 'never'
                        : r.to !== view ? 'elsewhere'
                          : r.p.need === 'never' ? 'ready' : r.p.need}
                      disabled={dead} aria-disabled={dead || undefined}
                      title={needTitle(r, r.h.name, view) || undefined}
                      onMouseDown={e => e.preventDefault()}
                      onMouseEnter={() => { if (!dead) setSSel(i); }}
                      onClick={() => takeRow(r)}>
                      <i className="tl-sugg__dot" style={{ background: catColor(r.h.cat, tokens()) }} aria-hidden="true" />
                      <span className="tl-sugg__name">{r.h.name}</span>
                      <span className="tl-sugg__meta">
                        {r.h.end > r.h.start ? `${fmtBig(r.h.start)} – ${fmtY(r.h.end)}` : fmtBig(r.h.start)}
                        {r.h.lane ? ` · ${r.h.lane}` : ''}
                      </span>
                      {note && <span className="tl-sugg__need">{note}</span>}
                    </button>
                  );
                })() : r.k === 'l' ? (
                  <button className="tl-sugg__row tl-sugg__row--lane" role="option" aria-selected={sel} data-sel={String(sel)}
                    title={r.l.on
                      ? `“${r.l.name}” is already a lane — find it in the panel.`
                      : `Add “${r.l.name}” as a lane: ${r.l.n} marks.`}
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setSSel(i)}
                    onClick={() => takeRow(r)}>
                    <i className="tl-sugg__dot" aria-hidden="true"
                      style={{ background: r.l.si === null ? 'var(--tl-ink-3)' : `var(--s${r.l.si + 1})` }} />
                    <span className="tl-sugg__name">{r.l.name}</span>
                    <span className="tl-sugg__meta">
                      {/* `r.l.hidden` is gone from this line, not from search.ts's
                          tuple: a lane on the board is drawn, so the third
                          state it named cannot happen any more. */}
                      {r.l.on ? 'on the board' : `add as a lane · ${r.l.n}`}
                    </span>
                  </button>
                ) : (
                  <button className="tl-sugg__row tl-sugg__row--view" role="option" aria-selected={sel} data-sel={String(sel)}
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setSSel(i)}
                    onClick={() => takeRow(r)}>
                    <i className="tl-sugg__dot tl-sugg__dot--view" aria-hidden="true" />
                    <span className="tl-sugg__name">{VIEWS[r.v].name}</span>
                    <span className="tl-sugg__meta">
                      {GROUPS.find(g => g.members.includes(r.v))?.label || 'Concepts'}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
          {sTotal > 0 && (
            <div className="tl-sugg__more">+{sTotal} more in history — keep typing</div>
          )}
        </div>
      )}

      {!ready && (
        <div className="bootstate" role="status">
          {error ? <><b>Could not load the data.</b> {error}</> : <>Loading the corpus — events, lanes and connections…</>}
        </div>
      )}
    </>
  );
}
