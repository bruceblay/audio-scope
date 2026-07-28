# Audio Scope: Overview

## What it is

A Chrome extension that visualizes the audio playing in any browser tab. Not a
decorative "audio reactive" toy: every mode is a real instrument or a real
physical simulation, driven by real measurements of the signal.

Two modes at launch:

1. **Oscilloscope** (retro CRT) - a genuine triggered time-domain scope with
   calibrated time/div and volt/div, plus X-Y (Lissajous) mode for the stereo
   field.
2. **Cymatics** - a real driven-membrane simulation. Detected pitch excites the
   actual eigenmodes of a circular membrane or a square plate; sand particles
   migrate to the nodal lines the way they do on a real Chladni plate.

## Positioning

Free, no account, no telemetry. The selling point is craft: it looks and feels
like a piece of hardware, and the physics underneath is honest. Most audio
visualizers do `bass = average(bins 0..4)` and multiply a sine wave by it. This
one does edge triggering, parabolic-interpolated FFT peak picking with harmonic
product spectrum, Bessel-function mode shapes, and Lorentzian resonance
response. That difference is visible: play a 440 Hz sine and the cymatic pattern
is reproducible and specific. Sweep the frequency and the pattern snaps between
mode families exactly where the resonances are.

## Design goals

- **Instrument, not skin.** The oscilloscope reads like a Tektronix bench scope:
  restrained metal, an inset screen with real depth, an etched graticule,
  tabular-numeral readouts. No fake screws or leather.
- **The visual is the product.** Chrome collapses away. The canvas gets the
  whole panel.
- **Correct first, pretty second, and they agree.** CRT beam brightness follows
  real electron-beam dwell time. Phosphor persistence follows real decay. Both
  choices happen to be what makes it look good.

## Non-goals

- Audio effects or processing. That is [browser-fx](../../browser-fx)'s job.
  Audio Scope is read-only: it taps the signal, plays it back untouched, and
  draws.
- Microphone or system-wide capture at launch. Tab audio only.
- Recording or export at launch.

## Constraints that shape everything

- Chrome MV3: no `AudioContext` in a service worker, so audio lives in a
  document (see [01-architecture.md](01-architecture.md)).
- `chrome.tabCapture` **redirects** tab audio into our stream. If we do not
  play it back, the tab goes silent. Playback is mandatory, not optional.
- `AnalyserNode` downmixes to mono, so stereo work needs a `ChannelSplitterNode`
  feeding one analyser per channel.

## Documents

| File | Contents |
| --- | --- |
| [01-architecture.md](01-architecture.md) | MV3 layout, capture handshake, lifecycle |
| [02-reference-browser-fx.md](02-reference-browser-fx.md) | What we reuse from browser-fx, what we changed, and why |
| [03-audio-engine.md](03-audio-engine.md) | Audio graph, analysers, measurement and pitch detection |
| [04-mode-oscilloscope.md](04-mode-oscilloscope.md) | Scope physics, triggering, CRT rendering |
| [05-mode-cymatics.md](05-mode-cymatics.md) | Membrane and plate eigenmodes, resonance, sand transport |
| [06-design-system.md](06-design-system.md) | Visual language and tokens |
| [07-plan.md](07-plan.md) | Phased build plan and status |
