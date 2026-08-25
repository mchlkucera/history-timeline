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

   This module is therefore thin on purpose: it is a RANKING, not a second
   corpus. It reads the same directory the Related panel reads, so a thing that
   can be searched is exactly a thing that can be selected — there is no way for
   the two to drift apart.

   NOTHING HERE TOUCHES timeline.ts. The dropdown is chrome, it is drawn by
   Lab.tsx, and the canvas keeps its own dimming behaviour untouched.
   ============================================================================= */

import { Layers, layerDefs } from './layers';
import { relDir } from './relations';
import { bandLabel, describe } from './subject';

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

/**
 * THE RANKING, in the order a person means when they type three letters:
 *
 *   1. the name STARTS with the query      ("rom" → Roman Republic)
 *   2. a WORD in the name starts with it   ("rev" → French Revolution)
 *   3. it appears anywhere in the name     ("volut" → …Revolution)
 *   4. only the NOTE mentions it           ("plague" → Black Death)
 *
 * and inside each tier, the more important thing first — because a query that
 * matches forty things should put the Roman Empire above a minor treaty that
 * happens to share a syllable. Ties break alphabetically so the list is stable
 * between keystrokes rather than shuffling under the cursor.
 *
 * THE NOTE TIER EXISTS BECAUSE THE CANVAS HAS IT. timeline.ts lights a mark
 * when the query is in its name, its tags OR its note, and the box's own
 * placeholder offers "plague" as an example — a word that appears in no title
 * in the corpus. A dropdown that answered "nothing" while the canvas lit up the
 * Black Death behind it would be two different searches wearing one box.
 */
export function searchCorpus(query: string, cap: number): { hits: Hit[]; total: number } {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { hits: [], total: 0 };      // one letter is not a query

  const scored: { h: Hit; tier: number }[] = [];
  for (const [id, d] of relDir) {
    const name = d.name || '';
    const i = name.toLowerCase().indexOf(q);
    let tier: number;
    if (i >= 0) tier = i === 0 ? 0 : /[\s(–—-]/.test(name[i - 1]) ? 1 : 2;
    else if ((d.note || '').toLowerCase().includes(q)) tier = 3;
    else continue;
    const s = describe(id);
    scored.push({
      tier,
      h: {
        id, name, start: d.start, end: d.end,
        cat: s ? s.cat : 'power',
        lane: s ? bandLabel(s) : null,
        kind: s ? s.type : d.kind,
        lvl: s ? s.lvl : 3,
      },
    });
  }
  scored.sort((a, b) =>
    a.tier - b.tier
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
