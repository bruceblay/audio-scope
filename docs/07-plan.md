# Build Plan

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Phase 0 - Documentation

- [x] Overview, architecture, browser-fx reference, audio engine, both modes,
      design system, this plan

## Phase 1 - Skeleton and capture

The single highest-risk item is whether `chrome.tabCapture.getMediaStreamId()`
works from a side panel. Everything else is downstream of it, so it gets verified
first with the smallest possible amount of code.

- [x] Vite multi-entry build, static `manifest.json`, `npm run dev` watch
- [x] Service worker: open side panel on icon click via `openPanelOnActionClick`
- [x] Side panel shell: mount, Connect button, status line
- [x] `src/audio/capture.ts` - `acquireTabStream()`, the isolated call site
- [~] **Verify capture from the side panel.** Needs a real browser: load `dist/`
      unpacked, open the panel on a playing tab, click Connect
- [x] Full teardown wiring: every path in
      [01-architecture.md](01-architecture.md#teardown)

The service worker turned out thinner than planned. `openPanelOnActionClick`
opens the panel directly from the toolbar icon and preserves the gesture chain,
and a side panel has full `chrome.tabs` access, so `GET_TARGET_TAB` was never
needed - the panel queries the active tab itself. The worker only sets the panel
behavior and maintains the badge.

Exit criteria: connect to a YouTube tab, hear it unchanged, see a moving level
number, disconnect, hear it return to normal. Repeat five times with no leaked
context and no silent tab.

If `getMediaStreamId` is rejected from the panel, implement the popup handoff
described in [01-architecture.md](01-architecture.md#the-user-gesture-requirement)
before moving on. Do not build on an unverified capture path.

## Phase 2 - Audio engine

- [x] `AudioEngine`: graph, attach/detach, reused buffers, `readFrame()`
- [x] Splitter + three analysers, `smoothingTimeConstant = 0`
- [x] Measurements: RMS, peak, crest, correlation, level follower, onset
- [x] 24 log-spaced bands
- [x] `src/audio/pitch.ts`: noise gate → candidate gate → HPS(5) with
      neighborhood sampling → parabolic interpolation → subharmonic check →
      confidence → jump-detecting smoother
- [x] Note naming with cents
- [x] Verify pitch against known tones (`npm test`)

**Met.** `test/dsp.test.ts` runs the real detector against synthetic signals,
building the spectrum exactly as `AnalyserNode` does. Pitch lands within
0.6 cents on clean sines, is octave-correct on sawtooths and squares, and
confidence goes to 0.000 on white noise and silence.

Two bugs the harness caught that would not have been obvious in the browser, both
now documented in [03-audio-engine.md](03-audio-engine.md#pitch-detection):

1. HPS reported `f/5` for a **pure sine** - the subharmonic ties the true answer
   exactly. Fixed with the candidate-energy gate.
2. HPS reported a 220 Hz sawtooth as 440 Hz because 440 happened to sit closer to
   an integer bin. Fixed by sampling each harmonic as a max over a neighborhood.

## Phase 3 - Oscilloscope mode

- [x] `Renderer` interface: `resize`, `render`, `readout`, `dispose`
- [x] `src/modes/scope/trigger.ts`: edge detection with sub-sample interpolation,
      auto / normal / free-run, slope, amplitude hysteresis, auto level from
      running min/max
- [x] Time base: 1-2-5 sequence, window into the record, samples-per-div math
- [x] Beam rendering: constant-energy-per-segment intensity, bucketed counting
      sort, `'lighter'` compositing
- [x] Persistence buffer with frame-rate-independent multiplicative decay
- [x] Three-pass glow
- [x] Graticule, 10×8 with center ticks, vignette, bezel inset, trigger marker
- [x] Measurements: Vpp, Vrms, frequency and period from trigger intervals, duty,
      dBFS
- [x] X-Y / Lissajous with correlation readout
- [x] Phosphor selection (P31 / P7 / P1)
- [x] Front-panel controls: vertical, horizontal, trigger, display groups

Numeric exit criteria **met** in `npm test`: period measurement is exact to
0.0000% at 100 Hz, 440 Hz, 1 kHz and 4.41 kHz, and trace phase jitter across 24
frames at arbitrary capture offsets is 0.0001% of a cycle - the trace does not
move at all. Duty on a 500 Hz square reads 49.48%. A DC-offset sine still
triggers correctly, confirming auto level.

The harness caught a third bug here: a sample-count **holdoff** discarded two of
every three edges at 4.41 kHz and reported the frequency exactly 3x low. Replaced
with amplitude hysteresis, which is what real scopes use for noise reject and is
frequency-independent by construction. See
[04-mode-oscilloscope.md](04-mode-oscilloscope.md#1-edge-triggering).

Still to confirm in a real browser: the square wave's bright tops and dim edges,
and mono collapsing to a 45° line in X-Y.

## Phase 4 - Cymatics mode

- [x] `src/modes/cymatics/bessel.ts`: `J_m(x)` by power series below x = 15 and
      Miller backward recurrence above, ten-decimal zero table (m 0-8, n 1-6),
      radial LUT cached per mode
- [x] `plate.ts`: mode tables for circular membrane and square plate, with the
      degenerate square-plate combinations weighted by drive-point coupling
- [x] Resonance: driven damped oscillator amplitude, `Q` control, drive-point
      coupling from each mode's own shape at the driver
- [x] Octave folding with the fold amount surfaced in the readout
- [x] Field evaluated to a 128x128 grid via cached radial and angular tables
- [x] Particle system in flat arrays, gradient drift, amplitude-scaled agitation,
      liftoff threshold, friction. Zero allocation per frame
- [x] Broadband fallback driven by the measured spectrum when confidence is low
- [x] Render: plate surface, rim and contact shadow, grains, displacement sheen,
      motion trails on airborne grains only
- [x] Inverse (powder) mode
- [x] Ink palette
- [x] Readouts including `settled %`
- [x] Controls: surface, plate size, damping, drive point, fold, grain, count,
      palette

Physics exit criteria **met** in `npm run test:cymatics`:

- Driving at any mode frequency selects that exact mode (J0,1 / J1,1 / J2,1 /
  J3,1 / J2,3 / J5,2 all correct).
- The membrane spectrum matches the textbook drum ratios to four decimals.
- 440 Hz produces a bit-identical field every time.
- Driving at the center kills every `m > 0` mode, as it must, and moving the
  driver off-center revives them.
- Q = 1000 engages one mode; Q = 10 engages fourteen.
- Broadband noise spreads across fourteen modes with the top one holding only
  10% of the response, so nothing resolves that should not.
- `J_m(x)` matches published values to 1e-14.

Three bugs the harness caught, all documented in
[05-mode-cymatics.md](05-mode-cymatics.md#bessel-functions-in-javascript):

1. The power series collapses to cancellation noise above x ~ 22. The risk was
   written down in the design doc and then shipped anyway; Miller's recurrence
   now covers the upper range.
2. Three published six-decimal zeros are a full unit off in the last place.
   The table is now Newton-refined to ten decimals.
3. Two of my own tests were measuring the wrong thing: `|J_m(alpha)|` against a
   fixed epsilon measures table precision rather than correctness, and a finite
   difference across the algorithm seam measures `J_m'(x)` rather than a
   discontinuity.

**Correction after first real-world comparison.** Watching it next to a video of
an actual plate showed the patterns did not match, and the cause was not tuning:
the mode modelled a fixed-edge *membrane* (wave equation, f ∝ k) and called it a
Chladni *plate* (biharmonic, free edge, f ∝ k²). Most visibly, a fixed rim is a
node, so sand piled into a ring at the boundary that a real plate never has.

Fixed by adding `freeplate.ts`, solving the free-edge Kirchhoff boundary
determinant numerically. Validated against Leissa, *Vibration of Plates* (1969),
every eigenvalue within 0.34%, with the fundamental correctly landing on (2,0).
The membrane is kept as a separate `Drum` surface, since it was never wrong,
only mislabelled. The particle rim handling was also pinning grains to the
boundary, which manufactured the same false ring; they now reflect instead.

Still to confirm in a real browser: 60 fps with 12k grains, and whether a slow
sine sweep visibly snaps between patterns the way the mode table says it should.

**Status: physics verified, visual result not there yet.** Bruce's assessment
after using it: "still needs some work." Every physical claim this mode makes is
now tested, but tested is not the same as good-looking. Where to start when
picking it back up:

- `TUNING` in `src/modes/cymatics/sand.ts` - liftoff threshold, drift, scatter,
  damping. `npm run test:sand` catches a change that breaks grain distribution,
  so this is safe to experiment with.
- `Damping Q`, which controls how many modes sum, and therefore how clean or how
  complex a figure is. It is the most expressive control in the mode.
- Grain rendering. Grains currently cover a third to a half of the nodal core,
  which reads as beaded rather than as continuous sand lines. More grains, a
  finer grid, or accumulating density into an ImageData instead of filling a
  Path2D would each help.
- The single-term Ritz approximation for the square plate gives correct shapes
  but frequencies up to 14% high. A multi-term expansion would tighten the
  spectrum, though it is unlikely to be what is holding the look back.

## Phase 5 - Polish and ship

- [ ] Self-hosted Inter + JetBrains Mono woff2 subsets
- [ ] Preference persistence via `chrome.storage.sync`
- [ ] Empty, connecting, error, and silent states designed rather than defaulted
- [ ] Icon set (16/32/48/128)
- [ ] Keyboard shortcuts and visible focus rings
- [ ] `prefers-reduced-motion` handling
- [ ] Performance pass: verify zero steady-state allocation in the frame path
      via a heap-timeline recording
- [ ] Store listing: screenshots, promo tiles, description, privacy policy
      (browser-fx's `docs/privacy-policy.md` and
      `docs/chrome-web-store-content.md` are the templates)
- [ ] `CLAUDE.md` for this repo

## Ideas not yet scoped

Recorded so they are not lost. Neither is specified yet - the ambiguities below
should be settled with Bruce before building, not guessed at.

### Built-in signal generator

A rudimentary synth, both as a feature and as test equipment. It is probably the
highest-leverage thing on this list, because it closes a real gap in how this
project can be verified.

**Why it is not just a toy.** Every mode here is a claim about a signal, and right
now the only way to check a claim in the browser is to find audio that exercises
it and listen through a lossy stream. That has already cost real time:

- The cymatics exit criterion in Phase 4 is "a slow sine sweep from 100 Hz to
  2 kHz visibly snaps between named mode patterns at the predicted frequencies."
  There is no way to run that today. A sweep generator makes it a ten-second check.
- X-Y fuzz turned out to be partly codec noise from YouTube
  ([04-mode-oscilloscope.md](04-mode-oscilloscope.md#what-smoothing-cannot-fix)).
  A local oscillator has none, so it separates "our rendering is soft" from
  "the source is compressed" instantly.
- The DSP tests verify the math against **fabricated** spectra. Nothing verifies
  that the real `AnalyserNode` path behaves the way those tests assume. A
  generator closes that loop: feed a known 440 Hz sine through the actual audio
  graph and confirm the trace stands still and the readout says 440.

**What it needs to produce.** Exact signals, no dither, precise frequencies -
being trustworthy is the point.

- Oscillators: sine, triangle, saw, square, plus noise for exercising the
  confidence gate and the cymatics broadband path.
- **Independent L and R with a frequency ratio.** This is the canonical X-Y test:
  1:1 draws a circle, 1:2 a figure-eight, 3:2 the classic knot. If those come out
  wrong, X-Y is wrong, and there is no ambiguity about the source.
- A sweep generator with a settable range and rate.
- A small keyboard for playing notes, which is the actual "see the shape of a
  note" use.

**What it changes architecturally.** `AudioEngine.attach()` takes a `MediaStream`
today, and the whole panel assumes a captured tab. This needs a second source path
that runs with no tab at all: oscillators into the same analyser fan-out, and a UI
that treats "internal generator" as a source alongside the tab.

That is the same requirement as Circular Pong below, which needs to synthesize its
own X-Y signal. Worth building the generator first and letting Pong use it.

### Tektronix light mode

A design pass giving the chrome a second, light theme modeled on a Tektronix 2236.
Personal to Bruce - his father sold these for Tektronix in the 90s. Full notes,
including the palette, the details worth taking, and the line between homage and
pastiche, are in
[06-design-system.md](06-design-system.md#planned-tektronix-light-mode).

Two things recorded there that are easy to get wrong: the screen in reference
photos looks blue only because an unlit CRT reflects the room (it is really a
creamy grey-green), and light mode means a light *panel*, never a light screen.

### Circular view for the oscilloscope

A round scope face instead of the 10x8 rectangle. Two readings, and they are
different amounts of work:

1. **A round bezel over the existing sweep** - the trace still runs left to
   right, the screen is just circular with a radial graticule. Cosmetic, cheap,
   and the CRT model already suits it.
2. **A radial time base** - the sweep runs *around* the circle, angle as time and
   radius as amplitude. That is a genuinely different instrument (closer to a
   radar PPI than a scope) and it makes periodic signals close on themselves,
   which is a lovely property: a waveform whose period matches the sweep draws a
   closed standing figure.

Reading 2 is the interesting one and it composes well with triggering, since the
trigger sets where "12 o'clock" falls.

The renderer already separates beam geometry from beam painting
(`buildSweep`/`buildXY` produce points, `bucketize`/`strokeBuckets` paint them),
so a radial time base is a third `build*` method rather than a new renderer.

### Circular Pong (hidden mini-game)

Pong drawn as a vector figure on the scope, on a round playfield: paddles as arcs
on the circumference, ball bouncing inside. Oscilloscope Pong is a real piece of
scope-art history, and X-Y mode is already the right display for it.

Decided:

- **A real game**, not an audio-driven demo. Single player against a CPU opponent.
- **An easter egg**, not a listed mode. It should not appear in the mode tabs; it
  needs a discovery gesture (a key sequence, or something hidden in the chrome).
- **Generate the X-Y audio if it can be done.** This is the honest
  oscilloscope-music version: the extension synthesizes the stereo signal whose
  Lissajous figure *is* the game, so the picture is a true consequence of the
  waveform rather than a drawing that imitates one. Play that signal and a real
  bench scope would show the same game.

That last point inverts the architecture: everything so far only *reads* audio and
never produces any. It needs an oscillator path into `AudioEngine` that can run
without a captured tab - the same path the signal generator above needs, so build
that first and let Pong use it. The renderer would then draw from the analyser like
every other mode rather than from game state directly. Worth checking early
whether the shapes hold up at audio rates - drawing arcs and a moving dot as an
X-Y signal means synthesizing a path at a few hundred Hz refresh, and flicker and
beam-speed artifacts are the usual limits.

Fall back to drawing the game directly if the synthesized version cannot hold a
readable picture, but try the real one first.

## Deferred, with reasons

| Item | Why deferred |
| --- | --- |
| **AudioWorklet ring buffer** | Analyser path is proven and good enough at the time bases people use. Needed for gap-free records, time/div above ~8 ms, and true single-shot triggering. Interface already designed for the swap. See [03-audio-engine.md](03-audio-engine.md#upgrade-path-audioworklet-ring-buffer). |
| **WebGL renderer** | Canvas2D with additive compositing gets ~90% of the CRT look. WebGL would give a true gaussian bloom, no persistence-residue artifact, and headroom for a much denser beam. Worth doing once the modes are settled, not before. |
| **Pop-out window** | Where this becomes a second-monitor fixture. Layout already avoids assuming the side panel is the only surface ([06-design-system.md](06-design-system.md#pop-out-window)). |
| **Spectral flux onset detection** | Level-based onset from browser-fx works. Flux catches transients that do not raise broadband level, like a hi-hat under a bass note. |
| **YIN pitch detection** | Better than HPS for monophonic sources, worse-suited to arbitrary polyphonic tab audio. Belongs with a future "instrument" mode. |
| **Microphone input** | Different permission story, doubles the QA surface. Tab audio first. |
| **Spectrogram / waterfall mode** | The obvious third mode, and a good one, but two done properly beats three done adequately. |
| **Configurable reference pitch** | Matters for non-A440 material. Small, low priority. |

## Where the risk actually is

1. **`getMediaStreamId` from a side panel** - still unverified against a real
   Chrome; it is the one thing the test harness cannot check. Documented fallback
   is the popup handoff in
   [01-architecture.md](01-architecture.md#the-user-gesture-requirement), and the
   call site is isolated in `acquireTabStream()` so moving it is a localized
   change. This is the only remaining item that could force an architecture
   change.
2. **60 fps with 20k particles plus a mode superposition** - the grid-LUT design
   should handle it. The fallback is fewer grains or a coarser grid, both of which
   are graceful.
3. **Persistence residue in Canvas2D** - a known artifact of alpha-decay toward
   black. Mitigated with a floor threshold; solved properly by the WebGL path.
4. **Trigger stability on real music** - a bass-heavy mix has many crossings per
   cycle. Holdoff plus auto level is the standard answer, and low-pass filtering
   the trigger source is the escalation if needed.
