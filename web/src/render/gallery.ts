// ================= ⑦ CONCEPT GALLERY =================
// Ported verbatim from prototypes/partB.html. Not a canvas view, so it keeps its own file
// rather than living in one of the eight renderers.
import { $, gotoTab } from './shared';

interface Concept { n: string; by: string; v: string; tab?: string; d: string; s: number[] }

const CONCEPTS: Concept[] = [
 {n:'Zoomable LOD timeline',by:'your core vision',v:'built',tab:'zoom',d:'Time behaves like a map: zoom reveals less-important events. Now carrying the full visual grammar — shape for kind, colour for domain.',s:[8,10,9,7,5]},
 {n:'Chrono-globe (map + time dial)',by:'new',v:'built',tab:'map',d:'Fix a moment, see the whole world. The literal “Google Earth of history” — kills the 1776 problem dead.',s:[10,7,8,9,5]},
 {n:'Flow of empires (Histomap)',by:'your take',v:'built',tab:'flow',d:'Ribbons whose thickness is weight in the world, forking along real lineage: Rome splits into West and East, the Ottomans swallow Byzantium.',s:[6,9,8,8,4]},
 {n:'Space-time cube (3D)',by:'your take',v:'built',tab:'cube',d:'Lat × lon × time as one solid block. The map is a horizontal cut, the core sample a vertical drill. The master mental model, now literally rotatable.',s:[7,6,4,9,7]},
 {n:'Core sample drill',by:'new',v:'built',tab:'core',d:'Fix a place, see every moment — strata of sovereigns under your feet. The dual query of the chrono-globe.',s:[8,8,9,7,8]},
 {n:'Braided rivers of ideas',by:'your Notion note',v:'built',tab:'braid',d:'Beliefs as streams that fork at schisms: 1054, 1517, 632. The same engine as the empire flow — because a schism and a partition are the same shape of event.',s:[5,7,5,8,7]},
 {n:'Information horizon',by:'new',v:'built',tab:'horizon',d:'Not what happened — what a person standing here could possibly have known yet. News at the speed of a horse, then a ship, then a wire.',s:[8,4,3,9,9]},
 {n:'People, not land',by:'new — replaces the breathing cartogram',v:'built',tab:'pop',d:'One circle per continent could never answer “where are the people”, so the cartogram was rebuilt as a density field on the real map: 2° cells, 3000 BCE to now. The Gangetic and North China plains stay the heaviest ground on Earth for four millennia. Regional totals are scholarly estimates; the distribution inside a region is an illustration, and the caption says so every frame.',s:[6,4,5,7,6]},
 {n:'Vector-space slicing',by:'your take',v:'engine',d:'Embed every (place, moment, topic) into latent space; “slicing” = semantic search, similarity, auto-generated lenses. Not a view — the engine under search and topic rows.',s:[4,6,3,6,8]},
 {n:'First-person street view',by:'new',v:'north star',d:'Stand in Philadelphia, July 1776, and look around. The endgame fantasy — parked deliberately, not forgotten.',s:[10,2,1,10,6]}];
const SK: Record<string, string> = {
 'Zoomable LOD timeline':'<line x1="8" y1="43" x2="252" y2="43" stroke="var(--ink3)"/><circle cx="40" cy="43" r="5" fill="var(--s1)"/><rect x="118" y="38" width="34" height="10" rx="5" fill="var(--s8)"/><circle cx="215" cy="43" r="5" fill="var(--s7)"/><circle cx="85" cy="43" r="2.5" fill="var(--s3)" opacity=".55"/><circle cx="172" cy="43" r="2.5" fill="var(--s5)" opacity=".55"/><rect x="150" y="14" width="80" height="58" rx="6" fill="none" stroke="var(--accent)" stroke-dasharray="4 3"/><text x="190" y="10" text-anchor="middle" font-size="9" fill="var(--accent)">zoom = more detail</text>',
 'Chrono-globe (map + time dial)':'<circle cx="70" cy="43" r="30" fill="var(--s3)" opacity=".35"/><path d="M48 35 Q60 22 88 30 Q95 45 78 58 Q55 60 48 35Z" fill="var(--s3)" opacity=".8"/><line x1="120" y1="66" x2="240" y2="66" stroke="var(--ink3)"/><circle cx="196" cy="66" r="6" fill="var(--accent)"/><text x="196" y="52" text-anchor="middle" font-size="10" fill="var(--accent)">1776</text>',
 'Flow of empires (Histomap)':'<path d="M10 30 C60 30 70 26 120 26 L120 54 C70 54 60 50 10 50 Z" fill="var(--s1)" opacity=".85"/><path d="M120 26 C170 26 200 16 250 16 L250 34 C200 34 170 38 120 40 Z" fill="var(--s5)" opacity=".85"/><path d="M120 40 C170 42 200 50 250 50 L250 70 C200 70 170 58 120 54 Z" fill="var(--s7)" opacity=".85"/><text x="60" y="45" font-size="9" fill="#fff">Rome</text><text x="196" y="28" font-size="8" fill="#fff">West</text><text x="196" y="64" font-size="8" fill="#fff">East</text>',
 'Space-time cube (3D)':'<path d="M60 30 L150 30 L185 55 L95 55 Z" fill="none" stroke="var(--ink3)"/><path d="M60 30 L60 72 L95 97 L95 55" fill="none" stroke="var(--ink3)"/><path d="M150 30 L150 72 L185 97 L185 55 M60 72 L150 72 M95 97 L185 97" fill="none" stroke="var(--ink3)"/><path d="M78 40 L120 40 L138 50 L96 50Z" fill="var(--s1)" opacity=".7"/><text x="205" y="45" font-size="9" fill="var(--ink3)">slice = a year</text>',
 'Core sample drill':'<rect x="110" y="10" width="40" height="13" fill="var(--s3)"/><rect x="110" y="23" width="40" height="13" fill="var(--s5)"/><rect x="110" y="36" width="40" height="13" fill="var(--s4)"/><rect x="110" y="49" width="40" height="13" fill="var(--s7)"/><rect x="110" y="62" width="40" height="13" fill="var(--s2)"/><text x="165" y="20" font-size="9" fill="var(--ink3)">now</text><text x="165" y="72" font-size="9" fill="var(--ink3)">deep past</text>',
 'Braided rivers of ideas':'<path d="M15 25 C80 25 90 45 130 45 C180 45 190 25 245 25" fill="none" stroke="var(--s5)" stroke-width="5" opacity=".8"/><path d="M15 45 C70 45 90 25 130 25 C175 25 195 60 245 60" fill="none" stroke="var(--s7)" stroke-width="5" opacity=".8"/><path d="M15 65 C90 65 160 65 245 42" fill="none" stroke="var(--s3)" stroke-width="5" opacity=".8"/>',
 'Information horizon':'<circle cx="70" cy="45" r="5" fill="var(--ink)"/><circle cx="70" cy="45" r="18" fill="none" stroke="var(--s2)" stroke-dasharray="4 4" opacity=".75"/><circle cx="70" cy="45" r="34" fill="none" stroke="var(--s2)" stroke-dasharray="4 4" opacity=".5"/><circle cx="70" cy="45" r="50" fill="none" stroke="var(--s2)" stroke-dasharray="4 4" opacity=".3"/><text x="150" y="40" font-size="9" fill="var(--ink3)">news = weeks away</text><text x="150" y="54" font-size="9" fill="var(--ink3)">what did they know?</text>',
 'People, not land':'<rect x="8" y="14" width="244" height="62" fill="var(--panel2)"/><rect x="36" y="30" width="12" height="8" fill="var(--ink)" opacity=".10"/><rect x="48" y="30" width="12" height="8" fill="var(--ink)" opacity=".16"/><rect x="60" y="26" width="12" height="8" fill="var(--ink)" opacity=".10"/><rect x="36" y="42" width="12" height="8" fill="var(--ink)" opacity=".20"/><rect x="48" y="42" width="12" height="8" fill="var(--ink)" opacity=".28"/><rect x="60" y="38" width="12" height="8" fill="var(--ink)" opacity=".16"/><rect x="24" y="54" width="12" height="8" fill="var(--ink)" opacity=".10"/><rect x="36" y="54" width="12" height="8" fill="var(--ink)" opacity=".16"/><rect x="108" y="26" width="12" height="8" fill="var(--ink)" opacity=".30"/><rect x="120" y="26" width="12" height="8" fill="var(--ink)" opacity=".44"/><rect x="132" y="30" width="12" height="8" fill="var(--ink)" opacity=".24"/><rect x="108" y="38" width="12" height="8" fill="var(--ink)" opacity=".55"/><rect x="120" y="38" width="12" height="8" fill="var(--ink)" opacity=".72"/><rect x="132" y="38" width="12" height="8" fill="var(--ink)" opacity=".40"/><rect x="120" y="50" width="12" height="8" fill="var(--ink)" opacity=".30"/><rect x="132" y="50" width="12" height="8" fill="var(--ink)" opacity=".20"/><rect x="156" y="22" width="12" height="8" fill="var(--ink)" opacity=".24"/><rect x="168" y="26" width="12" height="8" fill="var(--ink)" opacity=".40"/><rect x="180" y="26" width="12" height="8" fill="var(--ink)" opacity=".30"/><rect x="156" y="34" width="12" height="8" fill="var(--ink)" opacity=".44"/><rect x="168" y="34" width="12" height="8" fill="var(--ink)" opacity=".62"/><rect x="180" y="38" width="12" height="8" fill="var(--ink)" opacity=".34"/><rect x="168" y="46" width="12" height="8" fill="var(--ink)" opacity=".24"/><rect x="204" y="42" width="12" height="8" fill="var(--ink)" opacity=".16"/><rect x="216" y="46" width="12" height="8" fill="var(--ink)" opacity=".24"/><rect x="228" y="50" width="12" height="8" fill="var(--ink)" opacity=".12"/><rect x="84" y="58" width="12" height="8" fill="var(--ink)" opacity=".10"/><rect x="96" y="62" width="12" height="8" fill="var(--ink)" opacity=".14"/><rect x="204" y="58" width="12" height="8" fill="var(--ink)" opacity=".10"/><text x="14" y="72" font-size="8" fill="var(--ink3)">2° cells · people per cell</text>',
 'Vector-space slicing':'<circle cx="50" cy="30" r="3" fill="var(--s1)"/><circle cx="62" cy="40" r="3" fill="var(--s1)"/><circle cx="45" cy="48" r="3" fill="var(--s1)"/><circle cx="150" cy="28" r="3" fill="var(--s2)"/><circle cx="163" cy="38" r="3" fill="var(--s2)"/><circle cx="145" cy="45" r="3" fill="var(--s2)"/><circle cx="210" cy="60" r="3" fill="var(--s3)"/><circle cx="222" cy="52" r="3" fill="var(--s3)"/><line x1="100" y1="10" x2="120" y2="80" stroke="var(--accent)" stroke-dasharray="4 3"/>',
 'First-person street view':'<path d="M10 80 L110 40 L150 40 L250 80Z" fill="var(--ink3)" opacity=".3"/><rect x="70" y="28" width="24" height="34" fill="var(--s2)" opacity=".7"/><rect x="160" y="24" width="30" height="38" fill="var(--s1)" opacity=".7"/><path d="M120 62 L130 34 L140 62" fill="var(--accent)" opacity=".8"/><circle cx="215" cy="18" r="8" fill="var(--s4)" opacity=".8"/>'};
/* ── THE CARD IS A BUTTON, AND THE BUTTON IS THE TITLE ──────────────────────
   Eight of these ten cards navigate. They used to do it as a bare
   `<div data-goto>` with a click listener and an inline `cursor:pointer` —
   invisible to the keyboard (no tabindex, so Tab walked straight past the whole
   gallery), unannounced to a screen reader (no role, no name) and impossible to
   activate without a mouse.

   The fix is the standard stretched-target pattern rather than a role/tabindex
   costume: the concept's NAME becomes a real `<button>`, and app.css stretches
   that button's ::after over the whole card. So the element that takes focus,
   fires on Enter AND on Space, and carries the accessible name is a genuine
   button with genuine button semantics — while the click target stays the whole
   card and the focus ring, drawn on the stretched pseudo-element, traces the
   card the reader is actually about to open.

   A <button> may only contain phrasing content, which is why the title alone is
   the control and not the card: wrapping the <h3>/<p>/.scores in a <button>
   would be invalid HTML for the sake of looking tidier in the source.

   The two cards that are not views ("Engine, not a view", "North star") get no
   button at all — there is nothing to activate, and a focus stop that does
   nothing is worse than no focus stop. */
export function buildGallery() {
  const g = $('#gallery')!;
  const VN: Record<string, string> = { built: 'Built — this page', next: 'Build next', engine: 'Engine, not a view', 'north star': 'North star' };
  g.innerHTML = CONCEPTS.map(c => {
    const cls = c.v === 'built' ? 'built' : (c.v === 'next' ? 'next' : '');
    const [p, z, f, w, n] = c.s;
    // The accessible name KEEPS the visible name as its opening words (WCAG
    // 2.5.3, Label in Name) and then says what the button does, which the bare
    // title never did.
    const title = c.tab
      ? `<button type="button" class="concept__go" data-goto="${c.tab}" aria-label="${c.n} — open this view">${c.n}</button>`
      : `<span>${c.n}</span>`;
    return `<div class="card concept">
      <h3>${title}<span class="verdict ${cls}">${VN[c.v]}</span></h3>
      <svg viewBox="0 0 260 90" role="img" aria-label="sketch">${SK[c.n] || ''}</svg>
      <p><i>${c.by}.</i> ${c.d}</p>
      <div class="scores"><span>1776-pain <b>${p}</b></span><span>zoom-fit <b>${z}</b></span><span>feasible <b>${f}</b></span><span>wow <b>${w}</b></span><span>novel <b>${n}</b></span></div>
    </div>`;
  }).join('');
  // One listener, and it is `click` — which a real button fires for a mouse, for
  // Enter and for Space alike. That is the whole reason to use the element
  // instead of imitating it.
  g.querySelectorAll<HTMLElement>('[data-goto]').forEach(el => el.addEventListener('click', () => gotoTab(el.dataset.goto!)));
}
