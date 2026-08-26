/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ② ZOOMABLE TIMELINE =================
// The flagship projection. Two visual categories only, taken from the Connections
// vocabulary: SPREADS (anything with duration — era, polity, episode, life, movement)
// drawn as constant-height rectangles whose edges carry a per-item sharpness envelope,
// and EVENTS (moments) drawn as dots in their own stratum BELOW the spreads. Spreads
// pack into interval lanes biggest-first with no visual overlap — the founder's two
// old spreadsheets, live. One piecewise C1 scale (shared.ts tv/ty) runs the wheel from
// a decade to the Big Bang with no mode switch; the old log toggle is dead.
import {
  $, EVENTS, POLITIES, CATBY, catColor, clamp, fitCanvas, fmtBig, fmtSpan, fmtY, fontMono, fontUI,
  hideTip, reduceMotion, repaintOnFonts, showTip, tokens, yearPill,
  tv, ty, VFULL, timeTicks, withA, hexHsl, varyColor, inkFor, clampV, clampDomain,
  TimeStore, SelStore, evId, LANES, sharpnessOf,
  textW, ellipsize,
} from './shared';
import {
  REL, SPREADCAT, peakOf, lvlOfWeight, regionOf, relOf, dimAlpha, lit, renderRelatedPanel,
} from './relations';
import {
  bindPinch, slopFor, TAP_PAD, armSafariGestureGuard, refuseSafariGestures, coarsePointer,
} from './gesture';
import { FOLD, roleWord } from './fold';
import { SelCard } from './selcard';
import {
  Layers, layerDef, layerDefs, layerIdFor, layerIdOfEvent, passesDetail, polityLvl,
  type Detail, type GNode,
} from './layers';

// ── projections of this state ───────────────────────────────────────────────
// The Timeline group is ONE instrument shown two ways. vertical.ts reads d0/d1, log,
// lens, off and q off THIS object rather than copying them, and the shared controls
// (#lensRow, #catRow) are bound here exactly once. So anything that WRITES that state
// has to repaint whichever projection is currently on screen — that is what paint() is
// for, and every state-changing handler below calls it instead of render().
const PROJECTIONS: Array<() => void> = [];
const REVEALS: Array<(bandKey: string) => void> = [];
// The layer panel subscribes here. It is handed the finished layout — drawn
// geometry, not target geometry — once per painted frame.
const LAYOUTS: Array<(lay: Layout) => void> = [];

// A spread in the lane corpus. `row` is its PERMANENT lane index within its band,
// assigned once per corpus from the canonical importance-first order, so zoom can
// never reshuffle: lane 0 goes to Rome and the defining eras by construction.
interface SpreadItem {
  id: string; name: string; start: number; end: number;
  cat: string; type: string; lvl: number; sharpness: number;
  note: string; tags: string; peak: number; row: number;
  ev: any[] | null;
  // the item's extent in v-space, computed ONCE with the corpus. Occupancy is
  // decided in v against the latched window, so this is on the hot path of
  // every frame and there is no reason to keep paying tv() for it.
  v0: number; v1: number;
}
interface LSpread { it: SpreadItem; row: number; x0: number; x1: number; lodA: number; isMatch: boolean }
interface LEvent { ev: any[]; id: string; x0: number; row: number; lodA: number; mode: 'right' | 'left' | 'none'; labelW: number; isMatch: boolean }
interface LaneLayout {
  key: string; label: string; si: number | null; isCur: boolean;
  // ── the layer this band draws ──────────────────────────────────────────────
  // `key` is the LAYER ID ('eu-sci'), or 'g:<groupId>' for a group's header
  // strip. Everything keyed by lane key elsewhere in this file — _dh,
  // expanded, dying — is therefore keyed by layer, which is what makes a
  // reorder move a band's followed height along with it.
  layerId: string | null; detail: Detail; grp: GNode | null; isGroupHead: boolean;
  spreads: LSpread[]; events: LEvent[];
  ns: number; ne: number; more: number; exp: boolean;
  isRegion: boolean; era: LSpread[]; eraRow: number; eraOut: string[];
  top: number; h: number; evTop: number;
  // ── continuous geometry, one entry per PERMANENT row in permanent order ──
  // rowH is what is DRAWN this frame (slew-limited); rowG is what the content
  // ASKS for (0..1, the row's max LOD alpha). render() divides the two to know
  // how far a row is from where it is going, and fades it by exactly that much.
  rowY: number[]; rowH: number[]; rowG: number[];
  evY: number[]; evH: number[]; evG: number[];
  headH: number; gapH: number; dying: boolean;
}
interface Layout {
  lanes: LaneLayout[]; H: number; G: number; Wp: number;
  sel: string | null; rels: Map<string, { w: number; kind: string }> | null; q: string;
  anim: boolean;                 // something is still converging — paint again next frame
}

/* ── CONTINUITY: HEIGHT AS A FUNCTION OF ZOOM ─────────────────────────────────

   The founder, on the old layout: "Right now it jumps the height on zooms,
   movements, we need a smoother way… Google earth smoothness. Just slowly,
   smoothing, discovering new ones without jumps in layout."

   The jumps had three sources and every one of them was a DISCRETE decision
   dressed as a continuous gesture: an item crossing its LOD threshold popped a
   whole 24px row into existence; panning culled an item out of the window and
   its row collapsed; the global height-budget trim redistributed rows in whole
   steps. None of that is fixable with an animation timer chasing a discrete
   layout — the layout itself has to be continuous.

   So: A ROW'S HEIGHT IS rowPitch × THE MAX LOD ALPHA OF ITS VISIBLE CONTENT.
   Every item already had a continuous alpha (alphaFor's fade ramp, now a
   smoothstep so the derivative is continuous too). An item fading in 0→1 grows
   its row 0→24px in lockstep with its own fade; zooming out closes the row the
   same way; a band's height is the sum of its rows plus its furniture. Nothing
   to ease, nothing to time, perfectly reversible: the same window always gives
   the same height.

   THREE THINGS GUARD IT.

   1. THE SOFT PAN WINDOW. Culling is against a window padded by 30% on each
      side, and the window alpha ramps 0→1 across that pad. The ramp lives
      ENTIRELY OFF-SCREEN: anything whose extent touches the viewport at all is
      window-alpha 1, so a spread crossing the whole screen can never dim from
      pan maths and the viewport edges never look permanently faded. Leaving the
      screen shrinks a row instead of deleting it.

   2. THE SLEW-RATE LIMITER. The continuous function defines the TARGET; the
      limiter bounds how fast the drawn height may converge on it — 2.5px per
      frame for any single row, 2.2px per frame for a whole band. That one clamp
      catches every remaining source of a jump, enumerated or not: a flick pan
      that blows through the pad in two frames, a preset teleport, a lane toggle,
      a rung crossing, a search that re-ranks the corpus. It is NOT an easing
      curve — there is no timer and no duration. When the input is idle the drawn
      height equals the target exactly, so nothing breathes.

   3. THERE IS NO TRIM LEFT TO OSCILLATE. This slot used to describe a hysteresis
      band around the global height budget. The budget is gone — see the long note
      where `budgetOf` used to live — because it was the mechanism that deleted
      marks on the way IN. A band's height is now its content's demand and nothing
      else, so there is no cap to chatter against and no third guard to keep.

   Together they replace the 180ms discrete-moment ease that was on the table:
   ONE mechanism, not two, and it covers cases an enumerated ease would miss. */
/* ── AND WHAT REPLACED IT: THE ZOOM LADDER ───────────────────────────────────

   The note above is the history. The founder reviewed three prototypes of the
   zoom and picked B: "Add in the zoom stepping that enlarges rectangles.
   include more then 5 steps."

   So the ZOOM is no longer a continuous layout input. It is a LADDER of 26
   rungs, geometric in v-space (shared.ts's one piecewise scale, which is
   literally years for the last ten thousand of them and log-of-years-ago before
   that), each rung about 1.456× the next. Standing on a rung fixes TWO things at
   once, and they are the two the old continuous ramp used to smear:

     · WHAT IS VISIBLE — one importance tier, 1..5, a hard gate. The old
       alphaFor() ramp faded a level in across a 1.6× band of spans, which is
       what made every wheel notch a layout event.
     · HOW BIG THE MARKS ARE — a pitch multiplier on the row height, the
       rectangle heights and the label sizes, 0.60 at the Big Bang to 2.27 at a
       few years. Zoomed out: many slim rows. Zoomed in: fewer, fatter, readable
       ones. TIER_H is scaled WHOLE, so the importance ratios inside a step are
       exactly the ratios outside it.

   WHY 26 AND NOT 13. The founder, zoomed in: "Add more enlargement steps on
   zoom, when I zoom in it looks squashed." A 2.12× rung is a big thing to cross
   — a fifth of a wheel flick lands you a whole tier and a whole pitch away — so
   the ladder was HALVED IN STRIDE rather than lengthened at one end: every one
   of the old thirteen doors is still a door (so a tier still opens at exactly
   the v-span it always did), with a new rung interposed between each pair, one
   more above the old top (the old `deep time` rung spanned 70000..VFULL=151522,
   which is a full rung's worth on its own) and one more below the old bottom
   (zoomBy clamps the v-span at 8, so 12..18 was likewise a whole unused rung).
   Twice as many crossings per gesture, each moving half as far: the same total
   travel, delivered in smaller pieces, which is what "less jumpy" means. The
   hysteresis below is re-sized to match.

   BETWEEN RUNGS THE LAYOUT IS BIT-FROZEN. Wheeling inside a rung moves the
   marks along x and changes nothing else: not a height, not a visibility, not
   a trim, not a label. That is not an aspiration, it is arithmetic — every
   layout input is either a constant of the rung or a function of the LATCHED
   WINDOW (see _lwV0 below), and neither moves while the span does.

   CROSSING a rung is ONE eased settle of SETTLE_MS, riding the same slew
   limiter as everything else, and each threshold carries ±HYST of hysteresis so
   wheeling back and forth over a boundary cannot chatter between two layouts.

   THE STEP IS A FUNCTION OF THE V-SPAN, NOT THE YEAR SPAN. Panning is a
   translation in v and preserves the v-span exactly; it does NOT preserve the
   year span, because ty() is nonlinear past the seam — a pan in deep time can
   double the years on screen without changing the zoom at all. Reading the
   ladder in v is what makes "pan never changes the step" true by construction
   rather than by luck. */
interface ZStep {
  v: number;                // enter this rung when the v-span falls to or below this
  tier: number;             // importance visible here, 1..5 (before the layer's detail offset)
  pitch: number;            // multiplier on row pitch, rectangle height and label size
  air: number;              // multiplier on the whitespace BETWEEN BANDS (see the note below)
  ev: number;               // how many rows the event stratum may open
  name: string;             // what this rung is, in words
}
/* ── THE THIRD THING A RUNG FIXES: HOW MUCH AIR THERE IS ─────────────────────

   The founder, zoomed in: "When I am zooming and rectangles are getting bigger
   so should whitespace — it looks very crowded upon zoom now."

   He is describing a real arithmetic hole. `pitch` scaled the MARKS (TIER_H, the
   dot radius, the label size) and the ROW PITCH, so the gutter INSIDE a row grew
   with them. Everything BETWEEN the marks was a bare constant: the pad above a
   band's first row (HEAD_PAD), the separation between the spread stratum and the
   event stratum (GAP_H), the pad under a band's last mark (GAP_H again) and
   therefore the whole distance from one band's last rectangle to the next band's
   first one, which sat at a flat 14px whether the rectangles either side of it
   were 12px tall or 32px tall. Measured on the default arrangement, the gap
   between two bands was 14px at EVERY one of the thirteen rungs.

   So a rung fixes a third number, and it is deliberately NOT `pitch`.

   ── AND WHY THE EXPONENT WAS RE-DERIVED ─────────────────────────────────────
   The first answer was ONE number for all whitespace, running AHEAD of pitch
   (roughly pitch^1.75: marks 1.62×, air 2.28× at the closest rung), on the
   argument that ink area grows as the square of a linear scale while gaps grow
   linearly. That argument was made when a lane's height was effectively FIXED —
   the global height budget clamped the plot to one viewport, so the only way to
   buy breathing room was to spend it on gaps. With the budget gone (see the note
   where `budgetOf` used to be) the picture is free to grow, and the founder's
   next word on it was the opposite complaint: "when I zoom in it looks squashed."

   Squashed is what pitch^1.75 produces once you look at where the air lands. A
   row's pitch is the MARK plus a GUTTER (SP_PITCH = 20 + 4). At air 2.28 the
   gutter is 9.1px of a 41.5px row — 22% of the row is nothing, against 16.7% at
   the reference. The rectangle got 1.62× taller and its row got 1.73× taller, so
   the mark's SHARE of its own row FELL as the reader zoomed in. That is the
   squash, and it is arithmetic, not taste.

   The two gaps are therefore split, because they are doing different jobs:

     · THE GUTTER INSIDE A ROW is not a separator between two ideas, it is the
       leading of a line of type — and leading is the standard case of a gap that
       must grow SUB-linearly: a 12px face wants 1.5× line height, a 48px face
       wants 1.2×. So it goes as sqrt(pitch). At the closest rung the mark takes
       88% of its row instead of 78%, and it takes MORE of it the further in you
       go, which is the direction "enlarge the rectangles" actually points.
     · THE WHITESPACE BETWEEN BANDS — HEAD_PAD, GRP_H, GAP_H — is a separator
       between subjects, and it should scale with the thing it separates, with a
       little ahead for the area argument, which is real but much weaker than
       ^1.75 made it: pitch^1.25. That is `air`, the number in this table.

   BELOW THE REFERENCE air is left exactly on the hand-tuned trail it was on
   (0.805 → 1.00, linear), because slim rows and many of them is the whole point
   out there and the founder has already signed off on how deep time looks.

   At `an era` — pitch 1.00, air 1.00 — the geometry is still bit-identical to
   what it was before any of this existed, so that rung stays the reference every
   other number in this file was tuned against. */
const STEPS: ZStep[] = [
  { v: Infinity, tier: 1, pitch: 0.60, air: 0.805, ev: 1, name: 'all of time' },
  { v: 103000, tier: 1, pitch: 0.64, air: 0.820, ev: 1, name: 'deep time' },
  { v: 70000, tier: 1, pitch: 0.68, air: 0.850, ev: 1, name: 'the ice' },
  { v: 48000, tier: 1, pitch: 0.71, air: 0.865, ev: 1, name: 'the last glaciation' },
  { v: 33000, tier: 2, pitch: 0.74, air: 0.880, ev: 2, name: 'prehistory' },
  { v: 22600, tier: 2, pitch: 0.77, air: 0.895, ev: 2, name: 'the first peoples' },
  { v: 15500, tier: 2, pitch: 0.80, air: 0.910, ev: 2, name: 'civilisations' },
  { v: 10600, tier: 2, pitch: 0.83, air: 0.925, ev: 2, name: 'the first cities' },
  { v: 7200, tier: 2, pitch: 0.87, air: 0.940, ev: 2, name: 'the long ages' },
  { v: 4900, tier: 2, pitch: 0.90, air: 0.955, ev: 2, name: 'millennia' },
  { v: 3400, tier: 3, pitch: 0.94, air: 0.970, ev: 3, name: 'an age' },
  { v: 2320, tier: 3, pitch: 0.97, air: 0.985, ev: 3, name: 'ages' },
  { v: 1600, tier: 3, pitch: 1.00, air: 1.000, ev: 3, name: 'an era' },
  { v: 1100, tier: 3, pitch: 1.065, air: 1.08, ev: 3, name: 'the long centuries' },
  { v: 760, tier: 4, pitch: 1.13, air: 1.17, ev: 3, name: 'centuries' },
  { v: 520, tier: 4, pitch: 1.21, air: 1.27, ev: 3, name: 'half a millennium' },
  { v: 360, tier: 4, pitch: 1.29, air: 1.38, ev: 4, name: 'a century' },
  { v: 247, tier: 4, pitch: 1.37, air: 1.48, ev: 4, name: 'three lifetimes' },
  { v: 170, tier: 5, pitch: 1.46, air: 1.60, ev: 4, name: 'a lifetime' },
  { v: 116, tier: 5, pitch: 1.55, air: 1.73, ev: 4, name: 'two generations' },
  { v: 80, tier: 5, pitch: 1.66, air: 1.88, ev: 4, name: 'a generation' },
  { v: 55, tier: 5, pitch: 1.76, air: 2.03, ev: 4, name: 'half a lifetime' },
  { v: 38, tier: 5, pitch: 1.88, air: 2.20, ev: 5, name: 'a career' },
  { v: 26, tier: 5, pitch: 2.00, air: 2.38, ev: 5, name: 'a quarter century' },
  { v: 18, tier: 5, pitch: 2.13, air: 2.57, ev: 5, name: 'a decade' },
  { v: 12, tier: 5, pitch: 2.27, air: 2.79, ev: 5, name: 'a few years' },
];
// The dead band at every threshold: enter the next rung at (1−HYST)× its door,
// leave it again only at (1+HYST)×. It used to be nine percent each way against
// a 2.12× rung; the rung is 1.456× now, so the same PROPORTION of a rung is
// 0.09 × ln(1.456)/ln(2.12) = 0.045. A wheel parked on a boundary still cannot
// oscillate, and a deliberate reversal still costs about a fifth of a rung.
const HYST = 0.045;
// One settle, and the same one whichever way the ladder is climbed.
const SETTLE_MS = 230;
/* HOW WIDE THE LIMITER OPENS FOR A SETTLE, and why it opens at all.
   The limiter's ordinary caps — 2.2px a frame for a band, 2.5 for a row — are
   sized for things with NO clock of their own: a pan, a lane toggle, a preset
   teleport, a search that re-ranks the corpus. Those have to be WALKED, because
   nothing else is timing them. A settle is timed: an eased ramp of known length
   between two known geometries. Holding it to the walking pace does not make it
   gentler, it makes it LONG — measured on the production build, the ordinary
   caps left a 2.2px/frame TAIL after the settle clock had run out and stretched
   the two tier-opening crossings to 678 and 680ms. That is no longer part of the
   gesture, which was the whole point of having a settle.

   So during a settle the cap is DERIVED rather than fixed: exactly the peak
   velocity of the eased path this particular band has to travel, and never less
   than the walking pace. A smoothstep's peak is 1.5× its average, and the little
   over that is headroom for a frame that arrives late. The result is a cap that
   is as wide as the settle needs and not one pixel wider — a one-row crossing
   still moves at the walking pace, because that is all a one-row crossing needs
   — and, because the path it is following starts and ends at rest, what the eye
   gets at the wide end is a fast movement rather than a jump. */
const SETTLE_PEAK = 1.6;
const SETTLE_FRAMES = SETTLE_MS / 16.7;
const PAD_FRAC = 0.30;      // soft window around the LATCHED window, each side
const SLEW_ROW = 2.5;       // px/frame a single row's drawn height may move
const SLEW_LANE = 2.2;      // px/frame a whole band's drawn height may move
const SETTLE = 0.05;        // closer than this and the follower snaps — idle ⇒ drawn === target
const IDLE_MS = 400;        // a gap this long is a new look, not a gesture: snap, don't ramp
const LAB_G0 = 0.60, LAB_G1 = 0.85;    // a row's text fades in between 60% and 85% grown
const HIT_FLOOR = 0.34;     // below this a row is drawn but NOT hoverable (see hitAt)
/* ── NO BAND HEADER ON THE CANVAS ANY MORE ───────────────────────────────────

   The band name used to be painted at x=20 inside a 118px left gutter, and the
   gutter existed to hold it. The LAYER PANEL is that label now: its row sits at
   the band's own y, at the band's own height, so the name is beside the lane
   rather than inside it. Painting it twice would be two labels for one band.

   What is left of it is therefore a PAD — the breathing space between a
   band's separator rule and its first row of marks. But it still has to be a
   HEIGHT, not a constant, for two reasons the old comment already gave: a lane
   being switched off walks its header to zero along with its rows, and a band
   with nothing in it at this zoom must not collapse to a hairline, because its
   panel row has to stay big enough to hold a name and an eye. So the target is
   MIN_LANE_H when the band is empty and HEAD_PAD when it has content, and it
   crosses between them CONTINUOUSLY with the first row's growth. */
/* EVERY NUMBER FROM HERE TO GAP_H IS QUOTED AT air = 1, i.e. at the `an era`
   rung, and is multiplied by the rung's air wherever it is used. MIN_LANE_H is
   the one exception and it is not decoration: it is the height a panel row needs
   to hold a name and an eye, which is what makes "hide this layer" reversible,
   so it is a FLOOR in real pixels and does not move with the zoom. */
const HEAD_PAD = 8;         // pad above the first row of a band that has content, at air 1
const MIN_LANE_H = 22;      // …and the floor for a band that is empty or hidden — NOT scaled
const GRP_H = 16;           // a group's rule strip in the plot, at air 1
// How many event rows the per-frame pixel packer may open. Not a cap on what is
// SHOWN — the global height budget below is the only thing that takes a row
// away — just the width of the packing table. Ten is more rows than a band ever
// gets to keep at a laptop height.
const EV_BOUND = 10;
const GUT = 12;             // the plot's left gutter WHEN THE PANEL IS SHOWING
const GUT_SOLO = 118;       // …and when it is not (see panelOn / the phone note)
const GAP_H = 6;            // spreads ↔ events separation, at air 1, faded in with both
/* HOW A ROW PITCH SPLITS. SP_PITCH is 24 and the tallest rectangle in it is
   TIER_H[1] = 20, so four of those pixels are the gutter between one row's
   rectangle and the next one's. Those four scale with AIR; the twenty scale with
   PITCH, because they are the mark. EV_PITCH splits the same way — thirteen for
   the label line, four for the air around it. Both splits are exact at air 1
   pitch 1, so the reference rung is untouched. */
const ROW_AIR = 4;          // of SP_PITCH's 24, the part that is whitespace
const EV_AIR = 4;           // …and of EV_PITCH's 17
// The tick-label strip. It used to run along the BOTTOM of the canvas, under the plot,
// with the set-year pill sliding about inside the lanes above it. His words: "Lets
// remove the in-canvas orange date shower (which is sliding) altogether… Lets move the
// grey dates to the top." So the grey scale is a masthead, the bottom 34px keeps only
// the accent stub and the cursor's own pill, and lanes start below AXIS_TOP.
const AXIS_TOP = 22;

/* ── WHY THERE IS NO HOVER-DRIVEN LAYOUT HERE ─────────────────────────────────

   A cursor-directed fisheye was built and removed: the lane under the pointer grew,
   relaxed its level of detail and took the space from its neighbours. It worked, and
   the founder rejected it on sight — "The x moving is interesting, feels like jelly
   now, I would like it to work only on zoom. just like google earth. Stuff moves only
   on zoom or panning."

   So the rule this file now keeps: THE LAYOUT MOVES FOR ZOOM, PAN, OR A CLICK. Never
   for a hover. Pointing at something must be free — you can read a tooltip, aim at a
   rectangle, cross four bands on the way to a chip, and the page underneath does not
   answer. Anything that would make height or level of detail a function of the pointer
   belongs behind an explicit gesture, not under the cursor. */
// (A plateau used to be pre-mixed 12% toward the ground before being painted opaque.
// It is not any more: varyColor bakes that softening into the ladder it picks from, so
// the fill lands on exactly the colour that was asked for. See the render loop.)

/* ── THE ERA ROW ──────────────────────────────────────────────────────────────

   Biggest-first packing has one structural blind spot, and it is exactly the
   thing the founder asks for by name: "what did the world look like, WHAT WARS
   WERE THERE, what technology, what was going on in other spheres".

   Rows are assigned ONCE per corpus, in (level, peak, duration) order, and that
   last key is the trap: a four-year world war at level 1 is placed after
   Farming, Printing, Railways and Electrification — level 1 and centuries long —
   and lands in Europe's SEVENTH row, permanently. Promoting the wars to level 1
   does not help, because the burial happens inside the level. Neither would a
   peak proxy. Frame Cubism at 1875-1955 and Europe shows empires and technology
   and no war at all.

   So each REGION lane reserves at most one row for the window's own EPISODES.
   "Episode" is not a new idea invented for this: it is the grammar's own word
   for a bounded happening, and in the region lanes the hand-authored corpus is
   exactly two types — 11 zones (long, territorial, already deduped against the
   polities) and 17 episodes. The episodes ARE the buried class, and they are
   the wars, the revolutions and the plagues: World War I and II, the Punic and
   Thirty Years' Wars, the French, Haitian and Latin American revolutions, the
   Black Death, the Opium War, the US Civil War.

   An episode qualifies for the row when it is
     · mostly inside the window            (≥ 80% of ITSELF is on screen),
     · an episode OF this window, not the backdrop it sits on
                                           (3% ≤ its extent ≤ 50% of the span),
     · wide enough to read as a bar        (≥ 8px), and
     · not already drawn.
   The lowest level wins; ties go war-category first, then peak, then duration.

   THE ROW IS THE LANE'S LOWEST-PRIORITY VISIBLE ROW, given right of way rather
   than cleared: an episode takes only the space it actually collides with, so
   whatever else was in that row and does not overlap it simply stays. Nothing is
   added, so lane heights, the global height budget and the trim are all
   untouched, and a window with no qualifying episode gets no reserved row at all.

   AND IT MAY NOT OUTRANK ITS WAY IN. An episode evicts only things at its own
   level or below. Without that guard the rule cheerfully traded Asia's Silk Road
   (level 1, sixteen centuries) for Zheng He's treasure fleets (level 3, twenty-
   eight years) at an 800–1500 window — the importance ladder inverted in the name
   of surfacing an episode. World War I and II are level 1, so they still take the
   marginal row from Telegraph and telecommunications, which is level 1 too.

   Rows 0..n−2 never move, so zooming inside an era still cannot reshuffle what
   you were looking at — the stability rule survives intact. */
const ERA_MIN_PX = 8;          // narrower than this it is a tick, not a bar
const ERA_MIN_FRAC = 0.03;     // an episode OF this window…
const ERA_MAX_FRAC = 0.5;      // …not the backdrop it sits on
const ERA_INSIDE = 0.8;        // and mostly on screen, not clipped by an edge
const eraRank = (a: LSpread, b: LSpread) =>
  a.it.lvl - b.it.lvl
  || (a.it.cat === 'war' ? 0 : 1) - (b.it.cat === 'war' ? 0 : 1)
  || b.it.peak - a.it.peak
  || (b.it.end - b.it.start) - (a.it.end - a.it.start)
  || a.it.start - b.it.start;

// How dark the rest of the world goes when something is selected. NOT 0.1:
// selection here means "frame this thing AGAINST the lanes", and the relation
// links are secondary garnish — see the note on dimAlpha in relations.ts.
const DIM_FLOOR = 0.42;

// rectangle height by importance tier — the ONLY height variation permitted;
// never a weight curve (founder decision 2).
const TIER_H: Record<number, number> = { 1: 20, 2: 17, 3: 14, 4: 12, 5: 10 };

export const TL = {
  cv: null as unknown as HTMLCanvasElement, d0: -3000, d1: 2026,
  // Frozen `false`, kept because Lab and the vertical projection still read it. The
  // deep-time MODE died: the one piecewise scale reaches the Big Bang by wheel alone.
  log: false,
  q: '', hoverX: null as number | null,
  /* The domain filter, kept as an EMPTY set. The chips that wrote it are gone —
     a layer is a subject x a kind, which says "Europe's science but not its
     wars", the thing "hide this category everywhere" never could. render() and
     the vertical projection still consult it, so a future global mute has a
     place to write and nothing downstream had to change. */
  off: new Set<string>(),
  THR: { 1: Infinity, 2: 40000, 3: 2400, 4: 650, 5: 170 } as Record<number, number>,
  LMAX: 10.2,                              // dead, but part of the compatibility surface
  // stage height budget — sizeRenderers() writes this; the canvas grows to its content
  // but never (except at the trim floor) past this.
  HMAX: 760,
  // SPREAD_CAP / EVENT_CAP are gone with the density policy they were: a lane's
  // ceiling is what its detail dial asked for, and only the global height budget
  // can lower it. See `asks` in layout().
  SP_PITCH: 24, EV_PITCH: 17,
  // Lanes the reader has opened past their row cap by pressing "+N more".
  // Pressing it used to zoom one level of detail in, which could RAISE the
  // number it had just named: more items pass the LOD threshold while the rows
  // stay capped, so "+7 more" answered a click by saying "+11 more". It now
  // does what it says — the lane keeps every row it has and the band grows.
  expanded: new Set<string>(),

  // ---- THE LANE REGISTRY IS NOW THE LAYER PANEL ---------------------------
  // It used to be: deep time, then whichever curated lanes the LANES chips had
  // switched on, then the four standing regions, in a fixed order nobody could
  // change. The reader's only two verbs were "turn this whole band on" and
  // "hide this category everywhere". Both are gone; layers.ts holds the order,
  // the grouping, the visibility and the per-layer detail, and this method is
  // just its projection into lanes.
  //
  // A layer that has just been REMOVED is not dropped from the layout on the
  // spot -- that is a whole band vanishing in one frame, the exact jump this
  // file exists to kill. It is remembered here with the index it was removed
  // from, put back in that slot as `dying`, and the slew limiter walks it out
  // at 2.2px/frame; layout() forgets it once it has actually closed.
  dying: new Map<string, number>(),
  laneDefs(): {
    key: string; label: string; si: number | null; kind: 'group' | 'region' | 'movements' | 'person';
    isCur: boolean; isRegion: boolean; dying?: boolean; layerId: string | null;
    detail: Detail; hidden: boolean; grp: GNode | null;
  }[] {
    const out: any[] = [];
    for (const row of Layers.lanes()) {
      if (row.t === 'G') {
        out.push({
          key: 'g:' + row.g.id, label: row.g.name, si: null, kind: 'group', isCur: false,
          isRegion: false, layerId: null, detail: 1 as Detail, hidden: false, grp: row.g,
        });
        continue;
      }
      const d = layerDef(row.id); if (!d) continue;
      out.push({
        key: row.id, label: d.name, si: d.si, kind: d.kind,
        isCur: d.facet === 'all' && d.subject !== 'CO',
        isRegion: d.kind === 'region', layerId: row.id,
        detail: Layers.detail(row.id), hidden: !Layers.visible(row.id), grp: row.group,
      });
    }
    // ...and the ones on their way out, back where they were
    if (this.dying.size) {
      const pairs = [...this.dying.entries()].sort((a, b) => a[1] - b[1]);
      for (const [id, at] of pairs) {
        const d = layerDef(id); if (!d) { this.dying.delete(id); continue; }
        out.splice(Math.min(at, out.length), 0, {
          key: id, label: d.name, si: d.si, kind: d.kind,
          isCur: d.facet === 'all' && d.subject !== 'CO', isRegion: d.kind === 'region',
          dying: true, layerId: id, detail: Layers.detail(id), hidden: true, grp: null,
        });
      }
    }
    return out;
  },
  /* ── WHEN THERE IS NO PANEL, THE CANVAS NAMES ITS OWN BANDS ────────────────
     The panel can be away for two different reasons and this file deliberately
     cannot tell them apart:

       · the reader pressed the switch on the layer bar and put it away, to get
         the plot's width back on a tablet or to clear a phone screen; or
       · it was never up — below 760px a fresh visit starts with a clear canvas
         (layerpanel.ts, THE SWITCH), because a 232px drawer over a 390px phone
         is not a first sight of anything.

     Either way the canvas takes its own names back the moment it is not
     showing: the 118px gutter returns, each band draws its swatch and its
     label, and the header pad grows to a full strip to hold them.

     ONE TEST DECIDES IT — does the panel element have any width. Not a flag,
     not a media query read twice, not a copy of the switch's state: the panel
     is measured, here, on the frame that is being drawn. That is what makes it
     impossible for the two to disagree about who is labelling the bands, and it
     is why app.css closes the panel with `display:none` and nothing else —
     anything that left the element measurable would leave this test lying. */
  panelOn() {
    const el = $<HTMLElement>('#layerPanel');
    return !!(el && el.clientWidth > 0);
  },
  gutter() { return this.panelOn() ? GUT : GUT_SOLO; },
  /** A layer left the board -- close its band rather than deleting it. */
  closeLayer(id: string, at: number) { this.dying.set(id, at); this._noSnap = true; },
  /** Is this band key a curated lane? Kept for vertical.ts and the legend. */
  isCurated(key: string) { return LANES.some(L => L.key === key); },
  /**
   * Is this EVENTS tuple in a layer that is on the board, visible, and asked
   * for at its layer's detail? The vertical projection filters its columns
   * through this, so the two projections cannot disagree about what is showing
   * even though only one of them has the panel.
   */
  /** The detail its layer is set to, or `normal` when it has no layer at all. */
  detailOfEvent(ev: any[]): Detail {
    const id = layerIdOfEvent(ev);
    return id ? Layers.detail(id) : 1;
  },
  evVisible(ev: any[]): boolean {
    if (this.off.has(ev[6])) return false;
    const id = layerIdOfEvent(ev);
    if (!id || !Layers.has(id) || !Layers.visible(id)) return false;
    const d = layerDef(id); if (!d) return false;
    return passesDetail(Layers.detail(id), d.kind, ev[4] || 3,
      ev[7] || (ev[1] ? 'episode' : 'moment'), ev[0], ev[1] || 0);
  },
  // COMPAT SHIM for the vertical projection: same tuple shape as ever, but the
  // set of bands is now "every band with at least one visible layer" rather
  // than "the regions plus whichever lens chips are pressed". The bh numbers
  // are frozen constants consumed only by VT's railWidth.
  bands(): [string, string, number, number | null][] {
    const live = new Set<string>();
    for (const id of Layers.ids()) {
      if (!Layers.visible(id)) continue;
      const d = layerDef(id); if (d) live.add(d.subject);
    }
    const out: [string, string, number, number | null][] = [];
    if (live.has('CO')) out.push(['CO', 'Deep time', 34, null]);
    for (const L of LANES) if (live.has(L.key)) out.push([L.key, L.label, 88, L.si]);
    const REG: [string, string, number][] = [
      ['EU', 'Europe', 0], ['ME', 'MidEast & Africa', 1], ['AS', 'Asia', 2], ['AM', 'Americas', 3]];
    for (const r of REG) if (live.has(r[0])) out.push([r[0], r[1], 86, r[2]]);
    return out.length ? out : [['CO', 'Deep time', 34, null]];
  },
  span() { return this.d1 - this.d0; },

  // ---- the piecewise screen mapping (shared tv/ty; d0/d1 stay in YEARS) ----
  x(y: number, G: number, Wp: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1);
    return G + (tv(y) - v0) / ((v1 - v0) || 1) * Wp;
  },
  /** The same x, read off the LATCHED window instead of the live one. Anything a
   *  LAYOUT decision depends on has to be measured here or it is a per-frame
   *  input, which is the one thing the ladder exists to remove — see the event
   *  packing in layout(), whose row table this coordinate makes bit-frozen. */
  xLatch(v: number, G: number, Wp: number) {
    const v0 = this._lwV0, v1 = this._lwV1;
    return G + (v - v0) / ((v1 - v0) || 1) * Wp;
  },
  ix(x: number, G: number, Wp: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1);
    return ty(v0 + (x - G) / Wp * (v1 - v0));
  },
  /**
   * Zoom about an anchor year by factor f, in v-space. INVARIANT: x is affine in tv
   * with x(anchor) = G + frac·Wp before and after by construction, so the year under
   * the cursor never moves — at the seam and in deep time alike.
   */
  zoomBy(anchorYear: number, f: number) {
    const v0 = tv(this.d0), v1 = tv(this.d1), vc = tv(anchorYear);
    const frac = (vc - v0) / ((v1 - v0) || 1);
    const spanV = clamp((v1 - v0) * f, 8, VFULL);
    const [nv0, nv1] = clampV(vc - frac * spanV, vc - frac * spanV + spanV);
    this.d0 = ty(nv0); this.d1 = ty(nv1);
  },
  /** The span→importance ladder in its old continuous form. NOT a layout driver
   *  any more — the rung is (see STEPS). Kept because the vertical projection
   *  and the zoom readout still speak it. */
  levelFor(S: number) { if (S <= this.THR[5]) return 5; if (S <= this.THR[4]) return 4; if (S <= this.THR[3]) return 3; if (S <= this.THR[2]) return 2; return 1; },
  /**
   * THE OLD FADE RAMP. It used to be the whole level-of-detail system: a
   * smoothstep over a 1.6× band of spans, multiplied into every row's height,
   * so every wheel notch was a layout event. The ladder replaced it — see the
   * note above STEPS — and nothing in this file calls it any more. It stays
   * because vertical.ts exposes it as TL.alphaFor and because the number it
   * returns is still the honest answer to "how close is this span to the
   * threshold for this level".
   */
  alphaFor(lvl: number, S: number, isLens: boolean) {
    const t = this.THR[lvl] * (isLens ? 2.5 : 1); if (!isFinite(t)) return 1;
    if (S <= t) return 1;
    const p = (S - t) / (t * 0.6);
    if (p >= 1) return 0;
    return 1 - p * p * (3 - 2 * p);
  },

  /* ══ THE LADDER ══════════════════════════════════════════════════════════
     Everything the rung decides, and the only place it is decided. */

  /** The window's width in v — the zoom coordinate. Pan-invariant by construction. */
  vspan() { return tv(this.d1) - tv(this.d0); },
  /** Which rung a v-span belongs on, ignoring hysteresis. Boot and reporting. */
  stepAt(vs: number) { let i = STEPS.length - 1; while (i > 0 && vs > STEPS[i].v) i--; return i; },
  step: -1,                    // the rung we are standing on; −1 until the first layout
  _stepFrom: -1,               // the rung the live settle is climbing FROM
  _sT0: 0,                     // when that settle started (0 = nothing settling)
  /**
   * Every threshold crossing, newest last, capped at 64. `ms` is what the settle
   * ACTUALLY cost, measured from the crossing to the frame the last band arrived
   * — not the nominal SETTLE_MS, because the slew limiter can and does stretch a
   * big one. It stays −1 when the next crossing arrived first and superseded it,
   * which is what a flick through six rungs looks like in here. Read it from the
   * console: __tl.TL.xlog.
   */
  xlog: [] as { step: number; from: number; span: number; vspan: number; pitch: number; tier: number; at: number; ms: number }[],
  _xPend: null as null | { step: number; from: number; span: number; vspan: number; pitch: number; tier: number; at: number; ms: number },
  /**
   * Read the ladder. Called once per layout, before anything else looks at the
   * rung. Returns true on the frame a threshold was crossed.
   *
   * HYSTERESIS, both ways: the next rung's door opens at 0.91× its threshold
   * and the one you are on closes at 1.09× of yours, so the two tests can never
   * both be true and a wheel parked on a boundary has nothing to chatter
   * between. A single frame may climb several rungs (a flick, a preset flight);
   * that is still ONE settle, to wherever it landed.
   */
  stepTick(now: number): boolean {
    const vs = this.vspan();
    if (this.step < 0) {                       // boot: arrive on a rung, do not climb to it
      this.step = this.stepAt(vs); this._stepFrom = this.step; return false;
    }
    let i = this.step;
    while (i + 1 < STEPS.length && vs <= STEPS[i + 1].v * (1 - HYST)) i++;
    while (i > 0 && vs > STEPS[i].v * (1 + HYST)) i--;
    if (i === this.step) return false;
    const from = this.step;
    this.step = i; this._stepFrom = from; this._sT0 = now;
    // every drawn height becomes this settle's starting point, so the ease runs
    // from where the eye last saw the band rather than from the old target
    for (const st of this._dh.values()) { st.r0 = st.row.slice(); st.e0 = st.ev.slice(); st.h0 = st.head; }
    this._relatch = true;                      // the layout window follows the rung
    const e = {
      step: i, from, span: this.span(), vspan: vs,
      pitch: STEPS[i].pitch, tier: STEPS[i].tier, at: now, ms: -1,
    };
    this._xPend = e;
    this.xlog.push(e); if (this.xlog.length > 64) this.xlog.shift();
    return true;
  },
  /** How far through the settle, eased. 1 when nothing is settling. */
  settleP(now: number) {
    if (this._sT0 <= 0) return 1;
    const p = clamp((now - this._sT0) / SETTLE_MS, 0, 1);
    if (p >= 1) { this._sT0 = 0; this._stepFrom = this.step; return 1; }
    return p * p * (3 - 2 * p);
  },
  /** The visible importance tier for a layer: the rung's, offset by its detail dial.
   *  `detailed` means "everything we hold", which cannot mean "…once you have zoomed
   *  far enough in"; a curated lane is worth one tier more, exactly as the old ×2.5
   *  on its threshold was. */
  tierOf(detail: Detail, isCur: boolean, i = -1) {
    if (detail === 2) return 5;
    // −1 means "the rung we are on", and before the first layout has run there is
    // not one yet — the vertical projection can ask through TL.lodOf at boot.
    const k = i >= 0 ? i : this.step >= 0 ? this.step : this.stepAt(this.vspan());
    return clamp(STEPS[k].tier + (isCur ? 1 : 0), 1, 5);
  },
  showsAt(lvl: number, detail: Detail, isCur: boolean, i = -1) {
    return lvl <= this.tierOf(detail, isCur, i);
  },
  /* ── THE LATCHED LAYOUT WINDOW ───────────────────────────────────────────
     layout() decides occupancy against THIS window; render() draws at the live
     one. It is re-latched on exactly three things: the first frame, a rung
     crossing, and a PAN — a frame that moved the window without changing its
     v-span. A wheel changes the v-span every frame, so a wheel never re-latches,
     which is the whole of "bit-frozen between rungs": there is no per-frame
     input left for the span to move. */
  _lwV0: 0, _lwV1: 0, _lwOn: false,
  _pV0: 0, _pV1: 0,                            // last frame's live window, in v
  _relatch: false,
  /**
   * THE SOFT WINDOW, in v against the latch. How much of the padded window an
   * extent is inside: 1 for anything that touches it AT ALL — a spread crossing
   * the whole screen must never dim from pan maths, and the viewport edges must
   * never look permanently faded — then a smoothstep 1→0 across a pad 30% of
   * the window wide, which lives entirely off-screen. Panning something away
   * shrinks its row instead of deleting it.
   */
  winV(a: number, b: number) {
    const v0 = this._lwV0, v1 = this._lwV1, pad = (v1 - v0) * PAD_FRAC;
    const d = a > v1 ? a - v1 : (b < v0 ? v0 - b : 0);
    if (d <= 0) return 1;
    if (d >= pad) return 0;
    const p = d / pad;
    return 1 - p * p * (3 - 2 * p);
  },

  // ---- the spread corpus: membership + PERMANENT lane packing --------------
  // ONE CORPUS PER LAYER, not per band. A layer is a subject x a kind, so its
  // membership is a predicate over the same three sources as before -- EVENTS
  // durations, POLIS polities, REL.spreads -- routed through layers.ts's single
  // facetOf() decision, deduped by exact name so an EVENTS row does not shadow
  // the polity it duplicates. Packed ONCE per corpus in year space, zero-gap
  // (abutting spreads share a row -- the Gantt look), canonical order
  // (level asc, peak desc, type, duration desc, start asc, id asc).
  //
  // Packing per LAYER rather than per band is the whole reason a detail dial
  // can work: Europe's wars are packed against each other now instead of being
  // buried under fourteen level-1 empires, so "Europe . Wars" at `normal` is a
  // readable two rows rather than row seven of a region band.
  _corpus: null as null | { sig: string; byLayer: Map<string, SpreadItem[]> },
  ensureCorpus() {
    const defs = layerDefs();
    const sig = EVENTS.length + '|' + POLITIES.length + '|' + REL.spreads.length + '|' + defs.length;
    if (this._corpus && this._corpus.sig === sig) return this._corpus.byLayer;
    const byLayer = new Map<string, SpreadItem[]>();
    for (const d of defs) byLayer.set(d.id, []);
    // anchors: a mark banded elsewhere that a layer adopts (Mozart's lifespan
    // is banded MU, because a composer's life belongs in Music -- and the
    // Mozart layer is a study OF him, so it needs the bar too).
    const anchor = new Map<string, string[]>();
    for (const d of defs) for (const a of d.anchors || []) {
      const arr = anchor.get(a) || []; arr.push(d.id); anchor.set(a, arr);
    }
    const push = (id: string | null, it: SpreadItem) => {
      if (!id) return; const arr = byLayer.get(id); if (arr) arr.push(it);
    };
    for (const e of EVENTS) {
      if (!e[1]) continue;                             // moments belong to the event stratum
      const it: SpreadItem = {
        id: evId(e), name: e[2], start: e[0], end: e[1], cat: e[6] || 'power',
        type: e[7] || 'episode', lvl: e[4] || 3, sharpness: sharpnessOf(e[7], e[9]),
        // NOTE (not changed here, deliberately -- it is the founder's call): a
        // hand-authored spread has an importance LEVEL and no weight curve, so
        // peak is 0, and the packer breaks ties inside a level by peak.
        note: '', tags: e[5] || '', peak: 0, row: -1, ev: e,
        v0: tv(e[0]), v1: tv(e[1]),
      };
      push(layerIdFor(e[3], it.cat, it.type), it);
      for (const id of anchor.get(it.id) || []) push(id, { ...it });
    }
    for (const p of POLITIES) {
      const band = p.region === 'AF' ? 'ME' : p.region;
      push(layerIdFor(band, 'power', 'polity'), {
        id: 'polity:' + p.id, name: p.name, start: p.start, end: p.end, cat: 'power',
        type: 'polity', lvl: polityLvl(p), sharpness: 0.85,
        note: p.note || '', tags: '', peak: peakOf(p.weight), row: -1, ev: null,
        v0: tv(p.start), v1: tv(p.end),
      });
    }
    for (const sp of REL.spreads) {
      const fp = sp.footprint && sp.footprint.length ? sp.footprint[0] : null;
      const band = fp ? regionOf(fp.lat, fp.lon) : null;
      if (!band) continue;
      const cat = SPREADCAT[sp.kind] || 'society';
      push(layerIdFor(band, cat, 'spread'), {
        id: 'spread:' + sp.id, name: sp.name, start: sp.start, end: sp.end,
        cat, type: 'spread', lvl: lvlOfWeight(peakOf(sp.weight)), sharpness: sp.sharpness ?? 0.25,
        note: sp.note || '', tags: '', peak: peakOf(sp.weight), row: -1, ev: null,
        v0: tv(sp.start), v1: tv(sp.end),
      });
    }
    for (const entry of byLayer) {
      const items = entry[1];
      const names = new Set(items.filter(i => !i.ev).map(i => i.name.toLowerCase()));
      const kept = items.filter(i => !(i.ev && names.has(i.name.toLowerCase())));
      // DEVIATION from the architect's exact key (level, duration, peak): peak weight
      // outranks duration inside a level, so the top rows hold what actually loomed
      // largest (Rome, the big empires) rather than whatever merely lasted longest.
      // And at equal level/peak, collective phenomena outrank individual lives, or a
      // 90-year lifespan buries the 14-year Bauhaus.
      const typeRank = (t: SpreadItem) => (t.type === 'life' ? 1 : 0);
      kept.sort((a, b) => a.lvl - b.lvl
        || b.peak - a.peak
        || typeRank(a) - typeRank(b)
        || (b.end - b.start) - (a.end - a.start)
        || a.start - b.start
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const rows: SpreadItem[][] = [];
      for (const it of kept) {                          // zero-gap interval packing
        let r = 0;
        for (; r < rows.length; r++) if (!rows[r].some(o => it.start < o.end && o.start < it.end)) break;
        if (r === rows.length) rows.push([]);
        rows[r].push(it); it.row = r;
      }
      byLayer.set(entry[0], kept);
    }
    this._corpus = { sig, byLayer };
    return byLayer;
  },

  /**
   * THE DETAIL DIAL, WHERE THE RENDERER HONOURS IT.
   *
   * `normal` is deliberately a no-op against the old behaviour: the zoom LOD
   * decides, exactly as it always did. `less` never reaches here at all -- the
   * layer's membership was already cut by passesDetail(). `detailed` is the one
   * that changes the gate, and it removes it: "everything we hold" cannot mean
   * "...once you have zoomed far enough in", so a detailed layer draws every
   * mark it owns at every span, and the only thing that can still take one away
   * is the viewport physically running out of room.
   */
  lodOf(lvl: number, span: number, isCur: boolean, detail: Detail) {
    return this.showsAt(lvl, detail, isCur) ? 1 : 0;
  },

  /* ── THE LABEL FONTS ARE A PROPERTY OF THE RUNG ──────────────────────────
     Rectangles enlarge with the rung, so their names have to as well, or a
     decade's fat bars carry deep time's small type. Deriving the two font
     strings from the rung rather than from the eased drawn pitch is what keeps
     ellipsize()'s cache useful: the truncation of a name is re-derived once per
     rung and then re-used for every frame spent on it, instead of being
     re-measured against a width that moves every frame. */
  _fStep: -1, _fIn: '', _fUi: '',
  fonts() {
    if (this._fStep === this.step) return;
    const p = STEPS[Math.max(0, this.step)].pitch;
    const q = (px: number) => Math.round(px * 2) / 2;
    // THE CEILINGS MOVED WITH THE LADDER. They were 1.34/1.24 against a top
    // pitch of 1.62, i.e. type stopped growing four rungs before the marks did —
    // which is half of what "it looks squashed" was describing, because a 32px
    // rectangle carrying 14px type reads as a bar with a caption rather than as a
    // labelled object. The top pitch is 2.27 now; 1.45/1.34 keeps the inner label
    // at 15px inside a 43px level-1 bar and still fits a level-5 bar's 21px.
    this._fIn = fontUI(q(10.5 * clamp(p, 0.94, 1.45)), 600);
    this._fUi = fontUI(q(11.5 * clamp(p, 0.94, 1.34)));
    this._fStep = this.step;
  },

  // ---- pure layout pass: filter, pack, measure → per-lane continuous rows ----
  // size() calls this before fitCanvas; render() paints from the SAME result, so the
  // canvas height and the painted content can never disagree. Read the CONTINUITY note
  // above the constants before touching anything below.
  //
  // _dh is the follower's state: what each lane's rows are DRAWN at right now. Keyed by
  // lane key and then by PERMANENT row index — never by a compacted index, or a row
  // opening above would shift every drawn height down one slot and pop the whole band.
  // Keying it permanently is also what makes the old "rows with nothing visible are
  // compacted out" step disappear: an empty row simply has target height 0.
  // r0/e0/h0 are the SETTLE'S ORIGIN: the drawn heights as they stood the frame
  // a rung was crossed. The follower eases from those to the rung's geometry,
  // and outside a settle they are ignored entirely.
  _dh: new Map<string, { row: number[]; ev: number[]; head: number; r0: number[]; e0: number[]; h0: number }>(),
  // the DRAWN pitch: the rung's pitch outside a settle, eased between two rungs
  // during one. render() reads it, so a rectangle grows with its row rather than
  // jumping to the new size and waiting for the slot to catch up. _aDraw is the
  // same thing for the rung's AIR, and the two are eased on the one settle clock,
  // so a row's mark and the space around it arrive together.
  _pDraw: 1, _aDraw: 1,
  /** A spread row's pitch. THE MARK scales with the rung; THE GUTTER inside the
   *  row scales as sqrt(pitch) — leading, not separation. See the air note above
   *  STEPS. sqrt(1) === 1, so the reference rung is untouched. */
  spOf(p: number) { return (this.SP_PITCH - ROW_AIR) * p + ROW_AIR * Math.sqrt(p); },
  /** An event row's pitch, split the same way. */
  epOf(p: number) { return (this.EV_PITCH - EV_AIR) * p + EV_AIR * Math.sqrt(p); },
  /* ── WHERE THE GLOBAL HEIGHT BUDGET USED TO BE, AND WHY IT IS GONE ────────
     There was a `budgetOf(air)` here and a pair of trim maps under it. The plot
     was held to a stage-height budget: every frame, the lane with the most rows
     gave one up until the total fitted, and what it gave up went into "+N more".

     THAT MECHANISM WAS THE BUG. A row costs spOf(pitch) pixels and the pitch
     grows with the rung, so the SAME budget buys FEWER ROWS the further in you
     zoom — and at the same time the rung's tier gate lets MORE marks qualify, so
     demand rises while capacity falls. Measured on the corpus at a fixed 1800–
     2000 window, the old ladder drew 67 marks at `centuries` and 58 nine rungs
     later; Europe's Essentials went from four spread rows to two, and Winston
     Churchill — permanently packed on row 2 — was evicted into "+3 more" at the
     `centuries` crossing and never came back. Twenty-six marks in all vanished
     ON THE WAY IN across the ladder. The founder, twice, in his own words:
     "when I zoom more he disappears… zoomed out I see more stuff than zoomed in.
     Remember? Google Earth, we should be zooming in to see more, adding the space
     as needed."

     So the budget is not tuned, it is retired. A lane's row cap is now exactly
     what its content asks for, and `asks` is a NON-DECREASING function of the
     rung (the tier gate only ever opens, the detail dial is zoom-independent and
     the window is latched), so the set of rows a lane shows — and therefore the
     set of marks, since a mark's row is permanent — can only ever GROW as the
     reader zooms in. That is the invariant, and it now holds by construction
     rather than by tuning: there is no longer any code path that can take a
     spread row away on the way in.

     WHAT PAYS FOR IT is the scroll FIX 2 already built. The sheet grows and the
     one shared scroller absorbs it; HMAX survives as the MINIMUM stage height
     (see size()), which is what keeps a short arrangement from floating as a slab
     in the middle of the ground. Measured on the default arrangement at the
     closest rung the plot is about 3.5 viewports tall, and the reader who zoomed
     that far in is asking for exactly that. */
  _snap: true,                              // next layout jumps straight to its target
  _noSnap: false,                           // …unless a user-initiated change wants the ramp
  _lastCw: 0,
  _lastLay: -1e9,
  _raf: 0,


  layout(cw: number): Layout {
    const G = this.gutter(), Wp = cw - G - 10;
    const solo = G !== GUT;                          // the canvas is naming its own bands
    const sel = SelStore.id;
    const rels = sel ? relOf(sel) : null;
    const q = this.q.toLowerCase();
    const ctx = this.cv.getContext('2d')!;
    const byLane = this.ensureCorpus();

    // ── the follower's clock. SNAP means "this is a new look, not a gesture": the
    // first paint, a resize, a return from another tab (nothing painted for
    // IDLE_MS), or prefers-reduced-motion. _noSnap is the one-shot the discrete
    // user actions set so their ramp survives an idle gap.
    const now = performance.now();
    const snap = (this._snap || this._lastCw !== cw || (now - this._lastLay) > IDLE_MS || reduceMotion())
      && !this._noSnap;
    this._snap = false; this._noSnap = false; this._lastCw = cw; this._lastLay = now;

    // ── THE RUNG, AND THE LATCH ────────────────────────────────────────────
    // Read the ladder FIRST: everything below is a function of the rung, and a
    // crossing has to have taken its snapshot before any of it is measured.
    this.stepTick(now);
    if (snap) { this._sT0 = 0; this._stepFrom = this.step; }   // a new look arrives whole
    const sp = this.settleP(now);
    const ST = STEPS[this.step], STF = STEPS[this._stepFrom < 0 ? this.step : this._stepFrom];
    const pT = ST.pitch;                                  // the rung's own pitch — the TARGET
    const pD = this._pDraw = STF.pitch + (pT - STF.pitch) * sp;   // …and the eased DRAWN one
    const aT = ST.air;                                    // the rung's air — the TARGET
    const aD = this._aDraw = STF.air + (aT - STF.air) * sp;       // …and the eased DRAWN one
    const SP = this.spOf(pT), EP = this.epOf(pT);
    const SPd = this.spOf(pD), EPd = this.epOf(pD);
    // the furniture between the BANDS, at this rung and at the drawn ease of it
    const GAP = GAP_H * aT, GAPd = GAP_H * aD;
    const HEAD = Math.min(MIN_LANE_H, HEAD_PAD * aT);     // never past the empty-lane floor
    const GRP = GRP_H * aT;
    this.fonts();
    const uiF = this._fUi;
    // The latch. A frame that moved the window without changing its v-span is a
    // PAN and the layout follows it, exactly as it always did; a frame that
    // changed the v-span is a ZOOM and the layout does not move at all.
    const lv0 = tv(this.d0), lv1 = tv(this.d1);
    const moved = lv0 !== this._pV0 || lv1 !== this._pV1;
    const sameSpan = Math.abs((lv1 - lv0) - (this._pV1 - this._pV0)) < 1e-9;
    // NOT on `snap`. Snapping is about the FOLLOWER — "do not ramp, arrive whole"
    // — and it must never change what the follower is arriving AT. It used to be
    // in this condition, and the effect was a layout that quietly re-fitted itself
    // whenever the reader wheeled half a rung in and then paused for IDLE_MS: a
    // jump with no gesture under it, which is precisely what the ladder is for.
    if (!this._lwOn || this._relatch || (moved && sameSpan)) {
      this._lwV0 = lv0; this._lwV1 = lv1; this._lwOn = true;
    }
    this._pV0 = lv0; this._pV1 = lv1; this._relatch = false;

    interface Draft {
      L: LaneLayout; vis: LSpread[]; gRaw: number[]; spare: boolean[];
      evRaw: number[]; evSpare: boolean[];
      gS: number[]; gE: number[]; cumS: number; cumE: number; hT: number;
      capS: number; capE: number;
    }
    const drafts: Draft[] = [];

    // ══ PHASE A — what is visible, and how much height each row ASKS for ═════
    for (const def of this.laneDefs()) {
      const laneId = def.key;
      const isCur = def.isCur;
      const dying = !!def.dying;
      const detail = def.detail;
      const isExp = this.expanded.has(laneId);
      // THE EVENT STRATUM IS RATIONED BY THE RUNG. It used to pack into a flat
      // EVENT_CAP=3 for every band for ever (a density policy wearing the clothes
      // of a measurement), and then, briefly, into as many rows as physically
      // fitted — which made the stratum's height a per-frame number. The rung
      // says how many rows the stratum gets, the same way it says how tall a row
      // is; opening the lane by hand still overrides it.
      const eventCap = isExp ? EV_BOUND : ST.ev;
      // A GROUP'S HEADER STRIP is a lane with no content: a rule across the
      // plot, and a panel row whose height mirrors it (or, when the group is
      // collapsed, mirrors it plus every child band it is standing in for).
      const isGrp = def.kind === 'group';
      const corpus = isGrp || def.hidden ? [] : (byLane.get(laneId) || []);
      let nRows = 1;
      for (const it of corpus) if (it.row + 1 > nRows) nRows = it.row + 1;
      const gRaw = new Array<number>(nRows).fill(0);
      const spare = new Array<boolean>(nRows).fill(false);
      const vis: LSpread[] = [];
      for (const it of corpus) {
        if (this.off.has(it.cat)) continue;
        // THE DIAL IS ABSOLUTE AND COMES FIRST. It is a statement about content
        // ("only the turning points", "everything we hold"), so it is decided
        // before anything looks at the viewport or the zoom.
        if (!passesDetail(detail, def.kind as any, it.lvl, it.type, it.start, it.end)) continue;
        const isMatch = !!q && (it.name.toLowerCase().includes(q) || it.tags.includes(q) || it.note.toLowerCase().includes(q));
        // SOFT WINDOW first, against the LATCH: the only cull is the pad, 30% of
        // the window away, so nothing can leave the layout in a single pan frame
        // — and nothing can leave it during a zoom at all.
        const wA = this.winV(it.v0, it.v1);
        if (wA <= 0.02) continue;
        const isLit = lit(it.id, sel, rels);
        const on = this.showsAt(it.lvl, detail, isCur);                 // at the rung we are ON
        const was = sp < 1 && this.showsAt(it.lvl, detail, isCur, this._stepFrom);
        // THE ROW'S HEIGHT IS THE RUNG'S DEMAND, never the settle's alpha. Heights
        // are walked by the limiter and alphas by the settle clock; crossing the two
        // over is what used to make a fade and a growth fight each other.
        const want = (on || isLit) ? wA : (isMatch ? 0.6 * wA : 0);
        if (want > gRaw[it.row]) gRaw[it.row] = want;
        // …and the alpha IS the settle's, the only thing left of the old ramp: a
        // mark the rung has just revealed fades in across the settle, one the rung
        // has just dropped fades out across it, and everything else is simply there.
        let lodA = isLit ? 1 : on ? (was || sp >= 1 ? 1 : sp) : (was ? 1 - sp : (isMatch ? 0.6 : 0));
        lodA *= wA;
        if (lodA <= 0.02) continue;
        const x0 = this.x(it.start, G, Wp), x1 = this.x(it.end, G, Wp);   // LIVE — drawing only
        vis.push({ it, row: it.row, x0, x1, lodA, isMatch });
        if (isMatch || it.id === sel) spare[it.row] = true;
      }

      // THE ZONE-CAP FOLD (fold.ts). A founding or dissolution event that
      // duplicates a spread's cap is not a second fact: "Qin unifies China, 221
      // BCE" IS the left edge of the Qin dynasty rectangle two rows above it.
      // Two marks, one fact, and the dot is the weaker of the two. So the dot
      // folds into the spread, which names it in its tooltip and its card.
      //
      // PER FRAME, and against what this lane can actually SHOW: zoom out until
      // the Qin's fifteen years fall below the level of detail and the dot
      // returns, because at that zoom it is the only mark carrying the fact.
      // Keyed to LOD visibility rather than to the row budget — the budget edge
      // is fractional now, and hanging a dot's existence on it would flicker.
      const drawn = new Set(vis.map(v => v.it.id));
      const foldedMatch = new Set<string>();
      // events: per-frame pixel packing, today's laneEnd algorithm, end==0 only;
      // when no row is free the event is DROPPED to the overflow count.
      ctx.font = uiF;
      const evs = (isGrp || def.hidden ? [] : EVENTS.filter(e =>
        !e[1] && !this.off.has(e[6])
        && layerIdFor(e[3], e[6] || 'power', e[7] || 'moment') === laneId
        && passesDetail(detail, def.kind as any, e[4] || 3, e[7] || 'moment', e[0], 0),
      )).sort((a, b) => a[0] - b[0]);
      /* ── WHAT QUALIFIES, BEFORE ANYTHING IS PACKED ─────────────────────────
         The stratum used to size itself from the packing: however many rows the
         pixel packer happened to need this frame WAS the stratum's height. That
         is a per-frame number — it moves with every pan and every wheel notch —
         and it is exactly the kind of input the ladder exists to remove. So
         existence is decided first, by the rung and the latch alone, and the
         packer is handed a fixed number of rows to fill. */
      const qual: { ev: any[]; id: string; title: string; x0: number; xp: number; a: number; on: boolean; isMatch: boolean }[] = [];
      let nOn = 0;
      for (const ev of evs) {
        const id = evId(ev);
        const title = ev[2];
        const isMatch = !!q && (title.toLowerCase().includes(q) || ev[5].includes(q));
        const fold = FOLD[title];
        if (fold && drawn.has(fold.spread)) {
          if (isMatch) foldedMatch.add(fold.spread);   // a search for it lands on its parent
          continue;
        }
        const wA = this.winV(tv(ev[0]), tv(ev[0]));
        if (wA <= 0.02) continue;
        const isLit = lit(id, sel, rels);
        const on = this.showsAt(ev[4], detail, isCur);
        const was = sp < 1 && this.showsAt(ev[4], detail, isCur, this._stepFrom);
        const a = (isLit ? 1 : on ? (was || sp >= 1 ? 1 : sp) : (was ? 1 - sp : 0)) * wA;
        if (a <= 0.02) continue;
        if (on || isLit) nOn++;
        qual.push({
          ev, id, title, a, on: on || isLit, isMatch,
          x0: this.x(ev[0], G, Wp),                 // LIVE — drawing only
          xp: this.xLatch(tv(ev[0]), G, Wp),        // LATCHED — everything the packing decides
        });
      }
      /* ── THE PACKING, AND WHY NOTHING FALLS OUT OF IT ANY MORE ────────────
         The table used to be a FIXED number of rows — the rung's `ev` — and a dot
         that found no free row in it was dropped into "+N more". That is the same
         disappearance the row budget used to cause, arriving by a different door,
         and it is the one the ladder makes WORSE the further in you go: a label's
         width is a function of the rung's font, so at a fixed window the same dots
         claim more and more x as the reader zooms in, and one by one they stop
         fitting. Measured on the corpus, that alone deleted 44 dots on the way in.

         So the table GROWS. Three placements, tried in order, and only the third
         can fail:
           1. a row whose last committed label ends left of this dot,
           2. failing that, A NEW ROW — the stratum is one row taller and the sheet
              scrolls, which is the founder's "adding the space as needed",
           3. failing that (the table is at EV_BOUND), a row whose last DOT is
              clear, placed WITHOUT its label. The mark survives; the word is what
              is spent. That is the right thing to lose, and it is reversible —
              zoom on and the window widens the gaps back out.
         Only when the DOTS themselves collide is one dropped, which is an honest
         statement that two marks are at the same pixel.

         AND IT IS PACKED IN LATCHED COORDINATES. The stratum's height is read off
         the packing now, so the packing may not be a per-frame number: xp comes
         from the latched window, which moves on a pan and on a rung crossing and
         at no other time. Between rungs the event rows are therefore bit-frozen,
         exactly as the spread rows have always been. */
      const laneEnd: number[] = [];               // rightmost committed x per row (label included)
      const dotEnd: number[] = [];                // …and the same counting DOTS only
      const evSpare: boolean[] = [];
      const events: LEvent[] = [];
      let more = 0;
      for (const Q of qual) {
        const { ev, id, title, x0, xp, a: lodA, isMatch } = Q;
        const labelW = textW(ctx, title, uiF);
        let mode: 'right' | 'left' | 'none' = 'right';
        let lane = laneEnd.findIndex(le => le < xp - 4);
        if (lane < 0 && laneEnd.length < EV_BOUND) {
          lane = laneEnd.length; laneEnd.push(-1e18); dotEnd.push(-1e18); evSpare.push(false);
        }
        if (lane < 0) {
          lane = dotEnd.findIndex(de => de < xp - 4);
          if (lane < 0) { more++; continue; }
          mode = 'none';
        }
        const prevEnd = laneEnd[lane];
        if (mode === 'right' && xp + 7 + labelW >= cw - 4) mode = (xp - 9 - labelW > Math.max(G, prevEnd + 4)) ? 'left' : 'none';
        laneEnd[lane] = Math.max(prevEnd, xp + 8 + (mode === 'right' ? labelW : 0));
        dotEnd[lane] = Math.max(dotEnd[lane], xp + 8);
        if (isMatch || id === sel) evSpare[lane] = true;
        events.push({ ev, id, x0, row: lane, lodA, mode, labelW, isMatch });
      }
      // THE STRATUM'S HEIGHT is the rung's allowance or the packing's demand,
      // whichever is larger. The rung's floor is what keeps an empty-ish stratum
      // from collapsing as the reader wheels; the packing's demand is what keeps
      // every dot it placed on a row that has height to stand in.
      const evRows = Math.max(Math.min(eventCap, nOn), laneEnd.length);
      const evRaw = new Array<number>(evRows).fill(1);
      while (evSpare.length < evRows) evSpare.push(false);
      if (foldedMatch.size) for (const v of vis) if (foldedMatch.has(v.it.id)) v.isMatch = true;
      // era-row candidates, gathered from everything VISIBLE (not just what
      // survived the budget) — whether they are already drawn is decided after
      // the global trim, which is the only point at which that is finally known.
      const era = def.isRegion && !def.hidden
        ? (byLane.get(laneId) || [])
          .filter(it => it.type === 'episode')
          .map(it => vis.find(v => v.it.id === it.id))
          .filter((v): v is LSpread => !!v && this.isEraEpisode(v, Wp))
          .sort(eraRank)
        : [];
      // A LANE SWITCHED OFF HAS TO ACTUALLY CLOSE. `dying` zeroed the header height
      // and nothing else, so a lane the reader had just turned off kept every one of
      // its rows: the band lost its name and its dot and went on drawing its content
      // for ever — and because its height never fell under the 0.4px threshold, it
      // never left the `dying` set either, so switching it back on had nothing to
      // grow. The rows ARE the lane. They target zero with the header, and the slew
      // limiter walks the whole band out at 2.2px a frame, which is the close the
      // note above this file always described.
      if (dying) { gRaw.fill(0); evRaw.fill(0); }
      const L: LaneLayout = {
        key: laneId, label: def.label, si: def.si, isCur,
        layerId: def.layerId, detail, grp: def.grp, isGroupHead: isGrp,
        spreads: [], events,
        ns: 0, ne: evRows, more, exp: isExp,
        isRegion: def.isRegion, era, eraRow: -1, eraOut: [],
        top: 0, h: 0, evTop: 0,
        rowY: [], rowH: [], rowG: gRaw, evY: [], evH: [], evG: evRaw,
        headH: 0, gapH: 0, dying,
      };
      drafts.push({
        L, vis, gRaw, spare, evRaw, evSpare, gS: [], gE: [], cumS: 0, cumE: 0, hT: 0,
        capS: 0, capE: 0,
      });
    }

    // ══ PHASE B — how tall each band is. NOTHING IS TAKEN AWAY HERE ══════════
    // This used to be the global height budget: a trim loop that took a row off
    // the tallest band until the plot fitted a viewport. It is gone, and the note
    // where budgetOf() used to live says why in full. What is left is the
    // measurement — a band's height is its content's demand, and its cap IS that
    // demand, so the only number that can lower a row's height is the row's own
    // LOD alpha.
    //
    // WHY THAT MAKES THE ZOOM MONOTONE. `asks` counts the permanent rows holding
    // something visible. Every input to it is either zoom-independent (the detail
    // dial, the category mutes, the search) or NON-DECREASING in the rung (the
    // tier gate), and the window it is measured against is the LATCH. So
    // asks(rung N+1) >= asks(rung N) at a fixed window, a mark's row index is
    // permanent, and gS[row] > 0 for every row up to the cap. Zooming in can
    // therefore only ever ADD marks. There is no tuning constant in that sentence.
    //
    // A band's header height, as a continuous function of how much content it
    // holds. See the note on HEAD_PAD / MIN_LANE_H above the constants.
    const headTarget = (L: LaneLayout, cum: number) =>
      L.dying ? 0
        : L.isGroupHead ? GRP
          : solo ? MIN_LANE_H                        // room for the name the canvas draws
            : MIN_LANE_H - (MIN_LANE_H - HEAD) * Math.min(1, cum);
    // Rows spend their demand in permanent order and nothing caps them. The
    // signature keeps its shape — the callers below still ask for the cumulative
    // height, and a future cap (an explicit per-lane one, say) has a place to go.
    const spend = (raw: number[]) => {
      const g = new Array<number>(raw.length).fill(0);
      let cum = 0;
      for (let r = 0; r < raw.length; r++) {
        const want = raw[r];
        if (want <= 0) continue;
        g[r] = want; cum += want;
      }
      return { g, cum };
    };
    const asks = (raw: number[]) => { let n = 0; for (const g of raw) if (g > 0.02) n++; return n; };
    const measure = (d: Draft) => {
      const L = d.L;
      d.capS = asks(d.gRaw);
      d.capE = asks(d.evRaw);
      const s = spend(d.gRaw); d.gS = s.g; d.cumS = s.cum;
      const e = spend(d.evRaw); d.gE = e.g; d.cumE = e.cum;
      // an empty lane is a bare MIN_LANE_H strip — big enough that its panel row
      // can still hold a name and an eye, which is what makes "hide" reversible —
      // and it narrows CONTINUOUSLY to HEAD_PAD as its first row grows in, so even
      // "this lane gets its very first item" has no step in it. A dying lane
      // targets zero and the limiter walks it out at 2.2px a frame.
      d.hT = headTarget(L, d.cumS + d.cumE)
        + d.cumS * SP + d.cumE * EP
        + GAP * Math.min(1, d.cumS) * Math.min(1, d.cumE)
        + GAP * Math.min(1, d.cumS + d.cumE);
      return d.hT;
    };
    for (const d of drafts) measure(d);

    // ══ PHASE C — the era row ═══════════════════════════════════════════════════════════════
    const clash = (c: LSpread, arr: LSpread[]) =>
      arr.filter(o => c.it.start < o.it.end && o.it.start < c.it.end);
    for (const d of drafts) {
      const L = d.L;
      for (const v of d.vis) { if (d.gS[v.row] > 0.02) L.spreads.push(v); else L.more++; }
      L.events = L.events.filter(e => { if (d.gE[e.row] > 0.02) return true; L.more++; return false; });
      let nsSolid = 0, neSolid = 0, victim = -1;
      for (let r = 0; r < d.gS.length; r++) if (d.gS[r] >= 0.35) { nsSolid++; victim = r; }
      for (let r = 0; r < d.gE.length; r++) if (d.gE[r] >= 0.35) neSolid++;
      L.ns = nsSolid; L.ne = neSolid;
      /* ---- THE ERA ROW (see the note above the constants) ------------------
         IT NO LONGER FIRES, AND THAT IS THE POINT. The era row existed to rescue
         a world war that biggest-first packing had buried in row seven, BELOW THE
         ROW CAP. With the cap gone (Phase B) every visible mark is drawn on its
         own permanent row, so `already` contains the whole of `vis`, `era` is a
         subset of `vis`, and `fresh` is empty at every settled frame — the loop
         falls out two lines below without trading anything. It is kept, whole,
         because it is the ONLY thing standing between the reader and that burial
         if a row cap is ever reintroduced, and because during a settle a mark on
         its way out can still leave a row half-open. The victim is the lane's
         lowest row that is actually A ROW — a 5%-grown ghost is not somewhere to
         promote a world war into. */
      if (!L.isRegion || nsSolid < 2 || !L.era.length || victim < 0) continue;
      const already = new Set(L.spreads.map(v => v.it.id));
      const fresh = L.era.filter(v => !already.has(v.it.id));
      if (!fresh.length) continue;
      const best = fresh[0].it.lvl;                   // era is pre-sorted by level
      const row = L.spreads.filter(v => v.row === victim);
      // the same sparing the row budget already gives: a row holding the selection
      // or a search hit is never disturbed
      if (row.some(v => v.isMatch || v.it.id === sel)) continue;
      let keep = row.slice();
      const placed: LSpread[] = [];
      const out: string[] = [];
      for (const c of fresh) {
        if (c.it.lvl !== best) break;
        if (clash(c, placed).length) continue;        // one row: no self-overlap
        const evict = clash(c, keep);
        if (evict.some(o => o.it.lvl < c.it.lvl)) continue;   // never outrank its way in
        keep = keep.filter(o => !evict.includes(o));
        out.push(...evict.map(o => o.it.name));
        placed.push(c);
      }
      if (!placed.length) continue;
      L.spreads = L.spreads.filter(v => v.row !== victim)
        .concat(keep, placed.map(p => ({ ...p, row: victim })));
      L.eraOut = out;                                  // the trade, kept inspectable
      L.more = Math.max(0, L.more + out.length - placed.length);
      L.eraRow = victim;
      // the promoted episode owns that row now, so the row's demand is ITS demand
      let g = 0; for (const v of L.spreads) if (v.row === victim && v.lodA > g) g = v.lodA;
      const before = d.cumS - d.gS[victim];
      d.gS[victim] = d.spare[victim] ? g : Math.min(g, Math.max(0, d.capS - before));
      d.gRaw[victim] = g; d.cumS = before + d.gS[victim];
    }

    // ══ PHASE D — the settle, the slew limiter, then the geometry ════════════
    // The rung's geometry above IS the target, and between rungs it does not move,
    // so nothing here has anything to do: drawn === target, every frame, exactly.
    //
    // ON A CROSSING there are two clocks, and they do different jobs.
    //   · THE SETTLE names a WAYPOINT — where the band should be `sp` of the way
    //     through SETTLE_MS, eased from wherever it stood when the rung changed.
    //     That is the ~230ms the founder asked for, and it is one settle per
    //     crossing however many rungs were climbed in the frame.
    //   · THE SLEW LIMITER still bounds the per-frame VELOCITY toward that
    //     waypoint — SLEW_ROW for a row, SLEW_LANE for the band, the band's bound
    //     on the signed sum so a row opening while another closes leaves the band
    //     still. A crossing that moves a band four rows therefore takes longer
    //     than the settle and never moves faster than the limiter allows; a
    //     crossing that moves it one row takes the settle exactly.
    // It is also still the whole answer for everything that is NOT a crossing: a
    // pan, a lane toggle, a preset teleport, a search that re-ranks the corpus.
    let anim = false;
    let top = AXIS_TOP;
    for (const d of drafts) {
      const L = d.L;
      const tRow = d.gS.map(g => g * SP);
      const tEv = d.gE.map(g => g * EP);
      const tHead = headTarget(L, d.cumS + d.cumE);
      let st = this._dh.get(L.key);
      // a lane seen for the first time starts CLOSED and grows in, unless this frame
      // is a snap (boot, resize, reduced motion) in which case it arrives whole
      if (!st) {
        st = { row: [], ev: [], head: snap ? tHead : 0, r0: [], e0: [], h0: 0 };
        this._dh.set(L.key, st);
      }
      const n = tRow.length, m = tEv.length;
      while (st.row.length < n) st.row.push(0);
      while (st.ev.length < m) st.ev.push(0);
      const tOf = (a: number[], r: number, len: number) => (r < len ? a[r] : 0);
      // the waypoint: identical to the target unless a settle is running, so
      // outside a crossing this whole mechanism costs one comparison
      const way = (t: number, from: number) => (sp >= 1 ? t : from + (t - from) * sp);
      const wRow = (r: number) => way(tOf(tRow, r, n), tOf(st.r0, r, st.r0.length));
      const wEv = (r: number) => way(tOf(tEv, r, m), tOf(st.e0, r, st.e0.length));
      const wHead = way(tHead, st.h0);
      if (snap) {
        for (let r = 0; r < st.row.length; r++) st.row[r] = tOf(tRow, r, n);
        for (let r = 0; r < st.ev.length; r++) st.ev[r] = tOf(tEv, r, m);
        st.head = tHead;
      } else {
        const dr = new Array<number>(st.row.length).fill(0);
        const de = new Array<number>(st.ev.length).fill(0);
        let sum = 0;
        // The caps, each widened to the distance IT governs and to nothing else:
        // the band's cap to how far the BAND has to travel this settle, a row's to
        // the furthest any single ROW has to. They are different numbers and the
        // difference matters — a rung that opens one row while another closes
        // moves the band barely at all and moves two rows a long way.
        let kRow = SLEW_ROW, kLane = SLEW_LANE;
        if (sp < 1) {
          const add = (a: number[]) => { let t = 0; for (const v of a) t += v; return t; };
          const far = Math.abs(tHead - st.h0);
          let mr = far;
          for (let r = 0; r < st.row.length; r++) mr = Math.max(mr, Math.abs(tOf(tRow, r, n) - tOf(st.r0, r, st.r0.length)));
          for (let r = 0; r < st.ev.length; r++) mr = Math.max(mr, Math.abs(tOf(tEv, r, m) - tOf(st.e0, r, st.e0.length)));
          const band = Math.abs((tHead + add(tRow) + add(tEv)) - (st.h0 + add(st.r0) + add(st.e0)));
          kRow = Math.max(kRow, mr / SETTLE_FRAMES * SETTLE_PEAK);
          kLane = Math.max(kLane, band / SETTLE_FRAMES * SETTLE_PEAK);
        }
        for (let r = 0; r < st.row.length; r++) { dr[r] = clamp(wRow(r) - st.row[r], -kRow, kRow); sum += dr[r]; }
        for (let r = 0; r < st.ev.length; r++) { de[r] = clamp(wEv(r) - st.ev[r], -kRow, kRow); sum += de[r]; }
        let dh = clamp(wHead - st.head, -kRow, kRow); sum += dh;
        const scale = (k: number) => {
          for (let r = 0; r < dr.length; r++) dr[r] *= k;
          for (let r = 0; r < de.length; r++) de[r] *= k;
          dh *= k;
        };
        if (Math.abs(sum) > kLane) scale(kLane / Math.abs(sum));
        // AND THEN ON THE BAND HEIGHT ITSELF, not merely on the row sum. L.h is the sum
        // PLUS two GAP_H terms that pass through a min(1, …) — derived furniture that a
        // row crossing that knee drags along faster than the sum reports. Measured, a
        // one-frame teleport moved a band 3.17px while every row obeyed its 2.5. So the
        // predicted height is computed from the candidate deltas and they are rescaled
        // against THAT: the number the eye actually sees is the number that is bounded.
        // Twice, because the min() makes the prediction piecewise-linear rather than
        // linear, and one pass can leave a little on the table.
        const hOf = (k: number) => {
          let s = 0, e = 0;
          for (let r = 0; r < st.row.length; r++) s += st.row[r] + dr[r] * k;
          for (let r = 0; r < st.ev.length; r++) e += st.ev[r] + de[r] * k;
          const nS = s / SPd, nE = e / EPd;
          return (st.head + dh * k) + s + GAPd * Math.min(1, nS) * Math.min(1, nE)
            + e + GAPd * Math.min(1, nS + nE);
        };
        for (let pass = 0; pass < 2; pass++) {
          const move = Math.abs(hOf(1) - hOf(0));
          if (move <= kLane) break;
          scale(kLane / move);
        }
        // the SNAP test is against the waypoint (that is where this frame is
        // going); `anim` is against the TARGET, so the loop keeps running until
        // the settle has finished delivering the band to the rung's geometry
        for (let r = 0; r < st.row.length; r++) {
          const w = wRow(r), t = tOf(tRow, r, n);
          st.row[r] = Math.abs(w - st.row[r]) < SETTLE ? w : st.row[r] + dr[r];
          if (st.row[r] !== t) anim = true;
        }
        for (let r = 0; r < st.ev.length; r++) {
          const w = wEv(r), t = tOf(tEv, r, m);
          st.ev[r] = Math.abs(w - st.ev[r]) < SETTLE ? w : st.ev[r] + de[r];
          if (st.ev[r] !== t) anim = true;
        }
        st.head = Math.abs(wHead - st.head) < SETTLE ? wHead : st.head + dh;
        if (st.head !== tHead) anim = true;
      }
      // ---- drawn geometry, in permanent row order ----
      L.rowH = st.row.slice(); L.evH = st.ev.slice();
      L.rowG = d.gRaw.slice(); L.evG = d.evRaw.slice();
      L.headH = st.head;
      let y = 0, sumS = 0;
      L.rowY = new Array<number>(L.rowH.length);
      for (let r = 0; r < L.rowH.length; r++) { L.rowY[r] = y; y += L.rowH[r]; sumS += L.rowH[r]; }
      let ye = 0, sumE = 0;
      L.evY = new Array<number>(L.evH.length);
      for (let r = 0; r < L.evH.length; r++) { L.evY[r] = ye; ye += L.evH[r]; sumE += L.evH[r]; }
      const nS = sumS / SPd, nE = sumE / EPd;
      L.gapH = GAPd * Math.min(1, nS) * Math.min(1, nE);
      L.h = L.headH + sumS + L.gapH + sumE + GAPd * Math.min(1, nS + nE);
      L.evTop = L.headH + sumS + L.gapH;
      L.top = top; top += L.h;
    }
    // A SETTLE IS ITSELF A REASON TO PAINT AGAIN. The heights may already be at
    // the rung's geometry while the ALPHAS are still ramping — a rung that reveals
    // a level into rows that were open anyway moves no pixel of layout at all —
    // and without this the rAF loop would park half way through the reveal.
    if (sp < 1) anim = true;
    // a dying lane that has finished closing leaves for good
    for (const d of drafts) {
      if (!d.L.dying) continue;
      if (d.L.h < 0.4) { this.dying.delete(d.L.key); this._dh.delete(d.L.key); } else anim = true;
    }
    const lanes = drafts.map(d => d.L).filter(L => !(L.dying && L.h < 0.4));
    // the crossing is over when the last band has arrived. Measured, not assumed:
    // xlog carries what the settle actually cost, which is the number to argue with.
    if (this._xPend && !anim && sp >= 1) { this._xPend.ms = now - this._xPend.at; this._xPend = null; }
    return { lanes, H: top + 34, G, Wp, sel, rels, q, anim };
  },

  /**
   * Does this visible spread read as an EPISODE OF the LATCHED window? In v,
   * for the same reason the ladder is in v — and because "is this 3% of the
   * window" asked in years gives a different answer either side of the seam for
   * the same picture on screen. Its pixel width is derived from the latch too,
   * so the era row is decided by the rung and the pan and by nothing else.
   */
  isEraEpisode(v: LSpread, Wp: number): boolean {
    const a = v.it.v0, b = v.it.v1, ext = b - a;
    if (ext <= 0) return false;
    const w0 = this._lwV0, w1 = this._lwV1;
    const ov = Math.min(b, w1) - Math.max(a, w0);
    if (ov <= 0 || ov / ext < ERA_INSIDE) return false;   // clipped by an edge
    const f = ext / ((w1 - w0) || 1);
    if (f < ERA_MIN_FRAC || f > ERA_MAX_FRAC) return false;
    return f * Wp >= ERA_MIN_PX;                          // legible as a bar
  },

  _lay: null as Layout | null,
  size() {
    if (!this.cv) return null;
    const cw = this.cv.clientWidth || this.cv.parentElement?.clientWidth || 0;
    if (!cw) return null;
    const lay = this._lay = this.layout(cw);
    // THE SHEET ALWAYS COVERS THE STAGE. The canvas used to be exactly as tall as
    // its bands and app.css centred it, so a short arrangement floated as a slab
    // of film in the middle of the ground. That was survivable while the plot was
    // the only thing on the stage; it is not survivable next to a panel that has
    // to start at the plot's first pixel, because the panel would end where the
    // bands end and the seam would turn into a step. So the plot is laid out at
    // the top and the canvas is grown to the stage — the empty film below the
    // last band is the same film the panel is painted on, which is what makes
    // "no visible join" true at every arrangement rather than only at tall ones.
    lay.H = Math.max(lay.H, this.HMAX);
    const d = fitCanvas(this.cv, lay.H);
    return d ? { cw: d.cw, H: lay.H, ctx: d.ctx, lay } : null;
  },
  boxes: [] as any[],
  /**
   * What is under the cursor — LAST box wins, except that a SEARCH MATCH wins
   * over everything. At a five-thousand-year span, Cubism (1907-22) is seven
   * pixels wide and Surrealism (1924-66) starts three pixels into it: search
   * for "cubism", get one hit, click the one thing lit on screen, and the plain
   * last-wins test hands you Surrealism. If you searched for it, you meant it.
   *
   * SUB-GROWN ROWS. Boxes are pushed at the DRAWN geometry, never the target — a
   * row caught 30% of the way in is hit-tested exactly where it is on screen, not
   * where it is going. Below HIT_FLOOR (34% grown, an 8px slot at 30% opacity) a
   * row is drawn but registers no box at all: a mark that faint is scenery, and
   * making it clickable only means the pointer catches ghosts on the way past.
   */
  /**
   * `pad` grows every box by the same margin BEFORE the containment test. Zero
   * for a mouse, which lands where it is pointed; TAP_PAD for a finger, because
   * an event dot is a few pixels tall and a fingertip is nine millimetres wide.
   * findLast still decides, so the topmost mark under the tap keeps winning and
   * the pad only ever adds candidates at the edges of what was already there.
   */
  hitAt(mx: number, my: number, pad = 0) {
    const inside = (b: any) => mx >= b.x - pad && mx <= b.x + b.w + pad && my >= b.y - pad && my <= b.y + b.h + pad;
    if (this.q) { const m = this.boxes.findLast((b: any) => b.isMatch && inside(b)); if (m) return m; }
    return this.boxes.findLast(inside);
  },
  /* ══ SCROLLING DOWN THE SHEET ═══════════════════════════════════════════
     The founder: "Add some way to scroll on Y (maybe with shift?)"

     WHOSE OFFSET IT IS. Not this file's. The panel and the canvas are two flex
     items of ONE element — .tl-view, which app.css already gives overflow-y —
     so the browser has been holding a single scroll offset for both of them
     since the panel was built, and layerpanel.ts's header note says so in as
     many words. A this.scrollY of my own would have been a SECOND offset, and
     the two would have had to be kept in step by hand through every settle, every
     fling and every resize; the panel's own history records that exact
     arrangement being tried and abandoned. So there is nothing here that scrolls.
     There is only something that MOVES THE ONE SCROLLER THE READER ALREADY HAS,
     and the lock survives by construction rather than by care: neither side can
     desync from the other because neither side has an offset of its own.

     It also means hit-testing needed no change at all. Boxes are in canvas
     coordinates and every pointer handler already converts through
     getBoundingClientRect(), which moves with the scroll — so a mark 400px below
     the fold hit-tests exactly where it is drawn, at any offset.

     THE GESTURE, AND WHY. Plain wheel is the time zoom and cannot be shared;
     that rules out both the mouse wheel and the trackpad's two-finger drag,
     which arrive as the same event and cannot be told apart with any test worth
     shipping. So: SHIFT + WHEEL, the founder's own suggestion, reading deltaX as
     well as deltaY because Chrome and Safari swap the two axes while shift is
     held. And because a modifier gesture nobody told you about is not a feature,
     it comes with two things that are not the gesture. A RAIL — a slim,
     permanently visible scrollbar down the right edge of the plot, present only
     when there IS something below, draggable, and carrying the sentence that
     names the gesture in its tooltip; and a CUE beside it that says the gesture
     in words, until the first time the reader scrolls, after which they know and
     it goes. (#zoomReadout would have been the obvious place for the words, and
     the line below still writes them there — but that panel was deleted with the
     rest of the Timeline controls, so today nothing reads it. The cue is what the
     reader actually sees.) */
  /** The one scroller the panel and the canvas share. */
  scroller(): HTMLElement | null {
    return this.cv ? this.cv.closest('.tl-view') as HTMLElement | null : null;
  },
  /** Move down the sheet. The browser clamps at both ends; nothing here needs to. */
  scrollBy(dy: number) {
    const sc = this.scroller(); if (!sc) return;
    const was = sc.scrollTop;
    sc.scrollTop = was + dy;
    if (sc.scrollTop !== was) this.onScroll();
  },
  /** How far down the sheet we are, and how far it goes. */
  scrollState() {
    const sc = this.scroller();
    if (!sc || !sc.clientHeight) return { top: 0, view: 0, all: 0, over: 0 };
    const over = Math.max(0, sc.scrollHeight - sc.clientHeight);
    return { top: sc.scrollTop, view: sc.clientHeight, all: sc.scrollHeight, over };
  },
  _rail: null as HTMLElement | null,
  _track: null as HTMLElement | null,
  _thumb: null as HTMLElement | null,
  _cue: null as HTMLElement | null,
  _railDrag: null as null | { y: number; top: number },
  /* THE RAIL IS A STICKY FLEX ITEM, and both halves of that matter. STICKY
     because an absolutely-positioned child of a scroll container is part of the
     scrolled content and would travel away with the plot it is supposed to be
     measuring. A FLEX ITEM of zero width because the section is a flex row —
     panel, then canvas at flex:1 — so a zero-width third item lands exactly on
     the canvas's right edge without being given a millimetre of it, and it is
     hidden with the whole view by app.css when another projection is showing,
     which no element parked on the stage could manage. */
  ensureRail(): HTMLElement | null {
    const sc = this.scroller(); if (!sc) return null;
    let r = this._rail;
    if (!r) {
      r = this._rail = document.createElement('div');
      r.id = 'tlScrollRail';
      // height is written every frame from the scroller; width stays 0 so the
      // flex row gives it no space at all and it lands on the canvas's right edge
      r.style.cssText = 'position:sticky;top:0;width:0;flex:0 0 0;'
        + 'align-self:flex-start;z-index:4;pointer-events:none;';
      /* WHAT THE AFFORDANCE SAYS DEPENDS ON WHAT THE READER HAS. "hold ⇧ and
         scroll" is a sentence about a keyboard, and the founder was reading it on
         an iPad, where it named a key that is not there and a wheel that is not
         there either. The gesture underneath it is different too: on touch the
         canvas's own drag carries Y (see the pointermove handler), so the true
         instruction is "drag". Branch on the POINTER, not on the viewport — a
         Magic-Keyboard iPad is a coarse pointer with a real Shift key, and "drag
         up" is still true for it, whereas "hold ⇧" is not true for a finger. */
      const coarse = coarsePointer();
      // THE HIT AREA IS WIDER THAN THE BAR. The bar reads as a 9px hairline
      // because that is all a scroll position needs to say; the thing you grab is
      // 20px, which is a finger — on a mouse-driven page. On a tablet it is half
      // of one. iOS's floor is 44 and this cannot be 44: the rail sits OVER the
      // right-hand end of the plot, so 44px of grab is 44px of marks that can no
      // longer be tapped. 32px is as far as that trade goes, and the plot-drag
      // above means the rail is no longer the ONLY way down the sheet on touch,
      // which is what made 20px untenable rather than merely tight.
      const trackW = coarse ? 32 : 20;
      const track = this._track = document.createElement('div');
      track.style.cssText = 'position:absolute;right:0;top:30px;bottom:34px;'
        + `width:${trackW}px;`
        + 'opacity:0;transition:opacity .16s ease;cursor:pointer;touch-action:none;'
        + 'pointer-events:none;';
      track.title = coarse
        ? 'The plot is taller than the window — drag this, or drag the plot itself up.'
        : 'The plot is taller than the window — drag this, or hold Shift and scroll.';
      const bar = document.createElement('div');
      bar.style.cssText = 'position:absolute;right:4px;top:0;bottom:0;width:9px;'
        + 'border-radius:5px;background:var(--tl-surface-2);';
      const thumb = this._thumb = document.createElement('div');
      thumb.style.cssText = 'position:absolute;left:1.5px;width:6px;border-radius:3px;'
        + 'background:var(--tl-ink-3);opacity:.5;';
      bar.appendChild(thumb);
      track.appendChild(bar);
      const cue = this._cue = document.createElement('div');
      cue.textContent = coarse ? '▾ more below — drag up' : '▾ more below — hold ⇧ and scroll';
      cue.style.cssText = 'position:absolute;right:20px;bottom:12px;white-space:nowrap;'
        + 'font:600 10.5px/1 var(--tl-font-ui);letter-spacing:.02em;'
        + 'color:var(--tl-ink-2);background:var(--tl-surface-over);'
        + 'border:1px solid var(--tl-rule-soft);border-radius:var(--tl-radius-xs);'
        + 'padding:5px 8px;opacity:0;transition:opacity .22s ease;pointer-events:none;';
      r.append(track, cue);
      const to = (e: PointerEvent) => {
        const st = this.scrollState(); if (!st.over) return;
        const tb = track.getBoundingClientRect();
        const th = thumb.offsetHeight;
        const run = Math.max(1, tb.height - th);
        const at = clamp((e.clientY - tb.top - this._railDrag!.top) / run, 0, 1);
        const scr = this.scroller(); if (scr) scr.scrollTop = at * st.over;
        this.onScroll();
      };
      track.addEventListener('pointerdown', e => {
        const tb = thumb.getBoundingClientRect();
        const inside = e.clientY >= tb.top && e.clientY <= tb.bottom;
        this._railDrag = { y: e.clientY, top: inside ? e.clientY - tb.top : thumb.offsetHeight / 2 };
        thumb.style.opacity = '.85';
        try { track.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        to(e); e.preventDefault();
      });
      track.addEventListener('pointermove', e => { if (this._railDrag) to(e); });
      const up = () => { if (this._railDrag) { this._railDrag = null; thumb.style.opacity = '.5'; } };
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
      track.addEventListener('mouseenter', () => { thumb.style.opacity = '.8'; });
      track.addEventListener('mouseleave', () => { if (!this._railDrag) thumb.style.opacity = '.5'; });
    }
    if (r.parentElement !== sc) sc.appendChild(r);
    return r;
  },
  /** Size and place the rail from the scroller. Called once per painted frame. */
  updateRail() {
    const st = this.scrollState();
    if (st.over <= 2) {                       // nothing below the fold — no affordance
      if (this._track) { this._track.style.opacity = '0'; this._track.style.pointerEvents = 'none'; }
      if (this._cue) this._cue.style.opacity = '0';
      return;
    }
    if (!this.ensureRail()) return;
    const track = this._track!, thumb = this._thumb!;
    // the rail is exactly as tall as the WINDOW, inset clear of the axis masthead
    // at the top and the year strip at the bottom
    this._rail!.style.height = st.view + 'px';
    track.style.opacity = '1'; track.style.pointerEvents = 'auto';
    const h = Math.max(30, track.clientHeight || st.view - 64);
    const th = Math.max(26, Math.round(h * st.view / st.all));
    thumb.style.height = th + 'px';
    thumb.style.top = Math.round((h - th) * (st.top / st.over)) + 'px';
    // …and the words go the moment the reader has used them once
    this._cue!.style.opacity = st.top < 8 ? '1' : '0';
  },
  /* The sheet moved under the reader. The canvas itself needs no repositioning —
     it IS the sheet — but three things are pinned to the WINDOW rather than to
     the plot and have to be told: the rail, the cursor's year pill (drawn at the
     visible bottom edge, because a cursor readout that scrolled out of sight
     would be a readout you cannot read), and a selection card anchored to a mark
     that has just moved. */
  onScroll() {
    this.updateRail();
    if (this.hoverX !== null) this.render();
    SelCard.reanchor();
  },
  /** Register another projection of this state (vertical.ts). Repainted by paint(). */
  onProjection(fn: () => void) { PROJECTIONS.push(fn); },
  /** Register a projection that has to bring a named band into view (vertical.ts). */
  onReveal(fn: (bandKey: string) => void) { REVEALS.push(fn); },
  /** Register something that mirrors the lane geometry (the layer panel). */
  onLayout(fn: (lay: Layout) => void) { LAYOUTS.push(fn); },
  reveal(bandKey: string) { for (const f of REVEALS) f(bandKey); },
  /** The state changed — repaint every projection of it, not just this one. */
  paint() { this.render(); for (const f of PROJECTIONS) f(); },
  /**
   * "Do not snap the next frame." The continuous height function needs no help
   * during a gesture, because a gesture paints every frame and the slew limiter is
   * already following it. A one-off CLICK is the exception: lane toggles, "+N more",
   * the domain chips. Those can land after seconds of stillness, and layout() reads
   * a long silence as "a new look — arrive whole", which is right when you come back
   * to the tab and wrong when you have just pressed a button. Pressing a button
   * means ramp, so the button says so.
   */
  ease() { this._noSnap = true; },

  // ---- one spread rectangle with its sharpness envelope --------------------
  // The envelope is ALPHA/EDGE only — never geometry, never height. Per-edge ramp
  // width R = min(0.5·(1−s)·W, 96): s=0.85 polity → crisp and stroked; s=0.25 era →
  // long ramps with a 25% plateau; s→0 near-triangular. All alpha is baked into the
  // gradient stops — globalAlpha stays 1, no double multiply.
  drawSpread(ctx: CanvasRenderingContext2D, x0: number, x1: number, yC: number, h: number, col: string, alpha: number, s: number, W = Math.max(x1 - x0, 2)) {
    const R = Math.min(0.5 * (1 - s) * W, 96);
    const lo = alpha * Math.max(s, 0.06);
    const g = ctx.createLinearGradient(x0, 0, x0 + W, 0);
    g.addColorStop(0, withA(col, lo));
    g.addColorStop(R / W, withA(col, alpha));
    g.addColorStop(1 - R / W, withA(col, alpha));
    g.addColorStop(1, withA(col, lo));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x0, yC - h / 2, W, h, 3); ctx.fill();
  },
  /** The envelope's alpha at x — the same ramp drawSpread paints. A label uses it to ask
   *  what it is ACTUALLY sitting on: an era at sharpness 0.1 ramps over 45% of its width
   *  each side, so its name starts far out on the fade where the composite is nearly the
   *  page, not on the plateau. Deciding the ink from the plateau put white on "The
   *  Atlantic slave trade" at 2.6:1 where its own ink would have given 6.5:1. */
  spreadAlphaAt(x: number, x0: number, W: number, s: number, alpha: number) {
    const R = Math.min(0.5 * (1 - s) * W, 96);
    if (!(R > 0)) return alpha;
    const d = Math.min(x - x0, x0 + W - x);
    if (d >= R) return alpha;
    const lo = alpha * Math.max(s, 0.06);
    return lo + (alpha - lo) * clamp(d / R, 0, 1);
  },

  render() {
    const dim = this.size();
    if (!dim) { this.updateRail(); return; }        // no width ⇒ not on screen ⇒ no rail
    const { cw, H, ctx, lay } = dim; const T = tokens();
    // ONE read of the scroller per frame. Both of the things that are pinned to
    // the window rather than to the sheet — the cursor's year pill and the
    // readout's hint — ask the same question, and asking it three times forces
    // three synchronous layouts for one answer. (updateRail keeps its own read:
    // it runs after the panel has been placed, which invalidates this one.)
    const sst = this.scrollState();
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    const { G, Wp, lanes, sel, rels, q } = lay;
    this.boxes = [];
    let hitCount = 0;

    // ---- shared time axis: THE SCALE IS A MASTHEAD ----------------------------
    // The grey year labels used to sit in a strip along the BOTTOM, sharing that
    // strip with the accent stub and the cursor's pill — three things claiming one
    // edge. They read along the top now, above everything, and the gridlines start
    // BELOW them: a rule that struck through its own label was never worth the
    // "full height" it bought. What stays full height is the cursor crosshair, which
    // is the only accent in the plot and the only vertical the reader is steering.
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
    ctx.beginPath();
    for (const t of timeTicks(this.d0, this.d1, Wp)) {
      const x = this.x(t.y, G, Wp);
      if (x < G - 1 || x > cw - 4) continue;
      ctx.moveTo(x, AXIS_TOP); ctx.lineTo(x, H - 30);
      // The gutter is 12px now, not 118 — the panel took the band names with it.
      // A centred year label at the very left edge would be sliced in half, so the
      // RULE always draws and the LABEL only draws where it fits whole.
      const tw = ctx.measureText(t.label).width;
      if (x - tw / 2 >= 2 && x + tw / 2 <= cw - 4) ctx.fillText(t.label, x, AXIS_TOP - 7);
    }
    ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(0, AXIS_TOP); ctx.lineTo(cw, AXIS_TOP); ctx.stroke(); ctx.globalAlpha = 1;
    const xn = this.x(2026, G, Wp);
    if (xn >= G && xn <= cw) { ctx.strokeStyle = T.accent2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xn, AXIS_TOP); ctx.lineTo(xn, H - 30); ctx.stroke(); ctx.setLineDash([]); }

    // TEXT ALIGNMENT IS CANVAS STATE, AND THE TICK LOOP ABOVE LEAVES IT 'center'.
    // It used to be put back by the band-header block ("a band name is language"),
    // which is gone now that the layer panel names the bands — so every label in
    // every lane was silently drawn CENTRED ON its x instead of starting there,
    // half a word to the left of where it belonged. Reset it here, where the tick
    // loop ends, rather than in whichever block happens to draw text next.
    ctx.textAlign = 'left';

    const bgHsl = hexHsl(T.panel); const bgL = bgHsl ? bgHsl[2] : 92;
    // Which way the ground goes decides how the per-item colour jitter spends
    // itself (see varyColor in shared.ts) and which way the plateau is mixed.
    const isLight = bgL > 50;
    // THE DRAWN PITCH AND THE RUNG'S FONTS. layout() has just run (size() called
    // it), so both are this frame's — the pitch eased if a settle is in flight,
    // the fonts fixed by the rung so a name's truncation is computed once per rung
    // and re-used for every frame spent on it.
    // (_aDraw is not read here any more: the row gutter is a function of pitch
    // alone now — see spOf — and the only air left is BETWEEN bands, which
    // layout() has already baked into the geometry it hands over.)
    const pD = this._pDraw;
    const SPd = this.spOf(pD), EPd = this.epOf(pD);
    const uiF = this._fUi, inF = this._fIn;

    for (const L of lanes) {
      // BAND FURNITURE, WITH THE NAME TAKEN OUT OF IT.
      //
      // The band used to paint its own name and swatch at x=10/20 inside a 118px
      // gutter. The layer panel sits at the band's exact y and its exact height
      // now, so painting the name here as well would be the same label twice,
      // eight pixels apart. What is left is the separator rule, and — for a
      // layer whose eye is shut — a dashed rule in the empty slot it is keeping,
      // which is the difference between "hidden" and "removed".
      // HOW MUCH OF THIS BAND IS REALLY THERE. It used to be headH/HEAD_H, which
      // read 1 for every live lane back when the header was a fixed 22px strip
      // holding the band name. The header is a PAD now — 8px when the band has
      // content — so that ratio silently fell to 0.36 and took the "+N more"
      // affordance and the hidden-layer rule down with it (both gate on > 0.5).
      // The honest measure is the band's own height against the minimum a band
      // can have: 1 for anything standing, a ramp while one grows in, 0 for a
      // lane on its way out, whose furniture should go first.
      const hs = L.dying ? 0 : clamp(L.h / MIN_LANE_H, 0, 1);
      const solo = G !== GUT;
      if (L.isGroupHead) {
        if (solo && hs > 0.02) {
          ctx.globalAlpha = hs; ctx.fillStyle = T.ink3;
          ctx.font = fontUI(9.5, 600); ctx.textAlign = 'left';
          ctx.fillText(L.label.toUpperCase(), 20, L.top + 11); ctx.globalAlpha = 1;
        }
        // a group is named by its panel row; here it is a rule with a little air
        ctx.strokeStyle = T.line; ctx.globalAlpha = .55; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Math.round(L.top + L.h - 5) + .5); ctx.lineTo(cw, Math.round(L.top + L.h - 5) + .5); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      // THE BAND SEPARATOR, ON A WHOLE PIXEL. It used to be stroked at the exact
      // fractional boundary, which antialiases a 1px line across two rows — fine
      // on its own, and not fine now that the SAME rule is continued through the
      // layer panel by CSS (app.css, .tl-lrow). Both have to land on the band's
      // last pixel row or the seam grows a two-pixel smudge.
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath();
      ctx.moveTo(0, Math.round(L.top + L.h) - .5); ctx.lineTo(cw, Math.round(L.top + L.h) - .5);
      ctx.stroke(); ctx.globalAlpha = 1;
      if (solo && hs > 0.02) {
        const g2 = clamp(L.headH / MIN_LANE_H, 0, 1);
        ctx.globalAlpha = hs;
        ctx.fillStyle = L.si === null ? T.ink2 : T.s[L.si];
        ctx.beginPath(); ctx.arc(10, L.top + 13 * g2, 4 * g2, 0, 7); ctx.fill();
        ctx.fillStyle = T.ink2; ctx.font = fontUI(10.5, 600); ctx.textAlign = 'left';
        ctx.fillText(L.label.toUpperCase(), 20, L.top + 17 * g2);
        ctx.globalAlpha = 1;
      }
      if (L.layerId && !L.dying && !Layers.visible(L.layerId) && hs > 0.5) {
        ctx.strokeStyle = T.line; ctx.globalAlpha = .5; ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.moveTo(0, Math.round(L.top + L.h / 2) + .5); ctx.lineTo(cw, Math.round(L.top + L.h / 2) + .5); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      /* ── THE PLOT IS CLIPPED TO THE PLOT ─────────────────────────────────
         The 118px gutter used to hide a whole class of overspill: the soft pan
         window keeps drawing anything within 30% of the viewport, so a spread
         or an event whose year is just off the left edge lands at a negative x,
         and its label was drawn into the gutter where the band name lived. It
         looked like a slightly crowded gutter. With the gutter down to 12px
         those same labels run off the canvas and arrive as half-words at the
         seam — "onze Age", "Sumer)" — which reads as a broken panel rather than
         as a mark that is off-window.

         So the marks are clipped to the plot rectangle, which is what should
         always have been true: content lives between the gutter and the right
         edge. The furniture ABOVE this line — the band separator, the hidden
         layer's dashed rule — is drawn from x=0 on purpose, because those are
         the rules the layer panel continues. */
      ctx.save();
      ctx.beginPath(); ctx.rect(G, AXIS_TOP, cw - G, H - AXIS_TOP - 26); ctx.clip();

      // ---- SPREAD STRATUM: rows at CONTINUOUS pitch, rectangles with envelopes ----
      // Row r owns the slot [rowY[r], rowY[r] + rowH[r]] and nothing else, at every
      // fractional state — that is what keeps "zero pairwise overlap" structural
      // rather than something to re-check. The rectangle keeps its share of that
      // slot (TIER_H is 20/24 of the pitch at most, so the 2px gutter scales too),
      // which is why a half-grown row is a half-height rectangle and not a full one
      // spilling into its neighbour.
      const byRow: LSpread[][] = [];
      for (const s of L.spreads) (byRow[s.row] ||= []).push(s);
      const top0 = L.top + L.headH;
      for (let r = 0; r < L.rowH.length; r++) {
        const slot = L.rowH[r];
        if (slot <= 0.05) continue;
        const rowItems = (byRow[r] || []).sort((a, b) => a.x0 - b.x0);
        if (!rowItems.length) continue;
        const g = clamp(slot / SPd, 0, 1);
        // how far this row is from the height its content asked for: a row being
        // squeezed out by the budget, or still catching up to the slew limiter,
        // fades by exactly the fraction of its demand it is being given
        const fade = clamp(g / Math.max(L.rowG[r] || g, 1e-3), 0, 1);
        const textGate = clamp((g - LAB_G0) / (LAB_G1 - LAB_G0), 0, 1);
        const yC = top0 + L.rowY[r] + slot / 2;
        let prevEnd = -1e18;
        for (let i = 0; i < rowItems.length; i++) {
          const s = rowItems[i], it = s.it;
          const searchDim = q ? (s.isMatch ? 1 : 0.12) : 1;
          if (q && s.isMatch) hitCount++;
          const dimA = dimAlpha(it.id, sel, rels, DIM_FLOOR) * searchDim;
          // THE RECTANGLE ENLARGES WITH THE RUNG. One multiplier across the whole
          // of TIER_H, so importance still reads as 20:17:14:12:10 at every rung —
          // the sizing ladder is scaled, never re-tuned.
          const h = (TIER_H[it.lvl] || 12) * pD * g;
          const [col, , edge] = varyColor(catColor(it.cat, T), it.id, isLight);
          // THE PLATEAU *IS* THE INTENDED COLOUR. It used to be pre-mixed 12% toward
          // the ground before being painted, which cost 10-14% of the fill's chroma
          // and put every rectangle ΔE 5-7 from what varyColor asked for — the
          // "softened" that reads as drained. varyColor now bakes the softening into
          // the ladder's own lightness band, so the fill goes down unmixed and the
          // per-channel error against the intended colour is ZERO. The LOD, dim and
          // search fades still multiply on top, exactly as before.
          const fillA = clamp(s.lodA * dimA * fade, 0, 1);
          // a rectangle narrower than 2px is widened to stay visible — but never
          // past its neighbour's left edge, or two ticks in one row overlap
          const nextX0 = i + 1 < rowItems.length ? rowItems[i + 1].x0 : 1e18;
          const W = Math.max(0.5, Math.min(Math.max(s.x1 - s.x0, 2), nextX0 - s.x0));
          this.drawSpread(ctx, s.x0, s.x1, yC, h, col, fillA, it.sharpness, W);
          if (it.sharpness >= 0.6) {                   // the stroke is what makes "founded on a date" read
            ctx.globalAlpha = clamp(0.9 * s.lodA * dimA * fade, 0, 1);
            // one OKLCH step AWAY from the ground, same hue: with the fill no longer
            // pre-mixed, stroking it in its own colour would be no edge at all
            ctx.strokeStyle = edge; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(s.x0, yC - h / 2, W, h, 3); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (it.id === sel) {                          // the selection ring, Conn's exact idea
            ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.roundRect(s.x0 - 1, yC - h / 2 - 1, W + 2, h + 2, 4); ctx.stroke();
          } else if (s.isMatch) {
            ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.roundRect(s.x0 - 1, yC - h / 2 - 1, W + 2, h + 2, 4); ctx.stroke();
          }
          // ---- THE LABEL, and the founder's truncation rule --------------------
          // A rectangle too narrow for its full name shows AS MUCH OF THE NAME AS
          // FITS plus an ellipsis — never a blank bar. Only when fewer than three
          // characters plus "…" would fit does it fall back to the outside-label
          // algorithm, and only then to nothing. ellipsize() caches per (font, text,
          // 8px width bucket), so a continuous zoom re-uses one answer across an
          // 8px band of widths instead of re-measuring every frame.
          const visX0 = Math.max(s.x0, G);
          ctx.font = inF;
          const inner = (s.x1 - visX0) - 12;
          const inText = ellipsize(ctx, it.name, inner, inF, 3);
          let mode: 'in' | 'right' | 'left' | 'none' = 'none';
          let labelW = 0;
          if (inText) mode = 'in';
          else {
            ctx.font = uiF;
            labelW = textW(ctx, it.name, uiF);
            const nx = i + 1 < rowItems.length ? rowItems[i + 1].x0 : 1e18;
            if (s.x1 + 7 + labelW < Math.min(nx - 4, cw - 4)) mode = 'right';
            else if (s.x0 - 9 - labelW > Math.max(G, prevEnd + 4)) mode = 'left';
          }
          // text fades in with the row (60%→85% grown) and with its own alpha,
          // continuously — the old hard cutoff at 0.25 popped every label
          const textA = clamp((s.lodA * dimA * fade - 0.10) / 0.15, 0, 1) * textGate;
          if (textA > 0.02) {
            if (mode === 'in') {
              // INK BY MEASURED CONTRAST on the real composite, not by a lightness
              // threshold. The old `effL > 50 ? ink : white` test picked the WORSE of
              // the two on 23/160 light variants and 108/160 dark ones — in dark BOTH
              // candidates are pale, and no lightness threshold can say "this fill is
              // too bright for either, use the panel colour". inkFor composites the
              // fill over the ground at its own alpha and takes the higher ratio.
              ctx.globalAlpha = Math.min(1, fillA + 0.2) * textA;
              // the word spans a stretch of the envelope, so ask what the fill is doing
              // at BOTH of its ends and take the ink whose worst end is still legible
              const inkX0 = visX0 + 6, inkX1 = inkX0 + textW(ctx, inText, inF);
              ctx.fillStyle = inkFor(col, T.panel,
                this.spreadAlphaAt(inkX0, s.x0, W, it.sharpness, fillA),
                this.spreadAlphaAt(inkX1, s.x0, W, it.sharpness, fillA), T.ink, T.panel);
              ctx.fillText(inText, visX0 + 6, yC + 3.5);
            } else if (mode === 'right') {
              ctx.globalAlpha = textA; ctx.fillStyle = T.ink;
              ctx.fillText(it.name, s.x1 + 7, yC + 4);
            } else if (mode === 'left') {
              ctx.globalAlpha = textA; ctx.fillStyle = T.ink;
              ctx.fillText(it.name, s.x0 - 9 - labelW, yC + 4);
            }
          }
          ctx.globalAlpha = 1;
          prevEnd = Math.max(prevEnd, s.x1 + (mode === 'right' ? 8 + labelW : 0));
          if (g >= HIT_FLOOR) this.boxes.push({
            x: mode === 'left' ? s.x0 - 11 - labelW : s.x0 - 2,
            y: yC - h / 2 - 2,
            w: (s.x1 - s.x0) + 4 + (mode === 'right' ? 10 + labelW : mode === 'left' ? 12 + labelW : 0),
            h: h + 4, kind: 'spread', id: it.id, it, band: L.label, isMatch: s.isMatch, row: r,
          });
        }
      }

      // ---- EVENT STRATUM: strictly below the spread block (decision 4) ----
      // Same treatment: an event row is EV_PITCH × the max alpha of its dots, and the
      // dot keeps its share of the slot, so a stratum opens and closes as smoothly as
      // the spreads above it.
      ctx.font = uiF;
      const evTop = L.top + L.evTop;
      for (const E of L.events) {
        const slot = L.evH[E.row] || 0;
        if (slot <= 0.05) continue;
        const g = clamp(slot / EPd, 0, 1);
        const fade = clamp(g / Math.max(L.evG[E.row] || g, 1e-3), 0, 1);
        const title = E.ev[2];
        const searchDim = q ? (E.isMatch ? 1 : 0.12) : 1;
        if (q && E.isMatch) hitCount++;
        const a = clamp(E.lodA * dimAlpha(E.id, sel, rels, DIM_FLOOR) * searchDim * fade, 0, 1);
        const yy = evTop + L.evY[E.row] + slot / 2;
        ctx.globalAlpha = a; ctx.fillStyle = catColor(E.ev[6], T);
        ctx.beginPath(); ctx.arc(E.x0, yy, 3.2 * pD * g, 0, 7); ctx.fill();
        if (E.id === sel) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(E.x0, yy, 7 * pD * g, 0, 7); ctx.stroke();
        } else if (E.isMatch) {
          ctx.globalAlpha = 1; ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(E.x0, yy, 7 * pD * g, 0, 7); ctx.stroke();
        }
        ctx.fillStyle = T.ink;
        const textA = clamp((a - 0.10) / 0.15, 0, 1) * clamp((g - LAB_G0) / (LAB_G1 - LAB_G0), 0, 1);
        if (textA > 0.02) {
          ctx.globalAlpha = textA;
          if (E.mode === 'right') ctx.fillText(title, E.x0 + 7, yy + 4);
          else if (E.mode === 'left') ctx.fillText(title, E.x0 - 9 - E.labelW, yy + 4);
        }
        ctx.globalAlpha = 1;
        if (g >= HIT_FLOOR) this.boxes.push({
          x: E.mode === 'left' ? E.x0 - 11 - E.labelW : E.x0 - 8, y: yy - slot / 2,
          w: 16 + (E.mode === 'none' ? 4 : E.labelW), h: slot, kind: 'ev', id: E.id, ev: E.ev,
          band: L.label, isMatch: E.isMatch,
        });
      }

      // ---- the row-cap affordance: it OPENS the lane, it does not zoom ----
      if ((L.more > 0 || L.exp) && hs > 0.5) {
        ctx.font = fontMono(10); ctx.fillStyle = T.ink3; ctx.textAlign = 'right';
        const txt = L.exp ? '− less' : `+${L.more} more`;
        ctx.fillText(txt, cw - 12, L.top + L.h - 6);
        const tw = ctx.measureText(txt).width;
        this.boxes.push({
          x: cw - 14 - tw, y: L.top + L.h - 17, w: tw + 8, h: 15,
          kind: 'more', lane: L.key, band: L.label, exp: L.exp, more: L.more,
        });
        ctx.textAlign = 'left';
      }
      ctx.restore();                                   // …end of the plot clip
    }

    const baseL = this.tierOf(1, false);
    // both readouts are optional chrome now — the panel search box that carried
    // #searchCnt has been removed, and render() must not care. The rung is named
    // as well as measured: "step 7/13 · centuries" is the thing that changed when
    // the layout last moved, and the reader should be able to see which rung a
    // given picture belongs to.
    const rd = $('#zoomReadout');
    // NAMED IN WORDS AS WELL AS DRAWN. The rail says "there is more below"; this
    // says how to get there, in the one strip that is already reporting what the
    // plot is doing, and only while it is true.
    if (rd) rd.textContent = `importance ≤ ${baseL} of 5 · span ${fmtSpan(this.span())}`
      + ` · step ${this.step + 1}/${STEPS.length} · ${STEPS[this.step].name}`
      + (sst.over > 2 ? (coarsePointer() ? ' · drag up to move down the sheet' : ' · ⇧ + scroll to move down') : '');
    const sc = $('#searchCnt'); if (sc) sc.textContent = q ? `${hitCount} hits` : '';
    /* ── THE SET YEAR HAS NO LINE ON THIS CANVAS ─────────────────────────────
       There used to be a minium stub rising off the axis at x(TimeStore.year).
       It was honest when the set year was something you set — a click on the
       axis, a drag of the rail. It is not any more: the global moment IS the
       centre of this viewport now (Lab's centre-year observer publishes it on a
       throttle), so the stub was an accent vertical inside the plot chasing the
       middle of the plot a tenth of a second behind the hand. Panning it looked
       like a line on a rubber band. His verdict was the short one: delete it.

       So the set year's home is the rail underneath the canvas — its readout,
       its flag and its own 22px stub at the very bottom edge of the stage, all
       of which are instant because they are positioned from the number itself.
       NOTHING EASED AND VERTICAL LIVES IN THE PLOT. The only vertical left in
       here is the cursor's, and a cursor does not lag: it goes where the hand
       goes, this frame.

       ── AND THE CURSOR PAINTS LAST ────────────────────────────────────────
       Last in the frame, after every band, every rectangle, every label and
       every piece of lane furniture, and outside the plot clip. Where you are
       pointing is not a layer of the chart — it is the one thing that must be
       legible over the densest lane in it, which is exactly where a reader
       needs to read a year off. The line is drawn twice: a hairline of the
       page's own ground first, so the accent never has to fight a rectangle's
       fill for contrast, then the accent itself. */
    if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
      const hx = Math.round(this.hoverX) + .5;
      const yr = this.ix(this.hoverX, G, Wp);
      // THE PILL RIDES THE WINDOW. The crosshair is the sheet's — full height,
      // scrolling with the marks it is measuring — but the pill under it is the
      // cursor's own readout, and a readout that has scrolled 400px off the
      // bottom of the window is not one. It sits on the last visible 26px of the
      // sheet, which is exactly where it always sat when the sheet fitted.
      const pillY = sst.view ? Math.max(AXIS_TOP + 8, Math.min(H - 26, sst.top + sst.view - 26)) : H - 26;
      ctx.globalAlpha = .55; ctx.strokeStyle = T.panel; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx, AXIS_TOP); ctx.lineTo(hx, H - 30); ctx.stroke();
      ctx.globalAlpha = .9; ctx.strokeStyle = T.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, AXIS_TOP); ctx.lineTo(hx, H - 30); ctx.stroke();
      ctx.globalAlpha = 1;
      yearPill(ctx, T, this.hoverX, pillY, fmtBig(yr));
    }
    // THE GEOMETRY LOCK. The canvas layout is the ONLY source of lane geometry,
    // and the panel is positioned from the very same numbers, in the same frame,
    // after the slew limiter has had its say — so a row and its lane agree at
    // every fractional state of every transition, not just at the ends.
    for (const f of LAYOUTS) f(lay);
    // …and the rail, which measures the finished sheet against the window
    this.updateRail();
    // THE FOLLOWER'S ONLY CLOCK. layout() reports `anim` while any drawn height is
    // still short of its target; one rAF per frame walks it the rest of the way and
    // then stops. this.render(), never this.paint(): the vertical projection has its
    // own layout and must not be dragged through 60 repaints for a band it does not
    // draw. A canvas with no width paints nothing, so a hidden tab parks the loop.
    if (lay.anim) { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }
    else if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  },

  // eased in V-SPACE: year-space easing would spend 99.9% of the Big Bang preset's run
  // outside human history.
  // A FLIGHT IS NOT A WHEEL. Every frame of one changes the v-span, which is the
  // test layout() uses to know that a zoom is in progress and the layout window
  // must not move — right for a wheel, wrong for a teleport, which is going
  // somewhere else entirely and has to take the layout with it. So the flight
  // says so, one frame at a time.
  animTo(a: number, b: number, done?: () => void) {
    if (reduceMotion()) { this.d0 = a; this.d1 = b; this._relatch = true; this.paint(); done?.(); return; }
    const va0 = tv(this.d0), vb0 = tv(this.d1), va1 = tv(a), vb1 = tv(b), t0 = performance.now();
    const step = (t: number) => {
      const p = clamp((t - t0) / 650, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.d0 = ty(va0 + (va1 - va0) * e); this.d1 = ty(vb0 + (vb1 - vb0) * e);
      this._relatch = true; this.paint();
      if (p < 1) requestAnimationFrame(step); else done?.();
    };
    requestAnimationFrame(step);
  },
  /** If the global moment is outside the window, centre the window on it. */
  ensureYearVisible() {
    // …unless a deliberate framing is in flight. "In perspective" on Cubism
    // asks for 1874-1954 while the global moment is still 1783, and this would
    // otherwise yank the window straight back to 1783 the instant the tab
    // switch repaints — the framing losing an argument with a courtesy.
    if (this._holdYear) { this._holdYear = false; return; }   // one-shot: consumed here
    const y = TimeStore.year;
    if (y >= this.d0 && y <= this.d1) return;
    const s = this.span();
    const [ca, cb] = clampDomain(y - s / 2, y + s / 2);
    this.animTo(ca, cb);
  },
  _holdYear: false,
  /**
   * THE CORE LOOP'S ONE MOVE: frame the window on something, WITHOUT touching
   * the moment. animTo writes d0/d1 and nothing else, which is the whole
   * contract — "In perspective" changes what you can see, never where you are.
   */
  frameTo(a: number, b: number) {
    this._holdYear = true;
    // Cleared on a macrotask, never synchronously: with prefers-reduced-motion
    // animTo calls done() in the same tick as the click, which is BEFORE React
    // has flushed the tab switch — so a synchronous clear would hand the flag
    // back just in time for renderTab() to undo the framing.
    const [ca, cb] = clampDomain(a, b);
    this.animTo(ca, cb, () => {
      SelCard.reanchor();
      setTimeout(() => { this._holdYear = false; }, 0);
    });
  },

  /**
   * WHICH ELEMENT IS THE SEARCH FIELD.
   *
   * One selector list, read at the moment it is needed rather than captured at
   * boot, because the field is React's markup and this file is not: caching a
   * node here is how a listener ends up bound to an element that has since been
   * replaced. '#cmdk' is the single top-bar field ("Keep only one search - one
   * at the top."); '#searchBox' is the timeline panel's old box, kept in the
   * list so this file stays correct for whichever input owns the search rather
   * than for one particular id — losing THAT bet is what silently took the
   * canvas dim away when the panel box was deleted and nothing rebound.
   */
  searchInput(): HTMLInputElement | null {
    return $<HTMLInputElement>('#cmdk') || $<HTMLInputElement>('#searchBox');
  },
  /** The query changed. The only writer of this.q — every input path lands here. */
  setQuery(v: string) {
    const q = v.trim();
    if (q === this.q) return;
    this.q = q;
    this.paint();                       // paint() also drives the vertical projection
  },
  /**
   * Empty the search. Pressing "In perspective" means "now show me its world",
   * and a live query dims everything that is not a hit to 12% — which is the
   * exact opposite. You searched to FIND the thing; you found it; the box
   * visibly empties and the world comes back.
   */
  clearSearch() {
    if (!this.q) return;
    this.q = '';
    const box = this.searchInput(); if (box) box.value = '';
    const cnt = $('#searchCnt'); if (cnt) cnt.textContent = '';
    this.paint();
  },
  /** A hit box in canvas CSS pixels, as a viewport rect the card can dodge. */
  rectOf(b: { x: number; y: number; w: number; h: number }): DOMRect {
    const r = this.cv.getBoundingClientRect();
    return new DOMRect(r.left + b.x, r.top + b.y, b.w, b.h);
  },
  /** Where a selected id is on screen right now, or null if it is not drawn. */
  anchorOf(id: string): DOMRect | null {
    if (!this.cv || !this.cv.clientWidth) return null;
    const b = this.boxes.find(bx => bx.id === id);
    return b ? this.rectOf(b) : null;
  },

  _storesBound: false,
  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#zoomCanvas')!;
    armSafariGestureGuard();          // idempotent; whichever view boots first arms it
    // WHICH LAYERS ARE ON IS NOT DECIDED HERE ANY MORE. It used to be the
    // registry's `default` flag, re-read on every boot. It is the reader's own
    // arrangement now, restored from localStorage by LayerPanel.init(), and the
    // spine (region essentials + deep time) is what a fresh profile gets.
    // THE PRESET BUTTONS AND THE PANEL SEARCH BOX ARE GONE — "Remove the random
    // controls!" and "Keep only one search - one at the top." Mozart's world, 1776 in
    // context, Deep time and Reset were four canned framings occupying the top of the
    // panel; the wheel reaches every one of them and the rail transport reaches the
    // rest. animTo/frameTo stay — they are the core loop's move, and the card's "In
    // perspective" and Lab's search dropdown both call them.
    //
    // The QUERY state stays too: this.q, clearSearch() and the #searchCnt readout are
    // all still here for whichever input owns the search. Only the duplicate box in
    // this panel went. Everything below is bound defensively so this file cannot care
    // whether a given piece of chrome is still in the markup.
    //
    // THE DIM IS BOUND TO WHATEVER FIELD EXISTS, not to one id. This listener used
    // to name '#searchBox' — the panel's own box — and when that box was deleted in
    // favour of the single top-bar field the binding simply found nothing, so this.q
    // was never written again and the canvas stopped dimming. Nothing threw and
    // nothing logged; the behaviour just left. searchInput() resolves the field by a
    // list, and this listener rides ALONGSIDE Lab's own dropdown listener on the same
    // element (two listeners, one input, no coordination needed).
    const box = this.searchInput();
    if (box) box.addEventListener('input', (e: any) => this.setQuery(e.target.value));
    buildGrammarLegend();
    repaintOnFonts(() => this.render());
    if (!this._storesBound) {
      this._storesBound = true;
      TimeStore.subscribe(() => this.paint());
      SelStore.subscribe(() => {
        this.paint();
        renderRelatedPanel($('#tlRelPanel'), SelStore.id);
      });
      renderRelatedPanel($('#tlRelPanel'), SelStore.id);
    }
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      // SHIFT IS THE SECOND AXIS. Chrome and Safari move a shifted wheel's
      // magnitude onto deltaX (the horizontal-scroll convention), Firefox leaves
      // it on deltaY, and a trackpad sends both — so take whichever is carrying
      // it. Without shift nothing here has changed: the wheel is the time zoom.
      if (e.shiftKey) { this.scrollBy(e.deltaY || e.deltaX); return; }
      const r = cv.getBoundingClientRect(); const G = this.gutter(), Wp = cv.clientWidth - G - 10;
      const yc = this.ix(e.clientX - r.left, G, Wp);
      this.zoomBy(yc, Math.pow(1.0018, e.deltaY));
      this.paint();
    }, { passive: false });
    // The reader may also reach the scroller by every ordinary route the browser
    // already gives them — the rail, a two-finger scroll over the PANEL, a
    // keyboard once it has focus. All of them land here.
    const sc = this.scroller();
    if (sc) sc.addEventListener('scroll', () => this.onScroll(), { passive: true });
    /* ══ TOUCH ═══════════════════════════════════════════════════════════════
       ONE FINGER pans time and, because the plot is taller than the window and
       a finger has no Shift key, scrolls the sheet on the same drag. TWO
       FINGERS zoom about their midpoint and carry the window with it.

       THE PINCH IS NOT A SECOND ZOOM ROUTE. It computes a factor and hands it
       to zoomBy() — the identical call the wheel makes one screenful above,
       with the identical argument shape. The wheel's factor is
       pow(1.0018, deltaY); the pinch's is prev.d / now.d, which is the same
       quantity written in the other currency (a pinch that halves the finger
       separation IS ln(2)/ln(1.0018) ≈ 385 notches of wheel). So the v-span is
       the only thing either gesture touches, the LADDER still decides the rung
       from that span, and the hysteresis and the slew limiter downstream cannot
       tell a pinch from a wheel — which is the point. Layout stays bit-frozen
       between rungs for exactly the same reason it does under the wheel:
       layout()'s re-latch test is `moved && sameSpan`, and a pinch changes the
       span on every frame it fires. */
    let drag: any = null;
    const startDrag = (p: { clientX: number; clientY: number }) => {
      const sc0 = this.scroller();
      drag = {
        x: p.clientX, y: p.clientY, v0: tv(this.d0), v1: tv(this.d1),
        top: sc0 ? sc0.scrollTop : 0, moved: false,
      };
    };
    refuseSafariGestures(cv);
    const P = bindPinch(cv, {
      onStart: () => { drag = null; hideTip(); },
      onPinch: (now, prev) => {
        const r = cv.getBoundingClientRect(); const G = this.gutter(), Wp = cv.clientWidth - G - 10;
        // (1) ZOOM ABOUT THE MIDPOINT. The anchor is where the midpoint WAS, so
        // the year the two fingers were holding is the year that stays put —
        // the same invariant zoomBy's own docblock states for the cursor.
        this.zoomBy(this.ix(prev.cx - r.left, G, Wp), prev.d / now.d);
        // (2) THEN CARRY IT. The midpoint itself may have travelled; without
        // this the fingers scale the sheet but do not hold it, which reads as
        // slipping. Panning uses the POST-zoom span, so the two compose exactly.
        const dv = (now.cx - prev.cx) / Wp * (tv(this.d1) - tv(this.d0));
        const [nv0, nv1] = clampV(tv(this.d0) - dv, tv(this.d1) - dv);
        this.d0 = ty(nv0); this.d1 = ty(nv1);
        this.paint();
      },
      onRebase: p => startDrag(p),      // second finger left; the survivor keeps panning
    });
    cv.addEventListener('pointerdown', e => {
      if (P.multi) { drag = null; hideTip(); return; }   // a second finger is a pinch, never a pan
      startDrag(e);
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
    });
    cv.addEventListener('pointermove', e => {
      if (P.multi) { drag = null; return; }              // the pinch owns the gesture
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.hoverX = mx;
      if (drag) {
        // pan in v-space, or deep-time panning is wildly nonuniform
        const G = this.gutter(), Wp = cv.clientWidth - G - 10;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        const dv = dx / Wp * (drag.v1 - drag.v0);
        const slop = slopFor(e);
        if (Math.abs(dx) > slop || (e.pointerType !== 'mouse' && Math.abs(dy) > slop)) drag.moved = true;
        const [nv0, nv1] = clampV(drag.v0 - dv, drag.v1 - dv);
        this.d0 = ty(nv0); this.d1 = ty(nv1);
        // THE SECOND AXIS, FOR A HAND. On desktop the sheet moves on Shift+wheel
        // and on the rail; a finger has neither, and the canvas takes
        // touch-action:none so the browser will not scroll it either. So a touch
        // drag carries both axes at once — X through time, Y down the sheet —
        // which is also exactly what the vertical projection has always done.
        // Gated on pointerType: the mouse's gesture is untouched.
        if (e.pointerType !== 'mouse') {
          const sc2 = this.scroller();
          if (sc2) { const was = sc2.scrollTop; sc2.scrollTop = drag.top - dy; if (sc2.scrollTop !== was) this.onScroll(); }
        }
        this.paint(); return;
      }
      // NO HOVER ON A FINGER. A touch pointermove that reaches here is the tail
      // of a tap, and a tooltip pinned under the fingertip covers the thing it
      // describes and then has nothing to dismiss it. Tap opens the card, which
      // says more and can be closed.
      if (e.pointerType !== 'mouse') return;
      const b = this.hitAt(mx, my);
      this.render();
      if (b && b.kind === 'more') {
        showTip(e.clientX, e.clientY, b.exp
          ? `<div class=t>${b.band}</div><div class=m>Collapse this lane back to its row cap.</div>`
          : `<div class=t>${b.band}</div><div class=m>${b.more} more row${b.more === 1 ? '' : 's'} in this lane. Click to open the lane — the band grows, the zoom does not move.</div>`);
        cv.style.cursor = 'pointer'; return;
      }
      if (b && b.kind === 'spread') {
        const it = b.it; const cat = CATBY[it.cat];
        showTip(e.clientX, e.clientY, `<div class=t>${it.name}</div><div class=m>${fmtBig(it.start)} – ${fmtY(it.end)} · ${b.band}</div>` +
          `<div class=m>${cat ? cat.name : ''} · ${it.type}</div>` +
          (it.note ? `<div class=m>${it.note}</div>` : '') +
          foldLines(it.id) +
          `<div class=m>importance ${'●'.repeat(6 - it.lvl)}${'○'.repeat(it.lvl - 1)} (${it.lvl}) · click to select</div>`);
        cv.style.cursor = 'pointer';
      } else if (b) {
        const [y0, y1, t, , lvl] = b.ev; const cat = CATBY[b.ev[6]], typ = b.ev[7], pl = b.ev[8];
        showTip(e.clientX, e.clientY, `<div class=t>${t}</div><div class=m>${fmtBig(y0)}${y1 ? ' – ' + fmtY(y1) : ''} · ${b.band}</div>` +
          `<div class=m>${cat ? cat.name : ''} · ${typ}${pl ? ' · ' + pl[2] : ''}</div>` +
          `<div class=m>importance ${'●'.repeat(6 - lvl)}${'○'.repeat(lvl - 1)} (${lvl}) · click to select · Wikipedia in the Related panel</div>`);
        cv.style.cursor = 'pointer';
      } else { hideTip(); cv.style.cursor = 'crosshair'; }
    });
    cv.addEventListener('pointerup', e => {
      // tapBlocked: this gesture was a pinch, so the lift that ended it is not a
      // click on whatever happens to be under the last finger.
      const wasDrag = drag && drag.moved; drag = null; if (wasDrag || P.tapBlocked) return;
      const pad = e.pointerType === 'mouse' ? 0 : TAP_PAD;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const G = this.gutter(), Wp = cv.clientWidth - G - 10;
      const H = cv.clientHeight;
      // EITHER axis strip sets the global moment — the grey scale reads along the
      // top now, and the strip you can read the year off is the strip you expect to
      // be able to point at. The bottom 30px keeps the same job it always had.
      if (my > H - 30 || my < AXIS_TOP) {
        TimeStore.set(Math.round(this.ix(mx, G, Wp)), 'tl');
        return;
      }
      const b = this.hitAt(mx, my, pad);
      if (b && b.kind === 'more') {                    // open (or close) the lane — never zoom
        if (b.lane) {
          if (this.expanded.has(b.lane)) this.expanded.delete(b.lane); else this.expanded.add(b.lane);
        }
        hideTip();
        this.ease(); this.paint();
        return;
      }
      // Click means select, and the card appears BESIDE the mark — never over
      // it. Empty canvas clears the selection, exactly as before.
      SelCard.select(b ? b.id : null, b ? this.rectOf(b) : null);
    });
    cv.addEventListener('pointerleave', () => { hideTip(); this.hoverX = null; this.render(); });
  },
  /* ── THE LANE CHIPS AND THE DOMAIN CHIPS ARE GONE ───────────────────────────

     Both were replaced by ONE thing rather than moved. "Lanes" turned a whole
     curated band on and off; "Domain" hid a category across every band at once.
     Neither could say "Europe's science but not its wars", which is the ordinary
     request — the first is a whole-band switch, the second a global one. A LAYER
     is a subject x a kind, so it says exactly that, and the panel says it eight
     times over, in an order the reader chose.

     `off` survives as an empty Set. It is still the one filter render() and the
     vertical projection consult, so anything that ever wants to hide a category
     globally again has a place to write, and nothing downstream had to change. */
};

/** The founding/dissolution events a spread has swallowed, as tooltip lines. */
function foldLines(id: string): string {
  let out = '';
  for (const t in FOLD) {
    if (FOLD[t].spread !== id) continue;
    const ev = EVENTS.find(e => !e[1] && e[2] === t);
    if (!ev) continue;
    out += `<div class=m><b>${roleWord(FOLD[t].role)}</b> — ${t}, ${fmtY(ev[0])}</div>`;
  }
  return out;
}

// ONE container, shared by both projections (#grammarRowV, in the disclosure at the
// foot of the Timeline panel). Two visual categories now: spreads (rectangles, sharp
// or soft per their sharpness) and events (dots). Height carries importance; colour
// still carries domain.
export function buildGrammarLegend() {
  const rows = [$('#grammarRow'), $('#grammarRowV')].filter(Boolean) as HTMLElement[];
  if (!rows.length) return;
  const g = (svg: string, label: string) => `<span class="g"><svg width="30" height="14" viewBox="0 0 30 14">${svg}</svg>${label}</span>`;
  const c = 'var(--ink2)';
  rows.forEach((r, i) => {
    const gid = 'tlfade' + i;                          // per-container gradient id — never duplicated
    r.innerHTML = `<span class="note" style="font-weight:600">Mark =</span>` +
      g(`<rect x="3" y="3.5" width="24" height="7" rx="2" fill="${c}" opacity=".75"/><rect x="3" y="3.5" width="24" height="7" rx="2" fill="none" stroke="${c}" stroke-width="1"/>`, 'spread, sharp — dated ends') +
      g(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="${c}" stop-opacity=".05"/><stop offset=".38" stop-color="${c}" stop-opacity=".75"/>` +
        `<stop offset=".62" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="${c}" stop-opacity=".05"/>` +
        `</linearGradient></defs><rect x="2" y="3.5" width="26" height="7" rx="2" fill="url(#${gid})"/>`, 'spread, soft — fades in and out') +
      g(`<circle cx="15" cy="7" r="3.2" fill="${c}"/>`, 'event — a moment') +
      `<span class="note" style="margin-left:6px">taller = more important</span>` +
      `<span class="note" style="font-weight:600;margin-left:6px">Colour = domain</span>`;
  });
}
