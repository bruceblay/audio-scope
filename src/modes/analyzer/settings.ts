import type { DisplayStyle } from '../../lib/tui'

export type AnalyzerView = 'spectrum' | 'spectrogram'

/**
 * Colour ramps for the spectrogram.
 *
 * `phosphor` follows the scope's tube colour, which keeps the two modes reading
 * as one instrument. `magma` is the perceptually uniform scientific ramp.
 *
 * There is deliberately no rainbow option. Rainbow scales have bright bands at
 * yellow and cyan that the eye reads as edges, so they invent structure in the
 * data that is not there - the exact dishonesty this project avoids everywhere
 * else.
 */
export type ColorMap = 'phosphor' | 'magma'

/**
 * Display tilt, in dB per octave.
 *
 * Real analyzers offer this because natural material is not flat: pink noise
 * falls at 3 dB/octave and most music approximates it, so an untilted display
 * always slopes down and the top end looks empty. Tilting by 3 dB/octave makes
 * pink noise read as a flat line, which is what you actually want to judge
 * balance against. 4.5 dB/octave is the common broadcast preference.
 */
export const SLOPES = [0, 3, 4.5, 6] as const

export const MIN_HZ_OPTIONS = [10, 20, 40, 80] as const
export const MAX_HZ_OPTIONS = [8000, 12000, 16000, 20000, 24000] as const

/**
 * Spectrogram scroll rate, columns per second.
 *
 * Time-based rather than one column per frame. Pushing per frame ties the time
 * axis to the render loop, so a dropped frame silently stretches history and the
 * display can no longer be read as time at all.
 */
export const SCROLL_RATES = [15, 30, 60, 120] as const

/**
 * Analysis window, in FFT points. A straight trade of latency against
 * low-frequency detail, so it is a control rather than a constant.
 *
 * 1024 points is a 21 ms window that feels immediate, but its bins are 47 Hz
 * wide, which is coarse below 100 Hz. 32768 is a 683 ms window with 1.5 Hz bins,
 * which resolves individual low partials but lags badly on anything moving.
 *
 * 32768 is the ceiling because that is AnalyserNode's maximum fftSize.
 */
export const FFT_SIZES = [1024, 2048, 4096, 8192, 16384, 32768] as const

/**
 * Curve smoothing, as N in "1/N octave". 0 is off.
 *
 * Wider fractions smooth harder. 1/3 is heavy enough to show only broad balance,
 * 1/24 barely touches the shape.
 */
export const SMOOTH_OCTAVES = [0, 48, 24, 12, 6, 3] as const

/** Bars are octave-fraction bands. 1/3 octave is the RTA standard. */
export const BANDS_PER_OCTAVE = [1, 3, 6] as const

export interface AnalyzerSettings {
  view: AnalyzerView
  /** 'crt' is the continuous instrument; 'tui' the character-cell discipline
   * shared with the scope. */
  displayStyle: DisplayStyle

  /** Visible frequency range. The top is clamped to just under Nyquist. */
  minHz: number
  maxHz: number
  /** Visible magnitude range, dBFS. */
  floorDb: number
  ceilDb: number

  /** dB per octave display tilt. */
  slope: number
  /** 0..1 temporal averaging. Attack stays fast; this lengthens the release. */
  averaging: number

  /** Peak hold line, as on a real analyzer. */
  peakHold: boolean
  /** How fast the hold line falls back, dB per second. */
  peakDecay: number

  /** Draw the spectrum as bars rather than a continuous curve. */
  bars: boolean
  /** Bands per octave when drawing bars. */
  bandsPerOctave: number
  /**
   * Curve smoothing as N in "1/N octave", 0 for none.
   *
   * Bars do not use it: aggregating into octave bands is already the same
   * operation, so smoothing on top would be applied twice.
   */
  smoothOctave: number
  /** Analysis window in FFT points. Trades latency against low-end detail. */
  fftSize: number

  map: ColorMap
  /** Spectrogram columns per second. Sets how much time is on screen. */
  scrollRate: number
}

export const DEFAULT_ANALYZER_SETTINGS: AnalyzerSettings = {
  view: 'spectrum',
  displayStyle: 'crt',
  minHz: 20,
  maxHz: 20000,
  floorDb: -96,
  ceilDb: -12,
  slope: 3,
  averaging: 0.4,
  peakHold: true,
  peakDecay: 24,
  bars: false,
  bandsPerOctave: 3,
  smoothOctave: 12,
  // 341 ms. The 43 ms default felt immediate but could not resolve the low
  // end - narrow bands below ~250 Hz read from shared bins - and it looked it.
  fftSize: 16384,
  map: 'magma',
  scrollRate: 60,
}

export interface AnalyzerReadout {
  /** Loudest frequency on screen, after tilt. */
  peakHz: number
  peakDb: number
  /**
   * Spectral centroid: the magnitude-weighted mean frequency.
   *
   * A real, standard timbre measure - it is what "brightness" means numerically,
   * and it tracks a filter sweep or an EQ change far more legibly than watching
   * the curve move.
   */
  centroidHz: number
  /** Broadband level, for reference against the curve. */
  rmsDb: number
  /** Seconds of history visible in the spectrogram. */
  spanSec: number
}
