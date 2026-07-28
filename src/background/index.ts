/**
 * Service worker. Deliberately thin: the side panel hosts the AudioContext and
 * owns all capture. See docs/01-architecture.md.
 *
 * No audio data ever crosses a message boundary.
 */

/**
 * Opening the panel from `chrome.action.onClicked` is load-bearing, not a style
 * choice.
 *
 * `chrome.tabCapture.getMediaStreamId()` refuses unless the extension has been
 * *invoked* on the tab, which is what grants `activeTab`. Host permissions do
 * not substitute for it - declaring a broad host match changes nothing, tested.
 *
 * The obvious setup, `setPanelBehavior({ openPanelOnActionClick: true })`, is
 * exactly wrong here: Chrome opens the panel itself and `onClicked` never fires,
 * so no invocation is ever recorded and every capture attempt fails with
 * "Extension has not been invoked for the current page".
 *
 * Handling the click ourselves records the invocation and opens the panel in the
 * same gesture. The activeTab grant then persists on that tab until it navigates,
 * so the user's later Connect click succeeds.
 */
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return
  const tabId = tab.id

  // `sidePanel.open()` MUST be the first thing this listener does, and the
  // listener must not be async.
  //
  // The gesture that authorizes it is consumed by the first `await`. An earlier
  // version awaited a session-storage write before opening, and the panel simply
  // stopped opening: "sidePanel.open() may only be called in response to a user
  // gesture". Nothing else in this file may move above this call.
  chrome.sidePanel
    .open({ tabId })
    .catch((err) => console.error('[audio-scope] sidePanel.open failed:', err))

  // Record the invocation. The activeTab grant lives on this tab from this
  // moment, and this note is how the panel knows it may capture without asking
  // the user to click anything else.
  //
  // Session storage rather than a variable: the service worker is torn down
  // after ~30s idle and an in-memory flag would not survive it. Written after
  // the open call, so the gesture is never at risk.
  chrome.storage.session
    .set({ invocation: { tabId, at: Date.now() } })
    .then(() => {
      // Best effort. If the panel is not mounted yet it reads session storage on
      // mount instead, so both orderings work.
      chrome.runtime.sendMessage({ type: 'INVOKED', tabId }).catch(() => {})
    })
    .catch((err) => console.error('[audio-scope] recording invocation failed:', err))
})

/**
 * Undo the behavior flag explicitly. A profile that ran an earlier build has
 * `openPanelOnActionClick: true` persisted, and that would keep swallowing
 * `onClicked` even though the code above no longer sets it.
 */
function claimActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => console.error('[audio-scope] setPanelBehavior failed:', err))
}

chrome.runtime.onInstalled.addListener(claimActionClick)
chrome.runtime.onStartup.addListener(claimActionClick)
claimActionClick()

/**
 * Badge reflects whether the panel is currently capturing. The panel is the only
 * thing that knows, so it reports in.
 *
 * This listener must NOT be async: an async listener returns a Promise instead
 * of the literal `true` Chrome needs to hold the response port open, and every
 * sendResponse after an await then races the port teardown. That lesson is from
 * browser-fx, where it caused flaky "message port closed" errors.
 *
 * Messages this listener does not own get no response and no `return true`, so
 * the real recipient's response wins - chrome.runtime.sendMessage broadcasts to
 * every extension context, not just the intended one.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PANEL_STATE') {
    const connected = !!message.connected
    chrome.action.setBadgeText({ text: connected ? '●' : '' })
    chrome.action.setBadgeBackgroundColor({ color: '#3ddc84' })
    chrome.action.setTitle({
      title: connected ? 'Audio Scope - capturing' : 'Open Audio Scope',
    })
    sendResponse({ ok: true })
    return
  }
})

export {}
