# Audio Scope - Claude Context

## What this is

Chrome MV3 extension. Visualizes tab audio in a side panel. Two modes:
a triggered CRT oscilloscope (built) and a physically simulated Chladni plate
(designed, not built).

The differentiator is that the physics and signal processing are real, not
decorative. Read [docs/00-overview.md](docs/00-overview.md) before changing
anything that touches the math.

## Docs are the source of truth

`docs/` carries the reasoning. Code comments carry the *why*, not the *what*.
When you change an approach, update the doc in the same edit.

| File | Contents |
| --- | --- |
| `docs/00-overview.md` | Positioning, design goals, non-goals |
| `docs/01-architecture.md` | MV3 layout, capture handshake, teardown matrix |
| `docs/02-reference-browser-fx.md` | What we reuse from `../browser-fx` and why we diverged |
| `docs/03-audio-engine.md` | Node graph, measurements, pitch detection |
| `docs/04-mode-oscilloscope.md` | Triggering, time base, CRT rendering |
| `docs/05-mode-cymatics.md` | Membrane/plate eigenmodes, resonance, sand transport |
| `docs/06-design-system.md` | Visual language and tokens |
| `docs/07-plan.md` | Phased plan with live status |

## Architecture in one paragraph

The **side panel** hosts the `AudioContext` and owns everything: capture,
measurement, rendering. The **service worker** only opens the panel and sets the
badge. There is no offscreen document and no content script. Audio data never
crosses a message boundary, which is the whole reason the panel hosts the graph
rather than an offscreen document like `../browser-fx` does.

## Critical files

| File | Why it matters |
| --- | --- |
| `src/audio/capture.ts` | The only place `getMediaStreamId` / `getUserMedia` are called. If capture breaks, it breaks here. |
| `src/audio/engine.ts` | The graph and every measurement. `attach()` always `detach()`es first. |
| `src/audio/pitch.ts` | HPS pitch detection. Subtle, verified by tests, do not "simplify". |
| `src/modes/scope/trigger.ts` | Edge triggering with sub-sample interpolation. The trace standing still depends entirely on this. |
| `src/modes/scope/renderer.ts` | Beam physics, persistence, glow. |

## Commands

```bash
npm run dev        # vite build --watch into dist/
npm run build      # typecheck + production build
npm run typecheck
npm test           # DSP verification against synthetic signals
```

Load `dist/` as an unpacked extension. There is no HMR - a Chrome extension
cannot load from Vite's dev server. Rebuild is ~50 ms; hit Chrome's reload button.

## Rules

These are inherited from `../browser-fx`'s CLAUDE.md and earned in production.

1. **Never break working audio.** Verify audio still plays after any change to
   `src/audio/`. `tabCapture` *redirects* the tab's audio - if playback to
   `ctx.destination` breaks, the user's tab goes silent, which is worse than a
   broken visualizer.
2. **`chrome.runtime.onMessage` listeners must not be `async`.** An async
   listener returns a Promise instead of the literal `true` Chrome needs to keep
   the response port open, and `sendResponse` after an `await` races the teardown.
3. **Ignore messages you do not own.** `sendMessage` broadcasts to every
   extension context. Return nothing so the real recipient's response wins.
4. **`attach()` detaches first, always.** A stale stream blocks the next
   `getUserMedia` and the failure is completely silent.
5. **No allocation in the frame path.** Buffers are created once in constructors.
   `readFrame()` and `render()` fill them. The one exception is 24 `Path2D`
   objects per frame in the scope renderer, which is documented at the call site.
6. **Never smooth silently.** All three `AnalyserNode`s have
   `smoothingTimeConstant = 0`. Smoothing happens in our code where it is visible.
7. **If it claims to be physics, it has to be physics.** Non-integer mode numbers,
   made-up frequency mappings, and "close enough" resonance curves are the exact
   thing this project exists not to do. If a modeling shortcut is necessary, make
   it visible in the readout and write it down in the doc.
8. **Run `npm test` after touching `pitch.ts` or `trigger.ts`.** It has already
   caught three bugs that were invisible by eye.

## Known state

- Oscilloscope mode: complete, DSP verified by `npm test`, **not yet run in a
  real browser**.
- Cymatics mode: designed in `docs/05-mode-cymatics.md`, tab is disabled in the
  UI, no implementation.
- The one unverified assumption is whether `chrome.tabCapture.getMediaStreamId()`
  is permitted from a side panel. Fallback is documented in
  `docs/01-architecture.md`; the call site is isolated so moving it is local.
