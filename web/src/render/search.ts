/* =============================================================================
   search.ts — WHAT DOES THAT WORD MATCH?

   The timeline's search box has always DIMMED: type "revolution" and everything
   that is not a hit drops to 12%, leaving you to find the lit ones by eye on a
   surface that may be five thousand pixels wide. The founder, plainly: "When
   searching add a dropdown with the listed options so that I can click them."

   So the same query also has to produce a LIST, and a list needs one thing the
   dimming never did — an id per hit, resolvable to a name, an extent, a domain
   and a lane. That already exists twice over: relations.ts's relDir is the
   directory of every id the app can mint (spreads, polities, beliefs, events,
   entities and curated lane members, all with name/start/end), and subject.ts
   turns any one of them into the five answers the row needs.

   ── ONE MATCHER, NOT TWO ────────────────────────────────────────────────────
   This file used to answer only the list, and the canvas kept a raw substring
   test of its own. Two searches wearing one box, and they disagreed in public:
   "usa" lit the First Crusade (cr-USA-de), the Azusa Street Revival and Babylon
   destroys Jerusalem (Jer-USA-lem) — and NOT the Declaration of Independence,
   whose tags read "usa revolution independence". The dropdown read name+note,
   the canvas read name+tags+note, and neither could see a word inside a name it
   did not spell identically.

   queryMatch() below is now the ONLY answer to "does this word match this
   thing", for the dropdown and for the canvas dimming alike. It is a RANK, not
   a boolean: 0 is no match and bigger is better, so the same call that lights a
   mark also orders the list.

   Three things it does that a substring test cannot:

     TOKENS.   "thirty years war" finds Thirty Years' War. Every token has to
               land, in any order, against name + tags + note — a query is a
               set of words, not a prefix of one string.
     FOLDING.  Case, diacritics and apostrophes (typographic AND ASCII) are
               folded away on both sides, so the reader never has to know how
               the corpus spells Years' — or Munchen, or Zurich.
     YEARS.    "1620" is a question about time, and the corpus is made of time.
               It finds the Battle of White Mountain, and then everything that
               was alive in 1620.

   And one thing it deliberately stops doing: matching a short token in the
   MIDDLE of a word. "usa" is three letters; a corpus of forty thousand words
   contains it by accident. A token reaches a word by its START (or, from four
   letters up, anywhere inside a NAME — "volut" still finds Revolution).
   ============================================================================= */

import { Layers, layerDefs } from './layers';
import { relDir, type DirEntry } from './relations';
import { bandLabel, describe } from './subject';

/* ── WHAT A MATCHER CAN READ ────────────────────────────────────────────────
   Everything a searchable thing has to offer in words, plus its span. Every
   field but the name is optional, so the canvas can hand over its own corpus
   items unchanged and a thing with no span (a VIEW) simply never answers a
   year. */
export interface Haystack {
  name: string;
  tags?: string;
  note?: string;
  start?: number;
  end?: number;      // 0 or absent = a moment: the start year is the whole span
}

/* THE RANK, in tiers. Bigger is better, 0 is no match. Years outrank words
   because a query that is nothing but a year is a question about time and
   nothing else — no name in the corpus is "1776". */
const S_YEAR_AT = 90;    // the thing STARTS or ENDS in that year
const S_YEAR_NEAR = 80;  // within a few years of one of its ends
const S_YEAR_IN = 70;    // it was alive then
const S_NAME_IS = 60;    // the name IS the query
const S_NAME_PRE = 50;   // the name starts with the whole query, on a word break
const S_NAME_HEAD = 45;  // the name starts with it mid-word ("rom" -> Roman Republic)
const S_NAME_WORD = 40;  // every token starts a word in the name
const S_NAME_IN = 30;    // every token is somewhere in the name
const S_TAGS = 20;       // the tags carried it ("usa" -> Declaration of Independence)
const S_NOTE = 10;       // only the note did ("plague" -> Black Death)

/** How close to an end still counts as "at" that year. Three, so a query for a
 *  war's year finds the treaty that closed it the winter after. */
const NEAR = 3;
/** A span longer than this is not an answer to a year. Deep time contains every
 *  year there has ever been; "1776" should not return the Quaternary. Twenty
 *  thousand years keeps every empire, era and movement a person can name. */
const LONGEST = 20000;

const MARKS = /[̀-ͯ]/g;
const APOS = /['‘’ʼ`´]/g;
const WORDS = /[a-z0-9]+/g;

/** Lower-case, strip diacritics, drop apostrophes. Applied to BOTH sides of
 *  every comparison, which is the only thing that makes it a fold and not a
 *  guess: Thirty Years' War with a typewriter apostrophe, with a typographic
 *  one, and with none at all all become the same string — and so does the
 *  query, whichever key the reader happened to press. */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(MARKS, '').replace(APOS, '');
}
const toks = (s: string): string[] => fold(s).match(WORDS) || [];

/* ── THE QUERY, PARSED ONCE ─────────────────────────────────────────────────
   queryMatch() is called once per corpus item per paint, so the query is
   parsed once per QUERY and remembered: one slot is enough, because every
   caller in a frame is asking about the same words. */
interface ParsedQ { raw: string; toks: string[]; phrase: string; year: number | null }
const YEAR_Q = /^(-?)(\d{3,4})\s*(bce|bc|ad|ce)?$/;
let _qKey = ' ';
let _q: ParsedQ | null = null;
function parseQ(query: string): ParsedQ | null {
  if (query === _qKey) return _q;
  _qKey = query;
  const raw = fold(query).trim();
  if (raw.length < 2) return (_q = null);           // one letter is not a query
  const t = raw.match(WORDS) || [];
  const m = YEAR_Q.exec(raw);
  const year = m ? (m[1] === '-' || m[3] === 'bce' || m[3] === 'bc' ? -Number(m[2]) : Number(m[2])) : null;
  return (_q = { raw, toks: t, phrase: t.join(' '), year });
}

/** IS THIS A QUESTION ABOUT A YEAR? Exported for the one piece of copy that
 *  needs to know: "keep typing" is useless advice for "1776". */
export function yearOf(query: string): number | null {
  const p = parseQ(query);
  return p ? p.year : null;
}

/* ── THE HAYSTACK, FOLDED ONCE ──────────────────────────────────────────────
   Same reasoning, the other way round: the corpus does not change between
   keystrokes, so each item is folded once and kept against the object itself.
   A WeakMap, so a rebuilt corpus takes its cache with it. */
interface Folded {
  key: string;   // the name as one canonical phrase, "thirty years war"
  n: string;     // ' name ' — space-padded, so ' ' + token tests a word start
  t: string;     // ' name tags '
  a: string;     // ' name tags note '
}
const FOLDS = new WeakMap<object, Folded>();
function folded(h: Haystack): Folded {
  let f = FOLDS.get(h as object);
  if (f) return f;
  const n = toks(h.name || '').join(' ');
  const t = toks(h.tags || '').join(' ');
  const o = toks(h.note || '').join(' ');
  f = { key: n, n: ' ' + n + ' ', t: ' ' + n + ' ' + t + ' ', a: ' ' + n + ' ' + t + ' ' + o + ' ' };
  FOLDS.set(h as object, f);
  return f;
}

/** A token reaches a word by its START. */
const atWord = (hay: string, t: string) => hay.includes(' ' + t);
/** …or, from four letters up, from anywhere inside the NAME. Long enough that
 *  it is a fragment of a word somebody meant, not a syllable found by luck. */
const deep = (name: string, t: string) => t.length >= 4 && name.includes(t);

function textScore(f: Folded, p: ParsedQ): number {
  const T = p.toks;
  if (!T.length) return f.a.includes(p.raw) ? S_NOTE : 0;   // a query with no latin run
  if (T.every(t => atWord(f.n, t) || deep(f.n, t))) {
    if (f.key === p.phrase) return S_NAME_IS;
    if ((f.key + ' ').startsWith(p.phrase + ' ')) return S_NAME_PRE;
    if (f.key.startsWith(p.phrase)) return S_NAME_HEAD;
    if (T.every(t => atWord(f.n, t))) return S_NAME_WORD;
    return S_NAME_IN;
  }
  if (T.every(t => atWord(f.t, t) || deep(f.n, t))) return S_TAGS;
  if (T.every(t => atWord(f.a, t) || deep(f.n, t))) return S_NOTE;
  return 0;
}

/**
 * A YEAR IS A QUESTION ABOUT TIME.
 *
 * "1620 → nothing" was the front door broken: the Battle of White Mountain is
 * in the corpus, dated 1620, and the box could not find it because 1620 is not
 * a substring of "Battle of White Mountain". A year now asks the only question
 * it can mean — what happened then, and what was alive then — and answers in
 * that order: the things dated to it, the things dated beside it, then the
 * spans that contain it (ordered by importance, back in searchCorpus).
 */
function yearScore(h: Haystack, y: number): number {
  const s = h.start;
  if (typeof s !== 'number' || !isFinite(s)) return 0;
  const e = (typeof h.end === 'number' && isFinite(h.end) && h.end !== 0) ? h.end : s;
  if (s === y || e === y) return S_YEAR_AT;
  if (Math.abs(s - y) <= NEAR || Math.abs(e - y) <= NEAR) return S_YEAR_NEAR;
  if (s <= y && y <= e && e - s <= LONGEST) return S_YEAR_IN;
  return 0;
}

/**
 * DOES THIS WORD MATCH THIS THING, AND HOW WELL? 0 is no; bigger is better.
 *
 * The single matcher behind every search surface in the app — this file's
 * content rows and view rows, and timeline.ts's canvas dimming. If it lights on
 * the canvas it is in the list, and if it is in the list it lights: that is the
 * whole contract, and it is only true while there is one function.
 */
export function queryMatch(hay: Haystack, q: string): number {
  const p = parseQ(q);
  if (!p) return 0;
  const s = textScore(folded(hay), p);
  if (p.year === null) return s;
  const y = yearScore(hay, p.year);
  return y > s ? y : s;
}

export interface Hit {
  id: string;
  name: string;
  start: number;
  end: number;
  cat: string;            // a CATS id, for the colour dot
  lane: string | null;    // the band it lives in, spelled the way the canvas spells it
  kind: string;           // polity | spread | belief | life | moment | episode …
  lvl: number;            // 1..5, the importance ladder — the tie-break
}

/* WHAT relDir CALLS A NOTE IS SOMETIMES TAGS. The directory carries one text
   field per entry and fills it from two different slots: a polity, a spread or
   a belief hands over its NOTE, while an event, an entity or a curated lane
   member hands over slot [5] of its tuple, which is its TAGS. They rank
   differently — a word in the tags is a word somebody chose to file it under —
   so the split is made here, once per entry, and cached beside the fold. */
const HAYS = new WeakMap<object, Haystack>();
function hayOf(d: DirEntry): Haystack {
  let h = HAYS.get(d as object);
  if (h) return h;
  const isNote = d.kind === 'polity' || d.kind === 'spread' || d.kind === 'belief';
  const text = d.note || '';
  h = {
    name: d.name || '',
    tags: isNote ? '' : text,
    note: isNote ? text : '',
    start: d.start, end: d.end,
  };
  HAYS.set(d as object, h);
  return h;
}

/**
 * THE RANKING is queryMatch's tiers, and inside a tier the more important thing
 * first — because a query that matches forty things should put the Roman Empire
 * above a minor treaty that happens to share a syllable, and a year that
 * matches two hundred should lead with what was standing rather than with
 * whatever the directory happens to iterate first. Ties break alphabetically so
 * the list is stable between keystrokes rather than shuffling under the cursor.
 */
export function searchCorpus(query: string, cap: number): { hits: Hit[]; total: number } {
  if (!parseQ(query)) return { hits: [], total: 0 };

  const scored: { h: Hit; s: number }[] = [];
  for (const [id, d] of relDir) {
    const s = queryMatch(hayOf(d), query);
    if (!s) continue;
    const sub = describe(id);
    scored.push({
      s,
      h: {
        id, name: d.name || '', start: d.start, end: d.end,
        cat: sub ? sub.cat : 'power',
        lane: sub ? bandLabel(sub) : null,
        kind: sub ? sub.type : d.kind,
        lvl: sub ? sub.lvl : 3,
      },
    });
  }
  scored.sort((a, b) =>
    b.s - a.s
    || a.h.lvl - b.h.lvl
    || (a.h.name < b.h.name ? -1 : a.h.name > b.h.name ? 1 : 0));

  /* ONE ROW PER THING. The directory is keyed by id, and the same thing can
     hold two: the People's Republic of China is a polity AND the event that
     founded it, Ancient Egypt is a polity AND a spread. Both are legitimate
     ids with their own relations — but as two adjacent rows reading exactly
     the same, they are a list that looks broken. Deduped AFTER the sort, so
     the survivor is the better-ranked of the pair (the polity, which carries
     the map and cube joins, over the bare event). */
  const seen = new Set<string>();
  const hits: Hit[] = [];
  let total = 0;
  for (const x of scored) {
    const k = x.h.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    total++;
    if (hits.length < cap) hits.push(x.h);
  }
  return { hits, total };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LANES ARE ANSWERS TOO.

   The founder: "so that I can type in also categories like 'Literature' and it
   will enable me to add it as a new lane. […] I could also search for existing
   lane, which would just highlight it."

   Twelve curated lanes and nineteen layers sit in a library behind a "+ Add
   layer" popover, and the only way to learn that Literature exists at all is to
   open that popover and read the list. But the reader already has a box that
   takes any word in the app — so the word "literature" should reach the lane,
   not just the four literary movements inside it.

   TWO WORDS PER LAYER, NOT ONE. A layer is a SUBJECT × A KIND, and a person
   types either half: "czech" is a subject, "wars" is a kind, "religion" is
   both. So each layer carries its name plus the vocabulary of its subject and
   its facet, and a query is tried against the name first (where a match is
   strong evidence) and the vocabulary second (where it is a hint).
   ═══════════════════════════════════════════════════════════════════════════ */

/** What a person might type for a BAND. Never shown — only matched against. */
const SUBJECT_WORDS: Record<string, string> = {
  CO: 'deep time prehistory geology cosmos universe earth evolution origins big bang',
  EU: 'europe european western west',
  ME: 'middle east africa african arab arabic islamic near east mideast egypt',
  AS: 'asia asian east china chinese india indian japan japanese',
  AM: 'americas america new world latin north south indigenous',
  MU: 'music musical composers song sound',
  SC: 'science ideas thought discovery knowledge',
  MZ: 'mozart composer classical music biography person life',
  AR: 'arts art movements painting style styles aesthetics visual culture',
  DS: 'design graphic industrial typography product craft objects',
  LT: 'literature literary books writing novels poetry authors letters fiction',
  FM: 'film cinema movies motion pictures directors screen',
  RL: 'religion religions faith belief beliefs church spiritual gods theology sacred',
  PH: 'philosophy philosophers thought thinkers metaphysics ethics logic ideas',
  PI: 'political ideologies politics ideology isms doctrine government left right',
  EC: 'economics economy money trade markets finance capital business',
  TE: 'technology tech engineering machines invention industry tools computing',
  MD: 'medicine medical health disease doctors surgery epidemics public health',
  EX: 'exploration voyages discovery travel navigation expeditions explorers seafaring',
  CZ: 'czech czechia bohemia bohemian moravia prague czechoslovakia national',
};
/** What a person might type for a KIND. */
const FACET_WORDS: Record<string, string> = {
  ess: 'essentials overview turning points basics highlights spine main',
  sci: 'science scientific technology discovery invention knowledge research',
  war: 'war wars battle battles conflict military campaign army',
  art: 'art arts culture cultural painting architecture music literature',
  pol: 'states empires empire polities dynasties nations kingdoms government power realms',
  all: '',
};

export interface LayerHit {
  id: string;
  name: string;
  si: number | null;      // swatch index for the dot, the panel's own colour
  n: number;              // corpus size — what adding it actually puts on screen
  on: boolean;            // already on the board?
  hidden: boolean;        // on the board with its eye shut
  lead: boolean;          // an exact-ish NAME match: this outranks content
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * THE LAYER RANKING, in four tiers:
 *
 *   0  the name IS the query, or the query is the whole first word of it
 *      ("literature" → Literature, "czech" → Czech history, "arts" → Arts &
 *      movements). Only this tier leads the whole dropdown — typing a lane's
 *      name is not ambiguous, and making you arrow past ten movements to reach
 *      the lane you just named would be the wrong default.
 *   1  a word inside the name starts with it ("art" → Art & culture)
 *   2  the name contains it anywhere
 *   3  only the subject/kind vocabulary matches ("movies" → Film)
 *
 * A layer with an EMPTY corpus is never offered: MU/SC ship as registry
 * built-ins with no members, and a row that adds a lane which then draws
 * nothing is the phantom-zoom bug wearing a different hat.
 */
export function searchLayers(query: string, cap: number): LayerHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const word = new RegExp('\\b' + esc(q));
  const scored: { h: LayerHit; tier: number }[] = [];
  for (const d of layerDefs()) {
    if (!d.n) continue;                                     // nothing to draw — not an answer
    const name = d.name.toLowerCase();
    let tier = -1;
    if (name === q) tier = 0;
    else if (name.startsWith(q) && !/[a-z0-9]/.test(name[q.length] || '')) tier = 0;
    else if (word.test(name)) tier = 1;
    else if (name.includes(q)) tier = 2;
    else if (word.test((SUBJECT_WORDS[d.subject] || '') + ' ' + (FACET_WORDS[d.facet] || ''))) tier = 3;
    if (tier < 0) continue;
    scored.push({
      tier,
      h: {
        id: d.id, name: d.name, si: d.si, n: d.n,
        on: Layers.has(d.id), hidden: Layers.has(d.id) && !Layers.visible(d.id),
        lead: tier === 0,
      },
    });
  }
  // inside a tier the bigger lane first — "art" should reach the 33-member Arts
  // lane before a four-mark regional facet — then alphabetically, so the list
  // does not shuffle under the cursor between keystrokes.
  scored.sort((a, b) =>
    a.tier - b.tier
    || b.h.n - a.h.n
    || (a.h.name < b.h.name ? -1 : a.h.name > b.h.name ? 1 : 0));
  return scored.slice(0, cap).map(x => x.h);
}
