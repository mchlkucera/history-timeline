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

export function initBraid() {
  Braid.init();
  buildBraidMode();
  const pick = (id: string) => {
    const sys = (BELIEFS.systems || []).find((s: any) => s.id === id);
    Braid.items = sys ? sys.streams : [];
    Braid.d0 = id === 'ideology' ? 1650 : -1000; Braid.d1 = 2026;
    $('#braidNote')!.textContent = sys ? `${sys.label} · ${sys.streams.length} streams` : 'no data';
    document.querySelectorAll<HTMLElement>('[data-braid]').forEach(b => b.classList.toggle('hero', b.dataset.braid === id));
    Braid.render();
  };
  document.querySelectorAll<HTMLElement>('[data-braid]').forEach(b => b.addEventListener('click', () => pick(b.dataset.braid!)));
  pick('religion');
}
