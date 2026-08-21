/* =============================================================================
   fold.ts — THE ZONE-CAP FOLD.

   A dynasty's founding is not a separate fact from the dynasty. "Qin unifies
   China, 221 BCE" and the Qin dynasty rectangle that starts at 221 BCE are ONE
   thing drawn twice: a dot in the event stratum and the left edge of a spread
   two rows above it. Two marks, one fact, and the dot is the weaker of the two
   because it says less.

   So a founding/dissolution event that duplicates a spread's cap stops being a
   standalone dot and becomes part of the spread: named in its tooltip, named in
   its selection card, still findable by search (the hit selects the parent).

   THE TABLE IS EXPLICIT AND HAND-CURATED, never inferred. A mechanical
   "same-lane spread whose start is within N years" scan over this corpus
   returns 60+ pairs, nearly all of them wrong: it folds "Athenian democracy"
   into the Roman Republic (−508 vs −509) and "Waterloo" into the Holy Roman
   Empire. The candidate list is the flag:true entries of data/cat-*.json —
   the classifier's own "this duplicates a spread" flag — curated down by hand
   to the pairs where the event asserts NOTHING the spread's cap does not.

   AND THE FOLD IS PER-FRAME, not per-corpus: timeline.ts folds a dot only when
   the parent spread is actually drawn in that lane in that frame. Zoom out far
   enough that the Qin dynasty's 15 years fall below the level of detail and the
   dot comes back, because at that zoom it is the only mark carrying the fact.
   ============================================================================= */

export type FoldRole = 'founding' | 'dissolution';
export interface FoldEntry { spread: string; role: FoldRole }

/**
 * event title (EVENTS slot 2, verbatim) -> the spread it caps.
 *
 * Curated from the 25 flag:true entries in data/cat-*.json plus the founder's
 * own "USSR founded". The eleven flagged entries that are ZONES rather than
 * moments are not here — a zone is already a spread, so it is a duplicate
 * SPREAD, not a duplicate dot; those are handled by same-as links in
 * data/relations/links.json instead.
 */
export const FOLD: Record<string, FoldEntry> = {
  // ── Europe ────────────────────────────────────────────────────────────────
  'USSR founded': { spread: 'polity:soviet-union', role: 'founding' },
  // ── MidEast & Africa ──────────────────────────────────────────────────────
  'Egypt unified under one crown': { spread: 'polity:ancient-egypt', role: 'founding' },
  'Cyrus founds the Persian Empire': { spread: 'polity:achaemenid-persia', role: 'founding' },
  'State of Israel founded': { spread: 'polity:israel', role: 'founding' },
  // ── Asia ──────────────────────────────────────────────────────────────────
  'Qin unifies China': { spread: 'polity:qin-dynasty', role: 'founding' },
  'First shogunate in Japan': { spread: 'polity:kamakura-shogunate', role: 'founding' },
  'Genghis Khan unites the Mongols': { spread: 'polity:mongol-empire', role: 'founding' },
  // 1279 is the Song's last year exactly; the Yuan was proclaimed in 1271, so
  // this is a dissolution cap, not a founding one.
  'Mongols rule all of China': { spread: 'polity:song-dynasty', role: 'dissolution' },
  'Ming dynasty founded': { spread: 'polity:ming-dynasty', role: 'founding' },
  'Mughal Empire founded': { spread: 'polity:mughal-empire', role: 'founding' },
  'Tokugawa shogunate — Japan closes': { spread: 'polity:tokugawa-shogunate', role: 'founding' },
  'Qing dynasty takes China': { spread: 'polity:qing-dynasty', role: 'founding' },
  'India independent, partitioned': { spread: 'polity:republic-of-india', role: 'founding' },
  "People's Republic of China": { spread: 'polity:peoples-republic-of-china', role: 'founding' },
};

/**
 * Candidates deliberately LEFT AS DOTS, with the reason — so the next pass does
 * not have to rediscover why. Exported because the acceptance report reads it.
 */
export const FOLD_UNMATCHED: [string, string][] = [
  ['Dutch found Cape Colony', 'no Cape Colony spread exists in the MidEast & Africa lane — the Dutch empire is a Europe-lane polity'],
];

/** The fold entries whose parent spread lives in this lane's corpus. */
export function foldsInto(spreadId: string): string[] {
  const out: string[] = [];
  for (const t in FOLD) if (FOLD[t].spread === spreadId) out.push(t);
  return out;
}

export const foldOf = (title: string): FoldEntry | undefined => FOLD[title];
export const FOLD_TITLES = new Set(Object.keys(FOLD));
export const roleWord = (r: FoldRole) => (r === 'founding' ? 'Founded' : 'Ended');
