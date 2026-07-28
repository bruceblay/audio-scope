# Design System

The extension is free, so craft is the only differentiator. The bar: it should be
unclear whether this is a hobby project or a product from a company that makes
audio hardware.

## Principle: the visual is the product

Chrome is a frame, not a feature. The canvas gets the panel; controls collapse to
a rail. Nothing in the UI competes with the trace or the plate for attention.

## Principle: two instruments, not one theme

Oscilloscope mode and cymatics mode are different objects. A scope is a bench
instrument: charcoal metal, etched glass, tabular readouts, cool light. A cymatic
plate is a physical experiment: near-black surround, warm grains, a single object
lit from above. Forcing one skin over both would make both worse.

What they share is *restraint*: near-black surfaces, one accent per mode, type used
as instrumentation rather than decoration.

## Type

Two faces, no more.

| Role | Face | Usage |
| --- | --- | --- |
| **Labels** | Inter, 500/600 weight | `letter-spacing: 0.09em`, uppercase, 10-11 px. Front-panel legends. |
| **Readouts** | JetBrains Mono, 400/500 | `font-variant-numeric: tabular-nums`. Non-negotiable: a value that reflows as digits change looks broken. |

Both self-hosted as woff2 subsets in `public/fonts/`. browser-fx pulls Inter from
Google Fonts (`src/fonts.css`), which works but adds a network request from an
extension that otherwise makes none. Being able to say "zero outbound requests" is
worth the ~40 KB.

Type scale, tight and small on purpose: 10 / 11 / 13 / 16 / 22 / 34. Instrument
labels are small. Large text reads as a web app.

## Tokens

`src/ui/tokens.ts`, following browser-fx's `theme.ts` structure.

### Shared surfaces

```ts
surface: {
  void:    '#08090a',   // outside the instrument
  chassis: '#16181b',   // instrument body
  rail:    '#1d2024',   // control rail
  control: '#252930',   // buttons, selects
  raised:  '#2e333b',   // hover
  line:    '#0b0c0e',   // seams between panels
  hairline:'rgba(255,255,255,0.06)',
}
text: {
  primary: '#dfe3e8',
  legend:  '#8b939d',   // front-panel labels
  faint:   '#5a626c',   // inactive
}
```

Deliberately cooler and slightly lighter than browser-fx's neutral greys
(`#0d0d0d` / `#1e1e1e` / `#3a3a3a`). Test gear is grey-blue; Ableton devices are
neutral grey. Small shift, different object.

### Oscilloscope

```ts
scope: {
  screen:     '#050807',   // unlit phosphor
  graticule:  'rgba(150,190,210,0.13)',
  gratMajor:  'rgba(150,190,210,0.22)',
  phosphor: {
    p31: { core: '#2bff6a', bloom: '#a9ffc4' },   // classic scope green
    p7:  { core: '#a8d8ff', bloom: '#e8f4ff' },   // long-persistence
    p1:  { core: '#ffb340', bloom: '#ffe0b0' },   // amber
  }
}
```

`bloom` is the core hue desaturated toward white, because a saturating phosphor
does exactly that. Additive passes converge to `bloom` at the brightest points,
which is what makes intensity read as intensity rather than as opacity.

### Cymatics

```ts
cymatic: {
  slate: { plate: '#141619', grain: '#f2ece0', rim: 'rgba(255,255,255,0.10)' },
  ink:   { plate: '#e8e4dc', grain: '#14100c', rim: 'rgba(0,0,0,0.14)' },
  up:    'rgba(120,180,230,0.10)',   // positive displacement sheen
  down:  'rgba(230,160,110,0.10)',   // negative
}
```

### Status

```ts
status: {
  live:  '#3ddc84',   // capturing
  idle:  '#4a525c',   // connected, silent
  error: '#ff6b5e',
}
```

One accent, used only for status. Nothing decorative is green.

## Depth

Three techniques, used consistently, nothing else.

1. **Inset screens.** The scope screen and the cymatic stage are recessed:
   `inset 0 1px 3px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.6)`, plus a
   1 px top hairline of `rgba(255,255,255,0.05)` on the bezel below the screen -
   the light-catching edge that makes a recess read as a recess.
2. **Raised controls.** A 1 px top highlight, a darker bottom edge, and a very
   faint vertical gradient. browser-fx's `titleBarGradient` idea, subtler.
3. **Seams, not borders.** Panels separate with a 1 px dark line plus a 1 px light
   line below it. Real panel gaps, not CSS borders.

No drop shadows floating in space. No border radius above 4 px except on the
screen bezel, which gets 3 px because CRT faces have a corner radius.

## Motion

- **Instant** (0 ms): every audio-driven pixel. Adding easing to the trace is
  adding a lie.
- **Fast** (110 ms, `cubic-bezier(0.2, 0, 0.2, 1)`): control state, hover, tabs.
- **Considered** (260 ms, `cubic-bezier(0.16, 1, 0.3, 1)`): mode changes, panel
  reveals.

Nothing animates on load. The instrument is already on.

## Layout

The side panel is 320-600 px wide (Chrome's range) and full window height, so
vertical.

```
┌────────────────────────────┐
│ ▣ SCOPE   ◈ CYMATICS    ⚙ │   40px  mode tabs
├────────────────────────────┤
│                            │
│                            │
│         CANVAS             │   flex, min 260px
│                            │
│                            │
├────────────────────────────┤
│ Vpp 0.847  Vrms 0.299      │   readouts, tabular
│ FREQ 440.2Hz  PER 2.272ms  │
├────────────────────────────┤
│ TIME/DIV      ◀  1ms  ▶    │   control rail,
│ VOLT/DIV      ◀ 0.2FS ▶    │   collapsible
│ TRIGGER       AUTO ↗ AUTO  │
├────────────────────────────┤
│ ● youtube.com    DISCONNECT│   32px  source bar
└────────────────────────────┘
```

The canvas is square-ish when the panel is narrow and grows taller as the panel
widens - it always takes whatever is left after the fixed rows. Collapsing the
control rail gives the canvas nearly the whole panel, which is the intended way to
use it.

## Pop-out window

Phase 4. The best version of this is a borderless window with nothing but the
canvas, opened via `chrome.windows.create({ type: 'popup' })`, sized to the golden
ratio and remembered. It is where this becomes something people leave open on a
second monitor. Noted here so the layout does not assume the side panel is the only
surface: `src/ui/Stage.tsx` takes its dimensions from its container, never from
`chrome.sidePanel`.

## Planned: Tektronix light mode

A second theme modeled on a **Tektronix 2236**, the 100 MHz analog scope from
Tek's 2200 series - their volume bench line through the late 80s and 90s.

Bruce's father sold these for Tektronix in the 90s. That is the reason this is on
the list, and it is a good enough reason on its own. It also happens to be the
right reference: the 2200 series is what most people picture when they picture an
oscilloscope.

### The palette

Reference photographs of a *powered-off* scope are misleading, so noting the
correction up front:

> **The screen is not blue.** Photos show a blue-cyan face because an unlit CRT
> behind an anti-glare filter reflects the room. In use the face is a creamy
> grey-green. Our screen should move from near-black toward a warm dark
> grey-green - never toward blue, and never toward pure white.

| Surface | Reading |
| --- | --- |
| Case, top and sides | Tek's dusty slate blue, in a wrinkle-texture paint |
| Front panel | Warm light grey, close to cream, clearly lighter than the case |
| CRT bezel | Mid grey-taupe, deeply recessed, metal-look inner frame |
| Screen face | Creamy grey-green, darkening under the contrast filter in use |
| Legends | Small black uppercase, tight, high contrast on the pale panel |
| Wordmark | Tektronix blue, upper left of the panel |
| Accents | Red on the concentric CAL knobs; colored bands grouping functions |

Exact values should be sampled from reference photographs rather than guessed
from one image under one lighting condition.

### Details worth taking

- **Concentric knobs.** A large outer control with a small inner vernier is the
  signature 2200 gesture, and it maps directly onto controls we already have that
  are coarse plus fine.
- ~~**Radial 1-2-5 scales.**~~ Built and rejected. Time/div and volts/div are
  printed around rotary switches on the instrument, and we step through exactly
  those sequences, so it looked like the obvious win. It was not.

  A flat vector circle does not become a knob by being round. Real knobs read
  through moulded shadow and specular highlight, and supplying those is precisely
  the photographic skeuomorphism this theme is not allowed to use - so the honest
  version looks like a cartoon. Twelve labels 27 degrees apart is also inherently
  cramped in a 320 px column.

  The part worth keeping is not the knob. It is that a printed scale shows *where
  you are in the range* at a glance, which a stepper does not. If this is
  revisited, take that and leave the circle: a flat silkscreened linear scale with
  a position marker gets the same information across with no fake dimension.
- ~~**Colored grouping bands.**~~ Tried and dropped. Tek bracketed related
  controls with thin colored strips, but in a narrow vertical column they read as
  web-app callouts rather than panel engraving. The seam between groups carries
  the separation on its own. Worth revisiting only if the layout ever goes wide
  enough to hold several columns, which is the arrangement the bands were
  designed for.
- **Red on the calibrated detent.** A single saturated accent used only where
  something is in a calibrated position, not for decoration.

### The line this must not cross

The existing principle is "instrument, not skin - no fake screws or leather", and
a homage is exactly where that gets violated. The distinction to hold:

- **Take** the design *language*: palette, type treatment, control grouping,
  layout logic, the radial scales.
- **Do not take** photographic texture: no rendered wrinkle paint, no drop
  shadows imitating a photograph, no bevels pretending to be injection-molded
  plastic, no scuffs or wear.

It should look like an instrument Tektronix might have designed, not like a
photograph of one.

### Light mode is not a light screen

The important structural point. Going light means the **panel** goes light. The
screen stays dark and recessed, because a CRT face is dark in any lighting - that
is what makes the trace read. Inverting the screen too would destroy the one
element the whole product exists to show.

Same for cymatics: the `Ink` palette already inverts the plate, and that is a
separate choice from the chrome being light. The two should be independent.

## Accessibility

The visuals are the point and cannot be made non-visual, but:

- All readouts are real text, selectable and screen-reader legible. The measured
  values are available even if the trace is not.
- Controls are keyboard reachable with visible focus rings (`status.live` at 2 px,
  2 px offset).
- Amber (P1) phosphor plus the Ink cymatic palette give options for
  green-insensitive viewers.
- No control conveys state by color alone. Active tabs get a 2 px underline and a
  weight change, not just a tint.
- `prefers-reduced-motion` caps persistence decay and disables the idle breathing
  animation. It does not stop the audio-driven trace - that is the content.
