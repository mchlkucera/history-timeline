/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑥a BRAIDED RIVERS =================
// Ported verbatim from prototypes/partB.html — the same Ribbons engine as ③.
import { $, BELIEFS } from './shared';
import { labelModeButton, Ribbons } from './flow';

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

/* THE MODE TOGGLE, MINTED HERE. Lab.tsx owns the Controls panel and gave Braid a
   "Reset view" cluster but no scale switch; this appends a second button into that
   existing cluster — the same posture flow.ts takes with #flowRegionRow, append only,
   never restructure — so Beliefs ends up with the pair Empires already has, in the same
   corner, wearing the same words. The panel is addressed by what Lab declares about it
   (data-panelfor / aria-label) rather than by a class chain, so a re-skin of the panel
   cannot silently drop the control. */
function buildBraidMode() {
  const bd = document.querySelector<HTMLElement>('aside[data-panelfor~="braid"][aria-label="Controls"] .tl-panel__bd');
  if (!bd) return;
  let btn = bd.querySelector<HTMLButtonElement>('#braidMode');
  if (!btn) {
    const cluster = bd.querySelector<HTMLElement>('.tl-cluster');   // the row Reset view stands in
    if (!cluster) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn'; btn.id = 'braidMode';
    cluster.appendChild(btn);
    btn.addEventListener('click', () => {
      Braid.mode = Braid.mode === 'norm' ? 'abs' : 'norm';
      labelModeButton(btn!, Braid.mode);
      Braid.render();
    });
  }
  labelModeButton(btn, Braid.mode);                                 // …and never a hardcoded resting label
}

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
  buildBraidMode();
  const pick = (id: string) => {
    const sys = (BELIEFS.systems || []).find((s: any) => s.id === id);
    Braid.items = sys ? sys.streams : [];
    Braid.d0 = OPENS_AT[id] ?? -1000; Braid.d1 = OPENS_UNTIL;
    $('#braidNote')!.textContent = sys ? `${sys.label} · ${sys.streams.length} streams` : 'no data';
    document.querySelectorAll<HTMLElement>('[data-braid]').forEach(b => b.classList.toggle('hero', b.dataset.braid === id));
    Braid.render();
  };
  document.querySelectorAll<HTMLElement>('[data-braid]').forEach(b => b.addEventListener('click', () => pick(b.dataset.braid!)));
  pick('religion');
}
