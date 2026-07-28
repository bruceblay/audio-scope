/**
 * Pitch detection. See docs/03-audio-engine.md#pitch-detection for the reasoning
 * behind each stage.
 *
 * Pipeline: noise gate -> FFT peak via harmonic product spectrum -> parabolic
 * interpolation for sub-bin accuracy -> subharmonic check -> confidence from
 * peak prominence and spectral flatness -> jump-detecting temporal smoother.
 *
 * Cymatics mode maps frequency to a specific physical mode, so an octave error
 * produces a completely wrong picture. That is why HPS is here rather than a
 * bare argmax.
 */

import { clamp, hzToNote } from '../lib/dsp'
import type { Pitch } from './types'

/** Search range for the fundamental. Below 40 Hz is rumble; above 4 kHz is not a fundamental in practice. */
const MIN_HZ = 40
const MAX_HZ = 4000

/** Harmonics multiplied together in the HPS. Five is the usual choice. */
const HARMONICS = 5

/** dBFS floor. Silent bins read as -Infinity, which would poison the sum. */
const DB_FLOOR = -100

/** Below this RMS (about -60 dBFS) the detector reports no pitch at all. */
const GATE_RMS = 0.001

/**
 * A candidate fundamental must itself be a real partial, no more than this far
 * below the strongest one. Without this gate, HPS happily reports f/5 for a pure
 * sine: the subharmonic's product includes the real peak as its fifth harmonic
 * and ties the true answer exactly. Musical fundamentals are rarely more than
 * ~25 dB below the loudest partial.
 */
const MAX_FUNDAMENTAL_BELOW_PEAK = 25

/** A new estimate this far from the current one snaps instead of gliding. */
const SNAP_SEMITONES = 1

export interface PitchDetectorOptions {
  referenceHz?: number
}

export class PitchDetector {
  private readonly referenceHz: number

  /** Summed-log HPS, indexed by candidate bin. Reused every frame. */
  private hps: Float32Array = new Float32Array(0)

  /** Smoothed output state. */
  private smoothHz = 0
  private smoothConfidence = 0

  constructor(options: PitchDetectorOptions = {}) {
    this.referenceHz = options.referenceHz ?? 440
  }

  /**
   * @param spectrum dBFS magnitudes, length = fftSize/2
   * @param sampleRate audio context sample rate
   * @param rms broadband RMS of the matching time record, for the noise gate
   * @param out mutated in place and returned; never allocated here
   */
  detect(spectrum: Float32Array, sampleRate: number, rms: number, out: Pitch): Pitch {
    const bins = spectrum.length
    const fftSize = bins * 2
    const hzPerBin = sampleRate / fftSize

    if (rms < GATE_RMS) {
      // Release toward zero rather than snapping, so a note decaying into
      // silence fades out of the readout instead of blinking off.
      this.smoothConfidence *= 0.8
      return write(out, this.smoothHz, this.smoothConfidence, this.referenceHz)
    }

    const kMin = Math.max(1, Math.floor(MIN_HZ / hzPerBin))
    const kMax = Math.min(
      Math.floor(MAX_HZ / hzPerBin),
      Math.floor((bins - 1) / HARMONICS), // every harmonic must land inside the spectrum
    )
    if (kMax <= kMin) {
      this.smoothConfidence *= 0.8
      return write(out, this.smoothHz, this.smoothConfidence, this.referenceHz)
    }

    if (this.hps.length !== bins) this.hps = new Float32Array(bins)
    const hps = this.hps
    hps.fill(-Infinity)

    // The energy gate needs the strongest partial in the search range.
    let peakDb = DB_FLOOR
    for (let k = kMin; k <= kMax; k++) if (spectrum[k] > peakDb) peakDb = spectrum[k]
    const energyFloor = peakDb - MAX_FUNDAMENTAL_BELOW_PEAK

    // --- Harmonic product spectrum ---------------------------------------
    // The product of magnitudes at f, 2f, 3f... is large only where every
    // harmonic has energy, which is the fundamental. Summing dB is the same
    // argmax as multiplying magnitudes, and it avoids underflow entirely.
    let bestK = -1
    let bestScore = -Infinity
    for (let k = kMin; k <= kMax; k++) {
      // Skip bins that hold no real energy of their own (see the constant).
      if (spectrum[k] < energyFloor) continue

      let sum = spectrum[k] > DB_FLOOR ? spectrum[k] : DB_FLOOR
      for (let r = 2; r <= HARMONICS; r++) {
        // Take the strongest bin in a small neighborhood rather than the exact
        // multiple. A fundamental almost never lands on an exact bin, and the
        // misalignment compounds with r - at r=5 the true harmonic can be
        // several bins away from k*5. Without this, HPS systematically prefers
        // whichever candidate happens to be nearly bin-aligned, which is how a
        // 220 Hz sawtooth gets reported as 440 Hz.
        const half = Math.max(1, Math.round(r / 2))
        const from = Math.max(0, k * r - half)
        const to = Math.min(bins - 1, k * r + half)
        let best = DB_FLOOR
        for (let i = from; i <= to; i++) if (spectrum[i] > best) best = spectrum[i]
        sum += best
      }
      hps[k] = sum
      if (sum > bestScore) {
        bestScore = sum
        bestK = k
      }
    }

    if (bestK < 0) {
      this.smoothConfidence *= 0.8
      return write(out, this.smoothHz, this.smoothConfidence, this.referenceHz)
    }

    // --- Subharmonic check ------------------------------------------------
    // HPS is biased toward the octave above when the fundamental is weak. If
    // half the chosen frequency scores nearly as well *and* has real energy of
    // its own, it is the true fundamental.
    const halfK = Math.floor(bestK / 2)
    if (halfK >= kMin && Number.isFinite(hps[halfK])) {
      const halfScore = hps[halfK]
      const halfHasEnergy = spectrum[halfK] > spectrum[bestK] - 14
      // Tolerance is in summed-dB units across HARMONICS terms, so ~3 dB per
      // harmonic. Tuned empirically against sawtooth and square inputs.
      if (halfHasEnergy && halfScore > bestScore - 3 * HARMONICS) {
        bestK = halfK
      }
    }

    // --- Sub-bin refinement ----------------------------------------------
    // Parabola through the three log-magnitude values around the peak. Log
    // domain matters: a window's main lobe is close to parabolic in dB, so the
    // fit is far more accurate there than on linear magnitudes.
    const refinedBin = parabolicPeak(spectrum, bestK)
    const hz = refinedBin * hzPerBin

    // --- Confidence -------------------------------------------------------
    const stats = spectralStats(spectrum, kMin, Math.min(bins - 1, kMax * HARMONICS))
    // Prominence: how far the peak stands above the average of the band, in dB,
    // normalized against 40 dB. A single loud partial scores high; broadband
    // noise scores near zero. Mean is used instead of median to stay O(n).
    const prominence = clamp((spectrum[bestK] - stats.meanDb) / 40, 0, 1)
    // Flatness near 1 is white noise, near 0 is a pure tone. This factor is what
    // makes cymatics mode refuse to draw a specific pattern for a cymbal crash.
    const tonality = clamp(1 - stats.flatness * 1.6, 0, 1)
    const confidence = clamp(prominence * tonality, 0, 1)

    // --- Temporal smoothing with jump detection ---------------------------
    // Sustained notes should hold steady; a melody should track. Gliding across
    // a note change would slide through every frequency in between, and in
    // cymatics mode that means sliding through every mode pattern in between.
    const semitonesAway =
      this.smoothHz > 0 && hz > 0 ? Math.abs(12 * Math.log2(hz / this.smoothHz)) : Infinity

    if (this.smoothHz <= 0 || (semitonesAway > SNAP_SEMITONES && confidence > 0.25)) {
      this.smoothHz = hz
    } else {
      // Trust a confident reading more than a shaky one.
      this.smoothHz += (hz - this.smoothHz) * (0.12 + confidence * 0.3)
    }
    this.smoothConfidence += (confidence - this.smoothConfidence) * 0.25

    return write(out, this.smoothHz, this.smoothConfidence, this.referenceHz)
  }

  reset() {
    this.smoothHz = 0
    this.smoothConfidence = 0
  }
}

/**
 * Sub-bin peak position by fitting a parabola through y[k-1], y[k], y[k+1].
 * Values are already in dB, which is the domain the fit wants.
 */
function parabolicPeak(y: Float32Array, k: number): number {
  if (k <= 0 || k >= y.length - 1) return k
  const a = Math.max(y[k - 1], DB_FLOOR)
  const b = Math.max(y[k], DB_FLOOR)
  const c = Math.max(y[k + 1], DB_FLOOR)
  const denom = a - 2 * b + c
  if (Math.abs(denom) < 1e-9) return k
  const delta = (0.5 * (a - c)) / denom
  // A well-formed peak puts the vertex within half a bin. Anything further means
  // the three points are not describing a peak, so keep the integer bin.
  return Math.abs(delta) <= 0.5 ? k + delta : k
}

interface SpectralStats {
  meanDb: number
  /** Geometric mean over arithmetic mean of linear magnitudes, 0..1. */
  flatness: number
}

function spectralStats(spectrum: Float32Array, from: number, to: number): SpectralStats {
  let sumDb = 0
  let sumLinear = 0
  let n = 0
  for (let i = from; i <= to; i++) {
    const db = spectrum[i] > DB_FLOOR ? spectrum[i] : DB_FLOOR
    sumDb += db
    sumLinear += Math.pow(10, db / 20)
    n++
  }
  if (n === 0) return { meanDb: DB_FLOOR, flatness: 1 }

  const meanDb = sumDb / n
  // The mean of dB values *is* the geometric mean, expressed in dB.
  const geoMean = Math.pow(10, meanDb / 20)
  const arithMean = sumLinear / n
  const flatness = arithMean > 1e-12 ? clamp(geoMean / arithMean, 0, 1) : 1
  return { meanDb, flatness }
}

function write(out: Pitch, hz: number, confidence: number, referenceHz: number): Pitch {
  const note = hzToNote(hz, referenceHz)
  out.hz = hz
  out.confidence = confidence
  out.note = note.name
  out.cents = note.cents
  out.midi = note.midi
  out.fold = 0
  return out
}
