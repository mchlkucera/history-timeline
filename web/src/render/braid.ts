/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑥a BRAIDED RIVERS =================
// Ported verbatim from prototypes/partB.html — the same Ribbons engine as ③.
import { $, BELIEFS } from './shared';
import { Ribbons } from './flow';

// selKind 'belief': a braid stream is a belief, not a polity, and the card already
// describes 'belief:<id>'. Everything else — the fixed absolute reference, the click
// that writes the global selection, the highlight that answers one made elsewhere —
// is the shared Ribbons engine, so the two views cannot drift apart.
export const Braid = Ribbons({
  canvas: '#braidCanvas', d0: -1000, d1: 2026, height: 440, mode: 'norm', colorBy: 'root', selKind: 'belief',
});

export function initBraid() {
  Braid.init();
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
