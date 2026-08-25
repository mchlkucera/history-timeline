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
     · all eleven views are MOUNTED AT BOOT — visibility is CSS only;
     · containers a renderer appendChild()s into (#catRow, #lensRow,
       #flowRegionRow, #corePresets) ship EMPTY;
     · legacy class names (.chip/.on, .btn/.hero, .card, .caption, .note …) are
       frozen vocabulary — re-skinned in globals.css, never renamed here.

   And the one that bites hardest: a display:none view has clientWidth 0, so
   fitCanvas() returns null and the renderer no-ops in silence. renderTab()
   below therefore covers all eleven ids.
   ============================================================================= */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  catColor, clampDomain, fmtBig, fmtY, initData, setGotoTab, setLanes, SelStore, TimeStore,
  tokens, YMAX, YMIN,
  type Datasets,
} from '@/render/shared';
import { buildRelIndex } from '@/render/relations';
import { SelCard } from '@/render/selcard';
import { WorldMap } from '@/render/map';
import { TL } from '@/render/timeline';
import { LayerPanel } from '@/render/layerpanel';
import { VT } from '@/render/vertical';
import { Flow, initFlow } from '@/render/flow';
import { Cube } from '@/render/cube';
import { Core } from '@/render/core';
import { Braid, initBraid } from '@/render/braid';
import { Horizon } from '@/render/horizon';
import { Pop, loadPopulation } from '@/render/population';
import { buildGallery } from '@/render/gallery';
import { Conn, initConn, loadRelations } from '@/render/connections';
import { searchCorpus, searchLayers, type Hit, type LayerHit } from '@/render/search';
import { Layers, planReveal, reveal, type RevealPlan } from '@/render/layers';
import { describe, perspectiveSpan, setPolityAliases } from '@/render/subject';
import { railPos, railYear, railNum, railEraOf, SNAPSHOTS } from './rail';

// ── The information architecture ────────────────────────────────────────────
// Eleven flat tabs do not fit a 44px rail: eleven uppercase items is ~800px of
// switcher and .tl-rail__end alone is ~450px. So the IA is two levels — six
// groups in .tl-switch, and a .tl-seg sub-switcher for the two groups that
// still show one (the Timeline group's moved into its own panel). Views
// therefore sit behind a seg, which is why the search field's "Views" group —
// reached by typing, or by ⌘K — is load-bearing rather than a nicety.

type ViewId =
  | 'map' | 'pop' | 'horizon'
  | 'vertical' | 'zoom'
  | 'flow' | 'braid'
  | 'conn' | 'cube' | 'core' | 'concepts';

type RailMode = 'live' | 'span' | 'legend' | 'off';

const GROUPS: { id: string; label: string; members: ViewId[] }[] = [
  { id: 'g-map', label: 'Map', members: ['map', 'pop', 'horizon'] },
  { id: 'g-time', label: 'Timeline', members: ['vertical', 'zoom'] },
  { id: 'g-flow', label: 'Flow', members: ['flow', 'braid'] },
  { id: 'g-conn', label: 'Connections', members: ['conn'] },
  { id: 'g-cube', label: 'Cube', members: ['cube'] },
  { id: 'g-core', label: 'Core', members: ['core'] },
];

// Per-group landing member. Timeline lands on 'zoom': the horizontal projection is
// the FLAGSHIP now — it carries the new spread-lane layout, the sharpness fades and
// the piecewise deep-time zoom. Vertical keeps its seat in the seg, and coming back
// to the group returns you to whichever you last used.
const GROUP_DEFAULT: Record<string, ViewId> = {
  'g-map': 'map', 'g-time': 'zoom', 'g-flow': 'flow', 'g-conn': 'conn', 'g-cube': 'cube', 'g-core': 'core',
};
const DEFAULT_VIEW: ViewId = 'map';

// The Timeline group's two members, read straight off GROUPS so the projection
// switch in the time rail can never drift from the group it projects.
const TIME_MEMBERS: ViewId[] = GROUPS.find(g => g.id === 'g-time')!.members;

// Concepts is deliberately NOT in the switcher: it is documentation about the
// tool, not a view of history. It stays reachable from ⌘K and from the
// "Concepts, rated →" link in the field-notes footer.
const groupOf = (v: ViewId): string => GROUPS.find(g => g.members.includes(v))?.id || 'g-map';

interface ViewMeta { seg: string; name: string; gist: string; meta: string; rail: RailMode }

const VIEWS: Record<ViewId, ViewMeta> = {
  map: {
    seg: 'Borders', name: 'World map + time dial', rail: 'live',
    gist: 'Fix a moment, show me everywhere — drag the index to move the world.',
    meta: '18 snapshots · 3000 BCE – 1994',
  },
  pop: {
    seg: 'People', name: 'People, not land', rail: 'live',
    gist: 'Where the people actually are — four thousand years of it, cell by cell.',
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
  core: {
    seg: 'Core', name: 'Core sample', rail: 'off',
    gist: 'Fix a place, show me every moment — strata of sovereigns under your feet.',
    meta: '18 strata · newest on top',
  },
  concepts: {
    seg: 'Concepts', name: 'Concepts, rated', rail: 'off',
    gist: 'The divergent set, scored and pruned. Every good view is a slice of one block.',
    meta: '10 concepts · 5 axes',
  },
};

const ORDER: ViewId[] = ['map', 'pop', 'horizon', 'vertical', 'zoom', 'flow', 'braid', 'conn', 'cube', 'core', 'concepts'];

// ── Which views dock the panel column instead of floating it ────────────────
// A floating panel is honest over a MAP — it sits on ocean, and the map has no
// furniture under it. It is a lie over a CHART. Every view in the timeline
// family draws row furniture in a fixed left gutter of its own canvas that the
// renderer cannot move: timeline band names at x=20 (timeline.ts), connections
// lane names at x=22 (connections.ts), and Flow's earliest ribbons starting at
// x=0. The 264px panel sat exactly there, so the first sight of the primary
// timeline was six unlabelled bands.
//
// These five give the column a strip of its own (shell.css §04) and the canvas
// takes the remaining width. Map, People, Horizon and Cube keep floating
// panels — verified sitting over ocean and over empty projection space.
// The two TIMELINE views left this set when the layer panel landed. The dock
// was a strip of app ground with a hairline down its right edge, holding a
// bordered "Controls" panel over it — and the founder's instruction was the
// opposite of that: "make the layers blend seamlessly to the workspace". The
// layer panel is now a flex item of the view itself, in the same colour the
// canvas paints, sharing the canvas's scroller (app.css, THE SEAM). The
// vertical projection has no panel at all any more, so it takes the full width.
const DOCKED: ReadonlySet<ViewId> = new Set<ViewId>(['flow', 'braid', 'conn']);

// ── Field notes ─────────────────────────────────────────────────────────────
// Everything the old <p class="lede"> and the hand-authored captions used to
// say, moved verbatim behind a popover. Onboarding is read once; a docked strip
// taxes every session after that and costs 8–10% of the viewport.
interface Notes { body: React.ReactNode; src?: React.ReactNode }

const NOTES: Record<ViewId, Notes> = {
  map: {
    body: <>
      <p>The <strong>&ldquo;Google Earth of history&rdquo;</strong> answer to <em>&ldquo;I see 1776 and can&rsquo;t imagine the world.&rdquo;</em> Drag the index along the bottom rail and every border on the map moves with it.</p>
      <p>Territories are real research data &mdash; 18 snapshots between 3000 BCE and 1994 &mdash; coloured by sovereign, the British Empire in its traditional atlas pink. Scroll to zoom, drag to pan, and <strong>click any territory to select it</strong> &mdash; the card that comes up can drill a core sample through everything that ever happened at that exact spot.</p>
    </>,
    src: <>Snapshots: 3000 · 1000 · 323 BCE · 1 CE · 400 · 800 · 1000 · 1279 · 1492 · 1600 · 1715 · 1783 · 1815 · 1880 · 1914 · 1938 · 1960 · 1994. Border data: aourednik/historical-basemaps (GPL-3.0) &mdash; scholarly approximation, since historical borders are fuzzy and contested by nature.</>,
  },
  pop: {
    body: <>
      <p>Not area, not borders &mdash; <strong>where the people actually are</strong>. A coarse density field over the land, one cell at a time. Asia holds two thirds of humanity for four thousand years, the Americas collapse after 1492, Africa surges in the last century. <strong>Press play.</strong></p>
      <p>The grid is deliberately visible, because the cell size <em>is</em> the resolution of the claim. &ldquo;Field&rdquo; smooths the same numbers for legibility; &ldquo;Plate&rdquo; shows you what was actually computed.</p>
    </>,
    src: <>What is data and what is model: the eight macro-region totals per slice are scholarly estimates (McEvedy &amp; Jones, Biraben, the UN &mdash; wide error bars before 1500), and every region&rsquo;s field is normalised to sum back to exactly that published number. The distribution <em>inside</em> a region is a hand-written table of 101 population centres plus desert, ice, altitude and latitude rules. Nobody measured that. Read it for shape and concentration, never for a local figure.</>,
  },
  horizon: {
    body: <>
      <p>The most novel idea on the list: not <em>what happened</em>, but <strong>what a person standing here could possibly have known yet</strong>. News moved at the speed of a horse, then a ship, then a telegraph.</p>
      <p>Pick a city and a year. The rings are how far word had travelled after a week, a month, six months; the list on the right is the world still in transit toward you.</p>
    </>,
    src: <>Calibrated against known cases: news of the Declaration of 4 July 1776 was printed in London on 17 August &mdash; about 5,900 km in 44 days, so roughly 130 km/day for an important dispatch in 1776.</>,
  },
  vertical: {
    body: <>
      <p>The scroll projection of the timeline. It reads down the page, which is how a person actually reads a chronology &mdash; and <strong>past is always at the top</strong>, in every state, with no flip.</p>
      <p>Rotating it buys one enormous thing: <strong>a label no longer has to fit inside the time it describes.</strong> Every mark gets its own full line of text beside it, at whatever length the title actually is, instead of being cut to the gap before the next event. On the <strong>Mozart&rsquo;s world</strong> preset that is <strong>nine of his thirteen life events named on screen at 1280&times;800 and ten at 1440&times;900, against six either way in the horizontal view</strong> &mdash; half again as many, and the ones that are there are not abbreviated.</p>
      <p><strong>Neither projection fits all thirteen in a laptop window, and this one does not claim to.</strong> Eight of them fall between 1778 and 1791 &mdash; thirteen years, about a seventh of the plot at that zoom. A label may step aside by up to 64px to find a clear line, drawing a hairline back to its true year; past that it is dropped rather than parked against the wrong decade, and the mark stays on the axis, hoverable and clickable. Twelve fit at 1920&times;1080, all thirteen at 2560&times;1440.</p>
      <p>The bands are now <strong>columns, each as wide as its own longest label needs</strong>, so the surface is usually wider than the window. <strong>Drag it like a map</strong> &mdash; up and down through time, left and right across the world, in one gesture. The strip under the plot is the whole surface in miniature; the bright frame is what you can see, and you can drag that too. A chip at an edge names the next column off-screen; click it to bring it in &mdash; and <strong>turning a lens on brings its own column in for you</strong>, so the thing you just asked to see is never the thing off the right edge.</p>
      <p><strong>It shares this group&rsquo;s controls on purpose:</strong> vertical and horizontal are two projections of one timeline state &mdash; the same span, the same lanes, the same domains, the same search. The <strong>Projection</strong> switch sits in the time rail, bottom right; flipping it changes the projection, never the subject.</p>
      <p>This projection still draws the older shape grammar and only the hand-curated corpus; the new spread lanes, sharpness fades, and the polity rows land here next round.</p>
    </>,
    src: <>Faint hairlines mean a label had to step aside to stay legible &mdash; the mark is always at the true year, and a mark whose label was dropped is still drawn, still hoverable and still clickable. Column widths are measured over a window padded by a screenful of time above and below, so travelling does not make the columns breathe under your hand. A lens column sits next to the time axis rather than at the far end, because a lens is something you asked for.</>,
  },
  zoom: {
    body: <>
      <p>Your core vision: <strong>a map of time with level of detail</strong>. Zoomed out you see only what matters most; scroll to zoom in and smaller things fade in, exactly like streets appearing on Google Maps &mdash; and the wheel alone now runs from a decade to the Big Bang on one continuous scale.</p>
      <p><strong>Two kinds of thing.</strong> A <strong>spread</strong> is anything with duration &mdash; an empire, a war, a life, a movement, an era &mdash; drawn as a rectangle in its own row, biggest first, never overlapping another. Its edges carry its nature: a dynasty founded on a date ends crisply, the Renaissance dissolves at both ends. An <strong>event</strong> is a moment: a dot, in its own stratum below the spreads. Colour says which domain; height says how much it mattered.</p>
      <p><strong>Click anything to select it</strong> &mdash; everything related stays lit in proportion to how strongly it is related (the same weighted links as the Connections view), the Related panel lists them, and Wikipedia is one click away in that panel. Click empty canvas to clear.</p>
    </>,
    src: <>Importance is an editorial ladder, not a measurement. The five levels are thresholds on the visible span, so the same thing appears and disappears with the zoom rather than with the data. Rows are packed once, importance first, so zooming reveals more without reshuffling what you were looking at.</>,
  },
  flow: {
    body: <>
      <p>Empires as <strong>flowing ribbons whose thickness is their weight in the world</strong>, and lineage as forks: the Roman Empire splits into West and East, the East runs on for a thousand years as Byzantium, and the Ottomans absorb it.</p>
      <p>The 1931 Histomap idea, rebuilt with real lineage links. <strong>Hover any ribbon to light up its whole ancestry.</strong></p>
    </>,
    src: <>Weights are editorial estimates of reach and consequence, hand-curated for this prototype &mdash; not measurements.</>,
  },
  braid: {
    body: <>
      <p>Your own sketch, working: beliefs as streams that <strong>fork at schisms and occasionally merge</strong>. Christianity splits at 1054 and again at 1517; Islam at 632.</p>
      <p>The same engine as the flow of empires &mdash; because a schism and an imperial partition are the same shape of event.</p>
    </>,
    src: <>Thickness is an editorial estimate of reach, not a measurement of adherents.</>,
  },
  conn: {
    body: <>
      <p>An <strong>event</strong> happens at a point in time. An <strong>entity</strong> persists and is in one place at a time. A <strong>spread</strong> persists and is in <em>many</em> places at once, with a footprint that moves and an intensity that waxes and wanes &mdash; printing, an empire, a religion.</p>
      <p>Spreads are drawn with the same ribbon engine as the flow of empires, so they swell and taper instead of sitting in a rectangle, and the events that belong to one are drawn <em>inside</em> it: Mainz 1439 is a point within the printing ribbon. <strong>Click anything</strong> &mdash; everything related stays lit in proportion to how strongly it is related, everything else dims but stays on screen as context.</p>
    </>,
    src: <>The four lanes are <strong>queries, and they overlap on purpose</strong>: Europe is a region match, the other three are category matches. An item is drawn solid in whichever lane matches it most strongly and hollow wherever else it also matches, so the British Empire appears once in <em>Europe</em> as a filled ribbon and again in <em>Power &amp; economy</em> as an outline. Selecting it threads every copy together, so the repetition reads as information.</>,
  },
  cube: {
    body: <>
      <p>Your third take, built for real this time: <strong>latitude × longitude × time as one solid block.</strong> The map is a horizontal slice through it, the core sample is a vertical drill, the timeline is its shadow on the wall.</p>
      <p><strong>Reading the block:</strong> the translucent stack is eighteen world maps as real extruded sheets, oldest at the bottom. The traced polity is not drawn on those sheets &mdash; it is a <strong>volume</strong> through them, so an empire that persists is a column, one that grows is a cone, and a conquest is where one body swallows another.</p>
      <p><strong>Drag</strong> to orbit whatever is under the cursor &mdash; the pivot moves to the depth you clicked, so what you are looking at stays on screen. <strong>Right-drag</strong> pans, <strong>scroll</strong> zooms toward the pointer, <strong>double-click</strong> flies somewhere. <kbd>R</kbd> home &middot; <kbd>T</kbd> top &middot; <kbd>F</kbd> front &middot; <kbd>E</kbd> side &middot; <kbd>Z</kbd> frame the trace &middot; <kbd>I</kbd> isometric &middot; <kbd>A</kbd> single slice &middot; <kbd>P</kbd> play.</p>
    </>,
    src: <>What is data and what is inference: the <strong>bright rules</strong> around the solid are the eighteen dates somebody actually mapped; everything between them is a signed-distance blend and the material is deliberately darker there. <strong>Cut through time</strong> is capped with a lighter section face, the way a technical drawing distinguishes a cut from a surface. In <strong>single slice</strong> the ghost world cross-fades between two real snapshots and never invents a map for an in-between date &mdash; the readout says &ldquo;interpolated&rdquo; for exactly as long as that is what you are seeing. The rail below is a legend for the block&rsquo;s third axis, not a control.</>,
  },
  core: {
    body: <>
      <p>The map asks <em>&ldquo;fix a moment, show me everywhere.&rdquo;</em> The core sample asks the opposite: <strong>fix a place, show me every moment.</strong></p>
      <p>Like a geological drill &mdash; newest layer on top, dig down into the past. Click anywhere on the world map, or pick a famous drill site.</p>
    </>,
    src: <>The time rail is hidden here on purpose: the eighteen strata <em>are</em> the time axis, running down the page. A rail that cannot be operated is noise.</>,
  },
  concepts: {
    body: <>
      <p>The divergent set, scored and pruned. The unlock: they aren&rsquo;t competitors. <strong>History is one 3-D block (place × place × time), and every good view is a slice or projection of it.</strong></p>
      <p>The map is a horizontal slice, the core sample a vertical drill, the timeline a shadow &mdash; and the cube, now built, is the block itself.</p>
    </>,
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
  WorldMap.init(); TL.init(); LayerPanel.init(); VT.init(); initFlow(); Cube.init(); Core.init(); initBraid(); Horizon.init(); Pop.init(); buildGallery();
  initConn();
  WorldMap.render();
  // diagnostic handle for acceptance probes and console debugging — reads only
  (window as any).__tl = { TL, VT, Conn, WorldMap, Cube, TimeStore, SelStore, SelCard, Layers, LayerPanel };
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
  Flow.H = H; Braid.H = H; Cube.H = H;
  TL.HMAX = H;                     // the lane-trim budget, not a fixed height
  // Below 760px every panel becomes a bottom SHEET fixed over the canvas
  // (shell.css §13). Every full-height view loses its bottom strip to it, but only
  // the vertical timeline keeps a CONTROL down there — the pan rail that says which
  // columns you are looking at. So it alone gets a canvas short enough to clear the
  // sheet, measured rather than assumed so it also tracks the sheet being opened.
  let vH = H;
  if (typeof matchMedia !== 'undefined' && matchMedia(NARROW).matches) {
    const sheet = document.querySelector<HTMLElement>('.tl-panel--tl:not([hidden])');
    if (sheet) vH = Math.max(320, H - Math.min(sheet.offsetHeight + 6, Math.round(H * 0.45)));
  }
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
    case 'braid': Braid.render(); break;
    case 'conn': Conn.dirty = true; Conn.render(); break;
    case 'cube': Cube.render(); break;
    case 'core': break;                           // no canvas
    case 'concepts': break;                       // no canvas
  }
}

const rerenderAll = () => {
  sizeRenderers();
  WorldMap.render(); TL.render(); VT.render(); Flow.render(); Cube.render(); Braid.render(); Horizon.render(); Pop.render();
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

   replaceState, NEVER pushState: eleven views one keystroke apart would turn
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
     v  WHERE TO LOOK    the eleven views.
*/
type SRow =
  | { k: 'c'; h: Hit; p: RevealPlan }
  | { k: 'l'; l: LayerHit }
  | { k: 'v'; v: ViewId };

/**
 * THE ROW'S SECOND LINE — what stands between this hit and the canvas, in the
 * fewest words that are still true. Null when nothing does, which is the
 * common case and draws no line at all.
 */
function needLine(p: RevealPlan): string | null {
  if (p.need === 'never') return p.why || 'not drawn on this timeline';
  if (!p.layerName) return null;
  if (p.need === 'add') return `in ${p.layerName} — not added`;
  if (p.need === 'show') return `in ${p.layerName} — hidden`;
  if (p.need === 'detail') return `in ${p.layerName} — needs more detail`;
  return null;
}

/** The same verdict as a whole sentence, for the row's title attribute. */
function needTitle(p: RevealPlan, name: string): string | null {
  const raise = p.detailWord ? ` and sets it to “${p.detailWord}”` : '';
  if (p.need === 'never') return `${name} is ${p.why || 'not drawn on this timeline'}, so there is nothing here to zoom to.`;
  if (p.need === 'add') return `Adds the “${p.layerName}” layer${raise}, then selects ${name} and frames it.`;
  if (p.need === 'show') return `Un-hides “${p.layerName}”${raise}, then selects ${name} and frames it.`;
  if (p.need === 'detail') return `Raises “${p.layerName}” to “${p.detailWord}”, then selects ${name} and frames it.`;
  return null;
}

/* A ROW THAT CANNOT ACT IS NOT IN THE ARROW ORDER. A content hit whose thing is
   not drawn on this timeline at all (a belief stream, a spread with no
   footprint) stays in the list because it is still a truthful answer to the
   word, but the cursor steps over it and Enter cannot land on it — the same
   rule the group headers have always followed. */
const canTake = (r: SRow) => !(r.k === 'c' && r.p.need === 'never');
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
  info: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.2" /><path d="M8 7.2v4" /><path d="M8 4.7v.6" /></svg>,
  theme: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" /></svg>,
  prev: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>,
  next: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>,
  close: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  // The two projections, drawn as what they are: lanes running down the page,
  // and lanes running across it. Shown only where the words will not fit.
  projV: <svg className="tl-projseg__glyph" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
    <rect x="2" y="2" width="2.4" height="10" rx="1" /><rect x="5.8" y="2" width="2.4" height="7" rx="1" /><rect x="9.6" y="2" width="2.4" height="10" rx="1" />
  </svg>,
  projH: <svg className="tl-projseg__glyph" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
    <rect x="2" y="2" width="10" height="2.4" rx="1" /><rect x="2" y="5.8" width="7" height="2.4" rx="1" /><rect x="2" y="9.6" width="10" height="2.4" rx="1" />
  </svg>,
};

export default function Lab() {
  const [view, setView] = useState<ViewId>(DEFAULT_VIEW);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [collapsedBy, setCollapsedBy] = useState<boolean | null>(null);
  // THE DOCKED "RELATED" PANEL IS CLOSED BY DEFAULT. The selection card carries
  // the top three or four relations already; the dock exists for the moment you
  // want the whole ranked list, and it is reached from the card's
  // "All connections →". Opening it costs 92px of a shared column otherwise.
  const [relOpen, setRelOpen] = useState(false);
  const booted = useRef(false);
  // Coming back to a group should return you to where you were in it. Seeded
  // from GROUP_DEFAULT; the vertical port flips that seed, not this.
  const lastMember = useRef<Record<string, ViewId>>({ ...GROUP_DEFAULT });
  // Which views' field notes have been read. Deliberately NOT React state: the
  // markup ships with the dot on (correct for a first visit, and identical on
  // the server), and an effect clears it once localStorage has been consulted.
  const seen = useRef<Set<string>>(new Set());
  const narrow = useSyncExternalStore(subNarrow, () => matchMedia(NARROW).matches, () => false);
  const collapsed = collapsedBy ?? narrow;
  const viewRef = useRef<ViewId>(view);
  // Declared FIRST so it is up to date before any effect below reads it.
  useEffect(() => { viewRef.current = view; });

  const meta = VIEWS[view];
  // Concepts is outside the switcher, so NOTHING in the switcher is selected
  // while it is open — a rail that says MAP over a page of concept cards lies.
  const group = view === 'concepts' ? '' : groupOf(view);
  const members = group ? GROUPS.find(g => g.id === group)!.members : [];

  // ── view state ────────────────────────────────────────────────────────────
  // Tolerates unknown ids, and maps the legacy alias 'sketch' -> 'braid'.
  // gallery.ts still emits data-goto="sketch" on three cards (SHELL does not own
  // that file in this pass), so all three land on Beliefs rather than on Beliefs,
  // Horizon and People respectively. Logged as a follow-up.
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
        const [worlds, datasets, lanes, polities] = await Promise.all([
          grab('/data/worlds.json'), grab('/data/datasets.json') as Promise<Datasets>,
          grab('/data/lanes.json').catch(() => ({ lanes: [] })),   // curated lanes; tolerant
          // The time-gated polity → sovereign alias table. The cube already
          // fetches this from inside its own chunk; the map's territory
          // highlight needs it WITHOUT paying for three.js, so it is loaded
          // here and handed to subject.ts. Same posture as the rest: tolerant.
          grab('/data/polities.json').catch(() => ({ polities: [] })),
          loadRelations(),                       // Connections; a miss must not stop the boot
          loadPopulation(),                      // Map · People; same posture
        ]);
        initData(worlds, datasets);
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
        // eleven views, so the card's verbs are injected from here rather than
        // imported — which is also why selcard.ts can be imported BY the
        // renderers without a cycle.
        SelCard.wire({
          // THE CORE LOOP. "Zoom to X" on the timeline and "See on timeline" on
          // the map are the same move: frame the window on its span and show
          // the horizontal projection. It writes no year of its own — the
          // centre-year observer below turns the new window into the new
          // moment, once, in one place.
          perspective: (a, b) => { TL.clearSearch(); frameSettled(a, b); go('zoom'); },
          // AT THE CURRENT GLOBAL YEAR — syncToYear moves the map to the nearest
          // snapshot without writing TimeStore back.
          seeOnMap: () => { WorldMap.syncToYear(TimeStore.year); go('map'); },
          traceInCube: (pid) => { Cube.select(pid); go('cube'); },
          // Fix a place, show every moment. This is where the map's old
          // click-to-drill went: it is now a named action on the card, at the
          // point the user actually pointed at.
          drillAt: (lon, lat, label) => { Core.drill(lon, lat, label); go('core'); },
          allConnections: () => setRelOpen(true),
          mapYear: () => (WorldMap as any).year(),
          anchorOf: (id) => {
            const v = viewRef.current;
            if (v === 'zoom') return TL.anchorOf(id);
            if (v === 'vertical') return VT.anchorOf(id);
            return null;
          },
        });
        SelCard.setView(viewRef.current);
        setReady(true);
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
        year = (WorldMap as any).year();
        era = `${railEraOf(year)} · ${WorldMap.ix + 1}/18`;
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

    // mode === 'span': the canvas axis IS time, but the view is a zoom WINDOW,
    // not a moment. The rail shows the full extent with the visible window drawn as a
    // bracket — and the red index sits at the GLOBAL moment (TimeStore), because the
    // index means "where you are" app-wide now, not the window's centre.
    const src: any = v === 'flow' ? Flow : v === 'braid' ? Braid : v === 'conn' ? Conn : TL;
    const d0 = Number(src.d0), d1 = Number(src.d1);
    const a = railPos(d0), b = railPos(d1);
    const centre = (d0 + d1) / 2;
    const pct = railPos(TimeStore.year);
    setIndex(pct);
    if (span) { span.hidden = false; span.style.left = a + '%'; span.style.width = Math.max(0.4, b - a) + '%'; }
    stops.forEach(s => s.dataset.here = 'false');
    const flag = document.getElementById('railFlag');
    if (flag) flag.textContent = railNum(TimeStore.year);
    txt('railYear', railNum(TimeStore.year));
    txt('railEra', (v === 'zoom' || v === 'vertical') && TL.span() > 60000
      ? 'DEEP TIME · BIG BANG → NOW'
      : `${railEraOf(centre)} · SPAN ${Math.round(d1 - d0).toLocaleString('en-US')} YRS`);
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
  useEffect(() => { if (ready) renderTab(viewRef.current); }, [collapsed, ready]);

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

  // Below 1024 the switcher takes its own scrolling row (shell.css §13). On a
  // phone that row is wider than the screen, and the .tl-seg — the whole reason
  // a group has more than one view — sits past its right edge behind the fade.
  // So after a deliberate move, park whatever is contextual inside the row.
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
    const segEl = document.getElementById('viewSeg');
    // offsetParent is null while the seg is display:none for a single-member group.
    const target: HTMLElement | null = segEl && segEl.offsetParent
      ? segEl
      : mid.querySelector<HTMLElement>('.tl-switch__item[aria-selected="true"]');
    target?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [view]);

  /* ═══ THE SWITCHER ROW'S OVERFLOW, SAID OUT LOUD ═══════════════════════════

     At 390px the row wants 623px: six group names are 377 of it and the Map
     group's seg — Borders / People / Horizon — is another 190, so the seg sits
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
              : v === 'braid' ? `b${Braid.d0}|${Braid.d1}`
                : v === 'conn' ? `c${Conn.d0}|${Conn.d1}`
                  : `t${TL.d0}|${TL.d1}|${TL.log}`)
        + `|${TimeStore.year}|${SelStore.id ?? ''}`;   // the global stores nudge the rail too
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
    const src: any = v === 'flow' ? Flow : v === 'braid' ? Braid : v === 'conn' ? Conn : TL;
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


  /**
   * ONE QUERY, TWO KINDS OF ANSWER.
   *
   * Content comes from search.ts (the same corpus the canvas dims); views come
   * from the VIEWS table, which only this file has. They are ranked as one list
   * with content first — because "what happened" is the question this app is
   * for, and the eleven views are a fixed set the user learns once.
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
    const cRows: SRow[] = hits.map(h => ({ k: 'c', h, p: planReveal(h.id) }));
    const lRows: SRow[] = layers.map(l => ({ k: 'l', l }));
    const vRows: SRow[] = views.map(v => ({ k: 'v', v }));
    const body = laneFirst ? [...lRows, ...cRows] : [...cRows, ...lRows];
    return {
      rows: navFirst ? [...vRows, ...body] : [...body, ...vRows],
      total: total - hits.length,
    };
  }, []);

  /* THE LANE ROW'S GESTURE. Add-or-locate, and the difference is only whether
     the lane is already on the board — the founder's "I could also search for
     existing lane, which would just highlight it."

     The flash has to happen AFTER the panel has rebuilt: Layers.emit() runs
     LayerPanel.build(), which replaces every row element, so a class set before
     the add would be thrown away with the node it was on. And the panel only
     exists on the horizontal timeline, so a lane row also navigates there —
     locating a lane on a view that has no lanes is not locating anything. */
  const flashLayer = useCallback((id: string) => {
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
   * TAKE A ROW — and on the content branch, EARN THE FRAME FIRST.
   *
   * The founder: "Make sure its impossible to zoom in on something that does
   * not exist." So the order here is not decoration, it is the whole fix:
   *
   *   1. re-plan against the board AS IT IS NOW (the row was built a few
   *      keystrokes ago, and the reader may have changed the board since);
   *   2. if the plan is `never`, do nothing at all — no selection, no frame.
   *      The row is disabled in the markup too, so this is a second lock on a
   *      door that is already bolted;
   *   3. reveal() — add the layer, open its eye, raise its dial, whatever the
   *      verdict said, in ONE emit;
   *   4. only now select and frame.
   *
   * Nothing between 3 and 4 can fail: reveal() has already made Layers.has,
   * Layers.visible and passesDetail all true for the layer that draws it.
   */
  const takeRow = useCallback((r: SRow) => {
    if (r.k === 'c' && r.p.need === 'never') return;     // the door is bolted here too
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

    const plan = planReveal(r.h.id);
    if (!reveal(plan)) return;                           // not drawable — never frame
    const sub = describe(r.h.id);
    SelCard.select(r.h.id, null);
    if (sub) { const [a, b] = perspectiveSpan(sub); frameSettled(a, b); }
    go('zoom');
    // A LANE THAT WAS JUST TURNED ON IS AT THE BOTTOM OF THE BOARD. frameTo
    // moves the window along TIME; it cannot move the surface DOWN, and a lane
    // added by this gesture lands under every lane that was already there —
    // below the fold on anything but a very tall window. The panel shares one
    // scroller with the canvas (layerpanel.ts's whole design), so scrolling the
    // lane's PANEL ROW into view brings the lane itself with it. Only when this
    // gesture actually changed the board: a hit that was already showing is
    // where the reader left it, and moving the surface under them would be a
    // courtesy nobody asked for.
    if (plan.need !== 'ready' && plan.layer) flashLayer(plan.layer);
  }, [closeSearch, go, flashLayer]);

  // The box is markup this file owns but timeline.ts wires; these listeners are
  // additional, never replacements, so nothing about the dimming changes.
  useEffect(() => {
    if (!ready) return;
    const box = document.getElementById('cmdk') as HTMLInputElement | null;
    if (!box) return;

    const onInput = () => {
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
        // screen — a dim with nothing to explain it.
        else { box.value = ''; TL.clearSearch(); box.blur(); }
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
  }, [ready, placeSearch, closeSearch, takeRow, buildRows]);

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

  // ── field notes ───────────────────────────────────────────────────────────
  const openNotes = useCallback((open: boolean) => {
    setNotesOpen(open);
    if (!open) return;
    if (!seen.current.has(viewRef.current)) {
      seen.current.add(viewRef.current);
      try { localStorage.setItem('tl-notes-seen', JSON.stringify([...seen.current])); } catch { /* ignore */ }
    }
    paintUnread(seen.current, viewRef.current);
  }, []);

  // ── theme: system → dark → light → system ─────────────────────────────────
  const cycleTheme = () => {
    const el = document.documentElement;
    const cur = el.getAttribute('data-theme');
    const next = cur === null ? 'dark' : cur === 'dark' ? 'light' : null;
    if (next) { el.setAttribute('data-theme', next); try { localStorage.setItem('tl-theme', next); } catch { /* ignore */ } }
    else { el.removeAttribute('data-theme'); try { localStorage.removeItem('tl-theme'); } catch { /* ignore */ } }
  };

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
      if (e.key === 'Escape') { if (notesOpen) { setNotesOpen(false); document.getElementById('notesBtn')?.focus(); } return; }
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

  // ── derived flags ─────────────────────────────────────────────────────────
  const railOn = meta.rail !== 'off';
  const scaleCell = meta.rail === 'live'
    ? (view === 'map' ? 'yearSlider' : view === 'pop' ? 'popSlider' : 'railRange')
    : meta.rail === 'span' ? 'railRange' : 'none';
  const yearCell = view === 'map' ? 'map' : view === 'pop' ? 'pop' : 'rail';
  const tpCell = view === 'map' ? 'map'
    : view === 'pop' ? 'pop'
      : view === 'vertical' || view === 'zoom' ? 'time'
        : 'none';
  // THE HEADER CARRIES NAVIGATION AND GLOBAL CHROME, NOTHING ELSE.
  //
  // Two of the three multi-member groups are genuinely navigation: Map's seg
  // moves between three different questions (borders, people, what could be
  // known), Flow's between two different subjects. The Timeline group's seg is
  // the odd one out — the same timeline, drawn down the page or across it,
  // sharing one span, one selection, one search and one set of layers. That is
  // a CONTROL of the view, not a way to another one, and a control of the view
  // does not belong in the application header. So the Timeline group shows no
  // seg up here and the projection switch lives in the time rail (see the
  // tp-time cell in the transport, below).
  //
  // WHY THE RAIL AND NOT THE TOP OF THE LAYER PANEL — the other candidate:
  //   · the layer panel exists in the HORIZONTAL projection only (#layerPanel
  //     is a child of the zoom section; the vertical projection has no panel at
  //     all and takes the full stage width). A switch parked there would be a
  //     one-way door: you could leave horizontal and never come back;
  //   · below 760px the panel stands down entirely (app.css) — same trap;
  //   · and every row in that panel is positioned from the canvas's own lane
  //     geometry, every frame. A control row would be the one element in it
  //     with a height of its own, against the geometry lock it is built on.
  // The rail already IS the per-view control cluster: it carries the transport
  // for the live views and the span readout for these two, and it is where the
  // founder asked for the controls to be — beside play.
  const seg = members.length > 1;
  const segInHeader = seg && group !== 'g-time';
  // The engraving on the scale: the 18 world snapshots for Map and Cube, the
  // population slices for People, nothing for the span views (they get a bracket).
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
    // The collapse control belongs to the PRIMARY panel only. Connections now
    // stacks a secondary panel at the top of the same column, and without this
    // the chevron on Controls would fold "Related" away with it.
    'data-collapsed': corner === 'tl' && !(extra || '').includes('secondary') && collapsed ? 'true' : undefined,
    hidden: !forViews.includes(view),
    'aria-label': title,
  });

  // The primary panel's header, with the collapse control shell.css already
  // styles. On a phone this is the difference between a canvas and a sheet.
  const hd = (title: string) => (
    <div className="tl-panel__hd">
      <span className="tl-panel__title">{title}</span>
      <button className="tl-iconbtn" style={{ width: 24, height: 24 }}
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'} aria-expanded={!collapsed}
        onClick={() => setCollapsedBy(!collapsed)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
          style={collapsed ? { transform: 'rotate(180deg)' } : undefined}><path d="M4 6.5L8 10.5L12 6.5" /></svg>
      </button>
    </div>
  );

  return (
    <>
      <div className="tl-app" id="app" data-rail={railOn ? 'on' : 'off'}>

        {/* ══ TOP RAIL ═════════════════════════════════════════════════════ */}
        <header className="tl-rail">
          <span className="tl-mark">
            <span className="tl-mark__glyph" aria-hidden="true">{I.mark}</span>
            <span className="tl-mark__word">Timeline</span>
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

            {/* The seg is NAVIGATION between sibling views — Borders / People /
                Horizon, Empires / Beliefs. The Timeline group's is not:
                vertical and horizontal are two PROJECTIONS of one state, which
                is a control of the view rather than a way to another one. It
                lives in the time rail's control cluster instead, beside where
                Play sits on the views that have one. See segInHeader. */}
            <div className="tl-seg" id="viewSeg" role="group" aria-label="View"
              style={segInHeader ? undefined : { display: 'none' }}>
              {/* Rendered only when this seg is navigation. Keeping the Timeline
                  members here under display:none would leave a second, silent
                  copy of the projection switch in the header — the very control
                  this is getting out of it. */}
              {segInHeader && members.map(m => (
                <button key={m} className="tl-seg__item" aria-pressed={m === view} onClick={() => leaveSearch(m)}>
                  {VIEWS[m].seg}
                </button>
              ))}
            </div>

          </div>

          {/* THE SCROLL AFFORDANCE — the second half of the data-ovf work above.
              Absolutely positioned against the rail rather than placed in its
              grid, so adding them cannot invent a fourth column; app.css shows
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
              <kbd className="tl-kbd">⌘K</kbd>
            </div>
            <button className="tl-iconbtn" id="notesBtn" aria-expanded={notesOpen} aria-controls="fieldNotes"
              aria-label="Field notes for this view" title="Field notes  ?"
              data-unread="true"
              onClick={() => openNotes(!notesOpen)}>
              {I.info}
            </button>
            <button className="tl-iconbtn" id="themeBtn" aria-label="Switch theme" title="Theme: system → dark → light"
              onClick={cycleTheme}>
              {I.theme}
            </button>
          </div>
        </header>

        {/* ══ STAGE ════════════════════════════════════════════════════════ */}
        <main className="tl-stage" id="stage" data-dock={DOCKED.has(view) ? 'left' : undefined}>
          <div className="tl-graticule" aria-hidden="true" />

          {/* ── Map · Borders ─────────────────────────────────────────────── */}
          <section {...sect('map')}>
            <div className="tl-canvasbox"><canvas id="mapCanvas" height={520} /></div>
          </section>

          {/* ── Map · People ──────────────────────────────────────────────── */}
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

          {/* ── Core — no canvas; the strata ARE the time axis ────────────── */}
          <section {...sect('core')}>
            <div className="tl-doc">
              <div className="caption" id="coreWhere" />
              <div className="presetrow" id="corePresets" />
              <div className="strata" id="strata" />
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
              row: at 900x700 the People view's Names toggle was covered, not
              merely ugly. One flex column per side gives the pair a shared
              height budget they cannot exceed. Corner classes stay — they are
              what the column reads to decide which panel hugs the bottom. */}
          <div className="tl-col tl-col--l">
            {/* map */}
            <aside {...panel('tl', ['map'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-cluster">
                  <button className="btn" id="btnReset" title="Reset zoom and pan">Reset view</button>
                </div>
                <p className="note">Scroll to zoom · drag to pan · click any territory to select it.</p>
              </div>
            </aside>
            {/* pop */}
            <aside {...panel('tl', ['pop'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              {/* population.ts appendChild()s its own controls into #popPanel. */}
              <div className="tl-panel__bd" id="popPanel" />
            </aside>
            {/* horizon */}
            <aside {...panel('tl', ['horizon'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-field-group">
                  <span className="tl-label">Standing in</span>
                  <select id="hzCity" aria-label="City" defaultValue="" style={{ width: '100%' }} />
                </div>
                <div className="tl-field-group">
                  <span className="tl-label">In the year</span>
                  <input type="number" id="hzYear" defaultValue="1776" style={{ width: '100%' }} />
                  <div className="tl-cluster">
                    <button className="chip" data-hz="1776">1776</button>
                    <button className="chip" data-hz="1492">1492</button>
                    <button className="chip" data-hz="1889">1889</button>
                  </div>
                </div>
                <hr className="tl-hr" />
                <span className="note" id="hzSpeed" />
              </div>
            </aside>
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
            <aside {...panel('tl', ['flow'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-cluster">
                  <button className="btn hero" id="flowRome">Follow Rome</button>
                  <button className="btn" id="flowSplit">The great split</button>
                  <button className="btn" id="flowAll">Whole span</button>
                  <button className="btn" id="flowMode">Absolute scale</button>
                </div>
                <div className="searchwrap">
                  <input type="text" id="flowSearch" style={{ width: '100%' }}
                    placeholder="Find a polity… (Rome, Persia, Mali)" />
                  <span className="cnt" id="flowCnt" />
                </div>
                <hr className="tl-hr" />
                <div className="tl-field-group">
                  <span className="tl-label">Regions</span>
                  {/* MUST ship EMPTY — flow.ts appendChild()s into it. */}
                  <div className="tl-cluster" id="flowRegionRow" />
                </div>
              </div>
            </aside>
            {/* braid */}
            <aside {...panel('tl', ['braid'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-cluster">
                  <button className="btn hero" data-braid="religion">Religions</button>
                  <button className="btn" data-braid="ideology">Political ideologies</button>
                </div>
                <span className="note" id="braidNote" />
              </div>
            </aside>
            {/* conn — every id and class from the old #tab-conn subtree, intact.
                THE GRAMMAR LEGEND IS FOLDED IN HERE rather than floating at the
                bottom right of the canvas: see the note on .tl-col--r below for
                why Connections has no right-hand panels any more.
                buildConnLegend() fills #connGrammar by id, so it does not care
                that the element now lives inside a <details>. */}
            <aside {...panel('tl', ['conn'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-cluster">
                  <button className="btn hero" id="connIR">Click the Industrial Revolution</button>
                  <button className="btn" id="connPrint">Printing, from Mainz outward</button>
                  <button className="btn" id="connAll">Whole span</button>
                  <button className="btn" id="connMode">Share of lane</button>
                  <button className="btn" id="connClear">Clear selection</button>
                </div>
                <span className="note">scroll to zoom · drag to pan</span>
                {/* #connCap is not a reading of the selection — connections.ts
                    writes one fixed block of prose into it that explains the
                    view, plus a live counts line. It had a panel of its own on
                    the bottom left, which meant three panels sharing one 667px
                    column and a per-selection list starved down to a 60px
                    window. As standing explanation it folds, and "Related" —
                    the one thing here that answers a click — gets the column. */}
                <details className="tl-disc">
                  <summary>Reading<span className="tl-disc__v">how to read this</span></summary>
                  <div className="tl-disc__bd"><div className="caption" id="connCap" /></div>
                </details>
                <details className="tl-disc">
                  <summary>Grammar<span className="tl-disc__v">shape &amp; weight</span></summary>
                  <div className="tl-disc__bd"><div className="grammar" id="connGrammar" /></div>
                </details>
              </div>
            </aside>
            {/* CUBE. One panel, not two: splitting ~14 controls across a --tl
                and a --tr panel would have hidden half of them on a phone,
                where app.css keeps only the primary panel. Every id below is
                resolved once by cube.ts; #cubeChain ships EMPTY because cube.ts
                writes the lineage chips into it.

                AND IT DOES NOT SCROLL ITS PRIMARY CONTROLS AWAY. One flat list
                of fourteen controls was 1086px of instrument in a 531px body at
                1280x800: Fly to, Ghost world, Cut through time, Single slice,
                Time axis, Snapshot outlines, Ghost coastlines and Auto-orbit
                were all below the fold, behind a scroll with no cue that
                anything was down there. More than half the richest instrument
                in the app, invisible on an ordinary laptop.

                So the panel is now three tiers, split by what a reader is doing
                rather than by what the engine exposes:

                  OPEN, ALWAYS — the subject. What am I looking at, and what is
                  it made of: trace, lineage, and how the trace is built.
                  <details> CUT & SLICE — the two ways of taking the block
                  apart. Off by default, and both are verbs, not settings.
                  <details> VIEW & DETAIL — camera presets, projection, mesh,
                  and the four ways of drawing the ghost world.

                Every summary row is visible without scrolling, so "there is
                more, and here is what it is" is now a piece of the layout
                rather than a fact about a scrollbar. cube.ts opens a group
                whose contents are no longer at rest (paintDisc), so a closed
                group can never hide a setting that is doing something. */}
            <aside {...panel('tl', ['cube'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-field-group">
                  <span className="tl-label">Trace a polity</span>
                  <div className="searchwrap">
                    <input type="text" id="cubeFilter" style={{ width: '100%' }} autoComplete="off" spellCheck={false}
                      placeholder="rome, ottoman, han…" aria-label="Find a polity to trace" />
                    <span className="cnt" id="cubeCnt" />
                  </div>
                  <select id="cubeSov" aria-label="Polity to trace" defaultValue="" style={{ width: '100%' }} />
                  <span className="note" id="cubeNote" />
                </div>
                <div className="tl-field-group">
                  <span className="tl-label">Follow lineage<span className="tl-label__v" id="cubeLineageV" /></span>
                  <div className="tl-seg" id="cubeLineage" role="group" aria-label="Lineage depth">
                    <button className="tl-seg__item" data-v="0">Off</button>
                    <button className="tl-seg__item" data-v="1">1</button>
                    <button className="tl-seg__item" data-v="2">2</button>
                    <button className="tl-seg__item" data-v="3">3</button>
                  </div>
                  {/* MUST ship EMPTY — cube.ts appendChild()s the chain. */}
                  <div className="tl-cluster" id="cubeChain" />
                </div>
                <div className="tl-field-group">
                  <span className="tl-label">Solid</span>
                  <div className="tl-seg" id="cubeMode" role="group" aria-label="How the trace is built">
                    <button className="tl-seg__item" data-v="lofted">Volume</button>
                    <button className="tl-seg__item" data-v="prisms">Prisms</button>
                    <button className="tl-seg__item" data-v="off">Off</button>
                  </div>
                </div>

                {/* ── CUT & SLICE. The two verbs. Both are off at rest, which is
                    what makes them safe to fold away — and cube.ts opens this
                    group the moment either one stops being at rest, including
                    when the A or P shortcut is what turned it on. */}
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
                      <label className="tl-toggle">
                        <input type="checkbox" id="cubeCaps" defaultChecked />
                        <span className="tl-toggle__track" /><span className="tl-toggle__label">Cap the cut</span>
                      </label>
                    </div>
                    <div className="tl-field-group" id="cubeSliceRow" data-off="true">
                      <span className="tl-label">Single slice<span className="tl-label__v" id="cubeSliceV">off</span></span>
                      <label className="tl-toggle">
                        <input type="checkbox" id="cubeSlice" />
                        <span className="tl-toggle__track" /><span className="tl-toggle__label">One snapshot at a time</span>
                      </label>
                      <div className="tl-cluster tl-transport" id="cubeStep">
                        <button className="tl-iconbtn" data-a="prev" aria-label="Previous snapshot" title="Previous  [">{I.prev}</button>
                        <button className="btn" data-a="play" id="cubePlay" aria-pressed="false">Play</button>
                        <button className="tl-iconbtn" data-a="next" aria-label="Next snapshot" title="Next  ]">{I.next}</button>
                      </div>
                      <input type="range" id="cubeSliceIdx" min="0" max="17" step="1" defaultValue="0"
                        aria-label="Which snapshot" />
                    </div>
                  </div>
                </details>

                {/* ── VIEW & DETAIL. Where the camera is and how the block is
                    drawn. Every one of these has a keyboard route as well
                    (R/T/F/E/Z/I), and every one of them has a sane default —
                    which is the test for whether a control may be folded. */}
                <details className="tl-disc" id="cubeDiscView">
                  <summary>View &amp; detail<span className="tl-disc__v" id="cubeDiscViewV" /></summary>
                  <div className="tl-disc__bd">
                    <div className="tl-field-group">
                      <span className="tl-label">Fly to</span>
                      <div className="tl-cluster" id="cubeViews">
                        <button className="chip" data-v="home">Home</button>
                        <button className="chip" data-v="top">Top</button>
                        <button className="chip" data-v="front">Front</button>
                        <button className="chip" data-v="side">Side</button>
                        <button className="chip" data-v="low">Low</button>
                        <button className="chip" data-v="focus">Frame the trace</button>
                      </div>
                    </div>
                    <div className="tl-field-group">
                      <span className="tl-label">Projection</span>
                      <div className="tl-seg" id="cubeProj" role="group" aria-label="Projection">
                        <button className="tl-seg__item" data-v="persp">Perspective</button>
                        <button className="tl-seg__item" data-v="ortho">Isometric</button>
                      </div>
                    </div>
                    <div className="tl-field-group">
                      <span className="tl-label">Mesh detail</span>
                      <div className="tl-seg" id="cubeRes" role="group" aria-label="Mesh detail">
                        <button className="tl-seg__item" data-v="draft">Draft</button>
                        <button className="tl-seg__item" data-v="normal">Normal</button>
                        <button className="tl-seg__item" data-v="fine">Fine</button>
                      </div>
                    </div>
                    <div className="tl-field-group">
                      <span className="tl-label">Time axis</span>
                      <div className="tl-seg" id="cubeSpacing" role="group" aria-label="Time axis spacing">
                        <button className="tl-seg__item" data-v="even">Even</button>
                        <button className="tl-seg__item" data-v="true">True years</button>
                      </div>
                    </div>
                    <div className="tl-field-group">
                      <span className="tl-label">Ghost world<span className="tl-label__v" id="cubeGhostV" /></span>
                      <input type="range" id="cubeGhost" min="0" max="0.55" step="0.01" defaultValue="0.16"
                        aria-label="Opacity of the ghost world" />
                    </div>
                    <label className="tl-toggle">
                      <input type="checkbox" id="cubeOutlines" />
                      <span className="tl-toggle__track" /><span className="tl-toggle__label">Snapshot outlines</span>
                    </label>
                    <label className="tl-toggle">
                      <input type="checkbox" id="cubeGhostLines" defaultChecked />
                      <span className="tl-toggle__track" /><span className="tl-toggle__label">Ghost coastlines</span>
                    </label>
                    <label className="tl-toggle">
                      <input type="checkbox" id="cubeSpin" />
                      <span className="tl-toggle__track" /><span className="tl-toggle__label">Auto-orbit</span>
                    </label>
                  </div>
                </details>
              </div>
            </aside>
            <aside {...panel('bl', ['map'], 'Reading', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">Reading</span></div>
              <div className="tl-panel__bd"><div className="caption" id="capsule" /></div>
            </aside>
            <aside {...panel('bl', ['pop'], 'Reading', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">Reading</span></div>
              <div className="tl-panel__bd"><div className="caption" id="popCap" /></div>
            </aside>
            <aside {...panel('bl', ['horizon'], 'Reading', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">Reading</span></div>
              <div className="tl-panel__bd"><div className="caption" id="hzCap" /></div>
            </aside>
            <aside {...panel('bl', ['flow'], 'Reading', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">Reading</span></div>
              <div className="tl-panel__bd"><div className="caption" id="flowCap" /></div>
            </aside>
            {/* CONNECTIONS' "RELATED" LIST CAME OVER FROM THE RIGHT EDGE.
                The dock (shell.css §04) was invented because a floating panel
                is honest over a map and a lie over a chart — and Connections
                floated two of them on the other edge, over 12–14% of a canvas
                whose ribbons run the full width. Clipped ribbon labels were
                legible underneath: "Newton's Principi", "Computing". Same bug,
                same fix: the panels take a strip of their own and the canvas
                takes the rest, which for a left-docked view means the left
                column. Placed above the bottom-anchored Reading and below
                Controls, because Related is what you look at while Reading is
                what you look at last. It keeps every id and every title. */}
            <aside {...panel('tl', ['conn'], 'Related', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">Related</span></div>
              <div className="tl-panel__bd"><div className="relpanel" id="connPanel" /></div>
            </aside>
            {/* The frame meter lives in the HEADER, not the body. shell.css §
                .tl-col gives a secondary panel a floor of "a header plus two
                lines" and lets the controls take the rest — so anything in the
                body below the first two lines needs a scroll, and a panel
                called Reading must lead with the reading. .tl-panel__title
                carries margin-right:auto, so a second header child sits flush
                right without a new rule. Full build detail is in its title. */}
            <aside {...panel('bl', ['cube'], 'Reading', 'tl-panel--secondary')}>
              <div className="tl-panel__hd">
                <span className="tl-panel__title">Reading</span>
                <span className="tl-cube-stats" id="cubeStats" />
              </div>
              <div className="tl-panel__bd"><div className="caption" id="cubeCap" /></div>
            </aside>
          </div>

          {/* THE RIGHT COLUMN IS FOR VIEWS WHOSE CANVAS HAS NOTHING THERE.
              Horizon floats "In transit" over ocean, and the horizontal
              timeline's canvas is as tall as its bands (~466px) inside an
              ~790px stage, so its "Grammar" hangs in empty stage space below
              the plot. Both were verified covering nothing.

              Connections is NOT that case and no longer lives here: its canvas
              is 826px tall and its ribbons run the full width, so a --tr and a
              --br panel sat on the chart. They moved into the left dock. */}
          <div className="tl-col tl-col--r">
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
              layerpanel.ts fills it, so it MUST ship EMPTY. */}
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
            hidden={!notesOpen} style={{ top: 12, right: 12 }}>
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
              {NOTES[view].body}
              {NOTES[view].src && <p className="tl-pop__src">{NOTES[view].src}</p>}
            </div>
            <div className="tl-pop__ft">
              <span className="tl-pop__key"><kbd className="tl-kbd">←</kbd><kbd className="tl-kbd">→</kbd> step</span>
              <span className="tl-pop__key"><kbd className="tl-kbd">Space</kbd> play</span>
              <span className="tl-pop__key"><kbd className="tl-kbd">⌘K</kbd> search</span>
              <span className="tl-pop__key"><kbd className="tl-kbd">?</kbd> these notes</span>
              <button className="tl-pop__link" onClick={() => { go('concepts'); setNotesOpen(false); }}>
                Concepts, rated →
              </button>
            </div>
          </aside>
        </main>

        {/* ══ TIME RAIL ════════════════════════════════════════════════════
            Shared chrome, but "time" means three things across eleven views, so
            each cell holds a stack of per-view children, all present from boot.
            That is what lets #yearLabel, #yearSlider and #btnPlay keep working
            untouched while other views drive the same rail differently. */}
        <footer className="tl-timerail" id="timerail">
          <div className="tl-timerail__year" data-legend={String(meta.rail === 'legend')}>
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
            <div className="tl-scale__bands" aria-hidden="true" />
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

            <div className="tl-scale__span" id="railSpan" aria-hidden="true" hidden />
            <div className="tl-index" id="railIndex" aria-hidden="true"><span className="tl-index__flag" id="railFlag" /></div>

            <input className="tl-range" type="range" id="yearSlider" min="0" max="17" step="1" defaultValue="11"
              aria-label="Year" data-railcell="scale-map" data-on={String(scaleCell === 'yearSlider')} />
            <input className="tl-range" type="range" id="popSlider" min="0" max="15" step="1" defaultValue="10"
              aria-label="Year" data-railcell="scale-pop" data-on={String(scaleCell === 'popSlider')} />
            <input className="tl-range" type="range" id="railRange" min="0" max="1000" step="1" defaultValue="745"
              aria-label="Year" data-railcell="scale-generic" data-on={String(scaleCell === 'railRange')}
              onInput={onRailRange} />
          </div>

          <div className="tl-transport" id="railTransport" data-empty={String(tpCell === 'none')}>
            <div data-railcell="tp-map" data-on={String(tpCell === 'map')}>
              <button className="tl-iconbtn" id="railPrev" aria-label="Previous snapshot" title="Previous  ←"
                onClick={() => step(-1)}>{I.prev}</button>
              {/* map.ts overwrites #btnPlay's textContent, so it must stay a TEXT button. */}
              <button className="btn" id="btnPlay" aria-label="Play through time">▶ Play</button>
              <button className="tl-iconbtn" id="railNext" aria-label="Next snapshot" title="Next  →"
                onClick={() => step(1)}>{I.next}</button>
            </div>
            <div data-railcell="tp-pop" data-on={String(tpCell === 'pop')}>
              <button className="tl-iconbtn" id="railPrevP" aria-label="Previous slice" title="Previous  ←"
                onClick={() => step(-1)}>{I.prev}</button>
              {/* population.ts writes this button's label, but only while it has no
                  element child — so it must stay a TEXT button, never an icon. */}
              <button className="btn" id="popPlay" aria-label="Play through time" aria-pressed="false">Play</button>
              <button className="tl-iconbtn" id="railNextP" aria-label="Next slice" title="Next  →"
                onClick={() => step(1)}>{I.next}</button>
            </div>
            {/* THE PROJECTION SWITCH — the per-view control that used to sit in
                the application header. It is a third kind of transport: the map
                views step through moments, and the two timeline projections
                switch which way the same moment-span is drawn. Same cluster,
                same stack mechanism, so it appears and leaves with the views it
                belongs to and costs the other nine nothing.

                It carries its own caps label because this cluster's other
                occupants are playback: an unlabelled two-button seg sitting
                where Play sits would read as a playback mode.

                EACH ITEM CARRIES BOTH A GLYPH AND ITS WORD. On a phone the rail
                is ~390px of year readout + scale + this, and the words alone are
                150px of it — measured, the scale collapsed to a 20px sliver and
                "Horizontal" ran off the screen. Below 760px the label and the
                words stand down and the glyphs — bars down the page, bars across
                it — carry the meaning in ~50px, which is what the Play button
                next door costs. The words are still the accessible name. */}
            <div data-railcell="tp-time" data-on={String(tpCell === 'time')}>
              <span className="tl-tplabel">Projection</span>
              <div className="tl-seg" id="projSeg" role="group" aria-label="Projection">
                {TIME_MEMBERS.map(m => (
                  <button key={m} className="tl-seg__item" aria-pressed={m === view}
                    aria-label={`${VIEWS[m].seg} projection`}
                    title={`Draw the same timeline ${m === 'vertical' ? 'down the page' : 'across the page'}`}
                    onClick={() => leaveSearch(m)}>
                    {m === 'vertical' ? I.projV : I.projH}
                    <span className="tl-projseg__w">{VIEWS[m].seg}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
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
                  const dead = r.p.need === 'never';
                  const note = needLine(r.p);
                  return (
                    <button className="tl-sugg__row" role="option" aria-selected={sel} data-sel={String(sel)}
                      data-need={r.p.need} disabled={dead} aria-disabled={dead || undefined}
                      title={needTitle(r.p, r.h.name) || undefined}
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
                      {r.l.on ? (r.l.hidden ? 'on the board · hidden' : 'on the board') : `add as a lane · ${r.l.n}`}
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
          {error ? <><b>Could not load the data.</b> {error}</> : <>Loading 18 world snapshots…</>}
        </div>
      )}
    </>
  );
}
