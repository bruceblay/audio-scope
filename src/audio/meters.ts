/**
 * Level meter ballistics.
 *
 * The point of a meter is its ballistics. A "VU meter" that follows the
 * instantaneous peak and has a needle drawn on it is not a VU meter - it is a
 * peak meter wearing a costume, and it will disagree with a real one on every
 * piece of music. VU and PPM exist as separate instruments precisely *because*
 * their integration times differ: VU reads perceived loudness, PPM reads what
 * will actually clip, and the gap between them is the useful information.
 *
 * Verified against the published step responses in test/meters.test.ts.
 */

import { clamp, linearToDb } from '../lib/dsp'

/**
 * VU, per ANSI C16.5 / IEC 60268-17.
 *
 * A step of 1 kHz sine at reference level drives the needle to 99% of its final
 * reading in 300 ms, with 1-1.5% overshoot, and the fall is symmetric. That is a
 * damped second-order mechanical system, not a one-pole filter: a one-pole
 * cannot overshoot at all, so it can match the rise time or the character but
 * never both.
 *
 * Damping 0.826 gives ~1% overshoot; the natural frequency is then set by the
 * 300 ms settling requirement.
 */
const VU_DAMPING = 0.826
const VU_NATURAL_RAD = 4.6 / (VU_DAMPING * 0.3)

/**
 * PPM, DIN 45406 ballistics: the needle falls 20 dB in 1.7 seconds.
 *
 * Attack is fast but not instantaneous - a real PPM deliberately under-reads
 * very short transients, which is why it is a *programme* meter rather than a
 * sample-peak meter.
 */
const PPM_FALL_DB_PER_SEC = 20 / 1.7
const PPM_ATTACK_TAU = 0.01

/** Peak hold dwell before it starts falling, and how fast it then falls. */
const HOLD_DWELL_SEC = 1.6
const HOLD_FALL_DB_PER_SEC = 12

/** A clip light stays lit long enough to be seen. */
const CLIP_DWELL_SEC = 1.5

/** Digital full scale is 0 dBFS; anything at or above it may already be clipped. */
const CLIP_THRESHOLD = 0.999

export interface MeterState {
  /** VU reading per channel, dBFS. */
  vuDb: [number, number]
  /** PPM reading per channel, dBFS. */
  ppmDb: [number, number]
  /** Peak hold marker per channel, dBFS. */
  holdDb: [number, number]
  /** Clip light per channel. */
  clipped: [boolean, boolean]
}

/** One channel's worth of ballistic state. */
class Channel {
  /** VU needle position and velocity, in linear amplitude. */
  private position = 0
  private velocity = 0
  private ppmLinear = 0
  private ppmDb = -120
  private holdDb = -120
  private holdAge = 0
  private clipAge = CLIP_DWELL_SEC

  step(rms: number, peak: number, dt: number) {
    // --- VU: driven second-order system --------------------------------
    // Semi-implicit Euler, which stays stable at frame rates where explicit
    // Euler would slowly gain energy.
    const w = VU_NATURAL_RAD
    this.velocity += (w * w * (rms - this.position) - 2 * VU_DAMPING * w * this.velocity) * dt
    this.position += this.velocity * dt
    if (this.position < 0) {
      this.position = 0
      this.velocity = 0
    }

    // --- PPM: fast attack, standardized linear-in-dB fall ---------------
    if (peak > this.ppmLinear) {
      // Attack still has a time constant. A PPM under-reads very short
      // transients on purpose; that is what separates it from a sample-peak
      // meter and why broadcast uses it.
      const k = 1 - Math.exp(-dt / PPM_ATTACK_TAU)
      this.ppmLinear += (peak - this.ppmLinear) * k
    } else {
      this.ppmLinear = peak
    }
    const instant = linearToDb(this.ppmLinear)
    this.ppmDb =
      instant > this.ppmDb ? instant : Math.max(instant, this.ppmDb - PPM_FALL_DB_PER_SEC * dt)

    // --- Peak hold ------------------------------------------------------
    const peakDb = linearToDb(peak)
    if (peakDb >= this.holdDb) {
      this.holdDb = peakDb
      this.holdAge = 0
    } else {
      this.holdAge += dt
      if (this.holdAge > HOLD_DWELL_SEC) this.holdDb -= HOLD_FALL_DB_PER_SEC * dt
    }

    // --- Clip -----------------------------------------------------------
    if (peak >= CLIP_THRESHOLD) this.clipAge = 0
    else this.clipAge += dt
  }

  get vu() {
    return linearToDb(this.position)
  }
  get ppm() {
    return this.ppmDb
  }
  get hold() {
    return this.holdDb
  }
  get isClipped() {
    return this.clipAge < CLIP_DWELL_SEC
  }

  reset() {
    this.position = 0
    this.velocity = 0
    this.ppmLinear = 0
    this.ppmDb = -120
    this.holdDb = -120
    this.holdAge = 0
    this.clipAge = CLIP_DWELL_SEC
  }
}

export class Meters {
  private readonly left = new Channel()
  private readonly right = new Channel()

  readonly state: MeterState = {
    vuDb: [-120, -120],
    ppmDb: [-120, -120],
    holdDb: [-120, -120],
    clipped: [false, false],
  }

  /**
   * @param rmsL,rmsR per-channel RMS over the record, linear
   * @param peakL,peakR per-channel absolute peak over the record, linear
   */
  update(rmsL: number, rmsR: number, peakL: number, peakR: number, dt: number) {
    const step = clamp(dt, 0, 0.1)
    this.left.step(rmsL, peakL, step)
    this.right.step(rmsR, peakR, step)

    this.state.vuDb[0] = this.left.vu
    this.state.vuDb[1] = this.right.vu
    this.state.ppmDb[0] = this.left.ppm
    this.state.ppmDb[1] = this.right.ppm
    this.state.holdDb[0] = this.left.hold
    this.state.holdDb[1] = this.right.hold
    this.state.clipped[0] = this.left.isClipped
    this.state.clipped[1] = this.right.isClipped
  }

  reset() {
    this.left.reset()
    this.right.reset()
    this.state.vuDb[0] = this.state.vuDb[1] = -120
    this.state.ppmDb[0] = this.state.ppmDb[1] = -120
    this.state.holdDb[0] = this.state.holdDb[1] = -120
    this.state.clipped[0] = this.state.clipped[1] = false
  }
}

/** Exported for verification against the published step responses. */
export const BALLISTICS = {
  VU_DAMPING,
  VU_NATURAL_RAD,
  PPM_FALL_DB_PER_SEC,
  PPM_ATTACK_TAU,
}
