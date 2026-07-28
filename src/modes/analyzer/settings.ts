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

export interface AnalyzerSettings {
  view: AnalyzerView

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

  map: ColorMap
}

export const DEFAULT_ANALYZER_SETTINGS: AnalyzerSettings = {
  view: 'spectrum',
  minHz: 20,
  maxHz: 20000,
  floorDb: -96,
  ceilDb: -12,
  slope: 3,
  averaging: 0.4,
  peakHold: true,
  peakDecay: 24,
  bars: false,
  map: 'phosphor',
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
}
