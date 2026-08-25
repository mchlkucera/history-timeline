/* eslint-disable @typescript-eslint/no-explicit-any */
/* =============================================================================
   layers.ts — THE LAYER MODEL.

   It replaces two older controls at once: the LANES chips (which turned whole
   curated bands on and off) and the DOMAIN chips (which hid a category across
   every band at the same time). Neither could say the thing a reader actually
   wants to say, which is "show me Europe's science but not its wars" — the
   first is a whole-band switch, the second is a global one.

     A LAYER IS A SUBJECT × A KIND.  eu-sci = Europe · Science.

   The subject is a region (EU/ME/AS/AM), deep time, or a curated lane (Mozart,
   Design…). The kind is what the marks in it ARE: a facet of the region's
   corpus, or the whole of a curated lane. Every layer has a stable id, so the
   whole arrangement — which layers exist, their order, their groups, what is
   hidden, how much detail each is asked for — survives a reload in
   localStorage.

   THE LIBRARY holds everything not currently on the board. "+ Add layer" takes
   from it, "×" gives back to it. Nothing is ever destroyed.

   THE SPINE is the fresh-load default: the four regions' Essentials plus deep
   time. Everything else — the wars, the sciences, the states, the arts, the
   curated studies — starts in the library, which is what makes the first sight
   of the timeline legible instead of a wall.

   WHAT THIS FILE DOES NOT DO: it does not know about the canvas. It is the
   model and the persistence, nothing else. timeline.ts reads visibleLanes()
   and asks membership questions of it; layerpanel.ts draws it.
   ============================================================================= */

import { CATBY, EVENTS, LANES, POLITIES, clamp, evId } from './shared';
import { REL, SPREADCAT, lvlOfWeight, peakOf, regionOf } from './relations';

// ── detail: three named steps, and each word means something concrete ────────
// The founder's semantics, verbatim: LOW answers "when", NORMAL answers "what
// happened", DETAILED answers "everything we hold".
export type Detail = 0 | 1 | 2;
export const DETAIL_WORDS: readonly string[] = ['less', 'normal', 'detailed'];
export type LayerKind = 'region' | 'movements' | 'person';

export const DETAIL_TEXT: Record<LayerKind, [string, string][]> = {
  person: [
    ['less', 'Just when they lived — the lifespan bar, nothing else.'],
    ['normal', 'The lifespan plus the landmark moments: the works that matter.'],
    ['detailed', 'Everything — every premiere, every move, the minor business too.'],
  ],
  region: [
    ['less', 'Only the turning points — what a one-page history would name.'],
    ['normal', 'The turning points plus what a course would cover.'],
    ['detailed', 'Everything we hold, down to the local detail, at every zoom.'],
  ],
  movements: [
    ['less', 'The long dominant movements only — the periods you can name.'],
    ['normal', 'Every movement that shaped things, plus the moments that started them.'],
    ['detailed', 'Everything, including the short-lived and the marginal.'],
  ],
};

/**
 * DOES THIS MARK BELONG IN THIS LAYER AT THIS DETAIL?
 *
 * The dial is a statement of INTENT about content, not a density policy: it is
 * absolute, and it does not change when you zoom. Zoom still runs the level of
 * detail on top of it (alphaFor), so a layer at `normal` behaves exactly as the
 * old timeline did — that step is deliberately a no-op against today.
 *
 *   less      the kind's spine: a life's bar, a movement's long periods,
 *             a region's turning points.
 *   normal    the structure in full, but only the FIRST-RANK moments.
 *   detailed  everything — and timeline.ts ALSO drops the zoom gate for this
 *             layer, because "everything we hold" cannot mean "…once you have
 *             zoomed far enough in".
 *
 * WHY NORMAL TREATS A DOT DIFFERENTLY FROM A BAR. `normal` used to admit
 * importance 4 for everything, which sounded like a middle setting and was not
 * one: of the 179 event dots in the corpus, 170 are level 4 or better. Normal
 * was showing 95% of them, so the dial's middle notch was `detailed` wearing a
 * different name, and the event stratum — the densest thing on the board, and
 * the one whose labels compete hardest for horizontal room — never thinned out
 * until you turned the dial the whole way down to `less`.
 *
 * A dot at normal now needs level 3 or better: 97 dots rather than 170. What
 * that drops is the genuinely second-rank moment — Stonehenge raised, the first
 * Olympic games, the Defenestration of Prague — every one of which is still one
 * notch away at `detailed`, per layer. SPANS keep level 4, because a bar is
 * structure rather than incident: it says a thing EXISTED for a stretch, it
 * cannot pile up in a row the way dots do, and thinning it would take the shape
 * out of the board rather than the clutter.
 */
/** The importance a MOMENT must reach to survive `normal`. Spans keep 4. */
const NORMAL_MOMENT = 3;
export function passesDetail(
  d: Detail, kind: LayerKind, lvl: number, type: string, start: number, end: number,
): boolean {
  if (d === 2) return true;
  const isSpan = end !== 0 && end !== start;
  // Callers pass end === 0 for an event, so isSpan is the dot/bar split.
  const cap = isSpan ? 4 : NORMAL_MOMENT;
  if (kind === 'person') {
    if (type === 'life') return true;                    // the bar is the spine
    return d === 1 && lvl <= cap;
  }
  if (kind === 'movements') {
    if (d === 0) return isSpan && lvl <= 3;
    return lvl <= cap;
  }
  if (d === 0) return lvl <= 2 || (isSpan && (end - start) >= 200 && lvl <= 3);
  return lvl <= cap;
}

// ── the catalogue ────────────────────────────────────────────────────────────
export interface LayerDef {
  id: string;                 // 'eu-sci' — stable, and what localStorage stores
  subject: string;            // band key: 'EU' | 'CO' | 'MZ' …
  facet: string;              // 'ess' | 'sci' | 'war' | 'art' | 'pol' | 'all'
  name: string;               // 'Europe · Science'
  kind: LayerKind;
  si: number | null;          // swatch index for the dot
  n: number;                  // corpus size, shown in the library
  anchors?: string[];         // node ids adopted from ANOTHER band or facet (see MZ, and the big-wars adoption in build())
}

const REGIONS: [string, string][] = [
  ['EU', 'Europe'], ['ME', 'MidEast & Africa'], ['AS', 'Asia'], ['AM', 'Americas'],
];
const FACET_NAME: Record<string, string> = {
  ess: 'Essentials', sci: 'Science', war: 'Wars', art: 'Art & culture', pol: 'States & empires',
};
// The founder's own word for Asia's polity layer. Everywhere else "States &
// empires" is the truthful noun — Rome was not a dynasty.
const FACET_NAME_BY: Record<string, Record<string, string>> = { AS: { pol: 'Dynasties' } };
const FACET_SI: Record<string, number> = { ess: 0, sci: 2, war: 7, art: 4, pol: 0 };
// A facet with fewer marks than this is not a topic, it is a footnote: Asia has
// one war event and the Americas one science event of their own. Those fold
// back into Essentials rather than shipping a layer you would never add.
const FACET_MIN = 4;

/** Which facet of its region does a mark belong to? The ONE place that decides. */
export function facetOf(cat: string, type: string): string {
  if (type === 'polity') return 'pol';
  if (cat === 'war') return 'war';
  if (cat === 'sci') return 'sci';
  if (cat === 'art') return 'art';
  return 'ess';
}

// Mozart's lifespan is banded MU (it is a composer's life, and Music is where a
// composer's life belongs). The Mozart layer is a STUDY OF HIM, so it adopts
// that one bar — a person layer without its person's lifespan cannot answer
// "when", which is exactly what its `less` step is for.
const MZ_ANCHOR = 'entity:Wolfgang Amadeus Mozart';

/**
 * THE CURATED LANE CATALOGUE — every short code the library can offer, and the
 * KIND its detail dial speaks. A lane arrives as data (data/lanes.json ships a
 * two-letter `key`; setLanes appends its members to EVENTS under that band), so
 * the entry itself is built from LANES below. This table says the one thing the
 * data cannot: which kind's words apply, because "less" means a different thing
 * for a life than for a set of movements than for a national corpus.
 *
 *   MZ  a STUDY OF A PERSON — `less` is the lifespan bar and nothing else.
 *   CZ  a national history — events, lives and periods together, so it reads
 *       like a region: `less` is the turning points a one-page history names.
 *   everything else  movements: `less` is the long periods you can name.
 *
 * Codes are listed here even when 'movements' is what a missing entry would
 * give anyway, so this is the one place to read what the library holds.
 */
const LANE_KIND: Record<string, LayerKind> = {
  MZ: 'person',                                     // Mozart
  CZ: 'region',                                     // Czech history
  AR: 'movements', DS: 'movements', MU: 'movements', SC: 'movements',
  LT: 'movements',                                  // Literature
  FM: 'movements',                                  // Film
  RL: 'movements',                                  // Religion
  PH: 'movements',                                  // Philosophy
  PI: 'movements',                                  // Political ideologies
  EC: 'movements',                                  // Economics
  TE: 'movements',                                  // Technology
  MD: 'movements',                                  // Medicine
  EX: 'movements',                                  // Exploration & voyages
};

let _defs: LayerDef[] | null = null;
let _byId: Map<string, LayerDef> | null = null;

/**
 * Build the catalogue. Runs once, AFTER initData() and setLanes() — the facet
 * split is measured against the real corpus, so a facet's existence is a fact
 * about the data rather than a guess written here.
 */
function build(): LayerDef[] {
  // count every mark the timeline can draw, by (band, facet) — and remember the
  // strongest (lowest) level seen per facet, which the fold rule below reads.
  const n = new Map<string, number>();
  const strongest = new Map<string, number>();
  const bump = (band: string, facet: string, lvl: number) => {
    const k = band + '/' + facet;
    n.set(k, (n.get(k) || 0) + 1);
    if (lvl < (strongest.get(k) ?? 9)) strongest.set(k, lvl);
  };
  for (const e of EVENTS) bump(e[3], facetOf(e[6] || 'power', e[7] || (e[1] ? 'episode' : 'moment')), e[4] || 3);
  for (const p of POLITIES) bump(p.region === 'AF' ? 'ME' : p.region, 'pol', polityLvl(p));
  for (const s of REL.spreads) {
    const fp = s.footprint && s.footprint.length ? s.footprint[0] : null;
    const r = fp ? regionOf(fp.lat, fp.lon) : null;
    if (r) bump(r, facetOf(SPREADCAT[s.kind] || 'society', 'spread'), lvlOfWeight(peakOf(s.weight)));
  }

  const defs: LayerDef[] = [];
  const co = n.get('CO/ess') || 0;
  defs.push({
    id: 'deep', subject: 'CO', facet: 'all', name: 'Deep time', kind: 'region',
    si: CATBY.nature.si, n: co + (n.get('CO/sci') || 0) + (n.get('CO/war') || 0) + (n.get('CO/art') || 0) + (n.get('CO/pol') || 0),
  });
  for (const [key, label] of REGIONS) {
    let essN = n.get(key + '/ess') || 0;
    const live: string[] = [];
    for (const f of ['sci', 'war', 'art', 'pol']) {
      const c = n.get(key + '/' + f) || 0;
      // A facet under FACET_MIN is a footnote and folds into the spine — EXCEPT
      // a science facet holding a level-1/2 mark. That exemption is the founder's
      // named miss ("writing is more of a technology topic"): a 5,000-year
      // level-1 Writing ribbon folding into MidEast Essentials is not a footnote,
      // it is a miscategorisation, so a sci facet that holds something that big
      // ships as a real (if thin) layer instead of folding.
      const keep = c >= FACET_MIN || (f === 'sci' && c > 0 && (strongest.get(key + '/sci') ?? 9) <= 2);
      if (keep) live.push(f); else essN += c;                // footnote folds into the spine
    }
    // THE FOUNDER BAR: "show the biggest changes and empires in NORMAL view."
    // facetOf() gives every cat=war mark to the Wars facet exclusively, which
    // starved a region's Essentials of its biggest changes — EU Essentials had
    // neither World War. So Essentials ADOPTS the region's importance-1/2 war
    // spans through the anchors mechanism timeline.ts already honours: they stay
    // in Wars, where they belong, and appear in Essentials too, which cannot
    // tell the region's story without them. Only needed while a live war facet
    // would otherwise own them exclusively — a folded one is in the spine already.
    const bigWars = live.includes('war')
      ? EVENTS.filter(e => e[3] === key && e[1] && (e[6] || 'power') === 'war' && (e[4] || 3) <= 2).map(evId)
      : [];
    defs.push({
      id: key.toLowerCase() + '-ess', subject: key, facet: 'ess',
      name: label + ' · ' + FACET_NAME.ess, kind: 'region', si: FACET_SI.ess,
      n: essN + bigWars.length,
      ...(bigWars.length ? { anchors: bigWars } : {}),
    });
    for (const f of live) defs.push({
      id: key.toLowerCase() + '-' + f, subject: key, facet: f,
      name: label + ' · ' + ((FACET_NAME_BY[key] && FACET_NAME_BY[key][f]) || FACET_NAME[f]),
      kind: f === 'pol' ? 'movements' : 'region', si: FACET_SI[f], n: n.get(key + '/' + f) || 0,
    });
  }
  for (const L of LANES) {
    const id = L.key.toLowerCase();
    let count = 0;
    for (const f of ['ess', 'sci', 'war', 'art', 'pol']) count += n.get(L.key + '/' + f) || 0;
    const kind = LANE_KIND[L.key] || 'movements';
    const person = kind === 'person';
    defs.push({
      id, subject: L.key, facet: 'all', name: L.label,
      kind, si: L.si, n: count + (person ? 1 : 0),
      ...(person ? { anchors: [MZ_ANCHOR] } : {}),
    });
  }
  return defs;
}

export function layerDefs(): LayerDef[] {
  if (!_defs) { _defs = build(); _byId = new Map(_defs.map(d => [d.id, d])); }
  return _defs;
}
export function layerDef(id: string): LayerDef | undefined {
  layerDefs(); return _byId!.get(id);
}
/** Data arrived after the catalogue was first asked for (HMR, a late fetch). */
export function resetCatalogue() { _defs = null; _byId = null; }

// ── the tree: a FLAT list, with groups as optional nodes in the same list ────
export type LNode = { t: 'L'; id: string };
export type GNode = { t: 'G'; id: string; name: string; collapsed: boolean; kids: LNode[] };
export type TNode = LNode | GNode;

interface Persisted {
  v: 1;
  root: TNode[];
  vis: Record<string, boolean>;
  det: Record<string, Detail>;
  gvis: Record<string, boolean>;
}

const KEY = 'tl.layers.v1';
// THE SPINE — what a reader who has never been here gets. Deep time first (it
// is the backdrop everything else sits on), then, per region, its essentials
// AND its states & empires. The second half is the founder's order — "show the
// biggest changes and empires in NORMAL view" — made the default: a polity is
// routed to exactly one layer by timeline.ts, so the empires reach the default
// board as their own layer beside each region's essentials rather than by
// flooding the essentials corpus with every minor state. The zoom LOD keeps the
// first sight legible: zoomed out, a polity layer shows only its top empires.
const SPINE = ['deep', 'eu-ess', 'eu-pol', 'me-ess', 'me-pol', 'as-ess', 'as-pol', 'am-ess', 'am-pol'];
// what the spine was before the empires joined it — load() migrates an
// untouched old default forward, and nothing else.
const OLD_SPINE = ['deep', 'eu-ess', 'me-ess', 'as-ess', 'am-ess'];

let uid = 0;
const nid = () => 'g' + (++uid) + '-' + Math.random().toString(36).slice(2, 6);

export const Layers = {
  root: [] as TNode[],
  vis: {} as Record<string, boolean>,
  det: {} as Record<string, Detail>,
  gvis: {} as Record<string, boolean>,
  _subs: new Set<() => void>(),
  _loaded: false,

  subscribe(f: () => void) { this._subs.add(f); return () => { this._subs.delete(f); }; },
  /** Something changed. The panel redraws, the renderer relayouts. */
  emit() { this.save(); for (const f of [...this._subs]) f(); },

  load() {
    if (this._loaded) return;
    this._loaded = true;
    const known = new Set(layerDefs().map(d => d.id));
    let p: Persisted | null = null;
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      if (raw) { const j = JSON.parse(raw); if (j && j.v === 1 && Array.isArray(j.root)) p = j; }
    } catch { /* private mode, quota, a hand-edited value — fall through to the spine */ }
    if (!p) { this.reset(); return; }
    // sanitise: drop ids the catalogue no longer has, and any duplicate
    const seen = new Set<string>();
    const keepL = (a: any[]): LNode[] => {
      const out: LNode[] = [];
      for (const k of a || []) {
        if (!k || k.t !== 'L' || typeof k.id !== 'string') continue;
        if (!known.has(k.id) || seen.has(k.id)) continue;
        seen.add(k.id); out.push({ t: 'L', id: k.id });
      }
      return out;
    };
    const root: TNode[] = [];
    for (const nd of p.root) {
      if (!nd || typeof nd !== 'object') continue;
      if ((nd as any).t === 'L') { root.push(...keepL([nd])); continue; }
      const g = nd as GNode;
      if (typeof g.id !== 'string') continue;
      root.push({ t: 'G', id: g.id, name: String(g.name || 'Group'), collapsed: !!g.collapsed, kids: keepL(g.kids) });
    }
    // MIGRATION: the default spine changed — it now ships each region's states
    // & empires layer ("show the biggest changes and empires in NORMAL view").
    // A stored board that is exactly the untouched OLD default (the five-lane
    // spine, nothing hidden, every dial at normal) adopts the new default; a
    // board with any customisation is the reader's own arrangement and keeps itself.
    const untouched = root.length === OLD_SPINE.length
      && root.every(nd => nd.t === 'L')
      && OLD_SPINE.every(id => seen.has(id))
      && [...seen].every(id => (p!.vis ? p!.vis[id] !== false : true)
        && ((p!.det ? p!.det[id] ?? 1 : 1)) === 1);
    if (untouched) { this.reset(); return; }
    this.root = root;
    this.vis = {}; this.det = {}; this.gvis = {};
    for (const id of seen) {
      this.vis[id] = p.vis ? p.vis[id] !== false : true;
      const d = p.det ? p.det[id] : 1;
      this.det[id] = (d === 0 || d === 1 || d === 2) ? d : 1;
    }
    for (const nd of root) if (nd.t === 'G') this.gvis[nd.id] = p.gvis ? p.gvis[nd.id] !== false : true;
    if (!root.length) this.reset();
  },
  reset() {
    const known = new Set(layerDefs().map(d => d.id));
    this.root = SPINE.filter(id => known.has(id)).map(id => ({ t: 'L' as const, id }));
    this.vis = {}; this.det = {}; this.gvis = {};
    for (const nd of this.root) if (nd.t === 'L') { this.vis[nd.id] = true; this.det[nd.id] = 1; }
    this.save();
  },
  save() {
    try {
      const p: Persisted = { v: 1, root: this.root, vis: this.vis, det: this.det, gvis: this.gvis };
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(p));
    } catch { /* nothing to do — the session still works, it just will not survive */ }
  },

  // ---- reading the tree ----------------------------------------------------
  /** Every node in draw order, with the list it lives in (for drag + remove). */
  walk(): { n: TNode; list: TNode[] | LNode[]; i: number; g?: GNode }[] {
    const out: { n: TNode; list: any; i: number; g?: GNode }[] = [];
    this.root.forEach((n, i) => {
      out.push({ n, list: this.root, i });
      if (n.t === 'G') n.kids.forEach((k, j) => out.push({ n: k, list: n.kids, i: j, g: n }));
    });
    return out;
  },
  /** Layer ids on the board, in draw order. */
  ids(): string[] { return this.walk().filter(x => x.n.t === 'L').map(x => x.n.id); },
  has(id: string) { return this.ids().includes(id); },
  /** Everything NOT on the board — the library. */
  library(): LayerDef[] {
    const on = new Set(this.ids());
    return layerDefs().filter(d => !on.has(d.id));
  },
  groupOf(id: string): GNode | null {
    for (const nd of this.root) if (nd.t === 'G' && nd.kids.some(k => k.id === id)) return nd;
    return null;
  },
  detail(id: string): Detail { const d = this.det[id]; return d === 0 || d === 2 ? d : 1; },
  /** Visible = its own eye is open AND its group's eye is open. */
  visible(id: string): boolean {
    if (this.vis[id] === false) return false;
    const g = this.groupOf(id);
    return !(g && this.gvis[g.id] === false);
  },
  /** The draw order the renderer consumes: group heads and layers, interleaved. */
  lanes(): ({ t: 'L'; id: string; group: GNode | null } | { t: 'G'; g: GNode })[] {
    const out: any[] = [];
    for (const nd of this.root) {
      if (nd.t === 'L') { out.push({ t: 'L', id: nd.id, group: null }); continue; }
      out.push({ t: 'G', g: nd });
      for (const k of nd.kids) out.push({ t: 'L', id: k.id, group: nd });
    }
    return out;
  },

  // ---- the five operations -------------------------------------------------
  toggle(id: string) { this.vis[id] = this.vis[id] === false; this.emit(); },
  toggleGroup(gid: string) { this.gvis[gid] = this.gvis[gid] === false; this.emit(); },
  setDetail(id: string, d: Detail) { this.det[id] = d; this.emit(); },
  collapse(gid: string) {
    const g = this.root.find(n => n.t === 'G' && n.id === gid) as GNode | undefined;
    if (g) { g.collapsed = !g.collapsed; this.emit(); }
  },
  add(id: string) {
    if (this.has(id)) return;
    this.root.push({ t: 'L', id });
    if (this.vis[id] === undefined) this.vis[id] = true;
    if (this.det[id] === undefined) this.det[id] = 1;
    this.emit();
  },
  remove(id: string) {
    for (const w of this.walk()) {
      if (w.n.t === 'L' && w.n.id === id) { (w.list as any[]).splice(w.i, 1); break; }
    }
    this.emit();
  },
  newGroup(name = 'New group') {
    const g: GNode = { t: 'G', id: nid(), name, collapsed: false, kids: [] };
    this.root.push(g); this.gvis[g.id] = true; this.emit();
    return g.id;
  },
  /** Ungroup: the group node disappears, its layers stay in the list where it was. */
  ungroup(gid: string) {
    const i = this.root.findIndex(n => n.t === 'G' && n.id === gid);
    if (i < 0) return;
    const g = this.root[i] as GNode;
    this.root.splice(i, 1, ...g.kids);
    delete this.gvis[gid];
    this.emit();
  },
  renameGroup(gid: string, name: string) {
    const g = this.root.find(n => n.t === 'G' && n.id === gid) as GNode | undefined;
    if (g) { g.name = name || 'Group'; this.emit(); }
  },
  /**
   * Move a node to (list, index). The one primitive under "drag to reorder and
   * between groups" — root ⇄ group, both directions, groups never nest.
   * Returns true when something actually moved, so the caller can skip a redraw.
   */
  moveTo(nodeId: string, isGroup: boolean, list: TNode[] | LNode[], at: number): boolean {
    const cur = this.walk().find(w => (w.n.t === 'G' ? w.n.id : w.n.id) === nodeId && (isGroup ? w.n.t === 'G' : w.n.t === 'L'));
    if (!cur) return false;
    if (isGroup && list !== (this.root as any)) return false;          // groups do not nest
    let i = at;
    if (cur.list === list) { if (cur.i < i) i--; if (i === cur.i) return false; }
    (cur.list as any[]).splice(cur.i, 1);
    (list as any[]).splice(clamp(i, 0, (list as any[]).length), 0, cur.n as any);
    this.emit();
    return true;
  },
};

/** Which layer owns this EVENTS tuple (whether or not it is on the board)? */
export function layerIdOfEvent(ev: any[]): string | null {
  return layerIdFor(ev[3], ev[6] || 'power', ev[7] || (ev[1] ? 'episode' : 'moment'));
}

/** band + category + type → the layer id that owns it (whether on the board or not). */
export function layerIdFor(band: string, cat: string, type: string): string | null {
  layerDefs();
  if (band === 'CO') return 'deep';
  if (REGIONS.some(r => r[0] === band)) {
    const want = band.toLowerCase() + '-' + facetOf(cat, type);
    return _byId!.has(want) ? want : band.toLowerCase() + '-ess';       // folded footnote
  }
  const lane = band.toLowerCase();
  return _byId!.has(lane) ? lane : null;
}

/** The importance level a POLITY carries — shared by the catalogue and the corpus. */
export const polityLvl = (p: any) => lvlOfWeight(peakOf(p.weight));

/* ═══════════════════════════════════════════════════════════════════════════
   CAN THIS THING ACTUALLY BE DRAWN? — the phantom-zoom guard.

   The founder: "if I search for something thats not shown its going to zoom on
   not existing piece. […] Make sure its impossible to zoom in on something that
   does not exist."

   The search corpus is the WHOLE corpus; the board is a subset of it. Cubism is
   a real, selectable, framable id whether or not "Arts & movements" is on the
   board — so choosing it used to move the window to 1875–1955 and land on a
   lane that is not there. The span was right and the screen was empty, which
   reads as a broken app rather than as a missing layer.

   The cure is not a warning, it is a RESOLUTION: before anything is framed, the
   id is resolved to the layer that would draw it, and that layer is asked the
   three questions that decide whether the mark reaches the canvas —

     is it ON THE BOARD?          Layers.has
     is its EYE OPEN?             Layers.visible (its own, and its group's)
     does its DETAIL DIAL ask for something this unimportant?   passesDetail

   planReveal() answers all three as one verdict, and reveal() is the single
   operation that makes the verdict true. Framing is allowed only afterwards.

   NOTHING HERE GUESSES. The three questions are asked with the same functions
   timeline.ts asks them with (Layers.has / Layers.visible / passesDetail), on
   the same numbers the renderer passes (a moment's `end` is 0, exactly as in
   the event stratum), so this file and the canvas cannot drift into disagreeing
   about whether something is on screen.
   ═══════════════════════════════════════════════════════════════════════════ */

// EVENTS only ever grows (initData, then setLanes), so a length check is a
// sufficient signature — the same trick subject.ts uses for its own index.
let _evIx: Map<string, any[]> | null = null;
let _evIxN = -1;
function eventById(id: string): any[] | null {
  if (_evIxN !== EVENTS.length) {
    _evIxN = EVENTS.length;
    _evIx = new Map();
    for (const e of EVENTS) { const k = evId(e); if (!_evIx.has(k)) _evIx.set(k, e); }
  }
  return _evIx!.get(id) || null;
}

/** The numbers the renderer's own gates are fed, for one selectable id. */
interface MarkFacts {
  own: string | null;      // the layer that OWNS it
  adopted: string[];       // layers that ALSO draw it, through `anchors`
  lvl: number;
  type: string;
  start: number;
  end: number;             // 0 for a moment — what the event stratum passes
}

function factsOf(id: string): MarkFacts | null {
  layerDefs();
  if (id.startsWith('polity:')) {
    const p = POLITIES.find((x: any) => x.id === id.slice(7));
    if (!p) return null;
    const band = p.region === 'AF' ? 'ME' : p.region;
    return {
      own: layerIdFor(band, 'power', 'polity'), adopted: [],
      lvl: polityLvl(p), type: 'polity', start: p.start, end: p.end,
    };
  }
  if (id.startsWith('spread:')) {
    const s = REL.spreads.find(x => x.id === id.slice(7));
    if (!s) return null;
    const fp = s.footprint && s.footprint.length ? s.footprint[0] : null;
    const band = fp ? regionOf(fp.lat, fp.lon) : null;
    if (!band) return null;                    // no footprint, no band, no lane
    return {
      own: layerIdFor(band, SPREADCAT[s.kind] || 'society', 'spread'), adopted: [],
      lvl: lvlOfWeight(peakOf(s.weight)), type: 'spread', start: s.start, end: s.end,
    };
  }
  const e = eventById(id);
  if (!e) return null;                         // beliefs, and anything else the timeline never draws
  const adopted: string[] = [];
  for (const d of _defs!) if (d.anchors && d.anchors.indexOf(id) >= 0) adopted.push(d.id);
  return {
    own: layerIdOfEvent(e), adopted,
    lvl: e[4] || 3, type: e[7] || (e[1] ? 'episode' : 'moment'),
    start: e[0], end: e[1] || 0,
  };
}

/** The lowest detail step at or above `from` that lets this mark through. */
function detailFor(f: MarkFacts, kind: LayerKind, from: Detail): Detail {
  for (let d = from; d <= 2; d++) {
    if (passesDetail(d as Detail, kind, f.lvl, f.type, f.start, f.end)) return d as Detail;
  }
  return 2;                                    // `detailed` is "everything we hold" — it always passes
}

/** What stands between this id and the canvas. */
export type RevealNeed = 'ready' | 'add' | 'show' | 'detail' | 'never';

export interface RevealPlan {
  need: RevealNeed;
  layer: string | null;          // the layer to act on
  layerName: string | null;
  detail: Detail | null;         // the dial reveal() will set, when it has to raise one
  detailWord: string | null;     // that dial, spelled the way the panel spells it
  why: string | null;            // set only for `never`: what kind of thing this is
}

/**
 * WHAT WOULD IT TAKE TO SEE THIS? Read-only — it decides, it never acts.
 *
 * A mark can have more than one candidate layer: Mozart's lifespan is banded MU
 * and ADOPTED by the Mozart study, the big wars sit in a region's Wars facet and
 * are adopted by its Essentials. If any candidate already draws it, the answer
 * is `ready` and nothing is touched — a reader who has Europe · Essentials open
 * should not have Europe · Wars added underneath them for a mark that is
 * already on their screen.
 *
 * Otherwise the CHEAPEST candidate wins, in the order of how much of the
 * reader's arrangement it disturbs: raising a dial < opening an eye < adding a
 * lane. Ties go to the owning layer, which is where the mark actually belongs.
 */
export function planReveal(id: string): RevealPlan {
  // A BELIEF STREAM IS NOT A BUG, IT IS A DIFFERENT VIEW. The braided-rivers
  // view draws the belief corpus and this one never has; saying so by name is
  // more use to the reader than a flat "not drawn".
  const none: RevealPlan = {
    need: 'never', layer: null, layerName: null, detail: null, detailWord: null,
    why: id.startsWith('belief:')
      ? 'a belief stream — the Beliefs view draws these'
      : 'not drawn on this timeline',
  };
  const f = factsOf(id);
  if (!f || !f.own) return none;

  const cands = [f.own, ...f.adopted];
  // already drawn by one of them? then there is nothing to do.
  for (const c of cands) {
    const def = layerDef(c); if (!def) continue;
    if (Layers.has(c) && Layers.visible(c)
      && passesDetail(Layers.detail(c), def.kind, f.lvl, f.type, f.start, f.end)) {
      return { need: 'ready', layer: c, layerName: def.name, detail: null, detailWord: null, why: null };
    }
  }

  let best: RevealPlan | null = null;
  let bestCost = 99;
  for (const c of cands) {
    const def = layerDef(c); if (!def) continue;
    const on = Layers.has(c);
    const lit = on && Layers.visible(c);
    const cur = Layers.detail(c);                 // a layer off the board still remembers its dial
    const want = detailFor(f, def.kind, cur);
    const raises = want !== cur;
    const cost = !on ? 3 : !lit ? 2 : 1;
    if (cost >= bestCost) continue;
    bestCost = cost;
    best = {
      need: !on ? 'add' : !lit ? 'show' : 'detail',
      layer: c, layerName: def.name,
      detail: raises ? want : null,
      detailWord: raises ? DETAIL_WORDS[want] : null,
      why: null,
    };
  }
  return best || none;
}

/**
 * MAKE THE VERDICT TRUE. One emit, whatever it took: adding a lane and raising
 * its dial in two emits would rebuild the panel twice and hand the slew limiter
 * two separate relayouts for one gesture.
 *
 * Returns false only when the plan was `never` — i.e. the thing is not drawn on
 * this timeline at all, and the caller must not frame anything.
 */
export function reveal(plan: RevealPlan): boolean {
  if (plan.need === 'never' || !plan.layer) return false;
  if (plan.need === 'ready' && plan.detail === null) return true;
  const id = plan.layer;
  let touched = false;
  if (!Layers.has(id)) {
    Layers.root.push({ t: 'L', id });
    if (Layers.vis[id] === undefined) Layers.vis[id] = true;
    if (Layers.det[id] === undefined) Layers.det[id] = 1;
    touched = true;
  }
  if (Layers.vis[id] === false) { Layers.vis[id] = true; touched = true; }
  const g = Layers.groupOf(id);
  if (g && Layers.gvis[g.id] === false) { Layers.gvis[g.id] = true; touched = true; }
  if (plan.detail !== null && Layers.det[id] !== plan.detail) { Layers.det[id] = plan.detail; touched = true; }
  if (touched) Layers.emit();
  return true;
}
