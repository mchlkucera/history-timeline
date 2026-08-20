# Timeline — Shell Design System

**Codename: _Survey._** A design system for the chrome of a full-viewport historical atlas.

This directory contains a design system and application shell, not app code. Another agent
integrates it. Nothing here touches the canvas renderers — it defines the frame they live in,
the tokens they should draw with, and the controls that drive them.

- `tokens.css` — every colour, space, radius, shadow, type step and duration.
- `shell.css` — the chrome, built entirely on those tokens. All classes namespaced `tl-*`.
- `preview.html` — a self-contained review page showing the whole shell in both themes.

---

## 1. The brief, restated

Two hard requirements from the founder:

**(A) App-first.** The visualisation fills the viewport like a map app. The title becomes a small
mark. Chrome floats over or docks tightly around the canvas. Target: >80% of pixels are the
visualisation.

**(B) De-generic it.** The current prototype is the AI-default look: warm cream `#F2ECDC`, Iowan
Old Style serif display, centred 1240px column, 12px rounded cards with double shadows, pill tabs,
a brass accent, and a 60-word explanatory paragraph above every view. All of it goes.

---

## 2. Where the point of view comes from

Not "history" in general — **instruments that measure position and deep time**. A theodolite, a
sextant scale, a bathymetric chart, a stratigraphic core log, a portolan wind rose. Objects built to
answer exactly the founder's question: *where and when am I, and what is around me.*

Three things carried over from that world into the design:

1. **An engraved scale is the frame, not a widget.** On an instrument, the measuring scale *is* the
   body. So time is docked permanently to the bottom edge of the app, ruled, and shared by every
   view. See §6.
2. **One accent, and it means index.** Portolan charts drew the eight principal winds in black and
   marked direction in red. Minium (red lead) was the rubricator's pigment: the thing that says
   *look here*. The chrome has **exactly one accent hue**, and it is reserved for one meaning —
   **where you are** — the current year, the playhead, the needle, keyboard focus. Every other
   state (on/off, pressed, selected, emphasis, confidence) is carried by the neutral ramp or by
   form. Nothing else in the chrome is coloured, and there is no pure red in the data palette.
3. **Chart film, not parchment.** The ground is cool grey-green drafting film and deep bathymetric
   blue-black. Deliberately not the warm parchment of the current prototype, and not near-black
   either — near-black-plus-one-pop is its own cliché.

---

## 3. Palette

Eight named values. Pigment and material names, because the palette came from pigments and
materials — a name like `--tl-minium` carries its rule with it in a way `--accent-500` never does.

### Light — "Chart film"

| Name | Hex | Role |
|---|---|---|
| **Plate** | `#12181A` | Primary ink. Engraved-plate blue-black, never pure `#000`. |
| **Graphite** | `#505E63` | Secondary ink — labels, muted copy, inactive tabs. ~6.9:1 on Film. |
| **Chalk** | `#6D7B7F` | Tertiary ink — tick numerals, disabled, placeholder. ~4.4:1 on Film. |
| **Film** | `#F5F7F6` | Chrome surface. Rails, panels, popovers — the things that float. |
| **Chart** | `#E3E8E6` | App ground and canvas backdrop. The paper under the instrument. |
| **Rule** | `#C7D0CD` | Hairline. Every border in the system is 1px of this. |
| **Minium** | `#B4382A` | **The one accent.** Current year, playhead, needle, focus ring. Nothing else. |
| **Rubric** | `#8E2C21` | The deep step of that same hue — hover and pressed. Not a second hue. |

The neutrals are biased green-cyan (hue ≈ 165–190°) so they read as chosen rather than inherited,
and so the one warm accent has something to push against. Chrome (`Film`) is *lighter* than the ground (`Chart`) — the map-app
convention that makes panels read as floating above the world rather than punched into it.

### Dark — "Bathymetric"

The same eight roles, retuned rather than inverted. The ground goes to the blue-black of a deep
sounding; both accents gain lightness and lose a little chroma so they sit on it without glowing.

| Role | Hex |
|---|---|
| Ground | `#080C0D` |
| Surface (chrome) | `#0E1416` |
| Surface raised | `#161E20` |
| Rule | `#242E31` |
| Ink | `#DEE6E4` |
| Ink-2 | `#8D9A9C` |
| Ink-3 | `#6E7D82` |
| Minium | `#E4644B` |
| Rubric | `#F07A62` |

Here the chrome is *lighter* than the ground too — same rule, both themes.

### Data palette — eight domains

The app's visual grammar (from the project's own notes) is two orthogonal axes: **shape** = what
kind of thing, **colour** = which domain. Those eight domain colours are tokens too
(`--tl-cat-*`), because a design system that stops at the chrome and lets the canvas invent its own
colours is not a design system.

| Domain | Light | Dark | Pigment |
|---|---|---|---|
| power | `#2C4E8F` | `#7098DC` | indigo |
| war | `#8B4A31` | `#C98058` | iron oxide |
| belief | `#6B3F79` | `#B287C0` | aubergine |
| sci | `#1F6E63` | `#45B39D` | verdigris |
| art | `#A33A63` | `#E0789F` | madder rose |
| nature | `#4F6B2B` | `#92B85C` | terre verte |
| society | `#8A6B15` | `#D2A63C` | ochre |
| reach | `#16657E` | `#4FAFC9` | sea blue |

**These are a separate system from the chrome accent, and the two must never be confused:**

| | hues | means | tokens |
|---|---|---|---|
| Chrome accent | **one** | where you are | `--tl-accent` |
| Data hues | **eight** | which domain a mark belongs to | `--tl-cat-*` |

Never paint canvas data with `--tl-accent`. Two crossings the other way are allowed, and only these
two: the **index** is chrome drawn over the canvas, and a **legend key or chip dot quotes** a data
hue so the reader can match it to the canvas — that is what `--tl-dot` exists for. A `--tl-cat-*`
value may never colour a control, a border, a label or a state.

**No pure red in the data palette.** `war` is iron oxide — a brown-orange — specifically so that red
on the canvas can only ever mean *the moment you are looking at*. That constraint is the whole point
of rule 2 above; the data palette had to bend to it, and did.

Eight hues is a hard requirement of the visual grammar (shape = what kind of thing, colour = which
domain), so the one-accent rule applies to the chrome only and stops at the canvas edge.

### Confidence, encoded by form

Generic `success / warning / error` would be dead weight here. The real semantic axis in a
historical atlas is **how much we actually know** — the prototype's own caption already admits
"historical borders are fuzzy and contested by nature".

It is deliberately **hue-free**. One neutral ink, three silhouettes, read as a single gauge running
full → half → empty:

| State | Mark | Meaning |
|---|---|---|
| `attested` | ● solid disc | sourced and dated |
| `approximate` | ◐ half disc | scholarly estimate |
| `contested` | ⊘ slashed ring | sources disagree |

Three reasons this is an upgrade rather than a concession to the one-accent rule:

1. These marks sit inches from eight categorical data colours. A coloured status dot reads as a
   **ninth domain**, which is exactly the confusion the two-system split (§3, data palette) exists
   to prevent.
2. Form survives colour-blindness, a greyscale print, a dimmed screen and a projector.
3. It frees confidence to be encoded **on top of** the data hues on the canvas: hue keeps saying
   *what domain*, and a stroke pattern (`--tl-dash-*`: solid / dashed / dotted) says *how sure*.
   Two orthogonal channels instead of one overloaded one.

`--tl-danger` exists for destructive UI and is defined as the accent itself — the same hue,
distinguished by form (a bordered button with a word on it, never a bare mark). The atlas is
read-only, so that surface is tiny; if destructive actions ever multiply, separate them with a
filled accent button rather than a second hue.

## 4. Typography

Three faces, three genuinely separate jobs. Google Fonts only. Real fallback stacks on all three.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&display=swap">
```

> Integration note: `tokens.css` cannot load fonts (`@import` would block render), so **these three
> tags must be pasted into the host document's `<head>`** or all three faces fall back silently.

| Role | Face | Stack | Used for |
|---|---|---|---|
| **Interface** | Instrument Sans | `"Instrument Sans", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` | Everything you read: nav, buttons, chips, panel titles, field notes. |
| **Instrument** | IBM Plex Mono | `"IBM Plex Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace` | Everything you *measure*: the year readout, tick numerals, coordinates, counts, keycaps, dataset ranges. Always `tabular-nums`. |
| **Mark** | Instrument Serif | `"Instrument Serif", "Iowan Old Style", Charter, Georgia, serif` | The wordmark. One string, one size, 15px. Nothing else, ever. |

Instrument Sans is a slightly narrow neo-grotesque drawn for interfaces — it holds up at 11–13px
where a wide humanist face turns to mush, and it is not one of the two faces every generated page
reaches for. IBM Plex Mono's slab-ish terminals read as engraving rather than as code. Instrument
Serif appears exactly once, at 15px, as the cartouche on a chart would.

The split is doctrinal: **if it is a measurement, it is mono; if it is language, it is sans.** That
single rule does most of the typographic work in the shell.

### Scale

Base is 13px, not 16px — this is a dense instrument, not an article. Steps are named for use, so
"which size is this" is never a judgement call.

| Token | px | Line-height | Tracking | Use |
|---|---|---|---|---|
| `--tl-text-2xs` | 10 | 1.2 | `.08em` | tick numerals, keycaps |
| `--tl-text-xs` | 11 | 1.35 | `.02em` | micro-labels, legend, meta |
| `--tl-text-sm` | 12 | 1.4 | `.005em` | chips, secondary controls |
| `--tl-text-base` | 13 | 1.45 | `0` | the shell default |
| `--tl-text-md` | 15 | 1.4 | `-.005em` | panel titles, wordmark |
| `--tl-text-lg` | 18 | 1.35 | `-.01em` | popover headings |
| `--tl-text-xl` | 24 | 1.2 | `-.02em` | year readout, narrow |
| `--tl-text-2xl` | 32 | 1.05 | `-.03em` | year readout, desktop |
| `--tl-text-3xl` | 44 | 1 | `-.035em` | reserved: full-screen scrub |

`--tl-text-prose` (14px / 1.6) is separate and used only inside the field-notes popover, where you
are reading sentences rather than operating controls. That measure is capped near 62 characters.

Uppercase micro-labels get `.08em` tracking and Graphite, never Plate — they are signposts, not
content.

---

## 5. Layout concept

**A canvas with three engraved edges.** One fixed-height CSS grid, no page scroll, no centred
column, no cards. The visualisation is the ground floor of the document; everything else is either
a hairline rail welded to an edge, or a small panel floating over the canvas with a 1px border.

```
grid-template-rows: var(--tl-rail-top) 1fr var(--tl-rail-time);
```

### Desktop — 1440 × 900

```
┌────────────────────────────────────────────────────────────────────────────┐
│ T Timeline │ MAP  TIMELINE  FLOW  CUBE  CORE │  18 snapshots · 3000BCE–1994 │ 44px
│            │ ▔▔▔                             │        [ ⌘K ]  ( i )  ( ☾ )  │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌ LENSES ────────────── ─ ┐                          ┌ FIELD NOTES ───── ✕ ┐│
│ │ ● Power    ● War        │                          │ World map + time    ││
│ │ ● Belief   ● Science    │                          │ dial                ││
│ │ ─────────────────────── │                          │                     ││
│ │ Detail  ▁▂▃▄▅ ── ●───   │        ░ CANVAS ░        │ Drag the dial.      ││
│ │ [ Labels ][ Borders ]   │      (full bleed,        │ Territories are     ││
│ └─────────────────────────┘       graticule)         │ real research data… ││
│                                                      │ ─────────────────── ││
│                       ┌ Aachen ─────────┐            │ ⌘K search   ␣ play  ││
│                       │ Frankish Empire │            └─────────────────────┘│
│                       │ 800 CE · attested│                                  │
│                       └─────────────────┘                     ┌ LEGEND ──┐ │
│                                                     ⌖          │ ▪ power  │ │
│                                     the index rises out         │ ▪ war    │ │
│                                     of the rail into the ───────┤ ▪ belief │ │
│                                     canvas  ╷                  └──────────┘ │
├──────────────────────────────────────────────╷─────────────────────────────┤
│  1776  │3000BCE  1000   1CE   1000  1500  1800╷1900  2000  │  ◀ ▶ ▶ │ 1× │  │ 64px
│   CE   │▏╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕╷╷╷╷▏╷╷╷╷▕╷╷█╷╷▏╷╷╷╷▕╷╷╷╷▏ │        │    │  │
│        │░ antiquity ░│░ post-classical ░│░ early mod ░│░ modern ░│  ← era bands│
└────────────────────────────────────────────────────────────────────────────┘
```

Canvas share at 1440×900: `(900 − 44 − 64) / 900 = 88%` of height at full width. Floating panels
occupy roughly 6% of the canvas area and are dismissible — so **~83% of pixels are the
visualisation at rest, and 88% with panels collapsed.** Requirement (A) met with margin.

### Narrow — 390 × 844

The switcher can't fit beside the mark, so it takes its own 34px row and scrolls horizontally with
snap points and edge fades. Floating panels become a bottom sheet with a drag handle, which is the
one place a rounded corner is allowed (top corners only, 12px — it reads as a sheet, not a card).
The time rail keeps its scale but drops the era band labels and the speed control.

```
┌────────────────────────────┐
│ T Timeline    ⌘K  ( i ) ☾ │ 44
├────────────────────────────┤
│ MAP  TIMELINE  FLOW  CU… ▸ │ 34   ← scroll-snap, edge fade
│ ▔▔▔                        │
├────────────────────────────┤
│                            │
│                            │
│        ░ CANVAS ░          │      ← 100% width, ~72% height
│                            │
│      ┌ Aachen ──────┐      │
│      │ Frankish Emp.│      │
│      └──────────────┘      │
│                          ╷ │
│  ╭─────────────────────╮   │
│  │        ▂▂▂          │   │      ← bottom sheet, drag handle,
│  │ LENSES              │   │        collapsed to 44px by default
│  │ ● Power  ● War   …  │   │
├──┴─────────────────────┴───┤
│ 1776 │▏╷╷▕╷╷▏╷█╷▕╷╷▏│ ▶   │ 56
└────────────────────────────┘
```

Canvas share at 390×844 with the sheet collapsed: `(844 − 44 − 34 − 56 − 44) / 844 = 79%`.

Nothing horizontally scrolls except the switcher, inside its own `overflow-x: auto` container.
`body` never scrolls sideways — verified at 390px: `documentElement.scrollWidth === innerWidth`.

### The long explanatory paragraphs

They move into a **field-notes popover** on an `( i )` button in the top rail, opened also by `?`.

Why this and not a collapsible strip:

- The paragraphs are **onboarding, not operation.** They are read once per view, understood, and
  then re-read never — but a docked strip taxes every session afterwards, forever.
- A collapsed strip still costs a decision and ~28px; an open one costs 70–90px, which is 8–10% of
  the viewport height. That is the difference between 88% canvas and 79% — it would break
  requirement (A) on its own.
- A popover can hold **more** than the strip could: the paragraph *plus* the data-provenance note
  (currently a stranded `.note` under the map) *plus* the keyboard shortcuts. Three homeless pieces
  of text get one home.

Discoverability is handled explicitly, because a hidden explanation that is never found is worse
than a paragraph that is always shown:

1. The `( i )` carries a **minium dot** until the notes for *that view* have been opened once.
2. The popover title names the view, so it never feels like generic help.
3. `?` opens it from anywhere; the shortcut is printed inside it.
4. One line of gist stays visible in the top rail at ≥1180px — enough to know what you are looking
   at without reading the essay.

---

## 6. The aesthetic risk: the engraved time rail

The one deliberate risk. **The time control is not a widget inside the app — it is the bottom edge
of the app.**

A 64px rail welded to the viewport bottom, present in every view, containing a real ruled scale:
minor ticks every 2% and major every 10%, both rising from a hairline baseline; century labels in
Plex Mono at 10px; era bands washed in at 5% alpha; and a **minium index** — a filled triangle, a
1px hairline down the rail, and a flagged year — that does not stop at the top of the rail but
continues *up into the canvas*.

**How far up it continues is a per-view decision, and the first draft got it wrong.** A full-height
red meridian across a world map is not an index, it is a misleading line of longitude. So the
default (`.tl-index-line`) is a 22px stub fading up out of the rail — enough to say *this rail
belongs to that canvas* — and time-axis views (Timeline, Flow, Cube), where the canvas X axis
really is time, add `.tl-index-line--full` to run it the whole way.

Alignment matters more than it looks. `--tl-index-pos` is a percentage of the *scale*, which is
inset by the year readout and the transport; the canvas is not inset, so driving both from one
percentage put them ~9% apart at 1440px. The app therefore also sets `--tl-index-x`, the same
point re-expressed in stage pixels (`scale.offsetLeft + pct * scale.offsetWidth`). Two properties,
one truth.

Why it is a risk: a permanently visible ruler is busy, and skeuomorphic instrument chrome curdles
into kitsch faster than almost anything else in interface design.

Why it earns its place: in this app time is not a filter, it is the second spatial axis. The map is
a horizontal slice through a space-time block; the flow view is a projection of it; the core sample
is a vertical drill. The rail is the only object that is *the same thing* in all five views, so it
is what makes them feel like one instrument rather than five demos in tabs. And the founder's actual
complaint — "I see 1776 and cannot imagine the world" — is a complaint about a number with no scale
around it. The rail is a permanent answer: the number is always shown *in its scale*.

How it avoids kitsch: no bevels, no gradients pretending to be metal, no drop shadows, no serif
numerals, no texture images. Every mark is a 1px line at a graded opacity. It is engraving, which
is flat by nature, not moulded plastic.

**Supporting detail — the graticule.** The empty canvas carries a lat/lon graticule drawn in pure
CSS (`repeating-linear-gradient`, 1px at 4% alpha, every 5th line at 7%). Costs nothing, ships no
assets, and means an empty or loading canvas reads as chart film rather than as a grey box.

**Supporting detail — real keycaps.** `<kbd>` is styled as a 1px-bordered mono cap and appears in
switcher tooltips, the search field, and the field notes. Keyboard affordance is most of what makes
Linear and Raycast feel like tools rather than pages, and it costs one component.

---

## 7. Component rules

| Property | Rule |
|---|---|
| **Borders** | 1px `--tl-rule`, everywhere. Hairlines separate; shadows do not. |
| **Shadows** | Only on things that genuinely float free: popover, tooltip, sheet, dropdown. Never on docked rails, never on a control at rest. Two tokens total. |
| **Radius** | 3px inputs/chips, 4px buttons, 6px panels, 8px popovers, 12px sheet top corners only. `--tl-radius-full` exists for status dots and nothing else. **No pills.** |
| **Active nav** | A 2px ink underline flush to the rail's bottom hairline. Not a filled pill, not a background wash. |
| **Primary button** | Solid ink (Plate on light, near-white on dark). The accent is not for buttons — it is for the index. |
| **Accent budget** | One hue, and it must stay scarce enough to mean something. In a live view it appears on the rail index (and its continuation into the canvas — the same object), the needle of any scale, and a transient unread dot. That is the ceiling. When a third or fourth candidate appears, demote one to neutral rather than reach for a second hue — that is how the wordmark glyph and the popover eyebrow both ended up as plain ink. |
| **States without hue** | On/off, pressed, selected and emphasis are all carried by fill, travel, weight and the neutral ramp. A checked toggle is an ink-filled track with an inverted knob; an emphasised badge is ink text on a stronger hairline. |
| **Control height** | 28px small / 32px default / 36px touch. Everything sits on a 4px grid. |
| **Focus** | Two-step ring: 2px of surface, then 2px of minium. Reads on any ground, including over the canvas. Never removed, never `outline: none` without a replacement. |
| **Motion** | 80/120/180/260ms on `cubic-bezier(.2,.7,.3,1)`. Hover is colour only. Everything is disabled under `prefers-reduced-motion`. |
| **Scrollbars** | 8px, transparent track, `--tl-rule` thumb, `--tl-ink-3` on hover. Firefox via `scrollbar-width: thin`. |
| **Digits** | `font-variant-numeric: tabular-nums` on every numeral in the shell. A year that jitters while scrubbing is a bug. |
| **Cascade** | Base resets are wrapped in `:where()` so they carry zero specificity and can never beat a component class. Learned the hard way: an `:is()` version of the reset scored 0-1-1, silently won `color` against `.tl-btn--primary`, and rendered the primary button's label in the same colour as its background. |

---

## 8. What I deliberately rejected, and why

Named, because "avoid AI-looking design" is only actionable if the traits are specific. Every item
below is present in `prototypes/partA.html` today.

| Rejected | Why |
|---|---|
| **Warm cream `#F2ECDC` ground + Iowan Old Style / Palatino display + brass `#8A6D2F` accent** | This is the single most recognisable generated-artifact palette there is, and the current prototype is a textbook instance of it. Replaced with cool chart film and bathymetric blue-black. |
| **Near-black with one acid-green or vermilion pop** | The obvious escape hatch from cream, and equally generic. Avoided by making the dark ground blue-green rather than neutral, and by giving the accent a *rule* (index only) rather than a decorative job. |
| **Centred 1240px column with page padding and a page scroll** | Directly contradicts requirement (A). Replaced with a fixed-height three-row viewport grid. |
| **12px rounded cards with `0 1px 2px + 0 6px 24px` double shadows** | Card-and-shadow is the default because it hides the work of alignment. Replaced with 1px hairlines and 4–8px radii; every edge now has to actually line up. |
| **`border-radius: 999px` pill tabs and chips** | The most-generated shape of the last three years. Replaced with 3–4px machined rectangles and an underlined active tab. |
| **Serif display headline as page hero** | Demoted to a 15px wordmark. Not deleted — one serif string as a chart cartouche is a real gesture — but it cannot be the hero. |
| **A 45-word explanatory paragraph above every view** | Requirement (A), and it is the single clearest "explained by an assistant" tell. Moved to the field-notes popover. |
| **Enclosed numerals and emoji as section markers (① ② ③ 🜨 ▶)** | Emoji-as-icon is on every generated page. Replaced with inline SVG glyphs and mono keycaps. |
| **Inter, Space Grotesk, Roboto** | The three faces that signal "no typographic decision was made". Replaced with Instrument Sans / IBM Plex Mono / Instrument Serif. |
| **Purple→blue gradients, gradient CTAs, accent bars on card corners** | Not present in the prototype, and not introduced. There is no gradient in this system except the 5%-alpha era bands and two edge fades. |
| **Generic `success / warning / error` semantics** | Meaningless for an atlas. Replaced with attested / approximate / contested, which encode something true about the data. |
| **A second chrome accent for positive/available states** (the green that was here in v1) | Two accents means two meanings, and the second one was never load-bearing — it was decorating a toggle, a badge and a status dot that all read perfectly well in ink. Worse, a green-and-amber status set sitting beside eight categorical data hues invites the reader to treat it as a ninth and tenth category. One hue, kept scarce, says *look here* far louder than two hues competing. |
| **Hue-coded status dots** | Colour alone fails ~8% of male readers, every greyscale print and every dimmed screen — and here it also collides with the data palette. Confidence is now solid / half / slashed silhouettes in one neutral ink. |
| **16px base type with generous article spacing** | Correct for a document, wrong for an instrument. Base is 13px and the density is deliberate. |

---

## 9. Responsive behaviour

| Width | Change |
|---|---|
| **≥1180px** | Full rail: mark, switcher, gist line, dataset meta, search hint, `( i )`, theme. Panels float, left and right. |
| **1024–1179px** | Gist line drops. Dataset meta drops below 1100px. Switcher labels stay. |
| **760–1023px** | Right-hand panels stack under the left ones or collapse to their headers; time rail loses the speed control. |
| **<760px** | Switcher moves to its own scrolling row. Panels become a bottom sheet, **collapsed to its 44px header by default** so the canvas keeps the screen; tapping it opens it to 46dvh. Time rail 56px; era labels, the index flag and all but two century anchors are dropped — at 390px the scale is only ~210px wide and five labels collide. `--tl-tap: 36px` raises every control to a touch target. |
| **Coarse pointer** | `@media (pointer: coarse)` raises control heights independently of width, so a touch laptop gets touch targets too. |

Verified at 1440, 1024 and 390. No horizontal body scroll at 390.

---

## 10. Integration notes

- Every custom property is `--tl-*` and every class is `.tl-*`. The existing prototype's `--bg`,
  `--ink`, `--panel`, `.card`, `.btn`, `.chip` are untouched, so both stylesheets can coexist during
  a staged migration.
- The canvas keeps `touch-action: none` and `cursor: crosshair`; `.tl-canvas` sets the frame, the
  `<canvas>` inside it fills it absolutely. Size the canvas from `getBoundingClientRect()`, not from
  a fixed `height` attribute — the frame is now viewport-driven.
- The eight `--tl-cat-*` tokens are the ones the renderers should read, via
  `getComputedStyle(document.documentElement).getPropertyValue('--tl-cat-power')`, so a theme switch
  repaints the canvas with the rest of the page.
- Three custom properties are **runtime inputs**, set by the app rather than the palette:
  `--tl-index-pos` (percentage of the scale, drives the rail index), `--tl-index-x` (the same point
  in stage pixels, drives the canvas index — see §6), and `--tl-dot` (per-element swatch colour on
  chips and legend rows, set inline as `style="--tl-dot: var(--tl-cat-power)"`).
- `color-scheme` is set in all three theme blocks, so native form controls and scrollbars follow.
- There is intentionally **no `--tl-accent-2`**. If a new state seems to need one, use the neutral
  ramp or a form difference; `tokens.css` carries the same warning at the declaration site.
- Canvas confidence should be drawn as a stroke pattern (`--tl-dash-attested` / `--tl-dash-approx` /
  `--tl-dash-contest`) over the domain colour, never as a colour change.
