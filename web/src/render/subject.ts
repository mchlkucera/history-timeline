/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   subject.ts — WHAT IS THE SELECTED THING?

   SelStore holds a string. Six streams can mint one ('event:' 'entity:'
   'polity:' 'spread:' 'belief:' 'lane:KEY:id'), and every consumer of a
   selection — the card, the map highlight, the cube trace, the actions — needs
   the same five answers about it: what is it called, when was it, what domain,
   what kind of thing, and when did it MATTER MOST. relations.ts's relDir
   already answers the first three for the Related panel; this answers all of
   them, plus the two the actions need: the peak year and the territory.

   THE TERRITORY IS TIME-GATED, and that is the whole point. public/data/
   polities.json carries, per polity, a map from SNAPSHOT YEAR to the sovereign
   strings the border data uses in that snapshot — so "Egypt" means Ancient
   Egypt in 3000 BCE and nothing at all in 1994. The cube already joins through
   it (cube3d/engine.ts presenceOfIds); this is the same join, for the map,
   without dragging three.js into the first-paint bundle.
   ============================================================================= */

import { BELIEFS, EVENTS, POLITIES, evId, CATBY, LANES, sharpnessOf, clamp } from './shared';
import { REL, SPREADCAT, lvlOfWeight, peakOf, relDir, relIndex } from './relations';

// ---------- the polity alias table ----------
// { id -> { match: { "<snapshotYear>": ["Sovereign", …] }, name, start, end } }
export interface PolityAlias { id: string; name: string; start: number; end: number; match: Record<string, string[]> }
const ALIAS = new Map<string, PolityAlias>();
export function setPolityAliases(json: any) {
  ALIAS.clear();
  for (const p of ((json && json.polities) || [])) {
    ALIAS.set(p.id, { id: p.id, name: p.name, start: p.start, end: p.end, match: p.match || {} });
  }
}
export const aliasCount = () => ALIAS.size;

/**
 * The sovereign strings this polity's territory is drawn under in ONE snapshot.
 * Empty means: it is honestly not on that map. Never widened to "any snapshot" —
 * that is exactly the time gate the table exists to keep.
 */
export function territoryAt(polityId: string | null, snapshotYear: number): Set<string> {
  const out = new Set<string>();
  if (!polityId) return out;
  const a = ALIAS.get(polityId);
  if (!a) return out;
  for (const s of (a.match[String(snapshotYear)] || [])) out.add(s);
  return out;
}

// ---------- the subject ----------
export interface Subject {
  id: string;
  name: string;
  start: number;
  end: number;                 // === start for a moment
  cat: string;                 // a CATS id
  type: string;                // polity | spread | era | life | movement | moment | episode | zone | belief
  note: string;
  lvl: number;                 // 1..5, the importance ladder
  peakYear: number;            // weight-curve peak, else the midpoint
  hasCurve: boolean;           // was the peak read off a curve, or guessed?
  polity: string | null;       // the id to join the map / cube through
  band: string | null;         // lane KEY it lives in, when it lives in one
}

/** argmax of a [[year, weight], …] curve; null when there is no curve. */
function curvePeak(w: any): number | null {
  if (!Array.isArray(w) || !w.length) return null;
  if (typeof w[0] === 'number') return null;          // polities.json's scalar weight
  let y = w[0][0], best = -Infinity;
  for (const p of w) if (p && p[1] > best) { best = p[1]; y = p[0]; }
  return y;
}

const evById = new Map<string, any[]>();
let evSig = -1;
function eventFor(id: string): any[] | null {
  if (evSig !== EVENTS.length) {                      // EVENTS only ever grows (initData, setLanes)
    evSig = EVENTS.length; evById.clear();
    for (const e of EVENTS) { const k = evId(e); if (!evById.has(k)) evById.set(k, e); }
  }
  return evById.get(id) || null;
}

const laneLabel = (k: string) =>
  ({ CO: 'Deep time', EU: 'Europe', ME: 'MidEast & Africa', AS: 'Asia', AM: 'Americas' } as Record<string, string>)[k]
  || LANES.find(l => l.key === k)?.label || k;

export function describe(id: string | null): Subject | null {
  if (!id) return null;

  if (id.startsWith('polity:')) {
    const pid = id.slice(7);
    const p = POLITIES.find((x: any) => x.id === pid);
    if (p) {
      const pk = curvePeak(p.weight);
      return {
        id, name: p.name, start: p.start, end: p.end, cat: 'power', type: 'polity',
        note: p.note || '', lvl: lvlOfWeight(peakOf(p.weight)),
        peakYear: pk ?? Math.round((p.start + p.end) / 2), hasCurve: pk !== null,
        polity: pid, band: p.region === 'AF' ? 'ME' : p.region,
      };
    }
    const a = ALIAS.get(pid);
    if (a) return { id, name: a.name, start: a.start, end: a.end, cat: 'power', type: 'polity', note: '', lvl: 3, peakYear: Math.round((a.start + a.end) / 2), hasCurve: false, polity: pid, band: null };
  }

  if (id.startsWith('spread:')) {
    const s = REL.spreads.find(x => x.id === id.slice(7));
    if (s) {
      const pk = curvePeak(s.weight);
      return {
        id, name: s.name, start: s.start, end: s.end,
        cat: SPREADCAT[s.kind] || 'society', type: 'spread', note: s.note || '',
        lvl: lvlOfWeight(peakOf(s.weight)),
        peakYear: pk ?? Math.round((s.start + s.end) / 2), hasCurve: pk !== null,
        polity: null, band: null,
      };
    }
  }

  if (id.startsWith('belief:')) {
    for (const sys of (BELIEFS.systems || [])) for (const st of (sys.streams || [])) {
      if ('belief:' + st.id !== id) continue;
      return {
        id, name: st.name, start: st.start, end: st.end, cat: 'belief', type: 'belief',
        note: st.note || '', lvl: 3, peakYear: curvePeak(st.weight) ?? Math.round((st.start + st.end) / 2),
        hasCurve: curvePeak(st.weight) !== null, polity: null, band: null,
      };
    }
  }

  const ev = eventFor(id);
  if (ev) {
    const isMoment = !ev[1];
    const start = ev[0], end = isMoment ? ev[0] : ev[1];
    // a curated lane member carries its note on the registry, not on the tuple
    let note = '';
    if (id.startsWith('lane:')) {
      const [, k, mid] = id.split(':');
      note = LANES.find(l => l.key === k)?.members?.find(m => m.id === mid)?.note || '';
    }
    return {
      id, name: ev[2], start, end, cat: ev[6] || 'power', type: ev[7] || (isMoment ? 'moment' : 'episode'),
      note, lvl: ev[4] || 3, peakYear: Math.round((start + end) / 2), hasCurve: false,
      polity: null, band: ev[3] || null,
    };
  }

  // last resort: the directory relations.ts built, so a link target is never nameless
  const d = relDir.get(id);
  if (d) {
    return {
      id, name: d.name, start: d.start, end: d.end, cat: 'power', type: d.kind, note: d.note || '',
      lvl: 3, peakYear: Math.round((d.start + d.end) / 2), hasCurve: false, polity: null, band: null,
    };
  }
  return null;
}

/** The band a subject sits in, spelled the way the canvas spells it. */
export const bandLabel = (s: Subject) => (s.band ? laneLabel(s.band) : null);
/** The domain a subject sits in, spelled the way the legend spells it. */
export const catLabel = (s: Subject) => (CATBY[s.cat] ? CATBY[s.cat].name : s.cat);
/** Type name for the chip line; lane members say "movement", not "spread". */
export const typeLabel = (s: Subject) => (s.type === 'zone' ? 'territory' : s.type);

/**
 * THE CORE-LOOP FRAME. The founder's "I want to see Cubism in perspective":
 * the item's own extent, then enough era around it that the neighbouring lanes
 * answer "what else was going on". A moment has no extent, so it gets the ~80
 * years a person means by "its era".
 */
export function perspectiveSpan(s: Subject): [number, number] {
  const ext = Math.max(0, s.end - s.start);
  const span = Math.max(80, ext * 3);
  const mid = (s.start + s.end) / 2;
  return [Math.round(mid - span / 2), Math.round(mid + span / 2)];
}

/** Does this thing exist at all at the global moment? */
export const aliveAt = (s: Subject, year: number) => year >= s.start && year <= s.end;

/** Its strongest relations, ranked, resolvable, deduped — the card shows 3–4. */
export function topRelations(id: string, n: number) {
  const seen = new Map<string, { id: string; name: string; kind: string; w: number }>();
  for (const r of (relIndex.get(id) || [])) {
    const t = relDir.get(r.other); if (!t) continue;
    const p = seen.get(r.other);
    if (!p || r.w > p.w) seen.set(r.other, { id: r.other, name: t.name, kind: r.kind, w: r.w });
  }
  return [...seen.values()].sort((a, b) => b.w - a.w || (a.name < b.name ? -1 : 1)).slice(0, n);
}
/** How many links it has in total, resolvable or not — the "All connections" count. */
export const relCount = (id: string) => new Set((relIndex.get(id) || []).map(r => r.other)).size;

// sharpnessOf and clamp are re-exported so the card can describe an edge without
// importing shared.ts twice; both are pure.
export { sharpnessOf, clamp };
