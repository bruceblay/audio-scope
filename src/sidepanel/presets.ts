import { DEFAULT_ANALYZER_SETTINGS, type AnalyzerSettings } from '../modes/analyzer/settings'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../modes/scope/settings'

/**
 * Presets, following browser-fx's model and menu: factory presets ship with
 * the extension, user presets live in chrome.storage.sync, saving never
 * overwrites, and Update is the only path that replaces one.
 *
 * A preset captures the visualization state - mode plus both instruments'
 * settings - so loading one restores the whole view even if you switch tabs
 * afterwards. It deliberately does not capture the panel theme (an instrument
 * preference, not a scene) or the synth (an input, not a display).
 */

export type PresetMode = 'scope' | 'analyzer'

export interface Preset {
  id: string
  name: string
  mode: PresetMode
  /** Deliberately partial: merged over the defaults at load time, so adding a
   * setting later does not leave old presets with a hole in them. */
  scope: Partial<ScopeSettings>
  analyzer: Partial<AnalyzerSettings>
}

export const PRESETS_KEY = 'presets.v1'

export const isFactoryPreset = (id: string) => id.startsWith('factory_')

export const newPresetId = () =>
  'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** "Name", "Name 2", "Name 3"... against the existing names. */
export function uniqueName(base: string, taken: string[]) {
  const set = new Set(taken.map((n) => n.toLowerCase()))
  if (!set.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!set.has(candidate.toLowerCase())) return candidate
  }
}

export function applyPreset(p: Preset): {
  mode: PresetMode
  scope: ScopeSettings
  analyzer: AnalyzerSettings
} {
  return {
    mode: p.mode,
    scope: { ...DEFAULT_SCOPE_SETTINGS, ...p.scope },
    analyzer: { ...DEFAULT_ANALYZER_SETTINGS, ...p.analyzer },
  }
}

/** What the loaded preset compares against for the dirty flag. */
export const presetSignature = (
  mode: PresetMode,
  scope: ScopeSettings,
  analyzer: AnalyzerSettings,
) => JSON.stringify([mode, scope, analyzer])

export const FACTORY_PRESETS: Preset[] = [
  {
    // The reason X-Y mode exists. Long exposure and low halation because drawn
    // images are composed of precise lines; persistence carries the figure.
    id: 'factory_oscilloscope_music',
    name: 'Oscilloscope Music',
    mode: 'scope',
    scope: {
      channel: 'xy',
      voltsPerDiv: 0.2,
      xyExposure: 2048,
      xySmoothing: 0.1,
      persistence: 0.3,
      halation: 0.2,
      beamFocus: 0.75,
      intensity: 1.1,
      graticuleBrightness: 0.4,
    },
    analyzer: {},
  },
  {
    // The stereo-field monitor: what mastering engineers keep in the corner.
    id: 'factory_goniometer',
    name: 'Goniometer',
    mode: 'scope',
    scope: {
      channel: 'xy',
      voltsPerDiv: 0.1,
      xyExposure: 4096,
      xySmoothing: 0.3,
      persistence: 0.6,
      halation: 0.9,
      beamFocus: 0.45,
      intensity: 0.75,
    },
    analyzer: {},
  },
  {
    // A bench scope as it comes: triggered sweep, 1 ms/div, green phosphor.
    id: 'factory_bench',
    name: 'Bench Classic',
    mode: 'scope',
    scope: {
      channel: 'sum',
      timePerDiv: 1e-3,
      voltsPerDiv: 0.1,
      triggerMode: 'auto',
      phosphor: 'p31',
      persistence: 0.15,
      halation: 0.4,
    },
    analyzer: {},
  },
  {
    // Slow sweep on the long-persistence blue phosphor, like a storage scope
    // watching a signal breathe.
    id: 'factory_storage_tube',
    name: 'Storage Tube',
    mode: 'scope',
    scope: {
      channel: 'sum',
      timePerDiv: 0.01,
      voltsPerDiv: 0.2,
      phosphor: 'p7',
      persistence: 1.5,
      halation: 0.9,
      intensity: 0.7,
    },
    analyzer: {},
  },
  {
    // For music that draws pictures in the spectrogram. Long window for
    // vertical detail, slow scroll so the image has room to form.
    id: 'factory_spectrogram_art',
    name: 'Spectrogram Art',
    mode: 'analyzer',
    scope: {},
    analyzer: {
      view: 'spectrogram',
      map: 'magma',
      fftSize: 8192,
      scrollRate: 30,
      minHz: 20,
      maxHz: 20000,
      floorDb: -90,
      ceilDb: -18,
    },
  },
  {
    // Judging tonal balance: pink-noise tilt, heavy averaging, gentle
    // smoothing, peaks held.
    id: 'factory_mastering',
    name: 'Mastering Balance',
    mode: 'analyzer',
    scope: {},
    analyzer: {
      view: 'spectrum',
      bars: false,
      slope: 3,
      averaging: 0.75,
      smoothOctave: 6,
      peakHold: true,
      peakDecay: 12,
      fftSize: 4096,
    },
  },
  {
    // The hi-fi deck look: third-octave bars, quick and readable.
    id: 'factory_third_octave',
    name: 'Third-Octave Bars',
    mode: 'analyzer',
    scope: {},
    analyzer: {
      view: 'spectrum',
      bars: true,
      bandsPerOctave: 3,
      slope: 3,
      averaging: 0.35,
      peakHold: true,
    },
  },
]
