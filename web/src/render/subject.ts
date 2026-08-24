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

import { BELIEFS, EVENTS, GEO, PLACES, POLITIES, evId, CATBY, LANES, pip, sharpnessOf, clamp } from './shared';
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

/**
 * THE REVERSE JOIN: the border feature the map just drew → the curated polity
 * it belongs to IN THAT SNAPSHOT. Same time-gated table as territoryAt, read
 * the other way, because a click on the map arrives as a sovereign STRING and
 * the card, the cube and the relation index all speak polity ids.
 *
 * Sixteen (year, sovereign) pairs in the table are claimed by more than one
 * polity — 1815 "France" is both the Kingdom and the First Empire, 1279
 * "Mongol Empire" is both the Mongol Empire and the Yuan Dynasty. They are
 * RANKED, never guessed: a sovereign string that IS the polity's name wins
 * outright, then a span that actually contains the snapshot year, then the
 * shorter span — the more specific claim. (1815 France → French Empire; 1279
 * Mongol Empire → Mongol Empire, not Yuan; 1938 Germany → Nazi Germany.)
 */
export function polityForFeature(sov: string, name: string, snapshotYear: number): string | null {
  const key = String(snapshotYear);
  let best: PolityAlias | null = null, bestScore = -1, bestSpan = Infinity;
  for (const a of ALIAS.values()) {
    const list = a.match[key];
    if (!list || !list.length) continue;
    let hit = '';
    for (const s of list) if (s === sov || s === name) { hit = s; break; }
    if (!hit) continue;
    const score = (hit.toLowerCase() === a.name.toLowerCase() ? 4 : 0)
      + (snapshotYear >= a.start && snapshotYear <= a.end ? 2 : 0);
    const span = Math.max(1, a.end - a.start);
    if (score > bestScore || (score === bestScore && span < bestSpan)) {
      best = a; bestScore = score; bestSpan = span;
    }
  }
  return best ? best.id : null;
}

// ---------- the subject ----------
/** A point on the globe, in the order Core.drill() takes it. */
export interface Place { lon: number; lat: number; label: string }

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
  // ── only ever set on an AD-HOC subject minted from a map click ──
  place?: Place | null;        // the exact point that was clicked
  sovs?: string[];             // the sovereign strings the map draws it under
  minimal?: boolean;           // a border feature with no curated record
}

/**
 * A BORDER FEATURE WITH NO CURATED RECORD, so the map click still has a
 * subject to select. Held in a tiny ring rather than a cache: it is a click
 * log, and the ids embed the snapshot they were minted in.
 */
const ADHOC = new Map<string, Subject>();
export function registerSubject(s: Subject) {
  if (ADHOC.size > 24) ADHOC.clear();
  ADHOC.set(s.id, s);
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

  const ad = ADHOC.get(id);
  if (ad) return ad;

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

/* ---------------------------------------------------------------------------
   WHERE IS IT? — the place the core sample drills.

   "Drill down" on the card means "fix THIS thing's place and show me every
   moment under it", so the point has to be the subject's own, and there are
   three honest sources for one, in this order of specificity:

     · a polity            → the centroid of its largest territory, in the
                             snapshot nearest the middle of its life, taken
                             from the same alias table the highlight uses;
     · an event or a life  → PLACEMAP, the hand-curated lat/lon the horizon
                             view already flies its news along;
     · a spread            → the footprint sample nearest its peak year.

   Anything with none of the three has no place, and the action is not offered
   rather than being offered at 0°, 0°. Memoised per id: the polity centroid
   costs up to 121 point-in-polygon tests, and only the first ask pays.
--------------------------------------------------------------------------- */
const placeMemo = new Map<string, Place | null>();

export function placeOf(s: Subject | null): Place | null {
  if (!s) return null;
  if (s.place) return s.place;                       // a map click carries its own
  const seen = placeMemo.get(s.id);
  if (seen !== undefined) return seen;
  const p = computePlace(s);
  placeMemo.set(s.id, p);
  return p;
}

function computePlace(s: Subject): Place | null {
  if (s.polity) {
    const c = polityCentroid(s.polity);
    if (c) return c;
  }
  const pl = PLACES[s.name];                          // [lat, lon, place, scope]
  if (Array.isArray(pl) && Number.isFinite(pl[0]) && Number.isFinite(pl[1])) {
    return { lon: pl[1], lat: pl[0], label: pl[2] || s.name };
  }
  if (s.id.startsWith('spread:')) {
    const sp: any = REL.spreads.find(x => x.id === s.id.slice(7));
    const fp: any[] = sp && Array.isArray(sp.footprint) ? sp.footprint : [];
    if (fp.length) {
      let best = fp[0];
      for (const f of fp) if (Math.abs(f.year - s.peakYear) < Math.abs(best.year - s.peakYear)) best = f;
      if (Number.isFinite(best.lon) && Number.isFinite(best.lat)) {
        return { lon: best.lon, lat: best.lat, label: s.name };
      }
    }
  }
  return null;
}

/** The middle of the polity's biggest patch of ground, in the snapshot nearest
 *  the middle of its life — and a point that is actually INSIDE it. */
function polityCentroid(pid: string): Place | null {
  const a = ALIAS.get(pid);
  if (!a) return null;
  const years = Object.keys(a.match).map(Number)
    .filter(y => (a.match[String(y)] || []).length && GEO[y]);
  if (!years.length) return null;
  const mid = Math.round((a.start + a.end) / 2);
  years.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
  for (const y of years) {
    const want = new Set(a.match[String(y)]);
    let big: any = null;
    for (const f of GEO[y]) if (want.has(f.sov) || want.has(f.name)) if (!big || f.area > big.area) big = f;
    if (!big) continue;
    const pt = interiorPoint(big);
    if (pt) return { lon: pt[0], lat: pt[1], label: a.name };
  }
  return null;
}

/**
 * A bounding-box centre is not a place: for anything shaped like an archipelago
 * or a horseshoe it lands in the sea, and the core sample would then read
 * "beyond the mapped world" under an empire. So the label centre is TESTED, and
 * a miss falls back to a coarse grid scan for the interior point nearest the
 * middle.
 */
function interiorPoint(f: any): [number, number] | null {
  if (f.lc && pip(f.lc[0], f.lc[1], f)) return [f.lc[0], f.lc[1]];
  const [x0, y0, x1, y1] = f.bb;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let best: [number, number] | null = null, bd = Infinity;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const lon = x0 + (x1 - x0) * i / 12, lat = y0 + (y1 - y0) * j / 12;
    if (!pip(lon, lat, f)) continue;
    const d = (lon - cx) * (lon - cx) + (lat - cy) * (lat - cy);
    if (d < bd) { bd = d; best = [lon, lat]; }
  }
  return best || (f.lc ? [f.lc[0], f.lc[1]] : null);
}

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
