/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑥a BRAIDED RIVERS =================
// Ported from prototypes/partB.html — the same Ribbons engine as ③.
import { $, BELIEFS } from './shared';
import { bindModeSeg, Ribbons } from './flow';

/* ── TWO VIEWS, NOT ONE VIEW WITH A SWITCH ────────────────────────────────────
   "I think it should be Empires/Beliefs/Ideologies."

   This file used to export ONE `Braid` — a single Ribbons instance on a single
   canvas — and a preset chip inside its own Controls panel swapped six things
   underneath the reader at once: the item set, the framing, the note, and the
   pressed state of the chip that did it. Religions and ideologies were two
   corpora wearing one instrument, and everything that made them different had
   to be re-applied on every press.

   They are peers in the Flow group's seg now, beside Empires, so each gets what
   a view gets: its own canvas, its own window, its own hover and selection and
   pan, its own scale switch, its own note. Nothing is "currently set to" any
   more — a caller says `Braids.ideology.render()` and means it.

   THE DIFFERENCE BETWEEN THEM IS THIS TABLE AND NOTHING ELSE. Same engine, same
   mode, same height, same colouring, same selKind. A third belief corpus would
   be a row here plus a section in Lab.tsx, and no branch anywhere.

   selKind STAYS 'belief' ON BOTH. The two systems share zero stream ids (32
   religions, 8 ideologies, no collision), so 'belief:<id>' is still unambiguous
   across the split — and a selection made before the split, or written by the
   card, or restored from a URL, still names exactly one stream. A second
   namespace would buy nothing and break every one of those. */

/* ── WHERE EACH BELIEF SYSTEM OPENS ────────────────────────────────────────────
   A property OF THE SYSTEM, not a branch inside a click handler: the framing is a fact
   about that corpus, and it had to survive being lifted out when these two became two
   views of their own. It has now been.

   "Well just make it look as religions — you see the evolution over time, but if you pan
   around, the heights do not change." That is a description of the absolute scale, which
   both of these already use. The scale was never the problem; the STARTING LINE was.
   Religions opens where its story is already a third of the plate and grows; ideologies
   opened at 1650, where its corpus totals 0.00 — the reader landed on nothing and watched
   a thread widen, which is not the same picture at all.

   1848, AND HERE IS THE ARITHMETIC BEHIND A ROUND YEAR. Religions opens on 38.5% of the
   plate and reaches 94% — a 2.4x growth across the view. Matching that fill exactly puts
   ideologies at 1871 (39.5%), and 1871 is indefensible as a starting line: it opens AFTER
   the Revolution, after 1848, after the Manifesto — after the founding moment of nearly
   every stream on the plate, so seven mature ideologies arrive with no origin. 1848 gives
   34.1% rising to 89%, a 2.6x growth — the same shape of picture, within four points of
   the same opening — and it is the one year in this subject a reader already holds: the
   Springtime of Nations, the Communist Manifesto, the year ideology became mass politics.
   Marxism is 0.4 units old there, so it is still seen to fork rather than to exist.

   The cost, named: Enlightenment rationalism (1680–1789) is off the left edge at 1848, so
   the trunk these streams fork from is not on screen at the opening. That is exactly what
   RELIGIONS does — its own root, prehistoric animism, ends at −3000 and is long gone by
   its −1000 opening, which shows 8 streams whose common origin is off the edge. Ideologies
   at 1848 shows 8 streams whose common origin is off the edge. The view the founder calls
   finished already makes this trade; this is the same trade, not a new one.

   NOTHING IS HIDDEN BY THIS. It is where the view OPENS, not what it holds: the item set
   is untouched, so panning left or zooming out still reaches 1789, 1650 and beyond, and
   Reset view returns here.

   AND IT OPENS ON THE ABSOLUTE SCALE, like Empires. "Make sure Beliefs have also an
   Absolute view option (and its default)." The reference is NOT the empires' 130.66:
   refMaxTotal() is computed from whatever items an instance is handed, and each of these
   is handed one system's streams, so each ruler is its own corpus's peak — 49.70 for the
   religions (2026) and 31.57 for the ideologies (1975). Splitting the instance in two did
   not change either number, because neither was ever computed from the union. */
export interface BeliefView {
  /** the system id in BELIEFS.systems — also the key callers use */
  sys: string;
  canvas: string;
  /** the scale .tl-seg Lab.tsx declares for this view */
  mode: string;
  /** the Reading caption this view writes */
  note: string;
  /** the year this view opens on, and the year Reset view returns to */
  d0: number;
}

const OPENS_UNTIL = 2026;

export const BELIEF_VIEWS: Record<string, BeliefView> = {
  religion: { sys: 'religion', canvas: '#braidCanvas', mode: '#braidMode', note: '#braidNote', d0: -1000 },
  ideology: { sys: 'ideology', canvas: '#ideologyCanvas', mode: '#ideologyMode', note: '#ideologyNote', d0: 1848 },
};

const makeBraid = (v: BeliefView) => Ribbons({
  canvas: v.canvas, d0: v.d0, d1: OPENS_UNTIL, height: 440, mode: 'abs', colorBy: 'root', selKind: 'belief',
});

/* THE MODE TOGGLE IS NOT MINTED HERE.

   This file used to build its own scale button at runtime: it went looking for
   `aside[data-panelfor~="braid"] .tl-panel__bd`, found the first .tl-cluster in
   it, and appended a second .btn into whatever row that happened to be. It did
   that because Lab.tsx had given Braid a Reset cluster and no scale switch — one
   of the two views on the same engine had the control and the other did not.

   That is exactly the fragmentation that round set out to end. Lab.tsx declares
   the switch now, one per view, in the HOW IT IS DRAWN group where Empires keeps
   its identical one, and this file binds it — the honest division: the shell owns
   the shape of the panel, the renderer owns the state behind it. bindModeSeg is
   flow.ts's, so there is literally one implementation of "relative or absolute"
   in the app, and now three instruments wearing it.  */

export const Braids: Record<string, ReturnType<typeof makeBraid>> = {
  religion: makeBraid(BELIEF_VIEWS.religion),
  ideology: makeBraid(BELIEF_VIEWS.ideology),
};

/** Every belief view, for the callers that must touch all of them (sizing, repaint). */
export const BRAID_IDS = Object.keys(BELIEF_VIEWS);

/**
 * WHICH SYSTEM HOLDS THIS STREAM — 'religion', 'ideology', or null when the id is
 * not a stream at all. Read from the CORPUS, never from an instance's `items`: the
 * question is which VIEW draws it, and that has to be answerable before either view
 * has ever been rendered.
 */
export function beliefSystemOf(localId: string): string | null {
  for (const s of (BELIEFS.systems || [])) {
    if ((s.streams || []).some((t: any) => t && t.id === localId)) return s.id;
  }
  return null;
}

/** Put a view back on its own opening framing — what Reset view means here. */
export function braidHome(id: string) {
  const v = BELIEF_VIEWS[id]; const b = Braids[id];
  if (v && b) b.animTo(v.d0, OPENS_UNTIL);
}

export function initBraid() {
  for (const id of BRAID_IDS) {
    const v = BELIEF_VIEWS[id], b = Braids[id];
    b.init();
    bindModeSeg(v.mode, () => b.mode, m => { b.mode = m as any; b.render(); });
    const sys = (BELIEFS.systems || []).find((s: any) => s.id === v.sys);
    b.items = sys ? sys.streams : [];
    $(v.note)!.textContent = sys ? `${sys.label} · ${sys.streams.length} streams` : 'no data';
    b.render();
  }
}
