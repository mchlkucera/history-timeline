# Backlog

Things deliberately deferred, with enough context to act on cold. Not a wish
list — every item here was hit in real use or found by measurement, and says
what is actually blocking it.

---

## Flow — events, to explain the forks

Flow draws lineage: ribbons split and merge along real succession. It shows
**that** a polity fractured and never **why**. The Habsburg split, the fall of
Rome into East and West, the partitions of Poland — the fork is drawn, the cause
is not.

Events are already in the corpus with dates and categories, and the timeline
draws them as dots. Putting the relevant ones on the flow, at the fork, would
make the view answer "what caused this" rather than only "what happened to it".

Open questions when this is picked up:

- **Which events?** Every event in the span would bury the ribbons. The honest
  filter is probably the relation corpus — `relations.json` already links events
  to polities, so an event that a fork's parent or child is *linked to* is a
  candidate, and one that merely happened nearby is not.
- **Drawn where?** At the fork itself, or on a stratum of its own like the
  timeline's event row? At the fork is more explanatory and more crowded.
- **What about forks with no linked event?** Most of them, currently. The view
  must not imply that an unexplained fork is uncaused — silence has to read as
  "we do not hold the reason" rather than "there was none".

---

## The lane picker card

Prototype built and committed at `experiments/lanepicker/` — four arrangements
on the real corpus and the real tokens, **design D recommended and first on the
page**. Awaiting a decision before anything touches the app.

D is: the card's existing destination strip is the list of views; under
**Timeline**, and only there, it opens into the lane names this subject belongs
to. Two states — on your board, or press to add. Names only, no counts, no
reasons.

The model change it implies is written into the prototype page. The short
version: `factsOf()` stops returning one lane and returns a ranked list; it needs
a `belief:` branch so belief streams stop resolving to `never`; and lane
membership needs somewhere to live, since nothing stores it today.

---

## Curation, and the query-vs-list question

Deferred by decision: *"Curated and derived lanes can coexist perfectly fine, but
let's keep the curation for the next version."* Lanes are hand-made **lists** for
now.

The thing to remember when it comes back: curation was defined as *"just choosing
what you see"* from the source data — which makes a curated lane a **saved
query**, not a second kind of object. A Habsburg lane, a self-curated esoteric
lane and a derived region lane are then one mechanism with different predicates.

The cost of the query model, worth deciding deliberately: a lane defined as a
rule **gains members on its own** as the corpus grows. Powerful, and slightly out
of the reader's control — the lane you built an understanding of a period on can
quietly become a different lane.

---

## Data gaps — measured, not impressions

The corpus is **476 things**. These are the specific holes found while auditing
the lanes:

- **The Buddha and Confucius have no rows anywhere.** The Religion lane's own
  Axial Age note names *"the Buddha, Confucius, the Hebrew prophets and Greek
  philosophy"* — it names the gap it does not fill.
- **Gandhi appears nowhere** in the 410-row curated corpus.
- **Religion's gap is East Asia**, not the West. Its real European/American share
  is ~17 of 40; the rest are Levantine, Mesopotamian, Persian, Indian, Egyptian.
  Six traditions are represented, none of them Chinese.
- **Literature cannot be named honestly without backfill.** It opens with
  Gilgamesh and Genji, so "Western literature" would be a visible lie — but
  "Literature" is a promise it does not keep: zero Chinese, Arabic, Persian or
  African. The fix is about four rows, not one word.
- **Printing erases the Chinese precedent.** Technology credits paper and
  gunpowder to China but files movable type at Mainz 1450, with no Bi Sheng
  (1040) and no Korean Jikji (1377).
- **Political ideologies has no pre-modern thought at all** — everything starts
  1685.

---

## Retire `band`

Every event tuple carries a band in slot 3, and it does exactly one job:
`layerIdFor(band, cat, type)` computes the derived lane. Two problems:

- **It mixes axes.** `EU/ME/AS/AM` are regions; `CO`, `MU`, `SC`, `MZ` are
  themes. That is why **Mozart has no region at all** — banded `MU`, so his place
  is never asked for — and why "Mozart as part of Austria" cannot be expressed.
- **Eight buckets for the whole world**, with Africa folded into the Middle East.

The replacement is an entity's actual place plus its actual domain, as two
separate fields. Cheaper to do during a data ETL than before one.

---

## Smaller, verified, and cheap

- **`rail.ts`'s `SNAPSHOTS` duplicates `ATLAS_YEARS` and disagrees with it** —
  the atlas's turn-of-era snapshot is `-1` (1 BCE), the rail engraves `1` (1 CE).
  One-line dedup: `export const SNAPSHOTS = ATLAS_YEARS;`
- **The cube has ~25 controls** in one panel with no hierarchy — projection,
  views, sovereign, lineage, chain, mode, disc cut, cut lo/hi, caps, slice, step,
  play, resolution, spacing, ghost, outlines, spin. Group them or cut them.
- **`textW`'s memo is never cleared** anywhere except in `connections.ts`, where
  a webfont landing after first measure made labels draw through each other. The
  other views may have the same latent bug.
- **`allConnections()` may now be unreachable** — the card's "All N →" button was
  removed (it was dead on 7 of 10 views) and the Related list lives permanently
  in the field notes. Confirm and delete if so.
