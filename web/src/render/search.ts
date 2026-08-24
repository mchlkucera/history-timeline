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

  return { hits: scored.slice(0, cap).map(x => x.h), total: scored.length };
}
