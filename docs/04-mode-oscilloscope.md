# Mode: Oscilloscope

A triggered analog-style oscilloscope. The goal is that someone who has used a
bench scope recognizes it immediately, and that the readouts are actually correct
enough to measure with.

## What makes it real

Most web "oscilloscopes" draw `analyser.getFloatTimeDomainData()` straight across
the canvas. The result slides sideways constantly, because the analyser's record
is not phase-locked to anything. It looks like an oscilloscope but it behaves like
nothing. Three things fix it.

### 1. Edge triggering

A real scope holds a periodic waveform still by starting each sweep at the same
point in the cycle. It watches for the signal crossing a **trigger level** in a
chosen **direction** (slope), and starts drawing there.

```ts
// Scan for the first crossing of `level` in the rising direction, then
// interpolate the sub-sample position for a rock-steady trace.
for (let i = start; i < searchEnd; i++) {
  const a = buf[i], b = buf[i + 1]
  if (a < level && b >= level) {
    const frac = (level - a) / (b - a)     // linear interpolation
    return i + frac
  }
}
```

Sub-sample interpolation is what separates a trace that sits perfectly still from
one that shivers by a pixel. Without it the trigger point quantizes to whole
samples, so a 1000 Hz tone at 48 kHz (48 samples per cycle) jitters by up to
1/48th of a cycle every frame.

Modes:

| Mode | Behavior |
| --- | --- |
| **Auto** | Trigger if a crossing is found; otherwise sweep anyway so you always see something. This is the default, and it is what real scopes default to. |
| **Normal** | Only redraw when a crossing is found. A steady display that freezes on the last trace when the signal stops. |
| **Free run** | No trigger. Honest about being untriggered. |

Slope: rising, falling, or either. Level: a knob, in volts, drawn as a marker on
the screen edge like a real scope.

**Noise reject is hysteresis, not holdoff.** After an edge, the signal must move
back past the level by a fraction of the peak-to-peak amplitude before another
edge counts. That is what rejects the multiple crossings noise produces on a slow
edge.

This started as a time-based holdoff (suppress re-triggering for N samples) and
the test harness caught why that is wrong: a 24-sample holdoff silently discards
two of every three edges of a 4.4 kHz tone, which has only 10.9 samples per cycle,
and the frequency readout comes out exactly 3x low. Hysteresis is amplitude-based,
so it is independent of frequency and cannot corrupt a measurement. Real scopes
label this control "noise reject" for the same reason.

### 2. Auto-trigger level from the measured signal

A fixed 0.0 trigger level fails on a DC-offset or asymmetric signal, and on very
quiet audio the trace never triggers. Default behavior tracks the signal:

```
level = (runningMin + runningMax) / 2      // the actual midpoint
```

with `runningMin`/`runningMax` decaying slowly toward the current record so the
level follows a fade without hunting. Manual override is available. This is the
same idea as a real scope's "Set level to 50%" button, run continuously.

### 3. Calibrated time base and readouts

The screen is a real graticule: **10 horizontal divisions × 8 vertical**, the
standard layout. Time/div and volt/div come from a 1-2-5 sequence, again matching
real instruments:

```
time/div:  10µs  20µs  50µs  100µs  200µs  500µs  1ms  2ms  5ms  10ms  20ms  50ms
volt/div:  10mV  20mV  50mV  100mV  200mV  500mV  1V
```

Samples per screen = `10 · (time/div) · sampleRate`. At 1 ms/div and 48 kHz that
is 480 samples out of the 4096-sample record, so most time bases are a window
into the record rather than the whole thing, which is exactly how a digital scope
works. Above ~8.5 ms/div the record runs out; those settings are shown but marked
until the AudioWorklet ring buffer lands (see
[03-audio-engine.md](03-audio-engine.md#upgrade-path-audioworklet-ring-buffer)).

"Volts" here means normalized sample amplitude, where full scale is ±1.0. That is
the honest unit for digital audio, and the readout says `FS` rather than pretending
to be volts.

Live measurements in the readout, all computed from the record, not estimated:

- **Vpp** - peak-to-peak, `max - min`
- **Vrms** - true RMS, not `Vpp/2.83` (which is only right for a sine)
- **Freq / Period** - from the *interval between successive trigger crossings*,
  averaged over the record. Measuring the period from trigger events is
  independent of the FFT and much more precise at audio frequencies than bin
  interpolation.
- **Duty** - fraction of the period above the trigger level
- **dBFS** - `20·log10(peak)`

## X-Y mode (Lissajous)

Left channel drives X, right drives Y. This is a real scope feature and it is the
best stereo-field display there is:

- Mono content collapses to a 45° diagonal line.
- Wide stereo opens into a blob or a circle.
- Out-of-phase content rotates to the other diagonal.
- A pure tone against a phase-shifted copy of itself draws a clean ellipse whose
  shape reads out the phase angle directly.
- Oscilloscope music (Jerobeam Fenderson and company) is composed *for* this
  display and draws recognizable figures.

X-Y mode has no time base and no trigger. It plots a connected path in 2D with
the same beam physics as the main mode. `correlation` from the audio frame is
shown as a readout beside it, and the graticule becomes square to match the plot
area, with dashed diagonals marking where mono and out-of-phase content lie.

### The streaming beam (which replaced Exposure)

Each frame draws exactly the audio that arrived since the previous frame, and
each sample is painted exactly once - the way the electron beam sweeps it
exactly once. Persistence alone carries history. The previous frame's final
beam position opens the next frame's path, so strokes connect across frame
boundaries.

The design it replaced drew the most recent `exposure` samples every frame.
At 60 fps roughly 16 ms of new audio arrives per frame, so a 43-85 ms
exposure window repainted every stroke two to five times, each time slightly
displaced as the figure animated, and the passes stacked additively into fog.
Side-by-side with real oscilloscope-music footage the difference was not
subtle: the reference drew crisp single strokes with invisible transits; ours
drew a green cloud. No setting could fix it, because the redraw was
structural. The Exposure control was removed with the redraw - in a streaming
beam it has nothing left to mean.

Streaming also exposed a dots-mode flaw the redraw had been hiding: honest
dwell energies span orders of magnitude (a parked beam versus a fast
transit), and linear normalization pushed every moving stroke below the lit
threshold. The lattice now applies a cube-root brightness response -
phosphor saturates - before quantizing.

### Smoothing

A real scope's deflection amplifiers have finite bandwidth and its beam has finite
spot size, both of which low-pass the trace. Without something equivalent, X-Y on
dense material looks jagged in a way no physical instrument does.

Implemented as **three cascaded centred box passes**, which approximate a
Gaussian. Two details, both of which were got wrong first:

**Centred, not recursive.** A one-pole filter is cheaper and delays X and Y by
the same amount, but that delay is a phase shift, and a phase shift between the
two axes rotates and opens a Lissajous figure. On an X-Y display that is not
smoothing, it is a different picture.

**Three passes, not one.** A single box filter has a sinc response whose first
sidelobe is only -13 dB, so broadband noise sails through almost untouched.
Cascading three cubes that to about -40 dB. Measured at a matched -3 dB corner,
so the real figure is blurred exactly as much either way:

| -3 dB corner | 1 pass | 3 passes | Improvement |
| --- | --- | --- | --- |
| 2376 Hz | -18.4 dB | -21.4 dB | 1.4x |
| 1253 Hz | -22.8 dB | -50.4 dB | 24x |
| 645 Hz | -29.1 dB | -60.9 dB | **39x** |
| 435 Hz | -32.2 dB | -69.8 dB | 76x |

(RMS gain over 4-24 kHz, which is where broadband noise lives.)

The first version shipped the single pass, and at maximum smoothing it was
letting through 39 times more noise than it needed to for the same blur. Sidelobe
behaviour is the whole story with box filters and it is invisible unless measured.

### What smoothing cannot fix

Lossy-compressed sources carry codec noise spread broadly across the spectrum.
On an X-Y display that noise is displacement *perpendicular to the trace*, so it
reads directly as fuzz around every line.

This is a real floor, not a rendering shortcoming. A rendered video of
oscilloscope music was drawn from the original uncompressed audio; a browser tab
is playing a ~128 kbps Opus stream of it. The figures will not be equally crisp,
and no amount of filtering recovers samples the encoder discarded. Filtering
trades fuzz for rounded corners, and past a point the corners are what is left.

### BW limit

The X-Y smoothing above is an aesthetic control and it stays one. The honest
cleanup control is the one a bench scope actually has: **BW LIMIT**, a lowpass
on the vertical channel, labeled in hertz. It sits in the Vertical section and
applies to both the sweep and X-Y, ahead of the trigger - deliberately so,
because the HF noise that scribbles the trace is the same noise that jitters
the trigger edge, which is why the real button exists.

The filter is a Gaussian FIR (`src/modes/scope/bandwidth.ts`), the response
scope front ends are deliberately designed toward: monotonic step response, no
ringing, no sidelobes. The box-cascade smoothing leaks HF through its sidelobes
- the same lesson the analyzer's smoothing taught - which is part of why maxed
smoothing never fully tamed the scribble. Verified in `test/dsp.test.ts`:
every offered cutoff reads within 0.03 dB of -3 dB at its stated frequency and
crushes two octaves up by ~50 dB. The range starts at 4 kHz because at 8 kHz
sigma falls below one sample and a sampled Gaussian that narrow misstates its
own cutoff by over a decibel; the test caught it and the step was removed
rather than excused.

Default is Full: the scribble on real material is part of the instrument's
character, and cleaning it up is a choice, not a correction.

In review, BW limit turned out to address only half the scribble, and the
smaller half. See the next section.

### Halation: where the scribble actually lives

BW limit and smoothing both operate *within one pass* of the beam. Shipping BW
limit and watching it fail to fix the scribble forced the better diagnosis,
which the user supplied: the trace "looks like the line is traced over in the
same path several times with slight variations." That is literally the
mechanism. Persistence holds roughly a dozen frames of trace, each frame draws
a slightly different rendition of the figure (phase drift, vibrato, codec
jitter), and every historical pass stays forever-crisp inside the persistence
buffer. A stack of nearly-identical crisp hairlines *is* the scribble, and no
per-pass filter can touch pass-to-pass variation.

A real CRT does not have this problem, because the beam spot and phosphor
halation are optical lowpasses over the *accumulated image*: superimposed
passes fuse into one bright ribbon. The renderer now models that with the
**Halation** control (Display section): each frame the persistence buffer is
diffused by a sub-pixel blur (up to 1.6 px per frame at the slider's top).
Blur compounds across frames as sqrt(n), so the newest trace stays sharp while
history melts together into an averaged band. Verified by A/B render of a
deliberately drifting 3:2 Lissajous with vibrato and noise through the real
renderer: at 0 the figure is a bundle of hairlines, at 0.5 each path is a
single soft ribbon, at 1.0 it is fully fused.

Default is 0.8: the fused ribbon is the intended look (chosen by eye on real
material). Zero restores the forever-crisp stacking exactly.

## Dots display style

The scope has two display disciplines, switched in the Display section: the
CRT below, and **Dots** - the same trace drawn the way a terminal draws it
(`src/modes/scope/tui.ts`). Not a retro filter over the CRT image: a second
set of real constraints, which is where the look comes from.

- **Geometry quantizes to a character-cell lattice**, ~7x14 px cells refined
  by 2x4 sub-dots per cell - the Braille trick every terminal plotter uses.
  Trace segments rasterize into the lattice; lit sub-dots draw as square dots.
- **Brightness quantizes to four levels.** A terminal cell has one colour, so
  the cell takes one level (from its brightest sub-dot, normalized against a
  slow-falling running maximum) and its sub-dots simply exist or do not.
- **The screen refreshes at ~18 Hz**, not the display's frame rate. Between
  ticks the canvas keeps its pixels, exactly as a terminal would. The slight
  choppiness is part of the discipline, not a performance artifact.
- **Dwell physics carries over at lattice resolution.** Every segment spans
  the same slice of time, so every segment deposits the same energy, spread
  over the sub-dots it crosses - slow beam travel makes bright cells the same
  way it makes bright phosphor. The test suite checks this equality; writing
  the test caught an endpoint over-deposit that made short segments up to 2x
  too bright.
- **Persistence decays in steps**, one multiplicative fade per tick with a
  flush to true zero. Focus and halation do not apply - there is no beam width
  and no phosphor image to diffuse - and their controls hide in Dots style.
- The graticule becomes dotted rules, one dot per cell: terminal box
  furniture rather than etched glass.

Everything upstream is shared with the CRT path: trigger, sweep, X-Y
projection, BW limit, smoothing, and all measurements.

The analyzer shares the discipline (`src/lib/tui.ts` holds the common cell
machinery): its curve becomes a dotted outline with vertical cliffs walked
dot by dot, bars become the stacked half-cell block ladder every hardware RTA
and cassette deck drew, and the waterfall quantizes its colour ramp to six
colours with 4x4 Bayer ordered dithering at cell resolution - ordered rather
than error-diffused or random because a fixed threshold pattern adds no
texture that is not in the data. Both modes switch styles independently, from
their own Display sections.

## CRT rendering

### The analytic beam (GPU)

The trace is painted by a WebGL2 pipeline (`src/modes/scope/beamgl.ts`) using
the technique every serious web oscilloscope converged on independently -
woscope (m1el), XXY Oscilloscope (N. Thapen), Nick Tasios' write-up. Each
audio segment becomes an instanced quad whose fragment shader evaluates the
exact integrated intensity of a Gaussian beam spot travelling the segment:

    F(p) = (E / 2l) * exp(-py^2 / 2s^2)
         * [erf(px / s*sqrt2) - erf((px - l) / s*sqrt2)]

The 1/l factor is dwell physics falling out of the integral: equal energy
spread over a longer path is dimmer per pixel, continuously, which replaces
the Canvas2D path's 24-bucket approximation. Energy accumulates linearly in a
half-float texture - light adds; 8-bit canvas compositing clips, which was a
large part of the historical "fog" - persistence is a per-frame
multiplicative decay of that texture, and a tonemap converts energy to
phosphor colour, saturating through the core hue toward bloom-white.
Halation on this path is a second, four-sigma-wide component of the beam
itself rather than a blur of the accumulated image.

The Canvas2D pipeline below remains in full as the automatic fallback (no
WebGL2, no float render targets, or a lost context), and everything outside
the paint - trigger, measurements, furniture, readouts - is shared by both
paths untouched.

The sections below describe the Canvas2D fallback's model. The look is not a
filter over a line chart: it is a model of what an analog scope screen
actually does, and the model is why it looks right. The GPU path computes the
same physics exactly; the fallback approximates it.

### Beam intensity follows dwell time

An electron beam deposits energy at a constant rate as it sweeps. Where the trace
moves slowly across the screen, more energy lands per unit length, so the phosphor
glows brighter. Where it moves fast, it is dim. This is why the flat tops of a
square wave are bright and the vertical edges are nearly invisible, and why a sine
wave is brightest at its peaks.

Implementation: energy per segment is constant (the beam spends equal time on
each), and brightness is that energy spread over however many pixels the segment
covers.

```ts
const hstep = width / pointCount          // energy per segment, normalized
const len = Math.hypot(x2 - x1, y2 - y1)
const alpha = clamp(intensity * hstep / Math.max(len, dpr), 0, 1)
```

Two details make the model self-consistent:

- Dividing by `pointCount` keeps the **total** energy per sweep constant, so
  changing the time base does not change how bright the screen is.
- Coverage floors at one device pixel. A sub-pixel segment still lights a whole
  pixel, and without the floor a densely sampled flat trace accumulates several
  times too much brightness.

Drawn with `globalCompositeOperation = 'lighter'` so overlapping segments sum,
the way light does. This single detail is the difference between "green line" and
"oscilloscope."

Segments are quantized into 24 brightness buckets and counting-sorted so each
bucket strokes as a single path. Without that, 4096 individual strokes times three
glow passes is 12,000 draw calls a frame and nothing renders at 60 Hz.

### Phosphor persistence

P31 phosphor (the standard green scope phosphor, peak emission 525 nm) has a
decay in the tens of microseconds for the fast component but a visible
afterglow. On screen this means the previous traces linger and fade, which is
what makes a modulating waveform readable and what gives the display its depth.

Implementation: the trace renders into a transparent persistence buffer that is
never cleared. Each frame the buffer is faded before the new trace is added:

```ts
persistCtx.globalCompositeOperation = 'destination-out'
persistCtx.fillStyle = `rgba(0, 0, 0, ${decayPerFrame})`
persistCtx.fillRect(0, 0, w, h)
```

`decayPerFrame` is derived from a persistence time in seconds and the actual frame
delta, so the decay rate is frame-rate independent:

```ts
const decayPerFrame = 1 - Math.exp(-dt / persistenceSeconds)
```

`destination-out` rather than filling with black: it **multiplies** the existing
alpha by `(1 - d)` instead of blending toward a grey floor. The buffer is then
composited over the graticule, so the trace appears to sit on the glass in front
of it.

That alone is not enough, and the leftover shows up as burn-in.

The buffer holds 8-bit alpha, so a pixel stops moving as soon as `alpha × d`
rounds to nothing. At a 1 s time constant the per-frame decay is 0.017, which
strands every alpha below about 30 - roughly **12% opacity, permanently**,
precisely where the trace has been. Turning persistence to zero clears it because
`d` becomes 1, which is exactly the symptom that identifies the cause.

The fix is to stop applying a decay too small to have an effect. Elapsed time
accumulates as a debt and the decay is applied only once it reaches `MIN_DECAY`
(0.08), which bounds the residue near 2% instead of 12%. The cost is that a long
tail steps down rather than gliding, at intervals short enough not to see.

A float or 16-bit accumulation buffer would remove the floor entirely rather than
bounding it, which is one more reason the WebGL path in
[07-plan.md](07-plan.md) is worth doing eventually.

### Glow and bloom

Cheap and effective: draw the trace three times into the persistence buffer at
decreasing line widths and increasing alpha, all additive.

| Pass | Width | Alpha |
| --- | --- | --- |
| Outer halo | 6 px | 0.06 |
| Mid | 2.5 px | 0.18 |
| Core | 1 px | 0.9 |

`ctx.shadowBlur` produces a nicer falloff but it is 10-50× slower and it stalls at
60 Hz on a large canvas. The three-pass approach is the standard trick and the
difference is not visible.

### Screen furniture

- **Graticule**: 10×8 divisions in a faint cool white, center axes slightly
  brighter, plus the small 0.2-division tick marks along the center lines that
  real scopes use for rise-time measurement. Drawn *under* the trace, at low
  alpha, so the beam appears to sit on the glass in front of it.
- **Vignette**: a radial darkening at the edges. Real CRT faces are not uniform.
- **Inner shadow** at the screen bezel so the glass sits recessed in the housing.
- **Trigger level marker**: a small arrow on the left edge at the trigger voltage,
  as on a real scope.
- **No scanlines.** A scope is a vector display, not a raster one. Scanlines
  would be the single most obvious tell that this was designed by someone who has
  not used one.

### Colors

| Phosphor | Color | Notes |
| --- | --- | --- |
| **P31 green** | `#2bff6a` | Default. The classic scope green. |
| **P7 blue-white** | `#a8d8ff` | Long-persistence storage-scope look. Pairs with a longer default persistence. |
| **P1 amber** | `#ffb340` | Not historically a scope phosphor, but a beautiful option and honest about being a choice. |

Bloom color is the phosphor hue desaturated toward white at high intensity,
because a saturating phosphor does exactly that.

## Controls

Grouped as on a real front panel, which also happens to be the clearest layout:

- **VERTICAL** - volt/div, position, channel (L / R / L+R / X-Y)
- **HORIZONTAL** - time/div, position
- **TRIGGER** - mode, slope, level (auto or manual), noise reject
- **BEAM** (X-Y only) - exposure, smoothing
- **DISPLAY** - phosphor, persistence, focus, intensity, graticule brightness

Focus and intensity are separate knobs, as on a real front panel: one sets how
wide the beam lands, the other how much light it deposits. An earlier version let
intensity fatten the line, which made a bright trace read as an out-of-focus one.

Defaults chosen so the first thing you see is good: Auto trigger, rising slope,
auto level, 4% noise reject, 1 ms/div, 0.2 FS/div, P31 green, 0.25 s persistence.
