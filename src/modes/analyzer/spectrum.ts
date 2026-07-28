/**
 * The analyzer's measurement maths, kept out of the renderer so it can be
 * verified without a canvas. See test/analyzer.test.ts.
 */

import { clamp } from '../../lib/dsp'

export interface Axis {
  /** First FFT bin falling in each pixel. */
  from: Int32Array<ArrayBuffer>
  /** Last FFT bin falling in each pixel. */
  to: Int32Array<ArrayBuffer>
}

/**
 * Map `n` pixels across a log frequency range to the FFT bins inside each.
 *
 * The mapping is not one-to-one in either direction: near 20 Hz a single bin
 * spans many pixels, and near 20 kHz dozens of bins fall into one. Callers take
 * the **maximum** over each pixel's range rather than the mean, because
 * averaging at the top end erases exactly the narrow peak an analyzer exists to
 * show.
 */
export function buildAxis(
  n: number,
  minHz: number,
  maxHz: number,
  bins: number,
  sampleRate: number,
): Axis {
  const hzPerBin = sampleRate / (bins * 2)
  const ratio = Math.log(maxHz / minHz)
  const from = new Int32Array(n)
  const to = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const f0 = minHz * Math.exp((i / n) * ratio)
    const f1 = minHz * Math.exp(((i + 1) / n) * ratio)
    const b0 = clamp(Math.floor(f0 / hzPerBin), 0, bins - 1)
    const b1 = clamp(Math.ceil(f1 / hzPerBin), 0, bins - 1)
    from[i] = b0
    to[i] = Math.max(b0, b1)
  }
  return { from, to }
}

/** Frequency at the centre of pixel `i` of `n`, on the same log axis. */
export function hzAt(i: number, n: number, minHz: number, maxHz: number): number {
  return minHz * Math.exp(((i + 0.5) / n) * Math.log(maxHz / minHz))
}

/**
 * Display tilt, in dB, at a given frequency.
 *
 * Pink noise falls at 3 dB/octave and most music approximates it, so an untilted
 * display always slopes downhill and the top end reads as empty. A 3 dB/octave
 * tilt renders pink exactly flat, which is the reference you actually judge
 * spectral balance against.
 */
export function tiltDb(hz: number, slopePerOctave: number): number {
  return slopePerOctave === 0 ? 0 : slopePerOctave * Math.log2(Math.max(hz, 1) / 1000)
}

/**
 * Spectral centroid: the magnitude-weighted mean frequency, and the numeric form
 * of "brightness".
 *
 * Gated relative to the loudest bin. Ungated, thousands of noise-floor bins each
 * carry little energy but sit high in frequency, and together they outvote the
 * signal - a lone 1 kHz tone against AnalyserNode's -100 dB floor measures
 * 2263 Hz. The gate is signal-relative so no display setting can move it.
 *
 * Computed on untilted magnitudes: tilt is a display choice, not a property of
 * the signal.
 */
export function spectralCentroid(
  spectrum: Float32Array,
  sampleRate: number,
  gateBelowPeakDb = 60,
): number {
  const hzPerBin = sampleRate / (spectrum.length * 2)
  let loudest = -Infinity
  for (let b = 1; b < spectrum.length; b++) if (spectrum[b] > loudest) loudest = spectrum[b]
  if (!Number.isFinite(loudest)) return 0

  const gate = loudest - gateBelowPeakDb
  let weighted = 0
  let total = 0
  for (let b = 1; b < spectrum.length; b++) {
    if (spectrum[b] < gate) continue
    const lin = Math.pow(10, spectrum[b] / 20)
    weighted += lin * b * hzPerBin
    total += lin
  }
  return total > 1e-12 ? weighted / total : 0
}

/** Highest frequency worth displaying: the requested top, capped below Nyquist. */
export function usableTopHz(requestedHz: number, sampleRate: number): number {
  return Math.min(requestedHz, sampleRate * 0.5 * 0.98)
}
