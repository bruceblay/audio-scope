import type { MeterState } from './meters'

/** Length of the time-domain record handed to the modes each frame. */
export const TIME_SIZE = 4096

/**
 * FFT size for the spectral analyser. 8192 gives 5.86 Hz per bin at 48 kHz,
 * which parabolic interpolation refines to roughly +/-0.5 Hz on a clean tone.
 * A 4096-point FFT is not enough resolution for low-register pitch.
 */
export const FFT_SIZE = 8192

/** Log-spaced bands for the spectrum strip in the UI chrome. */
export const BAND_COUNT = 24

export interface Pitch {
  /** Estimated fundamental in Hz, 0 when nothing was detected. */
  hz: number
  /** 0..1. Low values mean the input is not tonal; modes must respect this. */
  confidence: number
  /** Nearest equal-tempered note name, e.g. "A4". */
  note: string
  /** Deviation from that note in cents. */
  cents: number
  /** Fractional MIDI note number. */
  midi: number
  /** Octaves the raw estimate was shifted by, for readout honesty. Always 0 here. */
  fold: number
}

/**
 * One frame of measurements. Every typed array in here is **reused** between
 * frames - never retain a reference across frames, and never mutate it.
 * Allocating these at 60 Hz is megabytes per second of garbage.
 */
export interface AudioFrame {
  /** Monotonic frame timestamp in ms (performance.now). */
  time: number
  /** Seconds since the previous frame, clamped to a sane range. */
  dt: number
  sampleRate: number

  timeL: Float32Array
  timeR: Float32Array
  timeMono: Float32Array
  /**
   * Magnitude spectrum in dBFS, floored at -100. 8192-point window: fine
   * frequency resolution (5.9 Hz) at the cost of a 171 ms time window. Pitch
   * detection needs the resolution.
   */
  spectrum: Float32Array
  /**
   * Second spectrum from a resizable window, 1024 to 32768 points.
   *
   * FFT size is a straight trade of frequency resolution against time
   * resolution, and the two consumers want different points on it: pitch needs a
   * fixed fine-binned window, while a display wants whatever the user picked -
   * short to feel immediate, long to resolve low partials. One analyser cannot
   * serve both, so there are two. Length varies with the chosen size, so derive
   * bin width from it rather than assuming.
   */
  spectrumShort: Float32Array

  rms: number
  peak: number
  /** peak/rms expressed in dB. ~8-10 for a loud master, ~18-20 for live acoustic. */
  crest: number
  /** -1 (out of phase) .. 0 (uncorrelated) .. +1 (mono). */
  correlation: number
  /** Smoothed perceptual level, 0..1, fast attack and slow release. */
  level: number
  /** Transient envelope, 0..1. */
  onset: number
  bands: Float32Array
  pitch: Pitch
  /** True when the input is below the noise gate. */
  silent: boolean

  /** Per-channel RMS over the record, linear. */
  rmsL: number
  rmsR: number
  /** Per-channel absolute peak over the record, linear. */
  peakL: number
  peakR: number
  /** Level meters with real VU and PPM ballistics. See audio/meters.ts. */
  meters: MeterState
}
