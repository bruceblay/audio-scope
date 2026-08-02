/**
 * Tab audio capture. Everything Chrome-specific about acquiring a stream lives
 * in this file so the call site can be moved if a Chrome version stops allowing
 * it from a side panel.
 *
 * The two-call shape and the legacy `mandatory` constraint spelling both come
 * from browser-fx, which ships this path in production. The modern constraint
 * syntax does not work for `chromeMediaSource`.
 *
 * See docs/01-architecture.md#capture-handshake.
 */

export interface TabTarget {
  id: number
  title: string
  /** Hostname only - the full URL is never stored or logged. */
  host: string
  audible: boolean
}

export class CaptureError extends Error {
  constructor(
    message: string,
    /** A short, user-facing explanation. */
    readonly hint: string,
    /**
     * The raw Chrome error, surfaced in the UI rather than swallowed. An earlier
     * version guessed a hint from the message and showed only that, which hid
     * the real cause behind a wrong explanation. Always show what Chrome said.
     */
    readonly detail = '',
  ) {
    super(message)
    this.name = 'CaptureError'
  }
}

export async function getActiveTab(): Promise<TabTarget | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ? toTarget(tab) : null
}

export async function getTab(tabId: number): Promise<TabTarget | null> {
  try {
    return toTarget(await chrome.tabs.get(tabId))
  } catch {
    return null
  }
}

function toTarget(tab: chrome.tabs.Tab): TabTarget {
  let host = ''
  try {
    host = tab.url ? new URL(tab.url).hostname.replace(/^www\./, '') : ''
  } catch {
    host = ''
  }
  return {
    id: tab.id ?? -1,
    title: tab.title ?? 'Untitled tab',
    host,
    audible: !!tab.audible,
  }
}

/**
 * Acquire a MediaStream of a tab's audio.
 *
 * MUST be called from a user gesture (a click handler), and MUST be called from
 * a document rather than the service worker, because `getUserMedia` does not
 * exist there.
 *
 * The stream id returned by `getMediaStreamId` is single-use and short-lived, so
 * the `getUserMedia` call follows it immediately with nothing awaited in
 * between.
 */
export async function acquireTabStream(targetTabId: number): Promise<MediaStream> {
  const streamId = await requestStreamId(targetTabId)

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        // Legacy constraint shape. The modern spelling does not work here.
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    })
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    // browser-fx's hard-won lesson: a stream left over from a previous capture
    // blocks this call and the failure is silent from the user's side. The
    // engine always detaches before attaching, which is what prevents it.
    throw new CaptureError(
      `getUserMedia failed: ${message}`,
      'Audio capture was refused. Try disconnecting and connecting again.',
      message,
    )
  }
}

/** True when the failure is a missing activeTab grant, which is recoverable. */
export function isInvocationError(err: unknown): boolean {
  return err instanceof CaptureError && /not been invoked|activeTab/i.test(err.detail)
}

/**
 * Ask Chrome for a stream id, trying both call shapes.
 *
 * Capture rights come from one place only: an `activeTab` grant, which Chrome
 * issues when the user *invokes* the extension on that tab. Declaring
 * `host_permissions` does not substitute for it - tested, and it still fails
 * with "Extension has not been invoked for the current page".
 *
 * The invocation is recorded by `chrome.action.onClicked` in the service worker.
 * See the comment there; the setup is easy to break by accident.
 */
async function requestStreamId(targetTabId: number): Promise<string> {
  const attempts: string[] = []

  // Explicit target. Correct when host permissions cover the tab, and it keeps
  // working when the panel is watching a tab that is no longer in front.
  try {
    const id = await chrome.tabCapture.getMediaStreamId({ targetTabId })
    if (id) return id
    attempts.push('targetTabId form: empty id')
  } catch (err) {
    attempts.push(`targetTabId form: ${errorText(err)}`)
  }

  // browser-fx's exact production call: no arguments, meaning the current tab.
  try {
    const id = await chrome.tabCapture.getMediaStreamId()
    if (id) return id
    attempts.push('no-argument form: empty id')
  } catch (err) {
    attempts.push(`no-argument form: ${errorText(err)}`)
  }

  const detail = attempts.join(' | ')
  throw new CaptureError(`getMediaStreamId failed: ${detail}`, hintFor(detail), detail)
}

function errorText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

/**
 * Map Chrome's wording to something actionable. Anything unrecognized gets a
 * neutral hint, and the raw text is shown alongside it either way.
 */
function hintFor(detail: string): string {
  if (/not been invoked|activeTab/i.test(detail)) {
    // tabCapture requires an extension *invocation* on this specific tab. The
    // only thing that records one is clicking the toolbar icon while the tab is
    // in front. Host permissions do not substitute; verified.
    return 'Chrome needs one click to share this tab: press the Audio Scope button in your toolbar. The panel reconnects on its own.'
  }
  if (/gesture/i.test(detail)) {
    return 'The browser needs a direct click. Click Connect again.'
  }
  if (/cannot be captured|chrome:\/\/|devtools|extension page/i.test(detail)) {
    return 'This page cannot be captured. Browser pages, the Web Store, and other extension pages are off limits.'
  }
  if (/already|in use|being captured/i.test(detail)) {
    return 'This tab is already being captured, possibly by another extension.'
  }
  return 'Could not start capture on this tab.'
}
