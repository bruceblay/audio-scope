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
  /** Fractional bin at each pixel's centre frequency, for interpolation. */
  centre: Float32Array<ArrayBuffer>
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
  const centre = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f0 = minHz * Math.exp((i / n) * ratio)
    const f1 = minHz * Math.exp(((i + 1) / n) * ratio)
    const b0 = clamp(Math.floor(f0 / hzPerBin), 0, bins - 1)
    const b1 = clamp(Math.ceil(f1 / hzPerBin), 0, bins - 1)
    from[i] = b0
    to[i] = Math.max(b0, b1)
    centre[i] = clamp((Math.sqrt(f0 * f1) / hzPerBin), 0, bins - 1)
  }
  return { from, to, centre }
}

/**
 * Magnitude at a pixel, in dB.
 *
 * Two regimes, because the log axis stretches the bottom of the spectrum and
 * squeezes the top:
 *
 * - **Many bins per pixel** (the top end): take the maximum, so a narrow peak
 *   cannot be averaged away.
 * - **Many pixels per bin** (the bottom end): interpolate. Taking the single
 *   covering bin draws it as a flat plateau, and at 20 Hz with an 8192-point FFT
 *   one bin is 22 pixels wide - which is exactly the boxy, stepped look at the
 *   low end. Interpolating between neighbouring bins gives a continuous curve
 *   without inventing resolution the FFT does not have.
 */
export function magnitudeAt(
  spectrum: Float32Array,
  axis: Axis,
  i: number,
  floorDb = -140,
): number {
  const from = axis.from[i]
  const to = axis.to[i]
  // `to` is a ceil and `from` a floor, so a pixel narrower than a single bin
  // still reports two of them. Testing `to > from` therefore never took the
  // interpolation path at all - the low end stayed as stepped as before. Two
  // bins or fewer means the pixel is at or below bin resolution: interpolate.
  if (to - from > 1) {
    let best = floorDb
    for (let b = from; b <= to; b++) if (spectrum[b] > best) best = spectrum[b]
    return best
  }
  const c = axis.centre[i]
  const lo = Math.floor(c)
  const hi = Math.min(spectrum.length - 1, lo + 1)
  const f = c - lo
  return spectrum[lo] + (spectrum[hi] - spectrum[lo]) * f
}

/**
 * Fractional-octave band edges, the standard RTA layout (IEC 61260).
 *
 * Bars drawn on arbitrary pixel steps are not an analyzer, they are a curve with
 * corners - which is why a few-pixel step width made bars and curve look
 * identical. Real bars are octave-fraction bands, so their width carries meaning
 * and is constant in log frequency.
 */
export function octaveBands(
  minHz: number,
  maxHz: number,
  perOctave: number,
): { lo: number; hi: number; centre: number }[] {
  const bands: { lo: number; hi: number; centre: number }[] = []
  const step = Math.pow(2, 1 / perOctave)
  const half = Math.pow(2, 1 / (2 * perOctave))
  // Anchored on 1 kHz, as the standard series is.
  let k = Math.ceil(Math.log2(minHz / 1000) * perOctave)
  for (;;) {
    const centre = 1000 * Math.pow(2, k / perOctave)
    if (centre > maxHz) break
    const lo = centre / half
    const hi = centre * half
    if (hi > minHz) bands.push({ lo, hi, centre })
    k++
    void step
  }
  return bands
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
