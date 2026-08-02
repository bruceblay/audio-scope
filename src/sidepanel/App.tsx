import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CaptureError,
  acquireTabStream,
  getActiveTab,
  getTab,
  isInvocationError,
  type TabTarget,
} from '../audio/capture'
import { AudioEngine } from '../audio/engine'
import { DEFAULT_SYNTH, Synth, type SynthSettings } from '../audio/synth'
import {
  DEFAULT_ANALYZER_SETTINGS,
  type AnalyzerReadout,
  type AnalyzerSettings,
} from '../modes/analyzer/settings'
import {
  DEFAULT_CYMATICS_SETTINGS,
  type CymaticsReadout,
  type CymaticsSettings,
} from '../modes/cymatics/settings'
import {
  DEFAULT_SCOPE_SETTINGS,
  type ScopeReadout,
  type ScopeSettings,
} from '../modes/scope/settings'
import { Stage, type ModeId } from '../ui/Stage'
import type { ThemeId } from '../ui/tokens'
import { Group, Row, Segmented } from '../ui/controls'
import { ChevronDown, ChevronUp, DiskGlyph, InfoGlyph } from '../ui/glyphs'
import { Keyboard } from '../ui/Keyboard'
import { AboutView } from './AboutView'
import {
  FACTORY_PRESETS,
  PRESETS_KEY,
  applyPreset,
  isFactoryPreset,
  newPresetId,
  presetSignature,
  uniqueName,
  type Preset,
} from './presets'
import { PresetMenu } from './PresetMenu'
import { AnalyzerPanel, AnalyzerReadouts } from './AnalyzerControls'
import { CymaticsPanel, CymaticsReadouts } from './CymaticsControls'
import { ScopePanel, ScopeReadouts } from './ScopeControls'
import { SynthPanel } from './SynthControls'

// Bumping this discards stored preferences. Done deliberately when a default
// changes, since merge-on-load means a saved value always wins and a new default
// would otherwise never be seen.
/**
 * One final bump.
 *
 * Records written before `defaults` existed carry no way to tell "the user chose
 * this" from "that was the default at the time", so every stale default in them
 * survives as a decision - which is why the meter strip kept reappearing and why
 * the magma waterfall default never landed. From here the snapshot below does
 * that job and no further bump should be needed.
 */
const STORE_KEY = 'settings.v3'

/**
 * The defaults in force right now. Persisted alongside the user's settings so a
 * later default change can actually reach them.
 */
const DEFAULTS = {
  synth: DEFAULT_SYNTH,
  octave: 3,
  scope: DEFAULT_SCOPE_SETTINGS,
  cymatics: DEFAULT_CYMATICS_SETTINGS,
  analyzer: DEFAULT_ANALYZER_SETTINGS,
}

/**
 * Three-way merge: keep what the user chose, adopt new defaults for what they
 * did not.
 *
 * A plain `{...defaults, ...saved}` means a stored value always wins, so
 * changing a default has no effect on anyone who has ever opened the panel -
 * which is everyone. That bit twice in a row here. Comparing each stored value
 * against the default that was in force when it was saved separates "the user
 * picked this" from "this was simply the default at the time", and only the
 * former is preserved.
 *
 * The alternative, bumping the storage key, throws away every unrelated
 * preference to change one.
 */
function adopt<T extends object>(current: T, saved?: Partial<T>, savedDefaults?: Partial<T>): T {
  if (!saved) return current
  const out = { ...current }
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (!(key in saved)) continue
    const untouched =
      savedDefaults !== undefined && key in savedDefaults && saved[key] === savedDefaults[key]
    if (!untouched) out[key] = saved[key] as T[typeof key]
  }
  return out
}

const EMPTY_SCOPE: ScopeReadout = {
  vpp: 0,
  vrms: 0,
  hz: 0,
  period: 0,
  duty: 0,
  dbfs: -100,
  triggered: false,
  triggerLevel: 0,
  correlation: 0,
}

const EMPTY_CYMATICS: CymaticsReadout = {
  hz: 0,
  note: '--',
  cents: 0,
  confidence: 0,
  mode: '--',
  modeHz: 0,
  fold: 0,
  detune: 0,
  settled: 0,
  grains: 0,
}

/**
 * Cymatics is hidden, not removed.
 *
 * Its physics is verified - free-edge plate eigenvalues match Leissa, the sand
 * transport is measured in test/sand.test.ts - but verified is not the same as
 * good-looking, and the visual result is not up to standard yet. The code stays
 * so the work is not lost; flip this to bring the tab back.
 *
 * Where to pick it up is written down in docs/07-plan.md, Phase 4.
 */
const SHOW_CYMATICS = false

const EMPTY_ANALYZER: AnalyzerReadout = {
  peakHz: 0,
  peakDb: -120,
  centroidHz: 0,
  rmsDb: -120,
  spanSec: 0,
}

const ALL_MODES: { id: ModeId; label: string }[] = [
  { id: 'scope', label: 'Oscilloscope' },
  { id: 'analyzer', label: 'Analyzer' },
  { id: 'cymatics', label: 'Cymatics' },
]

const MODES = ALL_MODES.filter((m) => m.id !== 'cymatics' || SHOW_CYMATICS)

export function App() {
  // One engine for the life of the panel. Created here rather than in an effect
  // so it survives StrictMode's double-invoke.
  const [engine] = useState(() => new AudioEngine())
  const [synth] = useState(() => new Synth())

  const [target, setTarget] = useState<TabTarget | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<
    { hint: string; detail: string; recoverable: boolean } | null
  >(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [userPresets, setUserPresets] = useState<Preset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  // What the loaded preset looked like when it was loaded, for the dirty flag.
  const [presetSnapshot, setPresetSnapshot] = useState<string | null>(null)
  const [showControls, setShowControls] = useState(true)
  const [synthSettings, setSynthSettings] = useState<SynthSettings>(DEFAULT_SYNTH)
  const [octave, setOctave] = useState(DEFAULTS.octave)
  const [sounding, setSounding] = useState<Set<number>>(() => new Set())

  const [mode, setMode] = useState<ModeId>('scope')
  const [theme, setTheme] = useState<ThemeId>('dark')
  const [scope, setScope] = useState<ScopeSettings>(DEFAULT_SCOPE_SETTINGS)
  const [cymatics, setCymatics] = useState<CymaticsSettings>(DEFAULT_CYMATICS_SETTINGS)
  const [analyzer, setAnalyzer] = useState<AnalyzerSettings>(DEFAULT_ANALYZER_SETTINGS)
  const [scopeReadout, setScopeReadout] = useState<ScopeReadout>(EMPTY_SCOPE)
  const [cymaticsReadout, setCymaticsReadout] = useState<CymaticsReadout>(EMPTY_CYMATICS)
  const [analyzerReadout, setAnalyzerReadout] = useState<AnalyzerReadout>(EMPTY_ANALYZER)

  /**
   * Single teardown path. Every listener below routes here, and it is safe to
   * call repeatedly. Order matters: stopping the tracks hands playback back to
   * the tab immediately, before the graph is unwired.
   */
  const disconnect = useCallback(() => {
    engine.detach()
    setConnected(false)
    chrome.runtime.sendMessage({ type: 'PANEL_STATE', connected: false }).catch(() => {})
  }, [engine])

  /**
   * Whether the user is in capture mode: set on a successful connect, cleared
   * only by the Disconnect button. Streams also die on their own - the tab
   * navigates, the tab closes - and those must NOT clear it, because they are
   * exactly the moments auto-reconnect exists for.
   */
  const wantsCapture = useRef(false)

  const stopCapture = useCallback(() => {
    wantsCapture.current = false
    disconnect()
  }, [disconnect])

  const connectingRef = useRef(false)
  const connect = useCallback(async (explicitTabId?: number) => {
    if (connecting) return
    connectingRef.current = true
    setError(null)
    setConnecting(true)
    try {
      const tab =
        explicitTabId !== undefined
          ? await getTab(explicitTabId)
          : (target ?? (await getActiveTab()))
      if (!tab || tab.id < 0) throw new CaptureError('no active tab', 'No tab to listen to.')
      setTarget(tab)

      const stream = await acquireTabStream(tab.id)

      // A track can end on its own when the tab navigates or stops playing.
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', disconnect)
      }

      await engine.attach(stream)
      wantsCapture.current = true
      setConnected(true)
      chrome.runtime.sendMessage({ type: 'PANEL_STATE', connected: true }).catch(() => {})
    } catch (err) {
      // Show Chrome's own words, not just our interpretation of them.
      setError(
        err instanceof CaptureError
          ? { hint: err.hint, detail: err.detail, recoverable: isInvocationError(err) }
          : {
              hint: 'Could not connect to that tab.',
              detail: (err as Error)?.message ?? '',
              recoverable: false,
            },
      )
      if (isInvocationError(err)) {
        // Expected whenever the target tab has no activeTab grant: it navigated,
        // or it was never the tab the toolbar icon was clicked on. Recoverable
        // and self-explaining in the UI, so it is not an error-level event.
        console.info(
          '[audio-scope] no capture rights on this tab yet - click the toolbar icon on it',
        )
      } else {
        console.error('[audio-scope] connect failed:', err)
      }
      disconnect()
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }, [connecting, disconnect, engine, target])

  // --- Identify the tab this panel is watching ----------------------------
  // While disconnected, follow the active tab so Connect targets whatever you
  // are looking at. Once connected, latch, so browsing elsewhere does not yank
  // the visualization away.
  const followedTabId = useRef(-1)
  useEffect(() => {
    if (connected) return
    let cancelled = false
    const refresh = () => {
      getActiveTab().then((tab) => {
        if (cancelled || !tab) return
        setTarget(tab)
        if (tab.id === followedTabId.current) return
        followedTabId.current = tab.id
        // A new tab makes the old tab's error stale either way.
        setError(null)
        // If the user was capturing and the stream died (navigation, closed
        // tab), chase the tab they moved to. When Chrome still holds a grant
        // for it this reconnects silently, which is the auto-reestablish the
        // user asked for; when it does not, the attempt fails into the calm
        // press-the-button state rather than an error.
        if (wantsCapture.current) void connectRef.current(tab.id)
      })
    }
    refresh()
    chrome.tabs.onActivated.addListener(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      chrome.tabs.onActivated.removeListener(refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [connected])

  // --- Teardown wiring ----------------------------------------------------
  // Every path in docs/01-architecture.md#teardown, all landing on disconnect().
  //
  // Deliberately NOT listening to chrome.tabs.onUpdated for URL changes. A
  // single-page app rewrites its URL constantly - YouTube does it as you watch -
  // and tearing down on that killed a working capture roughly every minute. The
  // stream's own `ended` event is the authoritative signal: it fires on a real
  // document navigation and stays quiet for same-document routing.
  useEffect(() => {
    const targetId = target?.id

    const onRemoved = (tabId: number) => {
      if (tabId === targetId) disconnect()
    }
    const onPageHide = () => {
      // The panel is going away. Release the capture so the tab is not left
      // silent with its audio routed into a document that no longer exists.
      engine.detach()
    }

    chrome.tabs.onRemoved.addListener(onRemoved)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      chrome.tabs.onRemoved.removeListener(onRemoved)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [target?.id, disconnect, engine])

  // --- Recovery: the toolbar icon always works ----------------------------
  // The activeTab grant is Chrome's to revoke, and once it is gone the Connect
  // button can never succeed - which read as a crash, because nothing said so.
  // Clicking the toolbar icon mints a fresh grant, and the worker leaves a note
  // in session storage. Consuming it here turns that single click into a full
  // reconnect with no second step.
  //
  // Held in a ref rather than listed as a dependency. `connect` closes over
  // `target`, and `target` changes whenever the panel follows the active tab -
  // which includes the instant the side panel opens and takes focus. Depending on
  // it tore this effect down and rebuilt it exactly when the note arrived: the
  // in-flight read would remove the note, then bail on the cancel flag, and the
  // auto-connect silently never happened. The user then pressed Connect against
  // whatever tab was now in front, which usually had no grant.
  const connectRef = useRef(connect)
  connectRef.current = connect

  useEffect(() => {
    let cancelled = false

    const consumeInvocation = async () => {
      const stored = (await chrome.storage.session.get('invocation')) as {
        invocation?: { tabId: number; at: number }
      }
      const invocation = stored?.invocation
      if (!invocation || cancelled) return
      // Stale notes are ignored, so reopening the panel later does not silently
      // start capturing a tab the user has moved on from.
      if (Date.now() - invocation.at > 15000) return
      // Only consume the note once it is certain to be used. Removing it first
      // and then bailing throws away the one thing that makes recovery work.
      if (engine.isAttached) return
      await chrome.storage.session.remove('invocation')
      if (cancelled) return
      // The toolbar click that minted this grant also focuses the browser
      // window, and window focus fires the tab-chase - whose doomed attempt
      // may still be in flight. Racing into connect() while it is would hit
      // the re-entrancy guard and silently swallow the one click that can
      // succeed, with the note already consumed. Wait the chase out first.
      for (let i = 0; i < 20 && connectingRef.current; i++) {
        await new Promise((r) => window.setTimeout(r, 50))
      }
      if (cancelled) return
      void connectRef.current(invocation.tabId)
    }

    const onMessage = (message: { type?: string }) => {
      if (message?.type === 'INVOKED') void consumeInvocation()
    }

    void consumeInvocation()
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      cancelled = true
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [engine])

  // --- Synth ---------------------------------------------------------------
  // Enabling builds the audio graph if no tab is captured, which is the whole
  // point: the synth has to work as a signal source on its own.
  useEffect(() => {
    let cancelled = false
    if (!synthSettings.enabled) {
      synth.update(synthSettings)
      return
    }
    engine.ensureContext().then((ctx) => {
      if (cancelled) return
      const bus = engine.analysisBus
      if (bus) synth.connect(ctx, bus)
      synth.update(synthSettings)
    })
    return () => {
      cancelled = true
    }
  }, [engine, synth, synthSettings])

  // Held notes live in the Synth, which owns latch and arpeggiator state, so the
  // keyboard's lit keys are pushed here rather than mirrored.
  useEffect(() => {
    synth.setNotesChangedHandler(() => setSounding(new Set(synth.sounding)))
    return () => synth.setNotesChangedHandler(null)
  }, [synth])

  useEffect(() => () => synth.dispose(), [synth])

  // Turning the synth on reveals its controls. The synth section is at the
  // bottom of the rail and the keyboard strip appears below it in the same
  // commit, so without this the new controls sit just out of view and the panel
  // looks like an on/off switch with nothing behind it. Only on the rising
  // edge: enabled is never restored from storage, so a mount cannot trigger it.
  const synthSection = useRef<HTMLElement | null>(null)
  const synthWasEnabled = useRef(false)
  useEffect(() => {
    if (synthSettings.enabled && !synthWasEnabled.current) {
      synthSection.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    synthWasEnabled.current = synthSettings.enabled
  }, [synthSettings.enabled])

  // The analyzer's window size is an engine concern: it resizes a dedicated
  // AnalyserNode rather than the one pitch detection depends on.
  useEffect(() => {
    engine.setShortFftSize(analyzer.fftSize)
  }, [engine, analyzer.fftSize])

  // Release the AudioContext for good when the panel unmounts.
  useEffect(() => () => void engine.dispose(), [engine])

  // Keep the latched tab's label fresh while connected; the follow effect above
  // covers the disconnected case.
  useEffect(() => {
    if (!target || !connected) return
    const id = window.setInterval(async () => {
      const fresh = await getTab(target.id)
      if (fresh) setTarget((prev) => (prev && prev.id === fresh.id ? fresh : prev))
    }, 2000)
    return () => window.clearInterval(id)
  }, [target?.id, connected])

  // --- Presets ------------------------------------------------------------
  useEffect(() => {
    chrome.storage.sync.get(PRESETS_KEY).then((stored) => {
      const saved = stored?.[PRESETS_KEY] as
        | Partial<{ presets: Preset[]; activeId: string | null; snapshot: string | null }>
        | undefined
      if (!saved) return
      if (Array.isArray(saved.presets)) setUserPresets(saved.presets)
      if (typeof saved.activeId === 'string') setActivePresetId(saved.activeId)
      if (typeof saved.snapshot === 'string') setPresetSnapshot(saved.snapshot)
    })
  }, [])

  const persistPresets = useCallback(
    (presets: Preset[], activeId: string | null, snapshot: string | null) => {
      setUserPresets(presets)
      setActivePresetId(activeId)
      setPresetSnapshot(snapshot)
      chrome.storage.sync
        .set({ [PRESETS_KEY]: { presets, activeId, snapshot } })
        .catch(() => {})
    },
    [],
  )

  const presetDirty =
    activePresetId !== null &&
    presetSnapshot !== null &&
    presetSignature(mode === 'analyzer' ? 'analyzer' : 'scope', scope, analyzer) !==
      presetSnapshot

  const loadPreset = useCallback(
    (p: Preset) => {
      const applied = applyPreset(p)
      setMode(applied.mode)
      setScope(applied.scope)
      setAnalyzer(applied.analyzer)
      persistPresets(
        userPresets,
        p.id,
        presetSignature(applied.mode, applied.scope, applied.analyzer),
      )
      setShowPresets(false)
    },
    [persistPresets, userPresets],
  )

  const currentPreset = useCallback(
    (id: string, name: string): Preset => ({
      id,
      name,
      mode: mode === 'analyzer' ? 'analyzer' : 'scope',
      scope,
      analyzer,
    }),
    [mode, scope, analyzer],
  )

  const savePresetAsNew = useCallback(
    (name: string) => {
      const p = currentPreset(
        newPresetId(),
        uniqueName(name, userPresets.map((u) => u.name)),
      )
      persistPresets(
        [...userPresets, p],
        p.id,
        presetSignature(p.mode, scope, analyzer),
      )
      setShowPresets(false)
    },
    [currentPreset, persistPresets, userPresets, scope, analyzer],
  )

  const updateActivePreset = useCallback(() => {
    if (!activePresetId || isFactoryPreset(activePresetId)) return
    persistPresets(
      userPresets.map((p) =>
        p.id === activePresetId ? currentPreset(p.id, p.name) : p,
      ),
      activePresetId,
      presetSignature(mode === 'analyzer' ? 'analyzer' : 'scope', scope, analyzer),
    )
    setShowPresets(false)
  }, [activePresetId, currentPreset, persistPresets, userPresets, mode, scope, analyzer])

  const renamePreset = useCallback(
    (id: string, name: string) => {
      persistPresets(
        userPresets.map((p) =>
          p.id === id
            ? {
                ...p,
                name: uniqueName(
                  name,
                  userPresets.filter((o) => o.id !== id).map((o) => o.name),
                ),
              }
            : p,
        ),
        activePresetId,
        presetSnapshot,
      )
    },
    [persistPresets, userPresets, activePresetId, presetSnapshot],
  )

  const deletePreset = useCallback(
    (id: string) => {
      persistPresets(
        userPresets.filter((p) => p.id !== id),
        activePresetId === id ? null : activePresetId,
        activePresetId === id ? null : presetSnapshot,
      )
    },
    [persistPresets, userPresets, activePresetId, presetSnapshot],
  )

  const exportSetup = useCallback(() => {
    const json = JSON.stringify(
      {
        mode: mode === 'analyzer' ? 'analyzer' : 'scope',
        scope,
        analyzer,
        userPresets,
      },
      null,
      2,
    )
    return navigator.clipboard.writeText(json)
  }, [mode, scope, analyzer, userPresets])

  // --- Settings persistence ----------------------------------------------
  useEffect(() => {
    chrome.storage.sync.get(STORE_KEY).then((stored) => {
      // chrome.storage returns `{}` typed values, and whatever was persisted may
      // be from an older shape, so nothing here is trusted without a check.
      const saved = stored?.[STORE_KEY] as
        | Partial<{
            mode: ModeId
            theme: ThemeId
            synth: SynthSettings
            octave: number
            scope: ScopeSettings
            cymatics: CymaticsSettings
            analyzer: AnalyzerSettings
            defaults: typeof DEFAULTS
          }>
        | undefined
      if (!saved) return
      const was = saved.defaults
      // A profile that last used cymatics must not restore into a hidden mode.
      if (saved.mode && MODES.some((m) => m.id === saved.mode)) setMode(saved.mode)
      if (saved.theme) setTheme(saved.theme)
      if (typeof saved.octave === 'number') setOctave(saved.octave)
      // Enabled is deliberately not restored: an extension that starts making
      // noise on open is hostile, however the setting was left.
      setSynthSettings((prev) => ({ ...adopt(prev, saved.synth, was?.synth), enabled: false }))
      // The text style shipped briefly under the value 'tui'; stored settings
      // from that window coerce forward instead of silently falling to CRT.
      const styled = <T extends { displayStyle?: string }>(v: T): T =>
        (v.displayStyle as string) === 'tui' ? { ...v, displayStyle: 'text' } : v
      setScope((prev) => styled(adopt(prev, saved.scope, was?.scope)))
      setCymatics((prev) => adopt(prev, saved.cymatics, was?.cymatics))
      setAnalyzer((prev) => styled(adopt(prev, saved.analyzer, was?.analyzer)))
    })
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      chrome.storage.sync
        .set({
          [STORE_KEY]: {
            mode,
            theme,
            octave,
            synth: synthSettings,
            scope,
            cymatics,
            analyzer,
            defaults: DEFAULTS,
          },
        })
        .catch(() => {})
    }, 400)
    return () => window.clearTimeout(id)
  }, [mode, theme, octave, synthSettings, scope, cymatics, analyzer])

  const patchSynth = useCallback(
    (next: Partial<SynthSettings>) => setSynthSettings((prev) => ({ ...prev, ...next })),
    [],
  )
  const shiftOctave = useCallback(
    (delta: number) => setOctave((v) => Math.max(1, Math.min(6, v + delta))),
    [],
  )

  const patchScope = useCallback(
    (next: Partial<ScopeSettings>) => setScope((prev) => ({ ...prev, ...next })),
    [],
  )
  const patchCymatics = useCallback(
    (next: Partial<CymaticsSettings>) => setCymatics((prev) => ({ ...prev, ...next })),
    [],
  )
  const patchAnalyzer = useCallback(
    (next: Partial<AnalyzerSettings>) => setAnalyzer((prev) => ({ ...prev, ...next })),
    [],
  )

  // The theme drives both the CSS chrome and the canvas, so it lives on the root
  // element where the stylesheet can see it.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const isCymatics = mode === 'cymatics'
  const isAnalyzer = mode === 'analyzer'
  const dim = !connected
  const needsInvocation = !!error && error.recoverable

  if (showAbout) return <AboutView onClose={() => setShowAbout(false)} />

  return (
    <div className="app">
      <div className="tabs" role="tablist" aria-label="Visualization mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="tab"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          className="info-btn"
          aria-label="Presets"
          title="Presets"
          aria-expanded={showPresets}
          onClick={() => setShowPresets((v) => !v)}
        >
          <DiskGlyph />
        </button>
        <button
          type="button"
          className="info-btn"
          aria-label="About Audio Scope"
          title="About Audio Scope"
          onClick={() => setShowAbout(true)}
        >
          <InfoGlyph />
        </button>
      </div>
      <div className="seam" />

      {showPresets && (
        <PresetMenu
          userPresets={userPresets}
          factoryPresets={FACTORY_PRESETS}
          activeId={activePresetId}
          dirty={presetDirty}
          suggestedName={uniqueName(
            mode === 'analyzer'
              ? analyzer.view === 'spectrogram'
                ? 'Waterfall'
                : 'Spectrum'
              : scope.channel === 'xy'
                ? 'X-Y'
                : 'Scope',
            userPresets.map((p) => p.name),
          )}
          onLoad={loadPreset}
          onSaveNew={savePresetAsNew}
          onUpdate={updateActivePreset}
          onRename={renamePreset}
          onDelete={deletePreset}
          onExport={exportSetup}
          onClose={() => setShowPresets(false)}
        />
      )}

      <Stage
        engine={engine}
        mode={mode}
        settings={isCymatics ? cymatics : isAnalyzer ? analyzer : scope}
        theme={theme}
        onReadout={
          isCymatics
            ? (r) => setCymaticsReadout(r as CymaticsReadout)
            : isAnalyzer
              ? (r) => setAnalyzerReadout(r as AnalyzerReadout)
              : (r) => setScopeReadout(r as ScopeReadout)
        }
      >
        {!connected && !synthSettings.enabled && (
          <div className="stage-overlay">
            {/* Needing the toolbar click is a designed state, not a failure:
                no red, no raw API text (that lives in the console), just the
                one instruction. Anything else that goes wrong keeps Chrome's
                own words visible, because those are debuggable. */}
            {needsInvocation ? (
              <>
                <p>
                  Chrome needs one click to share {target?.host || 'this tab'}.
                </p>
                <p className="detail">
                  Press the <strong>Audio Scope</strong> button in your toolbar. The panel
                  connects on its own.
                </p>
              </>
            ) : error ? (
              <>
                <p className="error">{error.hint}</p>
                {error.detail && <p className="detail mono">{error.detail}</p>}
                <button
                  type="button"
                  className="btn"
                  data-variant="primary"
                  onClick={() => connect()}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting' : 'Connect'}
                </button>
              </>
            ) : (
              <>
                <p>
                  Connect to visualize {target?.host || 'this tab'}. Audio passes through
                  untouched.
                </p>
                <button
                  type="button"
                  className="btn"
                  data-variant="primary"
                  onClick={() => connect()}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting' : 'Connect'}
                </button>
              </>
            )}
          </div>
        )}
      </Stage>

      <div className="readouts">
        {isCymatics ? (
          <CymaticsReadouts readout={cymaticsReadout} dim={dim} />
        ) : isAnalyzer ? (
          <AnalyzerReadouts
            readout={analyzerReadout}
            dim={dim}
            spectrogram={analyzer.view === 'spectrogram'}
          />
        ) : (
          <ScopeReadouts readout={scopeReadout} settings={scope} dim={dim} />
        )}
      </div>
      <div className="seam" />

      <button
        type="button"
        className="rail-handle"
        aria-label={showControls ? 'Hide controls' : 'Show controls'}
        aria-expanded={showControls}
        title={showControls ? 'Hide controls' : 'Show controls'}
        onClick={() => setShowControls((v) => !v)}
      >
        <span className="legend">Controls</span>
        {showControls ? <ChevronDown /> : <ChevronUp />}
      </button>

      <div className="controls" hidden={!showControls}>
        {isCymatics ? (
          <CymaticsPanel settings={cymatics} patch={patchCymatics} />
        ) : isAnalyzer ? (
          <AnalyzerPanel settings={analyzer} patch={patchAnalyzer} />
        ) : (
          <ScopePanel settings={scope} patch={patchScope} />
        )}
        <Group title="Instrument">
          <Row label="Panel">
            <Segmented<ThemeId>
              label="Panel finish"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: 'Studio' },
                { value: 'tek', label: 'Bench' },
              ]}
            />
          </Row>
        </Group>
        {/* Last in the rail, so it sits directly above its own keyboard rather
            than with the panel settings wedged between the two. */}
        <SynthPanel
          settings={synthSettings}
          patch={patchSynth}
          octave={octave}
          onOctave={setOctave}
          sectionRef={synthSection}
        />
      </div>

      {synthSettings.enabled && (
        <div className="synth-strip">
          <Keyboard
            root={(octave + 1) * 12}
            sounding={sounding}
            onNoteOn={(m) => synth.noteOn(m)}
            onNoteOff={(m) => synth.noteOff(m)}
            onOctaveShift={shiftOctave}
          />
        </div>
      )}

      <div className="source">
        <span
          className="dot"
          data-state={error && !error.recoverable ? 'error' : connected ? 'live' : 'idle'}
          aria-hidden="true"
        />
        <span className="source-label" title={target?.title}>
          {target ? target.host || target.title : 'No tab'}
        </span>
        <button
          type="button"
          className="btn"
          onClick={connected ? stopCapture : () => connect()}
          disabled={connecting}
        >
          {connected ? 'Disconnect' : connecting ? 'Connecting' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
