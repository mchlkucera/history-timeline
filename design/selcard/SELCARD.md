# The selection card

**Component spec + working prototype. Design system: _Survey_.**
Another agent integrates this. Everything below that describes behaviour is a
requirement, not a suggestion; everything that describes looks is already in
`selcard.css`.

| file | what it is |
|---|---|
| `SELCARD.md` | this — hierarchy, action model, states, sizing, motion, the markup contract |
| `selcard.css` | the component. `tl-selcard*` only, built entirely on `../tokens.css`, no new colour |
| `preview.html` | eight real states, both themes live on one page, real corpus content |
| `shots/` | rendered proof — see below |

```
shots/
  preview-{light,dark}-1440.png      the whole review page, full height, 1440 wide
  viewport-{light,dark}-1440x900.png the same at exactly 1440 × 900
  row-{a,g,b,c,d,e,h,f}-{light,dark}.png   one specimen per file, both themes side by side
  sheet-{light,dark}-390x844.png     the bottom sheet at an honest phone viewport
  focus-dest.png  focus-row.png      keyboard focus on a destination cell and on a relation row
```

---

## 1. The verdict, and what it is actually a symptom of

> "The whole card actions are not too UX friendly. Get an UX/UI designer idea to
> make the card useable, easy to scan, use, straightforward."
> — and specifically: **"Zoom to Polish-Lithuanian Commonwealth"** should read
> "Zoom to view" or similar.

The absurd label is real, but it is the fourth-worst thing about that row. What
is actually wrong:

1. **The row is a wrapping bin.** Four buttons, all `flex: 1 1 auto`, in a 288px
   card. They wrap into a ragged 2×2 whose cells are different widths and whose
   first cell is "primary" only because it happens to be first. Four rectangles
   of near-equal weight is *zero* hierarchy, which is exactly what "not
   straightforward" feels like from the inside.
2. **Every label starts with the same word.** `Zoom to view` / `See on map` /
   `See on cube` / `Drill down`. The differentiating word is at the **end** of
   each phrase, so scanning the row means reading four phrases to their last
   syllable. The verbs are all synonyms of *look* — they carry no information.
   The **destination** is the information, and it was buried.
3. **The subject's name in a button is a category error.** It is already the
   biggest thing on the card, 20px above. Repeating it produces the
   40-character label the founder tripped over, and it is redundant in every
   case, not just the long ones.
4. **The honest line is set in the least legible type on the card** (10px,
   tertiary ink, in a grey well) even though it is the one fact that decides
   whether two of the four buttons will do anything at all.
5. **Nothing on the card locates the subject in time relative to you** — in an
   app whose entire subject is "where and when am I".
6. **The verb flips per view.** `Zoom to view` on the timeline, `See on
   timeline` on the map, `Drill down` vs `Drill down here`. Three special cases
   maintained by hand, all of them consequences of putting a verb where a noun
   belongs.

---

## 2. The model: one verb, four instruments

**These are not four commands. They are one command — _look at this_ — through
four of the app's own five views.**

The top rail already prints `MAP · TIMELINE · FLOW · CUBE · CORE`. The card's
actions *are* that switcher, re-pointed at the object you clicked. So the card
stops trying to phrase four sentences and instead says one thing:

```
Show this in
┌──────────────┬────────┬────────┬────────┐
│ TIMELINE  ↵  │  MAP   │  CUBE  │  CORE  │
└──────────────┴────────┴────────┴────────┘
   ink block      surface   surface  surface
```

Everything the verdict complains about falls out of this:

- **The subject's name never appears in an action.** It cannot. There is no
  slot for it. "Zoom to Polish-Lithuanian Commonwealth" is not shortened, it is
  structurally impossible.
- **Scanning drops from four phrases to four nouns**, and the nouns are already
  in the user's head from the top rail.
- **The awkward middle number goes away.** A row of 4–5 buttons is awkward; a
  segmented control of 3–5 cells is the shape a segmented control is *for*.
- **The verb flip dies.** The card looks identical on the timeline and on the
  map; only which cell is marked "you are here" changes. Three hand-maintained
  special cases become one attribute.
- **It teaches the top rail.** `CORE` is the most obscure tab in the app.
  Seeing it, spelled the same way, on every card you open — with a tooltip that
  says "every sovereign that ever held that ground" — is the cheapest possible
  onboarding for it.

**The fifth action is not a fifth cell.** "Reveal the full ranked relations in
the docked panel" does not open a view; it expands a block that is already on
the card. It belongs to that block, in its section header, where every "more"
affordance belongs. Four destinations plus one expander — the expander was
never a peer of the other four, and treating it as one is what made five feel
like an awkward number.

---

## 3. The seven questions

### 3.1 What is the visual hierarchy? What does the eye hit first?

**The name is first in reading order and first in size, and deliberately *not*
the loudest object on the card.**

You clicked this thing on purpose. You read its label on the canvas or hovered
its tooltip a half-second ago. The name is **confirmation**, not news — so
spending the card's loudest voice on it (18px semibold, as today) is spending
it on the one fact the user already has. But it cannot be small either: it is
the card's identity, and when the anchor scrolls off-screen the name is the
only thing tying the card to a thing.

So the name drops to `--tl-text-md` (15px) semibold and the loudness moves one
line down, to the object that carries the fact the user *doesn't* have:

```
 ● Power & states · polity · Europe                        ×     ← 11px, ink-3
 British Empire                                                  ← 15px semi, ink
 ▏╷╷╷╷▕╷╷╷▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▕╷╷╷╷▏              ← THE SPAN STRIP
 1707 – 1997                                        1783
 the largest empire in history, ruling a quarter …               ← 12px, ink-2
 Show this in
 [ TIMELINE ↵ ][ MAP ][ CUBE ][ CORE ]
 CONNECTIONS                                       ALL 7 →
 Industrial Revolution              part-of  ▇▇▇▇▇▇▇▇
 …
```

The first *fixation* is the name (biggest, darkest). The first *information* is
the span strip — the only graphic and the only colour on the card. That order is
correct for something you clicked deliberately: confirm identity in 100ms, then
get the answer you came for.

Three structural decisions make it hold:

- **The two quietest elements share the top line.** The domain marker and the
  close button are both small and grey, so they pair; the name below gets the
  full 294px and a forty-character title never has to wrap around a floating
  ×. (Today the × sits in the name's row and pinches it.)
- **Two competing uppercase runs collapse to one sentence-case line.** Today the
  category is a bordered uppercase chip with a colour dot *and* the type/band is
  a second uppercase run beside it: three signals for one fact, twice. It is now
  `● Power & states · polity · Europe`, 11px, sentence case. The dot survives
  because it is the card's legend key (§5).
- **A typographic rule instead of a judgement call:** *uppercase is a signpost,
  sentence case is content, and a measurement is mono.* So `CONNECTIONS` and the
  destination cells are uppercase (they point at places); the domain line, the
  name, the note and "Show this in" are sentence case (they are content); every
  date, distance, count, weight and relation-kind is IBM Plex Mono.

### 3.2 Is one action primary? Which, and how is that expressed?

**No. Superseded — the strip now carries exactly one idea.**

This section used to answer *yes: Timeline, on every view*, expressed as a solid
ink block, while `aria-current` — *you are standing here* — was a 2px bottom
bar. The claim was that fill and underline could never collide because the shell
spends different signals on the two meanings. In use they collided anyway, and
the louder one was wrong: Timeline was the ink block on all eleven views, so it
*read* as the active cell everywhere, while the real active marker was the
quieter of the two. Founder: *"right now it looks like 'Timeline' is always
active … keep inverted background as active state."*

**The inverted cell now means WHERE YOU ARE, and nothing else.** One signal, one
meaning:

| view you are on | inverted cell |
|---|---|
| Timeline (`zoom`) | TIMELINE |
| Map | MAP |
| Cube | CUBE |
| anything else (Flow, Braid, Vertical, …) | none — you are not standing in the strip |

The bottom bar is gone. The `--primary` modifier and the `↵` keycap are gone
with it. Timeline keeps only what §3.4 already gave it: the first slot, always.
The accent is still never spent on a button — minium means *where you are*, and
on this card the focus ring is its only appearance.

### 3.3 Row of buttons, icon cluster, menu, or list?

A **labelled segmented destination group, one row, words only.** Argued against
each alternative:

| | why not |
|---|---|
| **Menu** (`Actions ▾`) | Puts the single most-used interaction in the app behind two clicks and a hidden label. A menu is for things you *might* want; these are the reason the card exists. |
| **Icon-only cluster** | The destinations are app-specific concepts a new user has never met — a cube glyph meaning "your territory extruded through time" is unguessable, and a core-sample glyph doubly so. Tooltips are not labels. It also flattens hierarchy to zero, and one of these is the core loop. |
| **Flat row of equal buttons** (today) | The failure state. Ragged wrapping, no hierarchy, and four labels that can only be told apart by reading to the end. |
| **Vertical list of rows** | Genuinely the most scannable option, and it degrades beautifully — but 4 rows × 32px = 128px, which makes navigation-away the visual bulk of a detail card and pushes the connections under the fold on a laptop. Rejected on budget, not on principle. |
| **Segmented group** ✅ | One row (~32px). Hierarchy expressible without hue. Degradation is a shorter control rather than a broken one. And it tells the truth about the app: these are not four commands, they are four projections of one object. |

**No icons.** Measured: at 11px uppercase the four labels total ~157px, so with
cell padding and hairlines the group is ~240px inside a 294px content column —
comfortable. Adding a 13px glyph and a 6px gap per cell pushes it to ~316px,
which does not fit, and stacking icon-over-label turns a 32px control into a
44px one for no gain. The shell's own switcher is words only; matching it is
both cheaper and more consistent.

### 3.4 How does it degrade?

Three mechanisms, and the rule for choosing between them is **the difference
between _never_ and _not now_**.

| situation | treatment | why |
|---|---|---|
| The action can **never** apply to this kind of thing — a life has no territory, so Map and Cube are meaningless for all 39 lives in the corpus | **Not rendered** | A permanently dead cell teaches the user the app is broken. Two of them on every person, forever, is a tax with no payer. |
| The action applies to this kind of thing but is **empty at the current year** — the Roman Empire has territory, just not in 1783 | **Rendered, greyed, reason on the button** | Hiding it here would be a *lie*: it implies Rome never had a map presence. The user must be able to see that the door exists and is shut. |
| The action's data is missing entirely (no `PLACEMAP` point, no polity centroid) | **Not rendered** | Same as row 1 — for this object there is no such thing as a place, so there is nothing to be shut. |

**Order is never touched.** Timeline, Map, Cube — always, in that order. If
Map is missing, Cube does **not** slide left into its slot; the group just gets
shorter and Timeline is still the first cell. Reordering by relevance makes each
card individually optimal and the set of cards unlearnable. In a control you hit
hundreds of times, position stability beats per-instance optimisation.

**One cell is a button, not a control.** When only Timeline survives (a bare
moment), `:only-child` rounds all four corners and the cell goes full width. A
one-cell segmented control looks like a bug. **Zero cells is not a control
either:** a bare border feature has no destination at all now that Core is cut,
so the whole `__go` block — lead included — is not rendered.

The floor of the design, in full — **Cambrian explosion**, specimen D:

```
 ● Nature & catastrophe · moment · Deep time                 ×
 Cambrian explosion
 ▎╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕▼
 541 million yrs ago                             1783
 Show this in
 [           TIMELINE            ↵ ]
 CONNECTIONS                          None curated yet.
```

No note, no place, no territory, no links — and nothing is greyed, so nothing
reads as broken. It is ~150px tall and it is *complete*: every single thing that
is absent is genuinely absent from the corpus.

### 3.5 How is "not present at the current year" expressed?

**As a picture first, a measurement second, and never as a warning.**

The card's one graphic is a **span strip**: a miniature of the shell's signature
object, the engraved time rail, scoped to this object's life. Minor ticks every
10% rising from a hairline baseline, the subject's extent as a solid ink bar,
and the current global year as the same minium index the rail flies — a filled
triangle over a 1px hairline.

This is the **only legal place for the accent on this card**, and it is legal
precisely because it means what minium always means: *where you are.* Not on a
button; on a scale.

So "you are outside its span" is a **picture**: the index simply sits in the
empty margin past the end of the bar. You see it before you read anything.

Underneath, one line of mono. **Superseded in part:** it used to also print the
DISTANCE from the year you are standing on to the subject's span — `ended 1,388
yrs before 1783`, `begins 139 yrs after 1783`. The founder cut those, and he was
right: both dates and the current year are already on the line directly above,
so the sentence was arithmetic the reader had already done. What is left is the
one thing the dates cannot give you —

```
3 territories shown at 1880        ← map view: what is actually on screen
not on the map at 1776 (nearest snapshot 1783)
48.20°N · 16.37°E                  ← a nameless patch of the atlas: where it is
```

— because the map draws one of eighteen atlas snapshots, and which one, and
whether anything of this subject is in it, is derivable from nothing else on the
card. The line is emitted on the map view only, plus the coordinate case.

**Deliberately: no box, no tint, no icon, no accent.** Today's version sits in a
grey well, and a well reads as exception handling. An absence in a historical
atlas is *data*, not an error — Rome not being on the 1783 map is the single
most ordinary fact in the corpus. It is a measurement, so it is mono, and it
sits inside the span strip because it is the caption of the strip.

**It is an invitation only in the sense that the answer is directly underneath
it.** The presence line sits immediately above the destination group, whose
ink-filled first cell reframes the timeline onto the object's own span. The card
does **not** get a "travel to its peak" control: `selcard.ts` deleted exactly
that button because it was the one control that wrote the year, and the
centre-year rule made it a second, contradictory way to say the same thing. That
deletion stands. Framing the era moves the window; the year follows the window.

**And the absence does not gut the card.** Exactly one of the three destinations
is year-sensitive:

| destination | year-sensitive? |
|---|---|
| Timeline | no — it *moves* the year |
| **Map** | **yes** — it draws the nearest of eighteen snapshots |
| Cube | no — it traces the whole life as a solid |

So the Roman Empire at 1783 keeps two live destinations and greys one, with
its reason on the button. The old card let you press "See on map" and land on a
map with nothing highlighted.

### 3.6 What does the relations preview earn its space with?

Links are explicitly garnish to this founder, so the preview has to buy ~120px
with something a bare count cannot give. A count is the worst possible
affordance: it costs a click to discover whether the click was worth it.

**It earns it by being a ranked micro-chart rather than a list of links.** Each
row carries three things in one line:

```
Industrial Revolution              part-of  ▇▇▇▇▇▇▇▇
Railways                            origin  ▇▇▇▇▇▇
The Atlantic slave trade           part-of  ▇▇▇▇▇▇
Telegraph and telecommunications   part-of  ▇▇▇▇▇
```

- **the counterpart** — what
- **the kind** — `origin` vs `opposed-to` vs `caused` is a completely different
  fact about the same pair, and it is the part a name alone destroys
- **the weight, as a bar** — right-aligned, so four rows form a little histogram
  down the right edge. You learn the *shape* of the object's neighbourhood in
  one fixation: one dominant tie, or four even ones. Specimen H shows why this
  matters — a 0.15 "caused" link, which a bare list would present as the equal
  of the 0.75 above it.

The bar is **ink at one value on a neutral track, never a kind hue.** The docked
Related panel colours its bars by relation kind using data hues; the card must
not, because a `--tl-cat-*` may only ever appear as a legend key (DESIGN.md §3),
the card carries no legend to decode a hue against, and at 3×34px a hue is
unreadable anyway. Length is the whole signal — form, not colour, exactly as
confidence is.

**"All N" lives in the section header, not under the last row.** A "more"
affordance belongs with the thing it expands, it stays above the fold when the
list scrolls, and it leaves nothing orphaned at the bottom of the card. When
there is nothing curated, the header absorbs the empty state and the whole block
costs **one line**:

```
CONNECTIONS                        None curated yet.
```

"Yet" is doing work: the corpus is growing, and a subject with no curated links
is not thereby unimportant.

### 3.7 Sizing — what is the maximum, and what scrolls?

| | value | reason |
|---|---|---|
| **width** | **320px**, fixed | 294px of content: the four destination cells fit on one row with ~54px to spare, and the note runs ~44 characters. At 1280×800 that leaves 960px of canvas — 688px even with the 264px control column docked. At 288px (today) the destination group would be the thing that wraps. |
| **max height** | **`min(58vh, 480px)`** | 464px on an 800px laptop, against 692px of canvas between the two rails. The card is a transient detail surface dismissed by Esc; ~13% of canvas at a typical 360px height, 19% at the cap. |
| **min height** | none | it is as short as its content — 150px for a bare moment |
| **narrow (<760px)** | full-width sheet, **`max-height: 56dvh`**, 12px top corners, grip, sitting on the time rail | one sheet grammar on a phone rather than two. At 390px the four cells get ~90px each at a 36px touch height; nothing reflows to a second row. |

Measured on the rendered specimens: 320 × **231–393px** across all eight
desktop states, and 390 × 408px as a sheet. Nothing reaches the cap, nothing
clips, and no destination label wraps at any width — the widest cell is
`TIMELINE ↵` at 110px inside a 294px group.

**What scrolls: only the connections list.**

The card is a three-part flex column — `head` (`flex: none`), `go`
(`flex: none`), `rels` (`flex: 0 1 auto; min-height: 0; overflow-y: auto`). The
identity, the measurement and the **actions** can never be scrolled out of
reach; a card that scrolls its own purpose away is the failure we are fixing.
When the card is squeezed — and `selcard.ts` *does* squeeze it, setting an
inline `max-height` when a wide subject leaves only a shallow gap — the
connections list gives up its height first and scrolls inside itself, down to
nothing. Name, span, presence and destinations survive to a card ~190px tall.

The inline `max-height` the placement code sets beats the stylesheet's by
specificity, which is intended; the CSS uses `max-height`, never `height`.

---

## 4. Motion

Everything is on the shell's own duration tokens, so `prefers-reduced-motion`
is already handled at the token level (`--tl-dur-* → 0.01ms`) and this file has
no motion override of its own — the house rule.

| event | motion |
|---|---|
| card appears | 120ms fade + a 5px translate **out of the thing it names**. The app sets `data-side="l\|r\|t"` from the side it placed the card on; the keyframe travels from that edge. |
| year changes while open | the span index slides, 180ms, same easing as the rail index — it is the same object |
| hover | colour only (house rule) |
| sheet appears | 180ms up from the bottom edge |
| everything else | nothing. No skeletons, no staggered rows, no attention pulses |

---

## 5. Colour budget

| | count | where |
|---|---|---|
| **chrome accent** (minium) | **2 marks** | the span index (triangle + hairline); the keyboard focus ring. Both are "where you are", both are sanctioned by DESIGN.md §7. |
| **data hue** (`--tl-cat-*`) | **1** | the 7px domain dot, set inline as `--tl-dot`. This is the card's legend key — the one thing that lets you match the card to the mark you clicked. It is the only sanctioned crossing, and it may never become a fill, a border, a bar or a state. |
| everything else | — | the neutral ramp, fill vs outline, and form |

No button on this card is accented. No relation bar is hued. The presence line
is not tinted. There is no second accent, and `tokens.css` carries the warning
at the declaration site.

`selcard.css` contains exactly two literal colour values, both
`rgba(128, 128, 128, …)`, and both lifted verbatim from `shell.css`'s
`.tl-btn--primary`: a hueless grey overlay that darkens a light ink block and
lightens a dark one from one declaration. It is the house's own theme-agnostic
press state, not a new value. Every other colour in the file resolves to a
`--tl-*` token — `grep -E '#[0-9a-f]{3}|hsl' selcard.css` returns nothing.

---

## 6. The markup contract

This is what the integration must emit. Classes are exhaustive; anything not
listed does not exist.

```html
<div class="tl-selcard" data-side="r" role="dialog" aria-label="British Empire">
  <div class="tl-selcard__grip" aria-hidden="true"></div>          <!-- sheet only -->

  <div class="tl-selcard__head">
    <div class="tl-selcard__top">
      <div class="tl-selcard__meta" style="--tl-dot: var(--tl-cat-power)">
        <span class="tl-selcard__dot" aria-hidden="true"></span>
        <b>Power &amp; states</b> · polity · Europe
      </div>
      <button type="button" class="tl-selcard__x" aria-label="Close" title="Close  Esc">…</button>
    </div>

    <h3 class="tl-selcard__name">British Empire</h3>

    <div class="tl-selcard__span" data-kind="span"
         style="--sc-a:8.3%; --sc-b:91.7%; --sc-i:30.2%">
      <div class="tl-selcard__track" aria-hidden="true">
        <span class="tl-selcard__life"></span>
        <span class="tl-selcard__idx"></span>
      </div>
      <div class="tl-selcard__ends"><b>1707 – 1997</b><span>1783</span></div>
      <div class="tl-selcard__present">3 territories shown at 1880</div>   <!-- optional -->
    </div>

    <p class="tl-selcard__note">…</p>                               <!-- optional -->

    <div class="tl-selcard__folds">                                 <!-- optional -->
      <div class="tl-selcard__fold"><b>Founded</b> — Qing dynasty takes China, <time>1644</time></div>
    </div>
  </div>

  <div class="tl-selcard__go">
    <span class="tl-selcard__lead" id="showin">Show this in</span>
    <div class="tl-selcard__dests" role="group" aria-labelledby="showin">
      <button type="button" class="tl-selcard__dest" data-act="persp"
              title="Frame the timeline on 1417 – 2287 — what else was going on">Timeline</button>
      <button type="button" class="tl-selcard__dest" data-act="map"  aria-current="true" title="…">Map</button>
      <button type="button" class="tl-selcard__dest" data-act="cube" title="…">Cube</button>
    </div>
  </div>

  <div class="tl-selcard__rels">
    <div class="tl-selcard__relshd">
      <span class="tl-selcard__section">Connections</span>
      <button type="button" class="tl-selcard__all" data-act="all">All 7 →</button>
    </div>
    <ul class="tl-selcard__rellist">
      <li><button type="button" class="tl-selcard__rel" data-goid="spread:industrial-revolution">
        <span class="tl-selcard__rel-n">Industrial Revolution</span>
        <span class="tl-selcard__rel-k">part-of</span>
        <span class="tl-selcard__bar" style="--sc-w:100%" aria-hidden="true"><i></i></span>
        <span class="tl-selcard__sr">strength 1.00</span>
      </button></li>
    </ul>
  </div>
</div>
```

Empty connections replace the whole block with:

```html
<div class="tl-selcard__rels" data-empty="true">
  <div class="tl-selcard__relshd">
    <span class="tl-selcard__section">Connections</span>
    <span class="tl-selcard__none">None curated yet.</span>
  </div>
</div>
```

### Runtime inputs

| property | set on | value |
|---|---|---|
| `--tl-dot` | `.tl-selcard__meta` | `var(--tl-cat-<domain>)` — the only data hue on the card |
| `--sc-a` / `--sc-b` | `.tl-selcard__span` | start / end of the subject's life, as a % of the strip |
| `--sc-i` | `.tl-selcard__span` | the current global year, as a % of the strip |
| `--sc-w` | `.tl-selcard__bar` | one relation's weight, `Math.round(w * 100) + '%'` |
| `data-kind="moment"` | `.tl-selcard__span` | `s.end === s.start` — turns the bar into a pip |
| `data-side` | `.tl-selcard` | `l` / `r` / `t` — the edge the placement chose; drives the entry keyframe |

**The strip domain**, verbatim:

```js
const lo = Math.min(s.start, year), hi = Math.max(s.end, year);
const pad = (hi - lo) * 0.1 || 1;              // ⇒ the life ends up at 8.3% / 91.7%
const d0 = lo - pad, d1 = hi + pad;
const pct = v => (((v - d0) / (d1 - d0)) * 100).toFixed(1) + '%';
```

The domain always contains **both** the subject's life and the current year, so
the index is always on the strip and the gap between them is always to scale.

---

## 7. Behaviour the integration must change in `selcard.ts`

> **Amended twice since it was written.** Core is cut — the founder removed the
> view: *"lets remove the 'Detail'/'Core' altogether, it complicates things."*
> And `--primary` is cut with it (§3.2). Items 1–4, 6 and 8 below are restated
> to match; the rest stand.

1. **Action labels are destination names.** `Timeline`, `Map`, `Cube`. No verb
   flip per view, and the subject's name never appears in a label.
2. **Order is fixed and never sorted.** Build the array `[timeline, map, cube]`
   and filter it; never re-sort it.
3. **Hide vs grey, precisely:**
   - `map`: rendered only when `s.polity` is truthy. `aria-disabled="true"`
     only when the polity is drawn in **no** atlas snapshot at all; when it is
     drawn in some other snapshot the cell travels there instead of shutting.
   - `cube`: rendered only when `s.polity` is truthy. **Never** disabled by the
     year — the cube traces the whole life.
   - `timeline`: rendered for everything that is not `s.minimal`, always first.
   - `s.minimal` (a bare border feature): no destinations at all, so the whole
     `__go` block stands down.
4. **`aria-current="true"`** on the cell matching `this.view` — and that
   attribute is now the *only* state on the strip: it draws the inverted ink
   block. The cell stays clickable and re-frames the current view.
5. **A disabled cell keeps `aria-disabled`, not `[disabled]`**, so it stays
   focusable and its reason is reachable by keyboard; `act()` must no-op when
   `aria-disabled === 'true'`.
6. **`presence()`** returns the mono string for the `__present` slot, using the
   templates in §3.5. It emits a line in exactly two cases: the coordinate of a
   bare border feature, and — on the map view only — what the map is drawing for
   this polity. It keeps naming both the year and the nearest snapshot when the
   map's snapshot differs from the global year. Everywhere else it returns
   `null`. The distance sentences it used to emit are deleted.
7. **The span strip is new state to compute** on `paint()`: three percentages
   from §6. It must be recomputed on every `TimeStore` tick, which `paint()`
   already is.
8. **No default-action key.** There is no primary any more, so there is nothing
   for Enter to be the shortcut *to*; the `↵` keycap and `.tl-selcard__cap` are
   deleted.
9. **`data-side`** must be written by `place()` from the branch it took, so the
   card animates out of its anchor rather than out of nowhere.
10. **Escape and the × are unchanged.** Escape clears the card *and* the
    selection — that rule was bought with a real bug and it stays.

Nothing above writes `TimeStore`. That invariant is unchanged.

---

## 8. Keyboard and assistive behaviour

- **Not a focus trap and not a modal.** No backdrop, no scroll lock; the canvas
  stays live and pannable underneath. `role="dialog"` + `aria-label` only.
- **Tab order** follows the DOM: close → destinations → All N → relation rows.
- **Focus ring** is minium at 2px with a 2px offset — the shell's ring, but
  declared inside `.tl-selcard` because the shell's is scoped to `.tl-app` and
  this card must survive being mounted anywhere. Two places take the ring
  *inside* the control instead of around it, at `outline-offset: -2px`: the
  joined destination cells, where a neighbour would clip it (plus
  `z-index: 2`), and the connection rows, where the list's own
  `overflow-y: auto` would clip it. Both overrides are scoped to `.tl-selcard`
  and the base rule uses `:where()`, not `:is()` — `:is()` inherits the
  specificity of its most specific argument, which scored the base rule 0-2-1
  and silently beat both overrides, putting the ring back outside the control.
  Caught by rendering it, not by reading it. (DESIGN.md §7 records the same
  class of bug in the shell's own reset.)
- **The weight bar is `aria-hidden`**, with the numeric strength in a
  `.tl-selcard__sr` span, because a bar is a picture of a number and a screen
  reader should get the number.
- **A greyed destination announces its reason**, from both `title` and a
  `.tl-selcard__sr` span.

---

## 9. What I rejected

| rejected | why |
|---|---|
| **`Zoom to {name}`, and every label containing the subject** | The name is the headline. Repeating it in a control is redundant at every length and absurd at 30 characters. Fixed structurally, not by truncation. |
| **Renaming it `Zoom to view`** (the literal request) | Fixes the symptom and leaves four same-shaped buttons whose distinguishing word is still last. "Zoom" also describes a mechanism, not a payoff. |
| **A menu (`Actions ▾`)** | Two clicks and a hidden label for the app's core loop. |
| **An icon-only cluster** | Cube and Core are unguessable as glyphs; tooltips are not labels; and it flattens the one action that should lead. |
| **A vertical list of action rows** | The most scannable option and honestly close — rejected on a 128px budget that would push connections under the fold on a 1280×800 laptop. |
| **An accent-coloured primary** | The house rule, and a good one: minium means "where you are". A red button here would make the accent mean "click me" everywhere else. |
| **An amber / red "not present" banner** | An absence is the most ordinary fact in a historical atlas. Any warning colour makes normal data look like a fault — and a second hue beside eight data hues reads as a ninth category. |
| **Keeping the grey well around the presence line** | Wells read as exception handling. Removing the box *is* the statement that this is data. |
| **A "travel to its peak" control** | `selcard.ts` deleted it for good reason: it was the only control that wrote the year, and the centre-year rule made it a second contradictory way to say the same thing. Framing the era already does it. |
| **Reordering destinations by relevance** | Makes each card locally optimal and the set of cards unlearnable. |
| **Hiding a year-empty Map cell** | Hiding it implies the subject *never* had a map presence. That is a lie about the corpus. |
| **Kind-coloured weight bars** (as the docked panel draws them) | A `--tl-cat-*` may only appear as a legend key, the card has no legend, and a hue is unreadable at 3×34px anyway. |
| **A count-only relations affordance** (`7 connections →`) | Costs a click to discover whether the click was worth it. |
| **Tabs inside the card** (Overview / Connections) | Chrome inside a 320px popover, to hide 120px of content, in a card whose whole purpose is to be glanced at. |
| **An 18px hero name** | Spends the loudest voice on the fact the user already had. |
| **Making the whole card scroll** | Scrolls the actions — the card's purpose — out of reach precisely when the card is squeezed. |
| **A modal / backdrop / focus trap** | The canvas must stay live; the card is meant to be read *against* the timeline, not instead of it. |
| **A second sheet grammar on mobile** | The panels already become a bottom sheet; a phone gets one idiom, not two. |

---

## 10. Deliberately deferred

- **Confidence on the span bar.** DESIGN.md encodes confidence by form, and the
  card's bar is the natural place: `data-edge="soft"` masking a 10% fade at each
  end when `sharpness < 0.5`. Not shipped because only lane members and spreads
  carry `sharpness` — polities and events do not — so the signal would appear on
  some cards and not others, which is worse than no signal. Add it when the
  field is universal.
- **A relation-kind legend.** The kinds (`part-of`, `origin`, `enabled-by`,
  `opposed-to`, `lineage`, `caused`, `about`, `same-as`) are printed but never
  explained on the card. That explanation belongs in the field-notes popover,
  once, not in every card.
- **A peak marker on the span strip.** Every subject has a `peakYear` and half
  of them have a real weight curve. A second neutral tick saying "this is when
  it mattered most" is tempting and would be genuinely useful — but a second
  mark on a 14px strip competes with the index, and the index has to win.

---

## 11. Reviewing it

```bash
cd design && python3 -m http.server 4187
open http://localhost:4187/selcard/preview.html
```

`?theme=light` / `?theme=dark` stamps the *page chrome*; the specimens are
always both, because each one is its own document with its own stamped `:root`.
`?only=sheet-light` / `?only=sheet-dark` renders the phone specimen alone, so it
can be seen at an honest 390 × 844.

### What was verified

Rendered headless in Chromium at 1440 × 900 (both themes) and 390 × 844 (the
sheet), and inspected:

- **No state overflows.** Eight desktop states measured at 320 × 215–397px
  against a `min(58vh, 480px)` cap; the sheet at 390 × 412 against `56dvh`
  (472px). `scrollHeight === clientHeight` on every card — nothing clips.
- **No label wraps.** `scrollWidth === clientWidth` on all 25 destination cells
  across all states; the destination group never overflows its row.
- **No horizontal page scroll** at either width.
- **Contrast holds in both themes** — every specimen is rendered twice, over the
  canvas ground and graticule it will actually float on, not over a flat white
  card.
- **Focus is visible** on both control families, and neither ring is clipped —
  see §8 for the specificity bug this pass caught.
- **No console or page errors.**

Every name, date, note, weight, relation kind, category and snapshot year in
`preview.html` is read out of the app's corpus — `datasets.json`,
`relations.json`, `polities.json`, `lanes.json` and `fold.ts`. Nothing is
invented, including the fact that a life carries no note and that Cubism has no
curated links.
