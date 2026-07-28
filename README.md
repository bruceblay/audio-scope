# Audio Scope

A Chrome extension that visualizes the audio playing in any tab. Free, no
account, no telemetry, zero outbound network requests.

Two modes:

- **Oscilloscope** - a genuinely triggered CRT scope. Sub-sample edge triggering
  so a tone stands perfectly still, calibrated 10x8 graticule, real beam-dwell
  brightness and phosphor persistence, plus X-Y (Lissajous) for the stereo field.
- **Cymatics** - a driven-plate simulation where detected pitch excites the real
  eigenmodes of a membrane or plate, and sand grains migrate to the nodal lines.
  Designed, not yet built.

The point is that the measurements are real. Play a 440 Hz tone and the frequency
readout says 440. Sweep the pitch and the cymatic pattern snaps between mode
families exactly where the resonances are.

## Development

```bash
npm install
npm run dev      # watch build into dist/
npm test         # DSP verification against synthetic signals
```

Load `dist/` at `chrome://extensions` with Developer mode on, via "Load unpacked".
Click the toolbar icon to open the side panel, then Connect.

There is no hot reload - a Chrome extension cannot load from Vite's dev server.
The watch rebuild takes ~50 ms; use Chrome's extension reload button.

## Documentation

Design reasoning, physics derivations, and the build plan live in
[`docs/`](docs/). Start with [docs/00-overview.md](docs/00-overview.md).

## Credit

The MV3 tab-capture architecture is derived from
[browser-fx](../browser-fx), a shipped extension that proved the path. What
transfers and what deliberately differs is written up in
[docs/02-reference-browser-fx.md](docs/02-reference-browser-fx.md).
