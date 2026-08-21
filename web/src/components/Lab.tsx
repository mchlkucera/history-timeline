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
import { initData, setGotoTab, setLanes, SelStore, TimeStore, YMAX, YMIN, type Datasets } from '@/render/shared';
import { buildRelIndex } from '@/render/relations';
import { setPolityAliases } from '@/render/subject';
import { SelCard } from '@/render/selcard';
import { WorldMap } from '@/render/map';
import { TL } from '@/render/timeline';
import { VT } from '@/render/vertical';
import { Flow, initFlow } from '@/render/flow';
import { Cube } from '@/render/cube';
import { Core } from '@/render/core';
import { Braid, initBraid } from '@/render/braid';
import { Horizon } from '@/render/horizon';
import { Pop, loadPopulation } from '@/render/population';
import { buildGallery } from '@/render/gallery';
import { Conn, initConn, loadRelations } from '@/render/connections';
import { railPos, railYear, railNum, railEraOf, SNAPSHOTS } from './rail';

// ── The information architecture ────────────────────────────────────────────
// Eleven flat tabs do not fit a 44px rail: eleven uppercase items is ~800px of
// switcher and .tl-rail__end alone is ~450px. So the IA is two levels — six
// groups in .tl-switch, and a .tl-seg sub-switcher for the three groups that
// have more than one member. Five of eleven views therefore sit behind a seg,
// which is why the ⌘K palette below is load-bearing rather than a nicety.

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
const DOCKED: ReadonlySet<ViewId> = new Set<ViewId>(['vertical', 'zoom', 'flow', 'braid', 'conn']);

// ── Field notes ─────────────────────────────────────────────────────────────
// Everything the old <p class="lede"> and the hand-authored captions used to
// say, moved verbatim behind a popover. Onboarding is read once; a docked strip
// taxes every session after that and costs 8–10% of the viewport.
interface Notes { body: React.ReactNode; src?: React.ReactNode }

const NOTES: Record<ViewId, Notes> = {
  map: {
    body: <>
      <p>The <strong>&ldquo;Google Earth of history&rdquo;</strong> answer to <em>&ldquo;I see 1776 and can&rsquo;t imagine the world.&rdquo;</em> Drag the index along the bottom rail and every border on the map moves with it.</p>
      <p>Territories are real research data &mdash; 18 snapshots between 3000 BCE and 1994 &mdash; coloured by sovereign, the British Empire in its traditional atlas pink. Scroll to zoom, drag to pan, and <strong>click any spot to drill a core sample</strong> through everything that ever happened there.</p>
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
      <p><strong>It shares this group&rsquo;s controls on purpose:</strong> vertical and horizontal are two projections of one timeline state &mdash; the same span, the same lanes, the same domains, the same search. Switching the seg changes the projection, never the subject.</p>
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
  WorldMap.init(); TL.init(); VT.init(); initFlow(); Cube.init(); Core.init(); initBraid(); Horizon.init(); Pop.init(); buildGallery();
  initConn();
  WorldMap.render();
  // diagnostic handle for acceptance probes and console debugging — reads only
  (window as any).__tl = { TL, VT, Conn, WorldMap, Cube, TimeStore, SelStore, SelCard };
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

// ── Icons ───────────────────────────────────────────────────────────────────
const I = {
  mark: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6" /><path d="M8 2v12M2 8h12" /><ellipse cx="8" cy="8" rx="2.7" ry="6" /></svg>,
  search: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>,
  info: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.2" /><path d="M8 7.2v4" /><path d="M8 4.7v.6" /></svg>,
  theme: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" /></svg>,
  prev: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>,
  next: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>,
  close: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
};

export default function Lab() {
  const [view, setView] = useState<ViewId>(DEFAULT_VIEW);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [pq, setPq] = useState('');
  const [psel, setPsel] = useState(0);
  const [collapsedBy, setCollapsedBy] = useState<boolean | null>(null);
  // THE DOCKED "RELATED" PANEL IS CLOSED BY DEFAULT. The selection card carries
  // the top three or four relations already; the dock exists for the moment you
  // want the whole ranked list, and it is reached from the card's
  // "All connections →". Opening it costs 92px of a shared column otherwise.
  const [relOpen, setRelOpen] = useState(false);
  const booted = useRef(false);
  const pinput = useRef<HTMLInputElement>(null);
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
        // WHAT THE SELECTION CARD CAN DO. Lab is the only module that knows all
        // eleven views, so the card's verbs are injected from here rather than
        // imported — which is also why selcard.ts can be imported BY the
        // renderers without a cycle.
        SelCard.wire({
          // THE CORE LOOP. Frames the window and shows the horizontal
          // projection. It does not touch TimeStore, and TL.frameTo holds off
          // the tab-entry ensureYearVisible() so the framing is not undone by a
          // courtesy meant for a different situation.
          perspective: (a, b) => { TL.clearSearch(); TL.frameTo(a, b); go('zoom'); },
          // AT THE CURRENT GLOBAL YEAR — syncToYear moves the map to the nearest
          // snapshot without writing TimeStore back.
          seeOnMap: () => { WorldMap.syncToYear(TimeStore.year); go('map'); },
          traceInCube: (pid) => { Cube.select(pid); go('cube'); },
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
    if (ready) { renderTab(view); syncRail(); SelCard.setView(view); }
  }, [view, ready, syncRail]);

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

  // Renderers own their own state and emit no events, so the rail follows them
  // by watching. One rAF loop, four number reads, DOM touched only on change.
  useEffect(() => {
    if (!ready) return;
    let raf = 0, last = '';
    const tick = () => {
      const v = viewRef.current;
      const key = (v === 'map' ? `m${WorldMap.ix}`
        : v === 'pop' ? `p${Pop.ix.toFixed(3)}`
          : v === 'horizon' ? `h${Horizon.year}`
            : v === 'flow' ? `f${Flow.d0}|${Flow.d1}`
              : v === 'braid' ? `b${Braid.d0}|${Braid.d1}`
                : v === 'conn' ? `c${Conn.d0}|${Conn.d1}`
                  : `t${TL.d0}|${TL.d1}|${TL.log}`)
        + `|${TimeStore.year}|${SelStore.id ?? ''}`;   // the global stores nudge the rail too
      if (key !== last) { last = key; syncRail(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, syncRail]);

  // The generic scale drag surface. Horizon writes into #hzYear and dispatches
  // 'input' — horizon.ts already listens there, so no renderer changes.
  const onRailRange = (e: React.FormEvent<HTMLInputElement>) => {
    const pct = +(e.currentTarget.value) / 10;
    const y = railYear(pct);
    const v = viewRef.current;
    if (v === 'horizon') {
      const inp = document.getElementById('hzYear') as HTMLInputElement | null;
      if (inp) { inp.value = String(y); inp.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    const src: any = v === 'flow' ? Flow : v === 'braid' ? Braid : v === 'conn' ? Conn : TL;
    const half = (Number(src.d1) - Number(src.d0)) / 2;
    if (v === 'zoom' || v === 'vertical') {
      // same domain clamp-shift the wheel enforces — a rail click near the edge
      // must not centre the window past YMIN/YMAX (defect: d1 landed at 4464)
      let a = y - half, b = y + half;
      if (b > YMAX) { a -= b - YMAX; b = YMAX; }
      if (a < YMIN) { b += YMIN - a; a = YMIN; }
      TL.animTo(a, Math.min(b, YMAX)); return;
    }
    src.d0 = y - half; src.d1 = y + half;
    if (v === 'conn') Conn.dirty = true;
    src.render();
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
  const hits = ORDER.filter(v => {
    const q = pq.trim().toLowerCase();
    if (!q) return true;
    return (VIEWS[v].name + ' ' + VIEWS[v].seg + ' ' + VIEWS[v].gist).toLowerCase().includes(q);
  });
  const openPalette = (open: boolean) => {
    setPalette(open);
    if (open) { setPq(''); setPsel(0); requestAnimationFrame(() => pinput.current?.focus()); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPalette(!palette); return; }
      if (e.key === 'Escape') { if (palette) openPalette(false); else if (notesOpen) { setNotesOpen(false); document.getElementById('notesBtn')?.focus(); } return; }
      if (palette) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setPsel(s => Math.min(hits.length - 1, s + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setPsel(s => Math.max(0, s - 1)); }
        if (e.key === 'Enter') { e.preventDefault(); const v = hits[psel]; if (v) { go(v); openPalette(false); } }
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

  // ── derived flags ─────────────────────────────────────────────────────────
  const railOn = meta.rail !== 'off';
  const scaleCell = meta.rail === 'live'
    ? (view === 'map' ? 'yearSlider' : view === 'pop' ? 'popSlider' : 'railRange')
    : meta.rail === 'span' ? 'railRange' : 'none';
  const yearCell = view === 'map' ? 'map' : view === 'pop' ? 'pop' : 'rail';
  const tpCell = view === 'map' ? 'map' : view === 'pop' ? 'pop' : 'none';
  const seg = members.length > 1;
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

          <div className="tl-rail__mid">
            <nav className="tl-switch" role="tablist" aria-label="View">
              {GROUPS.map(g => (
                <button key={g.id} className="tl-switch__item" role="tab"
                  aria-selected={g.id === group}
                  aria-controls={`tab-${GROUP_DEFAULT[g.id]}`}
                  onClick={() => setView(g.members.includes(view) ? view : lastMember.current[g.id])}>
                  {g.label}
                </button>
              ))}
            </nav>

            <div className="tl-seg" id="viewSeg" role="group" aria-label="Projection"
              style={seg ? undefined : { display: 'none' }}>
              {members.map(m => (
                <button key={m} className="tl-seg__item" aria-pressed={m === view} onClick={() => setView(m)}>
                  {VIEWS[m].seg}
                </button>
              ))}
            </div>

            <p className="tl-gist" id="viewGist">{meta.gist}</p>
          </div>

          <div className="tl-rail__end">
            <span className="tl-meta" id="viewMeta">{meta.meta}</span>
            <button className="tl-field" id="cmdk" style={{ width: 186 }} aria-label="Search views"
              onClick={() => openPalette(true)}>
              {I.search}
              <span style={{ flex: 1, textAlign: 'left', fontSize: 'var(--tl-text-sm)' }}>Search</span>
              <kbd className="tl-kbd">⌘K</kbd>
            </button>
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

          {/* ── Timeline · Horizontal ─────────────────────────────────────── */}
          <section {...sect('zoom')}>
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
                  <button className="btn hero" id="btn1776">Show me 1776</button>
                  <button className="btn" id="btnReset" title="Reset zoom and pan">Reset view</button>
                </div>
                <p className="note">Scroll to zoom · drag to pan · click any spot to drill a core sample.</p>
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
            {/* THE TIMELINE GROUP SHARES ITS CONTROLS ON PURPOSE.
                vertical and horizontal are two projections of ONE timeline state —
                span, lenses, domains, search. The vertical port must reuse these
                ids, not duplicate them: #catRow, #searchBox, #searchCnt,
                #grammarRowV, #zoomReadout, #btnMozart, #btn1776z, #btnDeep,
                #btnResetZ. The seg switches only which canvas is visible. */}
            <aside {...panel('tl', ['zoom', 'vertical'], 'Controls')}>
              <div className="tl-panel__grip" aria-hidden="true" />
              {hd('Controls')}
              <div className="tl-panel__bd">
                <div className="tl-cluster">
                  <button className="btn hero" id="btnMozart">Mozart&rsquo;s world</button>
                  <button className="btn" id="btn1776z">1776 in context</button>
                  <button className="btn" id="btnDeep">Deep time</button>
                  <button className="btn" id="btnResetZ">Reset</button>
                </div>
                <div className="searchwrap">
                  <input type="text" id="searchBox" style={{ width: '100%' }}
                    placeholder="Search a thread… (revolution, Prague, plague)" />
                  <span className="cnt" id="searchCnt" />
                </div>
                <hr className="tl-hr" />
                <div className="tl-field-group">
                  <span className="tl-label">Lanes</span>
                  {/* MUST ship EMPTY — timeline.ts appendChild()s one chip per curated
                      lane from the registry (buildLaneRow), like #catRow. */}
                  <div className="tl-cluster" id="lensRow" />
                </div>
                <div className="tl-field-group">
                  <span className="tl-label">Domain</span>
                  {/* MUST ship EMPTY — timeline.ts appendChild()s the whole row. */}
                  <div className="tl-cluster" id="catRow" />
                </div>
                <hr className="tl-hr" />
                <span className="note" id="zoomReadout" />
                {/* THE GRAMMAR LEGEND LIVES HERE FOR BOTH PROJECTIONS.
                    It used to be two panels: a --bl in the vertical dock and a
                    floating --br over the horizontal view's empty stage space.
                    The docked one was the problem — a secondary panel in the
                    column has a floor of a header plus two lines, and the
                    legend is three rows, so it clipped its own last row (14-22px
                    of it) while also taking 104px off the Controls panel above,
                    which is what pushed two domain chips below ITS fold.
                    One disclosure in the shared panel fixes both, and it is the
                    more honest arrangement anyway: vertical and horizontal are
                    two projections of one instrument, so they share the legend
                    the way they already share the span, the lenses and the
                    search. buildGrammarLegend() fills it by id. */}
                <details className="tl-disc">
                  <summary>Grammar<span className="tl-disc__v">shape &amp; colour</span></summary>
                  <div className="tl-disc__bd"><div className="grammar" id="grammarRowV" /></div>
                </details>
              </div>
            </aside>
            {/* THE TIMELINE'S "RELATED" PANEL — the same pattern as Connections'.
                Click a spread or an event on either projection and relations.ts
                renders the ranked, grouped relation list (plus the Wikipedia link,
                which moved here from the old click-through) into #tlRelPanel. */}
            <aside {...panel('tl', ['zoom', 'vertical'], 'Related', 'tl-panel--secondary tl-panel--request')}
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
            <aside {...panel('tr', ['horizon'], 'In transit', 'tl-panel--secondary')}>
              <div className="tl-panel__hd"><span className="tl-panel__title">In transit</span></div>
              <div className="tl-panel__bd"><div className="newsfeed" id="hzFeed" /></div>
            </aside>
          </div>


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

          <div className="tl-scale" id="railScale" data-inert={String(meta.rail === 'legend')}>
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

      {/* ⌘K — required, not optional: five of eleven views sit behind a seg. */}
      <div className="tl-cmdk" hidden={!palette} onClick={e => { if (e.target === e.currentTarget) openPalette(false); }}>
        <div className="tl-cmdk__box" role="dialog" aria-label="Go to a view">
          <input className="tl-cmdk__in" placeholder="Go to a view…" ref={pinput}
            value={pq} onChange={e => { setPq(e.target.value); setPsel(0); }} />
          <div className="tl-cmdk__list">
            {hits.length === 0 && <div className="tl-cmdk__empty">Nothing matches that.</div>}
            {hits.map((v, i) => (
              <button key={v} className="tl-cmdk__row" data-sel={String(i === psel)}
                onMouseEnter={() => setPsel(i)} onClick={() => { go(v); openPalette(false); }}>
                <span>{VIEWS[v].name}</span>
                <em>{GROUPS.find(g => g.members.includes(v))?.label || 'Concepts'}</em>
              </button>
            ))}
          </div>
        </div>
      </div>

      {!ready && (
        <div className="bootstate" role="status">
          {error ? <><b>Could not load the data.</b> {error}</> : <>Loading 18 world snapshots…</>}
        </div>
      )}
    </>
  );
}
