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

import { CATBY, EVENTS, LANES, POLITIES, clamp } from './shared';
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
 *   normal    importance 4 and up (plus the spine, always).
 *   detailed  everything — and timeline.ts ALSO drops the zoom gate for this
 *             layer, because "everything we hold" cannot mean "…once you have
 *             zoomed far enough in".
 */
export function passesDetail(
  d: Detail, kind: LayerKind, lvl: number, type: string, start: number, end: number,
): boolean {
  if (d === 2) return true;
  const isSpan = end !== 0 && end !== start;
  if (kind === 'person') {
    if (type === 'life') return true;                    // the bar is the spine
    return d === 1 && lvl <= 4;
  }
  if (kind === 'movements') {
    if (d === 0) return isSpan && lvl <= 3;
    return lvl <= 4;
  }
  if (d === 0) return lvl <= 2 || (isSpan && (end - start) >= 200 && lvl <= 3);
  return lvl <= 4;
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
  anchors?: string[];         // node ids adopted from ANOTHER band (see MZ)
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

let _defs: LayerDef[] | null = null;
let _byId: Map<string, LayerDef> | null = null;

/**
 * Build the catalogue. Runs once, AFTER initData() and setLanes() — the facet
 * split is measured against the real corpus, so a facet's existence is a fact
 * about the data rather than a guess written here.
 */
function build(): LayerDef[] {
  // count every mark the timeline can draw, by (band, facet)
  const n = new Map<string, number>();
  const bump = (band: string, facet: string) => n.set(band + '/' + facet, (n.get(band + '/' + facet) || 0) + 1);
  for (const e of EVENTS) bump(e[3], facetOf(e[6] || 'power', e[7] || (e[1] ? 'episode' : 'moment')));
  for (const p of POLITIES) bump(p.region === 'AF' ? 'ME' : p.region, 'pol');
  for (const s of REL.spreads) {
    const fp = s.footprint && s.footprint.length ? s.footprint[0] : null;
    const r = fp ? regionOf(fp.lat, fp.lon) : null;
    if (r) bump(r, facetOf(SPREADCAT[s.kind] || 'society', 'spread'));
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
      if (c >= FACET_MIN) live.push(f); else essN += c;      // footnote folds into the spine
    }
    defs.push({
      id: key.toLowerCase() + '-ess', subject: key, facet: 'ess',
      name: label + ' · ' + FACET_NAME.ess, kind: 'region', si: FACET_SI.ess, n: essN,
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
    const person = L.key === 'MZ';
    defs.push({
      id, subject: L.key, facet: 'all', name: L.label,
      kind: person ? 'person' : 'movements', si: L.si, n: count + (person ? 1 : 0),
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
// is the backdrop everything else sits on), then the four regions' essentials.
const SPINE = ['deep', 'eu-ess', 'me-ess', 'as-ess', 'am-ess'];

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
