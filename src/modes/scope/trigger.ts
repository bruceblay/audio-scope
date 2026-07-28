/**
 * Edge triggering. This is the single thing that separates an oscilloscope from
 * a line chart: a real scope starts every sweep at the same point in the
 * waveform's cycle, so a periodic signal stands still on screen.
 *
 * See docs/04-mode-oscilloscope.md#1-edge-triggering.
 */

import type { TriggerSlope } from './settings'

export interface TriggerResult {
  /** Fractional sample index where the sweep should start. */
  index: number
  /** False when no qualifying edge was found in the search window. */
  found: boolean
  /** Level actually used, after auto-level tracking. */
  level: number
  /** Mean interval between qualifying edges, in samples. 0 when indeterminate. */
  periodSamples: number
  /** Hysteresis band actually applied, in FS. Shown as a band around the level marker. */
  hysteresis: number
  /** Fraction of the period spent above the trigger level, 0..1. */
  duty: number
}

export class Trigger {
  /** Slowly-tracking signal extremes, used to derive the auto trigger level. */
  private runMin = 0
  private runMax = 0
  private lastLevel = 0

  /**
   * @param buf the time-domain record
   * @param samplesOnScreen how many samples the sweep will draw
   * @param positionX where the trigger point sits horizontally, 0..1
   */
  find(
    buf: Float32Array,
    samplesOnScreen: number,
    positionX: number,
    slope: TriggerSlope,
    autoLevel: boolean,
    manualLevel: number,
    hysteresisFraction: number,
    dt: number,
  ): TriggerResult {
    const len = buf.length

    // --- Track the signal extremes ---------------------------------------
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < len; i++) {
      const v = buf[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    // Attack instantly, release slowly, so the level follows a fade without
    // hunting around inside a steady waveform.
    const release = Math.exp(-dt / 0.35)
    this.runMin = Math.min(min, this.runMin * release + min * (1 - release))
    this.runMax = Math.max(max, this.runMax * release + max * (1 - release))

    // A fixed 0.0 level fails on DC-offset or asymmetric signals. The midpoint
    // of the actual extremes is the same idea as a scope's "set level to 50%"
    // button, run continuously.
    const level = autoLevel ? (this.runMin + this.runMax) * 0.5 : manualLevel
    this.lastLevel = level

    // --- Search window ---------------------------------------------------
    // The trigger point sits `positionX` of the way across the screen, so the
    // sweep needs pre-trigger samples before it and the rest after. That is how
    // a digital scope works: it captures a record, then finds the edge inside it.
    const pre = Math.ceil(samplesOnScreen * positionX)
    const post = Math.ceil(samplesOnScreen * (1 - positionX))
    const searchStart = pre
    const searchEnd = len - post - 2

    // Hysteresis (noise reject on a real front panel): after an edge, the signal
    // must move back past the level by this much before another edge counts.
    // This is what rejects multiple crossings from noise riding on the signal.
    //
    // It replaces a sample-count holdoff, which corrupts frequency measurement:
    // a 24-sample holdoff silently discards two of every three edges of a
    // 4.4 kHz tone (10.9 samples per cycle) and reports the frequency 3x low.
    // Hysteresis is amplitude-based, so it is independent of frequency.
    const hysteresis = (this.runMax - this.runMin) * hysteresisFraction * 0.5

    const fallback: TriggerResult = {
      index: pre,
      found: false,
      level,
      periodSamples: 0,
      duty: 0,
      hysteresis,
    }
    if (searchEnd <= searchStart) return fallback

    // --- Scan for qualifying edges ---------------------------------------
    let firstIndex = -1
    let lastIndex = -1
    let edgeCount = 0
    let aboveSamples = 0
    let spanSamples = 0

    // Arming state. A rising edge only counts once the signal has been below
    // `level - hysteresis`; a falling edge once it has been above
    // `level + hysteresis`.
    let armedRising = buf[searchStart] < level - hysteresis
    let armedFalling = buf[searchStart] > level + hysteresis

    for (let i = searchStart; i <= searchEnd; i++) {
      const a = buf[i]
      const b = buf[i + 1]

      if (a < level - hysteresis) armedRising = true
      if (a > level + hysteresis) armedFalling = true

      const rising = armedRising && a < level && b >= level
      const falling = armedFalling && a > level && b <= level
      const qualifies =
        slope === 'rising' ? rising : slope === 'falling' ? falling : rising || falling

      if (!qualifies) continue
      if (rising) armedRising = false
      if (falling) armedFalling = false

      // Sub-sample interpolation. Without this the trigger point quantizes to
      // whole samples, and a 1 kHz tone at 48 kHz (48 samples per cycle) shivers
      // by up to 1/48th of a cycle every frame. This is the difference between a
      // trace that sits perfectly still and one that never quite settles.
      const frac = b === a ? 0 : (level - a) / (b - a)
      const exact = i + frac

      if (firstIndex < 0) firstIndex = exact
      else {
        edgeCount++
        // Duty is measured over the interval between successive edges.
        spanSamples += exact - lastIndex
      }
      lastIndex = exact
    }

    if (firstIndex < 0) return fallback

    // Period from the mean edge interval. Measuring between trigger events is
    // independent of the FFT and far more precise at audio frequencies than bin
    // interpolation - a 48-sample cycle is resolved to a fraction of a sample.
    let periodSamples = 0
    if (edgeCount > 0) {
      periodSamples = spanSamples / edgeCount
      // With 'either' slope, consecutive edges are half a cycle apart.
      if (slope === 'either') periodSamples *= 2
    }

    // Duty cycle over one measured period starting at the trigger point.
    if (periodSamples > 2) {
      const from = Math.floor(firstIndex)
      const to = Math.min(len - 1, Math.floor(firstIndex + periodSamples))
      for (let i = from; i <= to; i++) if (buf[i] > level) aboveSamples++
      const window = to - from + 1
      return {
        index: firstIndex,
        found: true,
        level,
        periodSamples,
        duty: window > 0 ? aboveSamples / window : 0,
        hysteresis,
      }
    }

    return { index: firstIndex, found: true, level, periodSamples, duty: 0, hysteresis }
  }

  get level() {
    return this.lastLevel
  }

  reset() {
    this.runMin = 0
    this.runMax = 0
  }
}
