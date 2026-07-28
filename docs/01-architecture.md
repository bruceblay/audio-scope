# Architecture

## Contexts

| Context | File | Job |
| --- | --- | --- |
| Service worker | `src/background/index.ts` | Open the side panel, acquire stream ids, track which tab is being visualized |
| Side panel | `src/sidepanel/index.html` + `main.tsx` | **Hosts the `AudioContext`.** Owns capture, measurement, rendering, and UI |
| Popup | `src/popup/index.html` + `main.tsx` | Thin launcher. Opens the panel on the active tab |

No offscreen document. No content scripts.

## Why the side panel hosts the audio

MV3 forbids `AudioContext` in a service worker, so audio must live in a
document. The candidates are a popup (dies the moment focus moves), an offscreen
document (invisible, persistent), or the side panel (visible, persistent while
open, resizable, full window height).

A visualizer needs a large amount of data per frame - a full time-domain record
per channel at 60 Hz - and it needs that data to arrive on a steady cadence or
the oscilloscope trigger jitters. Moving it across a `chrome.runtime` message
boundary costs a structured clone of ~16 KB per frame and adds unpredictable
latency. Putting the `AnalyserNode` in the same JS context as the canvas removes
the problem entirely rather than optimizing it.

The tradeoff is that capture stops when the panel closes. For a visualizer that
is correct behavior, not a limitation.

See [02-reference-browser-fx.md](02-reference-browser-fx.md) for why browser-fx
made the opposite choice.

## Capture handshake

```
                  user clicks the extension icon
                              |
                              v
              [service worker] chrome.sidePanel.open({ tabId })
                              |
                              v
              [side panel] mounts, learns its target tab id
                              |
                     user clicks "Connect"          (user gesture)
                              |
                              v
     [side panel] chrome.tabCapture.getMediaStreamId({ targetTabId })
                              |
                              v  streamId
     [side panel] navigator.mediaDevices.getUserMedia({ audio: {
                    mandatory: { chromeMediaSource: 'tab',
                                 chromeMediaSourceId: streamId } } })
                              |
                              v  MediaStream
     [side panel] AudioEngine.attach(stream)
                    source -> destination        (playback, mandatory)
                    source -> splitter -> analyserL / analyserR
                    source -> analyserMono       (FFT / pitch)
```

### The invocation requirement, and recovery

`chrome.tabCapture.getMediaStreamId()` refuses unless the extension has been
**invoked** on the target tab. That invocation is what grants `activeTab`, and it
is the *only* thing that does - host permissions do not substitute, tested. The
invocation is recorded when `chrome.action.onClicked` fires, which is why the
service worker handles the toolbar click itself instead of using
`setPanelBehavior({ openPanelOnActionClick: true })`.

**The grant is Chrome's to revoke.** It goes away when the tab navigates, and
there is no API to renew it. Once it is gone, the panel's Connect button can
never succeed again - which reads to a user as a crash, because the button is
right there and does nothing.

So the toolbar icon is the recovery path, and it is made to work in one click:

```
  user clicks the toolbar icon
        |
        v
  [worker] chrome.storage.session.set({ invocation: { tabId, at } })
           chrome.sidePanel.open({ tabId })
           sendMessage INVOKED                      (best effort)
        |
        v
  [panel] on mount AND on INVOKED, read the note.
          Fresh (<15s) and not already capturing? consume it and connect.
```

Session storage rather than a variable in the worker, because the worker is torn
down after ~30s idle. Reading it on mount *and* on the message means both
orderings work, whether or not the panel was already open. Stale notes are
ignored so that reopening the panel later never silently starts capturing.

The acquisition call site stays isolated in `acquireTabStream()` in
`src/audio/capture.ts`.

## Teardown

Capture must end cleanly or the target tab stays silent. Every one of these
paths calls the same `AudioEngine.detach()`:

| Trigger | Listener |
| --- | --- |
| User clicks Disconnect | Button handler |
| Side panel closes or navigates | `window.addEventListener('pagehide')` |
| Target tab closes | `chrome.tabs.onRemoved` |
| Target tab navigates, or the stream dies | `track.addEventListener('ended')` |

**Not** `chrome.tabs.onUpdated`. Tearing down on `changeInfo.url` looks right and
is wrong: a single-page app rewrites its URL constantly - YouTube does it while
you watch - so a working capture died roughly once a minute. The stream's own
`ended` event is the authoritative signal. It fires on a real document navigation
and stays quiet for same-document routing, which is exactly the distinction that
matters and exactly the one a URL string cannot make.

`detach()` is idempotent. Order matters: stop the tracks first (which hands
playback back to the tab), then disconnect nodes, then drop references. The
`AudioContext` is kept alive and reused across attach cycles - creating one per
capture leaks contexts and Chrome caps them.

`AudioEngine.attach()` always calls `detach()` first. browser-fx learned this the
hard way: a leftover stream blocks the next `getUserMedia` and capture silently
never engages.

## Messaging

Deliberately minimal. Because `chrome.runtime.sendMessage` broadcasts to every
extension context, every listener must ignore messages it does not own by
returning nothing.

| Type | From | To | Purpose |
| --- | --- | --- | --- |
| `OPEN_PANEL` | popup | worker | Open the side panel on the active tab |
| `GET_TARGET_TAB` | panel | worker | Which tab should I visualize? |
| `PANEL_STATE` | panel | worker | Report connected / disconnected so the icon badge can reflect it |
| `TAB_STREAM_ID` | popup | panel | Fallback path only (see above) |

Audio data never crosses a message boundary.

## Persistence

`chrome.storage.sync` holds user preferences (active mode, per-mode settings,
theme). `chrome.storage.local` is not used at launch. Stored connection state is
never trusted - the engine's live `stream` reference is the only truth about
whether capture is running.

## Build

Plain Vite, multi-entry, static manifest.

```
public/manifest.json     copied verbatim into dist/
src/background/index.ts  -> dist/background.js   (type: module worker)
src/sidepanel/index.html -> dist/sidepanel.html
src/popup/index.html     -> dist/popup.html
```

`npm run dev` runs `vite build --watch` because a Chrome extension cannot load
from Vite's dev server. Load `dist/` as an unpacked extension and use Chrome's
reload button. Hot module replacement is not available; the watch rebuild is
fast enough (~100 ms) that it does not matter.

## Permissions

```json
"permissions": ["tabCapture", "sidePanel", "storage", "activeTab"],
"host_permissions": ["http://*/*", "https://*/*"]
```

- `tabCapture` - the whole point.
- `sidePanel` - to host the visualizer.
- `storage` - preferences.
- `host_permissions` - **this is what actually grants capture rights.**

`tabCapture` needs access to the target tab, and that comes from either host
permissions matching the tab's URL or an `activeTab` grant. The first version of
this extension declared only `activeTab` and no host permissions, on the theory
that it was the narrower ask. It does not work: `activeTab` is granted when the
user *invokes* the extension on a tab, and `openPanelOnActionClick` means
`chrome.action.onClicked` never fires, so no invocation is ever recorded.
`getMediaStreamId` then fails on every page.

browser-fx declares `host_permissions: ["https://*/*"]` and no `activeTab` at
all, which is the configuration that ships and works. We match it, adding
`http://*/*` for non-TLS pages. `activeTab` is kept as a harmless second path.

No content scripts and no network access. The extension makes zero outbound
requests, which is worth stating plainly in the store listing - the host
permission is for reading tab audio, never for fetching anything.
