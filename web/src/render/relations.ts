/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= RELATIONS =================
// The single implementation of the weighted-link corpus that BOTH the Connections view
// and the timeline family consume: the relations data contract and loader, the link
// index, the graded-dimming math, the LOD exemption for a selection's own relations,
// and the Related side panel. Moved out of connections.ts so that clicking a spread in
// the timeline lights the same graph with the same math.

import {
  BELIEFS, EVENTS, POLITIES, SelStore, type Tokens, clamp, evId, fmtY, tokens,
} from './shared';

// ---------- the data contract (data/relations/SCHEMA.md) ----------
export interface Spread {
  id: string; name: string; kind: string; start: number; end: number; sharpness?: number;
  weight: [number, number][];
  footprint?: { year: number; lat: number; lon: number; radius: number; intensity: number }[];
  from?: string[]; to?: string[]; note?: string;
}
export interface Link { a: string; b: string; w: number; kind: string }
export interface Relations { spreads: Spread[]; links: Link[] }

export const REL: Relations = { spreads: [], links: [] };
export function setRelations(r: any) {
  REL.spreads = (r && r.spreads) || [];
  REL.links = (r && r.links) || [];
}
// The build step ships data/relations/{spreads,links}.json (falling back to the seeds)
// as one public/data/relations.json. A miss must not stop the other tabs booting.
export async function loadRelations(): Promise<Relations> {
  try {
    const res = await fetch('/data/relations.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    setRelations(await res.json());
  } catch {
    setRelations({ spreads: [], links: [] });
  }
  return REL;
}

// 'same-as' leads: it is not a relation between two things, it is the SAME thing
// seen through two lanes — "Renaissance" in Arts and "The Renaissance" in Europe.
// Both stay on screen because the lens is the information; selecting either has
// to light the other at full strength, which a 0.6 "about" link would not do.
export const KIND_ORDER = ['same-as', 'origin', 'part-of', 'enabled-by', 'caused', 'about', 'opposed-to', 'lineage'];
// Relation kinds take DATA hues. 'part-of' used to be T.accent, i.e. minium, which by
// doctrine means only "where you are" — it takes belief aubergine instead.
export const kindColor = (k: string, T: Tokens): string => ({
  'same-as': T.ink2, 'origin': T.accent2, 'part-of': T.s[6], 'enabled-by': T.s[2], 'caused': T.s[1],
  'about': T.s[0], 'opposed-to': T.s[7], 'lineage': T.ink3,
} as Record<string, string>)[k] || T.ink2;

// spread kinds map onto the existing CATS grammar — colour still says "what domain"
export const SPREADCAT: Record<string, string> = {
  technology: 'sci', movement: 'belief', religion: 'belief', era: 'power', economy: 'society',
};

// Ribbons and spreads carry no hand-assigned importance, but they all carry a weight
// curve on the same 0–10 scale, and its peak is exactly the "how big did this ever
// get" question importance asks.
export const peakOf = (w: any[]) => (w || []).reduce((m, p) => Math.max(m, p[1]), 0);
export const lvlOfWeight = (pk: number) => (pk >= 9 ? 1 : pk >= 7 ? 2 : pk >= 5 ? 3 : pk >= 3 ? 4 : 5);

export function regionOf(lat: number, lon: number): string | null {
  if (lon >= -25 && lon <= 45 && lat >= 34 && lat <= 72) return 'EU';
  if (lon < -25) return 'AM';
  if (lon <= 62 && lat < 34) return 'ME';           // ME band is "MidEast & Africa"
  return 'AS';
}

export const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- the link index + the node directory ----------
// relIndex: node id -> its raw weighted links, both directions, WITHOUT corpus
// resolution — pure strings, so the timeline can look up ids it knows and ignore the
// rest. relDir: what to CALL an id in the panel (name, kind, years, note), assembled
// from every stream the app ships.
export interface RelRow { other: string; w: number; kind: string }
export interface DirEntry { name: string; kind: string; start: number; end: number; note: string }
export const relIndex = new Map<string, RelRow[]>();
export const relDir = new Map<string, DirEntry>();

/** Build the shared link index + directory. Called once from Lab's boot(), after
 *  initData() and setLanes() so the EVENTS stream is complete. */
export function buildRelIndex() {
  relIndex.clear(); relDir.clear();
  const seen = new Set<string>();
  const push = (id: string, row: RelRow) => {
    let a = relIndex.get(id); if (!a) relIndex.set(id, a = []);
    a.push(row);
  };
  for (const L of REL.links) {
    if (!L || !L.a || !L.b || L.a === L.b) continue;
    const k = L.a < L.b ? L.a + '|' + L.b : L.b + '|' + L.a;
    if (seen.has(k)) continue; seen.add(k);
    const w = clamp(Number(L.w) || 0, 0, 1), kind = L.kind || 'about';
    push(L.a, { other: L.b, w, kind });
    push(L.b, { other: L.a, w, kind });
  }
  for (const s of REL.spreads) relDir.set('spread:' + s.id, { name: s.name, kind: 'spread', start: s.start, end: s.end, note: s.note || '' });
  for (const p of POLITIES) relDir.set('polity:' + p.id, { name: p.name, kind: 'polity', start: p.start, end: p.end, note: p.note || '' });
  for (const sys of (BELIEFS.systems || [])) for (const st of (sys.streams || []))
    relDir.set('belief:' + st.id, { name: st.name, kind: 'belief', start: st.start, end: st.end, note: st.note || '' });
  for (const e of EVENTS) {                          // 'event:'/'entity:' by exact title, first-wins
    const id = evId(e);
    if (relDir.has(id)) continue;
    relDir.set(id, { name: e[2], kind: e[7] === 'life' ? 'entity' : (e[7] || 'event'), start: e[0], end: e[1] || e[0], note: e[5] || '' });
  }
}

/** All relations of one id, deduped keeping the max weight per counterpart. */
export function relOf(id: string): Map<string, { w: number; kind: string }> {
  const m = new Map<string, { w: number; kind: string }>();
  for (const r of (relIndex.get(id) || [])) {
    const p = m.get(r.other);
    if (!p || r.w > p.w) m.set(r.other, { w: r.w, kind: r.kind });
  }
  return m;
}

// ---------- the graded dimming ----------
// Unrelated is dimmed but never gone; a relation's prominence is its weight.
//
// THE FLOOR IS PER VIEW, and that is the whole argument. Connections is a dense
// mat of overlapping ribbons where 0.1 is what makes a selection readable at
// all. The TIMELINE is not: there, the founder's whole reason for selecting
// something is "what else was going on" — "I want to see Cubism in perspective:
// what wars, what technology, what was going on in other spheres of my
// interests" — and 0.1 answers that question by blanking the answer. Worse, a
// thing with NO curated links (most of the Arts lane) dimmed the entire world
// to 10% to light up nothing at all.
//
// The curve is rescaled off the floor rather than clamped to it, so the grading
// stays monotone: at floor 0.42 a w=0.3 link is 0.55, still brighter than the
// 0.42 context it sits in. At the default 0.1 this is the original curve to
// within a few thousandths.
export function dimAlpha(
  id: string, sel: string | null,
  rels: Map<string, { w: number; kind: string }> | null,
  floor = 0.1,
): number {
  if (!sel) return 1;
  if (id === sel) return 1;
  const r = rels && rels.get(id);
  if (!r) return floor;                             // context, not erased
  return floor + (1 - floor) * Math.pow(r.w, 1.15);
}
/** The selection and its relations bypass level of detail — clicking a thing must
 *  never be able to hide one of its own relations. */
export function lit(id: string, sel: string | null, rels: Map<string, { w: number; kind: string }> | null): boolean {
  return !!(sel && (id === sel || (rels && rels.has(id))));
}

// ---------- the Related panel ----------
// Conn.panel() generalized: header + note + Wikipedia link (this is where the old
// click-through moved — click now means select), then the relations ranked by weight
// and grouped by kind, with the existing relrow markup globals.css already styles.
export interface RelPanelOpts { emptyHTML?: string; extraSub?: (id: string) => string }
export function renderRelatedPanel(el: HTMLElement | null, sel: string | null, opts?: RelPanelOpts) {
  if (!el) return;
  if (!(el as any)._relBound) {                     // ONE delegated listener, bound once
    (el as any)._relBound = true;
    el.addEventListener('click', (e: any) => {
      const row = e.target && e.target.closest && e.target.closest('.relrow');
      if (row && row.dataset.id) SelStore.set(row.dataset.id);
    });
  }
  const T = tokens();
  if (!sel) {
    el.innerHTML = opts?.emptyHTML ||
      `<div class="empty"><b>Click anything</b> — a spread or an event — and everything related stays lit ` +
      `in proportion to how strongly it is related; the rest dims but stays as context. Click empty canvas to clear.</div>`;
    return;
  }
  const d = relDir.get(sel);
  const name = d ? d.name : sel.slice(sel.lastIndexOf(':') + 1);
  const rows = (relIndex.get(sel) || []).slice().sort((a, b) => b.w - a.w);
  const groups = new Map<string, RelRow[]>();
  for (const r of rows) { if (!groups.has(r.kind)) groups.set(r.kind, []); groups.get(r.kind)!.push(r); }
  const wikiTerm = String(name).split(/ — | \(|·/)[0];
  let html = `<h4>${esc(name)}</h4>` +
    `<div class="sub">${d ? esc(d.kind) : '—'}${d ? ` · ${fmtY(d.start)}${d.end > d.start ? ' – ' + fmtY(d.end) : ''}` : ''} · ${rows.length} link${rows.length === 1 ? '' : 's'}</div>` +
    (d && d.note ? `<div class="sub">${esc(d.note)}</div>` : '') +
    `<div class="sub"><a class="sub" target="_blank" rel="noreferrer" href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(wikiTerm)}">Wikipedia ↗</a></div>` +
    (opts?.extraSub ? opts.extraSub(sel) : '');
  if (!rows.length) html += `<div class="empty" style="margin-top:12px">No curated relations yet for this item.</div>`;
  const order = [...KIND_ORDER, ...[...groups.keys()].filter(k => !KIND_ORDER.includes(k))];
  for (const k of order) {
    const g = groups.get(k); if (!g) continue;
    html += `<div class="grp"><span class="dot" style="background:${kindColor(k, T)}"></span>${esc(k)}</div>`;
    for (const r of g) {
      const t = relDir.get(r.other); if (!t) continue;
      html += `<div class="relrow" data-id="${esc(r.other)}">` +
        `<div><div class="n">${esc(t.name)}</div><div class="k">${esc(t.kind)} · ${fmtY(t.start)}${t.end > t.start ? '–' + fmtY(t.end) : ''}</div>` +
        `<div class="bar"><i style="width:${Math.round(r.w * 100)}%;background:${kindColor(r.kind, T)}"></i></div></div>` +
        `<div class="w">${r.w.toFixed(2)}</div></div>`;
    }
  }
  el.innerHTML = html;
}
