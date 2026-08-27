/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑥a BRAIDED RIVERS =================
// Ported verbatim from prototypes/partB.html — the same Ribbons engine as ③.
import { $, BELIEFS } from './shared';
import { bindModeSeg, Ribbons } from './flow';

// selKind 'belief': a braid stream is a belief, not a polity, and the card already
// describes 'belief:<id>'. Everything else — the fixed absolute reference, the click
// that writes the global selection, the highlight that answers one made elsewhere —
// is the shared Ribbons engine, so the two views cannot drift apart.
//
// AND IT OPENS ON THE ABSOLUTE SCALE, like Empires. "Make sure Beliefs have also an
// Absolute view option (and its default)." The reference is NOT the empires' 130.66:
// refMaxTotal() is computed from whatever items it is handed, and this instance is
// handed belief streams, so the ruler is the belief corpus's own peak — 49.70 for the
// religions (2026) and 31.57 for the ideologies (1975). Measured fills below.
export const Braid = Ribbons({
  canvas: '#braidCanvas', d0: -1000, d1: 2026, height: 440, mode: 'abs', colorBy: 'root', selKind: 'belief',
});

/* THE MODE TOGGLE IS NO LONGER MINTED HERE.

   This file used to build its own scale button at runtime: it went looking for
   `aside[data-panelfor~="braid"] .tl-panel__bd`, found the first .tl-cluster in
   it, and appended a second .btn into whatever row that happened to be. It did
   that because Lab.tsx had given Braid a Reset cluster and no scale switch — one
   of the two views on the same engine had the control and the other did not.

   That is exactly the fragmentation this round set out to end. Lab.tsx declares
   the switch now, in the HOW IT IS DRAWN group where Empires keeps its identical
   one, and this file binds it — the honest division: the shell owns the shape of
   the panel, the renderer owns the state behind it. bindModeSeg is flow.ts's, so
   there is literally one implementation of "relative or absolute" in the app.  */

/* ── WHERE EACH BELIEF SYSTEM OPENS ────────────────────────────────────────────
   A property OF THE SYSTEM, not a branch inside a click handler: the framing is a fact
   about that corpus, and it has to survive being lifted out if these two ever become two
   views of their own.

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
   Reset view returns here. */
const OPENS_AT: Record<string, number> = { religion: -1000, ideology: 1848 };
const OPENS_UNTIL = 2026;

export function initBraid() {
  Braid.init();
  bindModeSeg('#braidMode', () => Braid.mode, m => { Braid.mode = m as any; Braid.render(); });
  const pick = (id: string) => {
    const sys = (BELIEFS.systems || []).find((s: any) => s.id === id);
    Braid.items = sys ? sys.streams : [];
    Braid.d0 = OPENS_AT[id] ?? -1000; Braid.d1 = OPENS_UNTIL;
    $('#braidNote')!.textContent = sys ? `${sys.label} · ${sys.streams.length} streams` : 'no data';
    // A .tl-seg carries its selection in aria-pressed, like every other
    // exclusive choice in the app. It used to be a .hero class on a .btn, which
    // put an accent on a panel control — and an accent means "where you are in
    // TIME" here, nothing else.
    document.querySelectorAll<HTMLElement>('[data-braid]')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.braid === id)));
    Braid.render();
  };
  document.querySelectorAll<HTMLElement>('[data-braid]').forEach(b => b.addEventListener('click', () => pick(b.dataset.braid!)));
  pick('religion');
}
