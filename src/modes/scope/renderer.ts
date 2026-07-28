/**
 * CRT oscilloscope renderer.
 *
 * The look is not a filter over a line chart - it is a model of what an analog
 * scope screen does. Beam brightness follows electron-beam dwell time, and the
 * phosphor image decays between frames. Both are in
 * docs/04-mode-oscilloscope.md#crt-rendering.
 */

import type { AudioFrame } from '../../audio/types'
import { clamp, linearToDb } from '../../lib/dsp'
import { phosphor, scope as scopeTokens } from '../../ui/tokens'
import type { Renderer } from '../types'
import {
  DIV_X,
  DIV_Y,
  MAX_SMOOTH_HALF,
  type ScopeReadout,
  type ScopeSettings,
} from './settings'
import { Trigger } from './trigger'

/** Alpha quantization levels. Segments are grouped by level so each level strokes once. */
const BUCKETS = 24

/** Hard cap on beam segments per frame. The record is 4096, so this is headroom. */
const MAX_POINTS = 8192

/**
 * Smallest decay worth applying to the phosphor buffer. Residue is bounded at
 * roughly `0.5 / MIN_DECAY` in 8-bit alpha, so 0.08 caps it near 2% opacity
 * against the ~12% a naive per-frame decay leaves at long persistence.
 */
const MIN_DECAY = 0.08

/** Glow passes, outer to inner. Three cheap additive strokes beat one shadowBlur. */
const GLOW_PASSES = [
  { width: 6, alpha: 0.06 },
  { width: 2.5, alpha: 0.18 },
  { width: 1, alpha: 0.9 },
] as const

export class ScopeRenderer implements Renderer<ScopeSettings, ScopeReadout> {
  private readonly ctx: CanvasRenderingContext2D

  /** Phosphor image. Never cleared, only decayed - this is the persistence. */
  private persist: HTMLCanvasElement | null = null
  private persistCtx: CanvasRenderingContext2D | null = null

  /** Graticule is static, so it is drawn once and blitted. */
  private grat: HTMLCanvasElement | null = null
  private gratKey = ''

  private w = 0
  private h = 0
  private dpr = 1

  private readonly trigger = new Trigger()

  // --- Preallocated beam geometry -----------------------------------------
  private readonly xs = new Float32Array(MAX_POINTS)
  private readonly ys = new Float32Array(MAX_POINTS)
  private readonly bucketOf = new Uint8Array(MAX_POINTS)
  private readonly counts = new Int32Array(BUCKETS + 1)
  private readonly order = new Int32Array(MAX_POINTS)
  private pointCount = 0

  /** Scratch for the X-Y smoothing passes. */
  private readonly smoothX = new Float32Array(MAX_POINTS)
  private readonly smoothY = new Float32Array(MAX_POINTS)
  private readonly smoothTmp = new Float32Array(MAX_POINTS)

  /**
   * Elapsed time whose decay has not been applied yet.
   *
   * The phosphor buffer holds 8-bit alpha, and `destination-out` multiplies it,
   * so a pixel is stuck forever once `alpha * decay` rounds to nothing. At a 1 s
   * time constant the per-frame decay is 0.017, which strands every alpha below
   * ~30 - about 12% opacity, permanently, exactly where the trace has been. That
   * is the burn-in.
   *
   * Accumulating until the decay is worth applying bounds the residue to
   * `0.5 / MIN_DECAY` instead. The cost is that a long tail steps down rather
   * than gliding, which at these intervals is not visible.
   */
  private decayDebt = 0

  /** Per-bucket stroke colors, rebuilt only when the phosphor changes. */
  private colors: string[] = []
  private colorKey = ''

  private readonly out: ScopeReadout = {
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

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  resize(width: number, height: number, dpr: number) {
    this.w = width
    this.h = height
    this.dpr = dpr
    this.ctx.canvas.width = width
    this.ctx.canvas.height = height

    this.persist = document.createElement('canvas')
    this.persist.width = width
    this.persist.height = height
    this.persistCtx = this.persist.getContext('2d')

    this.grat = null
    this.gratKey = ''
  }

  render(frame: AudioFrame, s: ScopeSettings) {
    if (!this.w || !this.h || !this.persistCtx || !this.persist) return

    this.ensureColors(s)

    // --- Phosphor decay ---------------------------------------------------
    // 'destination-out' multiplies existing alpha by (1 - d) rather than
    // blending toward black, so the image converges toward transparent instead
    // of toward a grey floor. See decayDebt for why it is applied in batches.
    const p = this.persistCtx
    this.decayDebt += frame.dt
    const decay = s.persistence <= 0 ? 1 : 1 - Math.exp(-this.decayDebt / s.persistence)
    if (decay >= MIN_DECAY) {
      this.decayDebt = 0
      p.globalCompositeOperation = 'destination-out'
      p.fillStyle = `rgba(0,0,0,${clamp(decay, 0, 1)})`
      p.fillRect(0, 0, this.w, this.h)
    }

    // --- Build the beam ---------------------------------------------------
    if (s.channel === 'xy') this.buildXY(frame, s)
    else this.buildSweep(frame, s)

    // --- Paint the beam additively ---------------------------------------
    p.globalCompositeOperation = 'lighter'
    p.lineCap = 'round'
    p.lineJoin = 'round'
    this.strokeBuckets(p, s)

    // --- Compose the screen ----------------------------------------------
    const c = this.ctx
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = scopeTokens.screen
    c.fillRect(0, 0, this.w, this.h)

    this.drawGraticule(s)
    if (this.grat) c.drawImage(this.grat, 0, 0)

    c.drawImage(this.persist, 0, 0)

    this.drawTriggerMarker(s)
    this.drawVignette()
  }

  readout(): ScopeReadout {
    return this.out
  }

  dispose() {
    this.persist = null
    this.persistCtx = null
    this.grat = null
  }

  // ------------------------------------------------------------------------
  // Beam geometry
  // ------------------------------------------------------------------------

  /** Standard time-base sweep: voltage against time, started at the trigger point. */
  private buildSweep(frame: AudioFrame, s: ScopeSettings) {
    const buf =
      s.channel === 'left' ? frame.timeL : s.channel === 'right' ? frame.timeR : frame.timeMono
    const len = buf.length

    // Samples the sweep covers. Most time bases are a window into the record
    // rather than the whole thing, which is exactly how a digital scope works.
    const wanted = s.timePerDiv * DIV_X * frame.sampleRate
    const samplesOnScreen = clamp(wanted, 2, len - 4)

    const t = this.trigger.find(
      buf,
      samplesOnScreen,
      s.positionX,
      s.triggerSlope,
      s.triggerAuto,
      s.triggerLevel,
      s.hysteresis,
      frame.dt,
    )

    // Normal mode holds the last trace when no edge is found. Auto sweeps
    // anyway, which is what real scopes default to and why you always see
    // something. Free run never triggers and is honest about it.
    if (s.triggerMode === 'normal' && !t.found) {
      this.pointCount = 0
      this.out.triggered = false
      return
    }
    const startIndex = s.triggerMode === 'free' ? 0 : t.index - samplesOnScreen * s.positionX

    // One point per sample, or one per pixel when the sweep is faster than the
    // display - upsampling keeps a fast time base a smooth curve rather than a
    // polygon. Linear interpolation, not sinc; see docs/04-mode-oscilloscope.md.
    const n = clamp(Math.ceil(Math.max(samplesOnScreen, this.w)), 2, MAX_POINTS)
    const pxPerDivY = this.h / DIV_Y
    const midY = this.h / 2

    let min = Infinity
    let max = -Infinity
    let sumSq = 0
    let visible = 0

    for (let i = 0; i < n; i++) {
      const pos = startIndex + (i / (n - 1)) * samplesOnScreen
      const v = sampleLinear(buf, pos)
      this.xs[i] = (i / (n - 1)) * this.w
      this.ys[i] = midY - (v / s.voltsPerDiv + s.positionY) * pxPerDivY

      if (pos >= 0 && pos <= len - 1) {
        if (v < min) min = v
        if (v > max) max = v
        sumSq += v * v
        visible++
      }
    }
    this.pointCount = n

    // Measurements come from what is actually on screen, as on a real scope.
    // With nothing visible, min/max are still +/-Infinity from initialization.
    this.out.vpp = visible > 0 ? max - min : 0
    this.out.vrms = visible > 0 ? Math.sqrt(sumSq / visible) : 0
    this.out.dbfs = visible > 0 ? linearToDb(Math.max(Math.abs(min), Math.abs(max))) : -100
    this.out.period = t.periodSamples > 0 ? t.periodSamples / frame.sampleRate : 0
    this.out.hz = this.out.period > 0 ? 1 / this.out.period : 0
    this.out.duty = t.duty
    this.out.triggered = t.found
    this.out.triggerLevel = t.level
    this.out.correlation = frame.correlation

    this.bucketize(s)
  }

  /**
   * X-Y (Lissajous): left drives X, right drives Y. No time base and no trigger.
   * Mono collapses to a 45 degree line, wide stereo opens up, out-of-phase
   * content rotates to the other diagonal.
   */
  private buildXY(frame: AudioFrame, s: ScopeSettings) {
    const record = frame.timeL.length
    // Only the most recent slice of the record. The analyser always hands back
    // the newest `record` samples, so taking the tail is taking the present.
    const exposure = Math.round(clamp(s.xyExposure, 2, Math.min(record, MAX_POINTS)))
    const from = record - exposure

    const half = Math.round(clamp(s.xySmoothing, 0, 1) * MAX_SMOOTH_HALF)
    smoothInto(frame.timeL, from, exposure, half, this.smoothX, this.smoothTmp)
    smoothInto(frame.timeR, from, exposure, half, this.smoothY, this.smoothTmp)

    // Square plot area centered in the canvas, so a circle reads as a circle.
    const size = Math.min(this.w, this.h)
    const cx = this.w / 2
    const cy = this.h / 2
    // X-Y uses the vertical scale on both axes, matching a real scope's
    // convention of the same volts/div for both deflection plates.
    const pxPerDiv = size / DIV_Y
    const scale = pxPerDiv / s.voltsPerDiv

    let min = Infinity
    let max = -Infinity
    let sumSq = 0
    for (let i = 0; i < exposure; i++) {
      const l = this.smoothX[i]
      const r = this.smoothY[i]
      this.xs[i] = cx + l * scale
      this.ys[i] = cy - r * scale
      const m = (l + r) * 0.5
      if (m < min) min = m
      if (m > max) max = m
      sumSq += m * m
    }
    this.pointCount = exposure

    this.out.vpp = max - min
    this.out.vrms = Math.sqrt(sumSq / exposure)
    this.out.dbfs = linearToDb(Math.max(Math.abs(min), Math.abs(max)))
    this.out.period = 0
    this.out.hz = 0
    this.out.duty = 0
    this.out.triggered = false
    this.out.triggerLevel = 0
    this.out.correlation = frame.correlation

    this.bucketize(s)
  }

  /**
   * Assign every segment a brightness bucket, then counting-sort segment indices
   * by bucket so each bucket can be stroked as one path.
   *
   * Brightness model: an electron beam deposits energy at a constant rate, so
   * energy per segment is constant and brightness per pixel is that energy
   * divided by how many pixels the segment covers. Slow-moving parts of the
   * trace glow; fast edges are nearly invisible. This is why a square wave has
   * bright tops and dim sides with no special-casing.
   */
  private bucketize(s: ScopeSettings) {
    const n = this.pointCount
    if (n < 2) return

    // Energy per segment scales with 1/n so the total energy laid down per sweep
    // stays constant regardless of how finely the trace is sampled.
    const hstep = this.w / n
    // A sub-pixel segment still lights a whole pixel, so coverage floors at one.
    const minCover = this.dpr
    const gain = s.intensity * hstep

    this.counts.fill(0)
    for (let i = 0; i < n - 1; i++) {
      const dx = this.xs[i + 1] - this.xs[i]
      const dy = this.ys[i + 1] - this.ys[i]
      const len = Math.sqrt(dx * dx + dy * dy)
      const alpha = clamp(gain / Math.max(len, minCover), 0, 1)
      const b = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS))
      this.bucketOf[i] = b
      this.counts[b]++
    }

    // Exclusive prefix sum -> stable counting sort into `order`.
    let running = 0
    for (let b = 0; b < BUCKETS; b++) {
      const c = this.counts[b]
      this.counts[b] = running
      running += c
    }
    this.counts[BUCKETS] = running
    for (let i = 0; i < n - 1; i++) {
      this.order[this.counts[this.bucketOf[i]]++] = i
    }
    // counts[b] now holds the END of bucket b; shift back to get starts.
    for (let b = BUCKETS; b > 0; b--) this.counts[b] = this.counts[b - 1]
    this.counts[0] = 0
  }

  private strokeBuckets(ctx: CanvasRenderingContext2D, s: ScopeSettings) {
    const n = this.pointCount
    if (n < 2) return
    const spot = 1.6 - clamp(s.beamFocus, 0, 1) * 1.25
    const clip = this.h * 4 // segments this far off screen are not worth drawing

    for (let b = 0; b < BUCKETS; b++) {
      const from = this.counts[b]
      const to = this.counts[b + 1]
      if (to <= from) continue

      // Build the path once, stroke it three times at different widths. The 24
      // Path2D objects per frame are the only allocation in the frame path and
      // they are cheap next to rebuilding the geometry per pass.
      const path = new Path2D()
      let any = false
      for (let k = from; k < to; k++) {
        const i = this.order[k]
        const y1 = this.ys[i]
        const y2 = this.ys[i + 1]
        if ((y1 < -clip && y2 < -clip) || (y1 > this.h + clip && y2 > this.h + clip)) continue
        path.moveTo(this.xs[i], y1)
        path.lineTo(this.xs[i + 1], y2)
        any = true
      }
      if (!any) continue

      ctx.strokeStyle = this.colors[b]
      for (const pass of GLOW_PASSES) {
        ctx.globalAlpha = pass.alpha * ((b + 0.5) / BUCKETS)
        // Focus sets width, intensity sets brightness, and they stay separate -
        // two knobs on a real front panel, doing two different things. Letting
        // intensity fatten the beam made a bright trace read as an out-of-focus
        // one.
        ctx.lineWidth = pass.width * this.dpr * spot
        ctx.stroke(path)
      }
    }
    ctx.globalAlpha = 1
  }

  // ------------------------------------------------------------------------
  // Screen furniture
  // ------------------------------------------------------------------------

  private ensureColors(s: ScopeSettings) {
    if (this.colorKey === s.phosphor) return
    this.colorKey = s.phosphor
    const { rgb } = phosphor[s.phosphor]
    const bloom = hexToRgb(phosphor[s.phosphor].bloom)
    this.colors = []
    for (let b = 0; b < BUCKETS; b++) {
      // Brighter segments desaturate toward white, because a saturating phosphor
      // does exactly that. It is what makes intensity read as intensity rather
      // than as opacity.
      const t = ((b + 0.5) / BUCKETS) * 0.7
      const r = Math.round(rgb[0] + (bloom[0] - rgb[0]) * t)
      const g = Math.round(rgb[1] + (bloom[1] - rgb[1]) * t)
      const bl = Math.round(rgb[2] + (bloom[2] - rgb[2]) * t)
      this.colors.push(`rgb(${r},${g},${bl})`)
    }
  }

  private drawGraticule(s: ScopeSettings) {
    const key = `${this.w}x${this.h}:${s.graticuleBrightness}:${s.channel}`
    if (this.gratKey === key && this.grat) return
    this.gratKey = key

    const cv = document.createElement('canvas')
    cv.width = this.w
    cv.height = this.h
    const g = cv.getContext('2d')
    if (!g) return

    const alpha = clamp(s.graticuleBrightness, 0, 2)
    g.lineWidth = Math.max(1, Math.round(this.dpr))
    g.globalAlpha = alpha

    if (s.channel === 'xy') {
      this.drawXYGraticule(g)
      this.grat = cv
      return
    }

    // Division grid, 10 x 8.
    g.strokeStyle = scopeTokens.graticule
    g.beginPath()
    for (let i = 1; i < DIV_X; i++) {
      const x = Math.round((i / DIV_X) * this.w) + 0.5
      g.moveTo(x, 0)
      g.lineTo(x, this.h)
    }
    for (let i = 1; i < DIV_Y; i++) {
      const y = Math.round((i / DIV_Y) * this.h) + 0.5
      g.moveTo(0, y)
      g.lineTo(this.w, y)
    }
    g.stroke()

    // Center axes are brighter, and carry the 0.2-division tick marks real
    // scopes use for rise-time measurement.
    g.strokeStyle = scopeTokens.graticuleMajor
    g.beginPath()
    const cx = Math.round(this.w / 2) + 0.5
    const cy = Math.round(this.h / 2) + 0.5
    g.moveTo(cx, 0)
    g.lineTo(cx, this.h)
    g.moveTo(0, cy)
    g.lineTo(this.w, cy)

    const tick = 4 * this.dpr
    for (let i = 1; i < DIV_X * 5; i++) {
      const x = Math.round((i / (DIV_X * 5)) * this.w) + 0.5
      g.moveTo(x, cy - tick)
      g.lineTo(x, cy + tick)
    }
    for (let i = 1; i < DIV_Y * 5; i++) {
      const y = Math.round((i / (DIV_Y * 5)) * this.h) + 0.5
      g.moveTo(cx - tick, y)
      g.lineTo(cx + tick, y)
    }
    g.stroke()
    g.globalAlpha = 1

    this.grat = cv
  }

  /**
   * X-Y graticule: square, matching the plot area.
   *
   * The 10x8 grid is wrong here. buildXY uses the vertical scale on both axes and
   * plots into a centred square of side min(w, h), so a rectangular grid spanning
   * the full canvas lines up with nothing - divisions read as the wrong size
   * horizontally and the box does not bound the trace.
   *
   * The diagonals are the reason to look at this display at all. On a stereo
   * signal the rising diagonal is where mono content lies and the falling one is
   * where out-of-phase content lies, so they are the reference the eye measures
   * against. Broadcast goniometers draw the same two lines.
   */
  private drawXYGraticule(g: CanvasRenderingContext2D) {
    const size = Math.min(this.w, this.h)
    const ox = (this.w - size) / 2
    const oy = (this.h - size) / 2
    const step = size / DIV_Y

    g.strokeStyle = scopeTokens.graticule
    g.beginPath()
    for (let i = 1; i < DIV_Y; i++) {
      const p = Math.round(ox + i * step) + 0.5
      g.moveTo(p, oy)
      g.lineTo(p, oy + size)
      const q = Math.round(oy + i * step) + 0.5
      g.moveTo(ox, q)
      g.lineTo(ox + size, q)
    }
    g.stroke()

    const cx = Math.round(ox + size / 2) + 0.5
    const cy = Math.round(oy + size / 2) + 0.5

    // Mono and out-of-phase reference diagonals, dashed so they read as
    // annotation rather than as part of the grid.
    g.save()
    g.setLineDash([3 * this.dpr, 4 * this.dpr])
    g.strokeStyle = scopeTokens.graticule
    g.beginPath()
    g.moveTo(ox, oy + size)
    g.lineTo(ox + size, oy)
    g.moveTo(ox, oy)
    g.lineTo(ox + size, oy + size)
    g.stroke()
    g.restore()

    // Centre axes and the bounding box, brighter.
    g.strokeStyle = scopeTokens.graticuleMajor
    g.beginPath()
    g.moveTo(cx, oy)
    g.lineTo(cx, oy + size)
    g.moveTo(ox, cy)
    g.lineTo(ox + size, cy)
    g.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(size), Math.round(size))

    const tick = 4 * this.dpr
    for (let i = 1; i < DIV_Y * 5; i++) {
      const p = Math.round(ox + (i / (DIV_Y * 5)) * size) + 0.5
      g.moveTo(p, cy - tick)
      g.lineTo(p, cy + tick)
      const q = Math.round(oy + (i / (DIV_Y * 5)) * size) + 0.5
      g.moveTo(cx - tick, q)
      g.lineTo(cx + tick, q)
    }
    g.stroke()
  }

  /** Small arrow on the left edge at the trigger voltage, as on a real front panel. */
  private drawTriggerMarker(s: ScopeSettings) {
    if (s.channel === 'xy' || s.triggerMode === 'free') return
    const c = this.ctx
    const pxPerDivY = this.h / DIV_Y
    const y = this.h / 2 - (this.out.triggerLevel / s.voltsPerDiv + s.positionY) * pxPerDivY
    if (y < 0 || y > this.h) return

    const size = 5 * this.dpr
    c.fillStyle = this.out.triggered ? phosphor[s.phosphor].core : '#5a626c'
    c.globalAlpha = 0.85
    c.beginPath()
    c.moveTo(0, y - size)
    c.lineTo(size * 1.6, y)
    c.lineTo(0, y + size)
    c.closePath()
    c.fill()
    c.globalAlpha = 1
  }

  /** Real CRT faces are not uniformly bright at the edges. */
  private drawVignette() {
    const c = this.ctx
    const grad = c.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.25,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.72,
    )
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.55)')
    c.fillStyle = grad
    c.fillRect(0, 0, this.w, this.h)
  }
}

/**
 * Zero-phase smoothing of `count` samples starting at `from`, written to the
 * front of `dst`. Three cascaded box passes, which is a near-Gaussian.
 *
 * **Three passes, not one.** A single box filter has a sinc response whose first
 * sidelobe is only -13 dB, so broadband noise sails straight through it. Cascading
 * three boxes cubes that to about -40 dB. Measured at a matched -3 dB corner - so
 * the real figure is blurred exactly as much either way - the cascade passes
 * **39x less** broadband high-frequency noise at the settings this is used at.
 *
 * That matters because lossy-compressed sources (anything from YouTube) carry
 * codec noise spread broadly across the spectrum, and on an X-Y display that
 * noise is displacement perpendicular to the trace. It is the fuzz.
 *
 * Centred, not recursive: a one-pole filter delays X and Y equally, but that
 * delay is a phase shift, and a phase shift between the two axes rotates and
 * opens a Lissajous figure. That is not smoothing, it is a different picture.
 */
function smoothInto(
  src: Float32Array,
  from: number,
  count: number,
  half: number,
  dst: Float32Array,
  tmp: Float32Array,
) {
  if (half <= 0) {
    for (let i = 0; i < count; i++) dst[i] = src[from + i]
    return
  }
  // Sub-window chosen so three passes land on the same -3 dB corner a single
  // pass of `half` would have.
  const h = Math.max(1, Math.round(half * 0.58))

  boxFrom(src, from, count, h, dst)
  boxLocal(dst, count, h, tmp)
  boxLocal(tmp, count, h, dst)
}

/** First pass: reads the source window, clamping at the record edges. */
function boxFrom(src: Float32Array, from: number, count: number, half: number, out: Float32Array) {
  const last = src.length - 1
  const width = half * 2 + 1
  let sum = 0
  for (let k = -half; k <= half; k++) {
    const i = from + k
    sum += src[i < 0 ? 0 : i > last ? last : i]
  }
  for (let i = 0; i < count; i++) {
    out[i] = sum / width
    const add = from + i + half + 1
    const rem = from + i - half
    sum += src[add < 0 ? 0 : add > last ? last : add] - src[rem < 0 ? 0 : rem > last ? last : rem]
  }
}

/** Later passes: the window is already dense at the front of the array. */
function boxLocal(src: Float32Array, count: number, half: number, out: Float32Array) {
  const last = count - 1
  const width = half * 2 + 1
  let sum = 0
  for (let k = -half; k <= half; k++) sum += src[k < 0 ? 0 : k > last ? last : k]
  for (let i = 0; i < count; i++) {
    out[i] = sum / width
    const add = i + half + 1
    const rem = i - half
    sum += src[add > last ? last : add] - src[rem < 0 ? 0 : rem]
  }
}

/** Linear interpolation into the record, with zero outside it. */
function sampleLinear(buf: Float32Array, pos: number): number {
  if (pos < 0 || pos > buf.length - 1) return 0
  const i = Math.floor(pos)
  const f = pos - i
  const a = buf[i]
  const b = i + 1 < buf.length ? buf[i + 1] : a
  return a + (b - a) * f
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
