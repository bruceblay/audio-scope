# Reference: browser-fx

`../browser-fx` is a shipped, production Chrome extension that captures tab
audio and processes it with the Web Audio API. It is the source of truth for
anything to do with MV3 tab capture. This document records what transfers, what
does not, and the hard-won lessons encoded in its comments.

## What we take directly

### 1. The capture API and its exact shape

browser-fx proved the MV3 tab-capture path. Two calls matter:

```ts
// Must run in a context with a user gesture. Returns an opaque id.
const streamId = await chrome.tabCapture.getMediaStreamId()
```

```js
// Consumes the id. Must run in a *document*, not the service worker.
// Note the legacy `mandatory` shape - the modern constraint spelling
// does not work for chromeMediaSource.
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
})
```

Source: `browser-fx/src/background.ts:69` and
`browser-fx/offscreen-effects.js:2740`.

### 2. Per-tab state keyed by tab id

browser-fx keeps a `Map<tabId, TabAudioState>` so several tabs can be captured
at once and cleanup is scoped. Audio Scope visualizes one tab at a time, but the
keyed-state discipline still applies: a stale stream from a previous capture
**blocks the next `getUserMedia` and the capture silently no-ops**. So always
tear down before setting up.

> `browser-fx/offscreen-effects.js:2826` - "Start from a clean slate: a stale
> stream left over from a previous capture blocks the new getUserMedia and the
> effect silently never engages"

### 3. Message-listener rules

Both listeners in browser-fx carry the same warning, and it is correct:

> A `chrome.runtime.onMessage` listener must **not** be `async`. An async
> listener returns a Promise instead of the literal `true` Chrome needs to keep
> the response port open, so any `sendResponse` after an `await` races the port
> teardown and the sender sees "message port closed" even though processing
> succeeded.

Corollaries we adopt:

- Return `true` explicitly when responding asynchronously.
- Return nothing (not `false`, not `true`) for messages this listener does not
  own, so the real recipient's response wins. `chrome.runtime.sendMessage`
  broadcasts to *every* extension context, including the sender's siblings.
- Guard on a discriminator (browser-fx uses `message.tabId === undefined`) to
  ignore your own broadcast copy.
- "message port closed" after the work is already handed off is not a failure.
  browser-fx explicitly swallows it (`src/background.ts:98`) rather than
  reporting failure to the UI. We do the same.

### 4. Truthful state, not remembered state

browser-fx stores `isCapturing` per tab in `chrome.storage`, then on popup open
asks the audio host whether it is *actually* capturing (`GET_TAB_STATUS`,
`src/popup.tsx:174`) because stored state goes stale when a tab navigates or the
document is torn down. We keep this: the audio host owns the truth, storage is
only a hint.

### 5. Log-spaced frequency bands

`getVisualizerBands()` (`offscreen-effects.js:2912`) buckets FFT bins with
`Math.pow(binCount, b / BAND_COUNT)` rather than linear slices, so low bands are
narrow and high bands are wide. That is the right call - it matches how pitch
maps to frequency. We reuse the idea for the spectrum readout, though our main
measurements are finer-grained (see [03-audio-engine.md](03-audio-engine.md)).

### 6. Envelope shaping that reads well

From `browser-fx/src/components/Visualizer.tsx`, three techniques worth keeping:

- **Asymmetric smoothing**: fast attack, slow release
  (`smooth += (target - smooth) * (target > smooth ? 0.55 : 0.1)`). Motion feels
  responsive without flicker.
- **Contrast expansion**: square the band value so quiet passages stay calm and
  hits pop.
- **Onset detection by self-comparison**: track a slow-moving average of level,
  and treat `level > slowAvg * 1.05` as a transient. Feed a fast-decay envelope.
  Cheap, no FFT flux needed, and it works.

### 7. The design language

`browser-fx/src/theme.ts` is modeled on Ableton Live / Max for Live devices:
near-black surfaces, one saturated accent, restrained type. Audio Scope inherits
the restraint and the token structure but not the palette - a bench instrument
is a different object than a Live device. See
[06-design-system.md](06-design-system.md).

## What we deliberately change

### Audio lives in the side panel, not an offscreen document

browser-fx must survive its popup closing, because a user turns on reverb and
walks away. So it puts audio in an offscreen document and pumps visualizer data
to the popup over `chrome.runtime.sendMessage` at 20 Hz (16 numbers per frame).

Audio Scope has the opposite requirement. The visualizer is only worth running
while you can see it, and it needs **far** more data: a full time-domain record
(2048-4096 floats, per channel) every frame at 60 Hz. Shipping that across a
message boundary is ~1 MB/s of structured clone with jitter, and jitter destroys
trigger stability.

So the side panel hosts the `AudioContext` itself. The `AnalyserNode` and the
canvas live in the same JS context, zero copies, zero latency. When the panel
closes, the stream ends and Chrome restores normal tab playback. That is the
behavior we want anyway.

Consequence: we do not need an offscreen document at all, which also removes
browser-fx's `scripts/copy-offscreen-*.js` build hack (Plasmo does not bundle
offscreen documents, so it had to copy them by hand into
`build/chrome-mv3-{dev,prod}`).

### Vite instead of Plasmo

browser-fx uses Plasmo 0.90.5 with React 18. Audio Scope uses plain Vite with a
static manifest and React 19.

**This is the one place we diverged without a forcing reason, and it was decided
by default rather than by argument.** Recording that honestly, because the
first version of this section justified it with the offscreen-document copy
scripts above, and that justification does not hold: Audio Scope has no offscreen
document, so Plasmo's worst friction in browser-fx would never have touched us.

The reasons that do hold, weighed after the fact:

- **Version friction.** Plasmo 0.90.5 has been quiet for a long time and pins
  React 18. Audio Scope is on React 19 and TypeScript 7. Getting Plasmo to accept
  that combination is real work with an uncertain outcome, and none of it is work
  on the actual product.
- **Manifest directness.** Plasmo generates the manifest from a `package.json`
  field. The riskiest thing in this extension is the side panel plus
  `openPanelOnActionClick` plus `tabCapture` permission interaction, and that is
  the last thing worth debugging through a layer of generation.
- **Small surface.** The whole build is a side panel and a service worker: two
  entries, ~40 lines of `vite.config.ts`, a ~50 ms rebuild.

The reason against, which is real: Bruce ships browser-fx on Plasmo, and two
extensions on two build systems is more to hold in your head than one.

Reversible. Porting to Plasmo means a React 18 downgrade, moving the manifest
into `package.json`, renaming the entries to Plasmo's conventions
(`sidepanel.tsx`, `background.ts` at the root), and re-verifying the build and
`npm test`. Nothing in `src/audio/` or `src/modes/` would change.

### No Tone.js

browser-fx depends on `tone` for some effects. Audio Scope only reads the
signal, so it needs `AnalyserNode`, `ChannelSplitterNode`, and `GainNode`. No
dependency.

### Playback goes straight to `ctx.destination`

browser-fx routes through a `MediaStreamAudioDestinationNode` into an `<Audio>`
element (`offscreen-effects.js:2754`), which it needs because the offscreen
document's playback lifecycle is separate from its processing graph. We connect
the source to `ctx.destination` through a single gain node instead: lower
latency, fewer moving parts.

## Rules we inherit from browser-fx's CLAUDE.md

These earned their place and they apply here too:

1. Never break working audio when making changes. Verify audio after **any**
   change to the audio host.
2. Match message type strings exactly across contexts. A typo is a silent no-op.
3. When something is "broken," fix functionality before styling.

One browser-fx constraint that does **not** carry over: its offscreen document
could not use `chrome.storage`, so it fetched MIDI mappings from the background
over messaging (`offscreen-effects.js:2911`). A side panel is a normal extension
page with full `chrome.storage` access, so Audio Scope reads settings directly.
