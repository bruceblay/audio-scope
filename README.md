# Audio Scope

A Chrome extension that visualizes the audio playing in any tab. Free, no
account, no telemetry, zero outbound network requests.

Two modes, each with two display styles:

- **Oscilloscope** - a genuinely triggered CRT scope. Sub-sample edge
  triggering so a tone stands perfectly still, calibrated 10x8 graticule, and
  an analytic GPU beam: each audio segment is drawn as the exact integral of a
  travelling Gaussian spot (the woscope technique), so brightness follows beam
  dwell time per pixel and phosphor persistence decays like a tube. X-Y mode
  streams the stereo field the way oscilloscope music is meant to be seen,
  each sample drawn exactly once.
- **Analyzer** - spectrum curve or third-octave bars with peak hold and
  pink-noise tilt, and a waterfall spectrogram on a perceptually uniform
  colour ramp. Log frequency axis, fractional-octave smoothing, analysis
  windows from snappy to bass-resolving.

Either mode can also render in **Dots** style: the same signal drawn the way a
terminal plotter draws, a dithered dot lattice with quantized brightness and a
lazy refresh.

There is also a built-in **synth** (two oscillators, filter, envelopes, delay,
reverb, arpeggiator) played from the computer keyboard, so you always have a
known signal to explore, and a **preset** system with factory scenes for
oscilloscope music, spectrogram art, and a stock bench scope.

The point is that the measurements are real. Play a 440 Hz tone and the
frequency readout says 440. The trigger, the pitch detector, the analyzer axes
and the display quantizers are all verified against synthetic test signals in
`npm test`.

## Development

```bash
npm install
npm run dev      # watch build into dist/
npm test         # DSP verification against synthetic signals
npm run package  # production zip for the Chrome Web Store
```

Load `dist/` at `chrome://extensions` with Developer mode on, via "Load unpacked".
Click the toolbar icon to open the side panel, then Connect.

There is no hot reload - a Chrome extension cannot load from Vite's dev server.
The watch rebuild takes ~50 ms; use Chrome's extension reload button.

## Documentation

Design reasoning, physics derivations, and the build plan live in
[`docs/`](docs/). Start with [docs/00-overview.md](docs/00-overview.md). A
cymatics mode (Chladni-plate simulation) was designed and prototyped, then
shelved; its physics write-up remains in
[docs/05-mode-cymatics.md](docs/05-mode-cymatics.md).

## Credit

The MV3 tab-capture architecture is derived from
[browser-fx](../browser-fx), a shipped extension that proved the path. What
transfers and what deliberately differs is written up in
[docs/02-reference-browser-fx.md](docs/02-reference-browser-fx.md). The
analytic beam rendering follows the technique shared by
[woscope](https://github.com/m1el/woscope), the
[XXY Oscilloscope](https://dood.al/oscilloscope/), and
[Nick Tasios' write-up](http://nicktasios.nl/posts/simulating-an-xy-oscilloscope-on-the-gpu.html).
