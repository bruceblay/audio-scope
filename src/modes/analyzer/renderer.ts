/**
 * Spectrum analyzer and spectrogram.
 *
 * Both views read the same FFT and share a log frequency axis, which is the
 * reason they belong behind one selector: a spectrogram *is* the spectrum over
 * time, so switching between them changes the time window rather than the
 * instrument.
 *
 * The measurement maths lives in spectrum.ts so it can be verified without a
 * canvas; this file is geometry and paint.
 */

import type { AudioFrame } from '../../audio/types'
import { clamp } from '../../lib/dsp'
import { font, phosphor, screenTheme, type ThemeId } from '../../ui/tokens'
import type { Renderer } from '../types'
import type { AnalyzerReadout, AnalyzerSettings, ColorMap } from './settings'
import {
  buildAxis,
  hzAt,
  magnitudeAt,
  octaveBands,
  spectralCentroid,
  tiltDb,
  usableTopHz,
  type Axis,
} from './spectrum'

/** Octave centres, the frequencies an analyzer actually rules its grid on. */
const GRID_HZ = [20, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

const labelFor = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`)

/** Perceptually uniform. Sampled control points, linearly interpolated. */
const MAGMA: [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 253, 191],
]

const GLOW = [
  { width: 5, alpha: 0.07 },
  { width: 2, alpha: 0.2 },
  { width: 1, alpha: 0.85 },
] as const

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export class AnalyzerRenderer implements Renderer<AnalyzerSettings, AnalyzerReadout> {
  private readonly ctx: CanvasRenderingContext2D

  private w = 0
  private h = 0
  private dpr = 1

  /** Per-pixel FFT bin ranges: columns for the spectrum, rows for the waterfall. */
  private cols: Axis = { from: new Int32Array(0), to: new Int32Array(0), centre: new Float32Array(0) }
  private rows: Axis = { from: new Int32Array(0), to: new Int32Array(0), centre: new Float32Array(0) }
  private axisKey = ''
  /** Octave bands for bar mode, recomputed only when the range changes. */
  private bands: { lo: number; hi: number; centre: number }[] = []
  private bandKey = ''
  /** Top of the visible range after the Nyquist cap. Held, not re-parsed. */
  private topHz = 20000

  /** Smoothed and held magnitudes, in dB, one per column. */
  private mags = new Float32Array(0)
  private peaks = new Float32Array(0)

  /** Outline polyline, rebuilt each frame. Bars and curve share it. */
  private plotX = new Float32Array(0)
  private plotY = new Float32Array(0)
  private plotN = 0

  private sgram: HTMLCanvasElement | null = null
  private sgramCtx: CanvasRenderingContext2D | null = null
  private column: ImageData | null = null
  private head = 0
  /** Elapsed time not yet turned into columns. */
  private scrollDebt = 0
  /** Everything the stored columns were rendered against. */
  private sgramKey = ''

  private readonly out: AnalyzerReadout = {
    peakHz: 0,
    peakDb: -120,
    centroidHz: 0,
    rmsDb: -120,
    spanSec: 0,
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

    this.mags = new Float32Array(width).fill(-140)
    this.peaks = new Float32Array(width).fill(-140)
    // Bars emit two points per step, so the outline can exceed one point per pixel.
    this.plotX = new Float32Array(width * 2 + 4)
    this.plotY = new Float32Array(width * 2 + 4)

    this.sgram = document.createElement('canvas')
    this.sgram.width = width
    this.sgram.height = height
    this.sgramCtx = this.sgram.getContext('2d')
    this.column = this.sgramCtx?.createImageData(1, height) ?? null
    this.head = 0
    this.axisKey = ''
    this.sgramKey = ''
  }

  render(frame: AudioFrame, s: AnalyzerSettings, theme: ThemeId) {
    if (!this.w || !this.h) return
    const skin = screenTheme[theme]
    const c = this.ctx

    this.ensureAxes(frame, s)
    this.measure(frame, s)

    c.globalCompositeOperation = 'source-over'
    c.fillStyle = skin.screen
    c.fillRect(0, 0, this.w, this.h)

    if (s.view === 'spectrogram') {
      this.advanceSpectrogram(frame, s)
      this.blitSpectrogram()
      this.drawFreqRules(s, skin)
    } else {
      this.drawDbRules(s, skin)
      this.drawFreqRules(s, skin)
      this.drawSpectrum(s)
    }
  }

  readout(): AnalyzerReadout {
    return this.out
  }

  dispose() {
    this.sgram = null
    this.sgramCtx = null
    this.column = null
  }

  // ------------------------------------------------------------------ axes --

  private ensureAxes(frame: AudioFrame, s: AnalyzerSettings) {
    const top = usableTopHz(s.maxHz, frame.sampleRate)
    const key = `${this.w}x${this.h}:${s.minHz}:${top}:${frame.sampleRate}:${frame.spectrumShort.length}`
    if (key === this.axisKey) return
    this.axisKey = key
    this.topHz = top

    // The analyzer reads the short window: a 171 ms window is visibly behind the
    // audio, which reads as lag no amount of smoothing can remove.
    const bins = frame.spectrumShort.length
    this.cols = buildAxis(this.w, s.minHz, top, bins, frame.sampleRate)
    this.rows = buildAxis(this.h, s.minHz, top, bins, frame.sampleRate)
  }

  private ensureBands(s: AnalyzerSettings) {
    const key = `${s.minHz}:${this.topHz}:${s.bandsPerOctave}`
    if (key === this.bandKey) return
    this.bandKey = key
    this.bands = octaveBands(s.minHz, this.topHz, s.bandsPerOctave)
  }

  /** Horizontal position of a frequency on the log axis, 0..1. */
  private tFor(hz: number, s: AnalyzerSettings) {
    return Math.log(hz / s.minHz) / Math.log(this.topHz / s.minHz)
  }

  // ----------------------------------------------------------- measurement --

  private measure(frame: AudioFrame, s: AnalyzerSettings) {
    const spec = frame.spectrumShort

    // Fast attack, slow release. An analyzer must jump onto a transient and ease
    // off it, or peaks read late and the display lies about dynamics.
    const release = 1 - clamp(s.averaging, 0, 0.98) * 0.85
    const decayPerFrame = s.peakDecay * frame.dt

    let peakDb = -140
    let peakX = 0

    for (let x = 0; x < this.w; x++) {
      // Interpolating where a pixel covers less than one bin is what removes the
      // stepped plateaus at the low end; see magnitudeAt.
      const best = magnitudeAt(spec, this.cols, x)
      const v = best + tiltDb(hzAt(x, this.w, s.minHz, this.topHz), s.slope)

      this.mags[x] = v > this.mags[x] ? v : this.mags[x] + (v - this.mags[x]) * release
      this.peaks[x] = Math.max(this.mags[x], this.peaks[x] - decayPerFrame)

      if (this.mags[x] > peakDb) {
        peakDb = this.mags[x]
        peakX = x
      }
    }

    this.out.peakHz = hzAt(peakX, this.w, s.minHz, this.topHz)
    this.out.peakDb = peakDb
    this.out.centroidHz = spectralCentroid(frame.spectrum, frame.sampleRate)
    this.out.rmsDb = frame.rms > 1e-7 ? 20 * Math.log10(frame.rms) : -120
    this.out.spanSec = this.w / Math.max(1, s.scrollRate)
  }

  // --------------------------------------------------------------- drawing --

  private yFor(db: number, s: AnalyzerSettings) {
    return this.h - clamp((db - s.floorDb) / (s.ceilDb - s.floorDb), 0, 1) * this.h
  }

  private drawDbRules(s: AnalyzerSettings, skin: (typeof screenTheme)[ThemeId]) {
    const c = this.ctx
    c.lineWidth = Math.max(1, Math.round(this.dpr))
    c.strokeStyle = skin.graticule
    c.beginPath()
    const first = Math.ceil(s.floorDb / 12) * 12
    for (let db = first; db <= s.ceilDb; db += 12) {
      const y = Math.round(this.yFor(db, s)) + 0.5
      c.moveTo(0, y)
      c.lineTo(this.w, y)
    }
    c.stroke()

    c.fillStyle = skin.graticule
    c.font = `${10 * this.dpr}px ${font.mono}`
    c.textAlign = 'left'
    c.textBaseline = 'bottom'
    for (let db = first; db <= s.ceilDb; db += 12) {
      c.fillText(`${db}`, 3 * this.dpr, this.yFor(db, s) - 2 * this.dpr)
    }
  }

  /** Frequency runs across the spectrum and up the side of the waterfall. */
  private drawFreqRules(s: AnalyzerSettings, skin: (typeof screenTheme)[ThemeId]) {
    const c = this.ctx
    const ratio = Math.log(this.topHz / s.minHz)
    const sideways = s.view === 'spectrogram'

    c.strokeStyle = skin.graticule
    c.lineWidth = Math.max(1, Math.round(this.dpr))
    c.beginPath()
    for (const hz of GRID_HZ) {
      if (hz < s.minHz || hz > this.topHz) continue
      const t = Math.log(hz / s.minHz) / ratio
      if (sideways) {
        const y = Math.round(this.h - t * this.h) + 0.5
        c.moveTo(0, y)
        c.lineTo(this.w, y)
      } else {
        const x = Math.round(t * this.w) + 0.5
        c.moveTo(x, 0)
        c.lineTo(x, this.h)
      }
    }
    c.stroke()

    c.fillStyle = skin.graticuleMajor
    c.font = `${10 * this.dpr}px ${font.mono}`
    for (const hz of GRID_HZ) {
      if (hz < s.minHz || hz > this.topHz) continue
      const t = Math.log(hz / s.minHz) / ratio
      if (sideways) {
        c.textAlign = 'left'
        c.textBaseline = 'bottom'
        c.fillText(labelFor(hz), 3 * this.dpr, this.h - t * this.h - 2 * this.dpr)
      } else {
        c.textAlign = 'center'
        c.textBaseline = 'bottom'
        c.fillText(labelFor(hz), t * this.w, this.h - 3 * this.dpr)
      }
    }
  }

  private buildOutline(s: AnalyzerSettings) {
    let n = 0
    for (let x = 0; x < this.w; x++) {
      this.plotX[n] = x
      this.plotY[n] = this.yFor(this.mags[x], s)
      n++
    }
    this.plotN = n
  }

  /**
   * Bars as octave-fraction bands, the RTA layout.
   *
   * The previous version stepped the curve every few pixels, which is not a bar
   * chart - it is a curve with corners, and at four CSS pixels a step it was
   * indistinguishable from the curve. Real bars are bands whose width means
   * something and is constant in log frequency, drawn from the floor with gaps
   * between them.
   */
  private drawBars(s: AnalyzerSettings) {
    this.ensureBands(s)
    const c = this.ctx
    const [r, g, b] = phosphor.p31.rgb
    const gap = Math.max(1, Math.round(this.dpr))

    const grad = c.createLinearGradient(0, 0, 0, this.h)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.92)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.28)`)

    for (const band of this.bands) {
      const x0 = this.tFor(Math.max(band.lo, s.minHz), s) * this.w
      const x1 = this.tFor(Math.min(band.hi, this.topHz), s) * this.w
      const width = Math.max(1, x1 - x0 - gap)

      // The band's level is the loudest column inside it, matching how the curve
      // treats a pixel covering many bins.
      let best = -140
      let peak = -140
      const from = clamp(Math.round(x0), 0, this.w - 1)
      const to = clamp(Math.round(x1), 0, this.w - 1)
      for (let x = from; x <= to; x++) {
        if (this.mags[x] > best) best = this.mags[x]
        if (this.peaks[x] > peak) peak = this.peaks[x]
      }

      const y = this.yFor(best, s)
      c.fillStyle = grad
      c.fillRect(x0, y, width, this.h - y)

      if (s.peakHold && peak > s.floorDb) {
        const py = this.yFor(peak, s)
        c.fillStyle = `rgba(${r},${g},${b},0.85)`
        c.fillRect(x0, py - this.dpr, width, Math.max(1, this.dpr))
      }
    }
  }

  private drawSpectrum(s: AnalyzerSettings) {
    if (s.bars) {
      this.drawBars(s)
      return
    }
    this.buildOutline(s)
    if (this.plotN < 2) return

    const c = this.ctx
    const [r, g, b] = phosphor.p31.rgb

    // Filled body first, so the curve reads as the edge of a mass rather than a
    // floating line.
    const filled = new Path2D()
    filled.moveTo(this.plotX[0], this.h)
    for (let i = 0; i < this.plotN; i++) filled.lineTo(this.plotX[i], this.plotY[i])
    filled.lineTo(this.plotX[this.plotN - 1], this.h)
    filled.closePath()

    const grad = c.createLinearGradient(0, 0, 0, this.h)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.34)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.02)`)
    c.fillStyle = grad
    c.fill(filled)

    const trace = new Path2D()
    trace.moveTo(this.plotX[0], this.plotY[0])
    for (let i = 1; i < this.plotN; i++) trace.lineTo(this.plotX[i], this.plotY[i])

    // Same additive glow as the scope, so both modes read as one tube.
    c.globalCompositeOperation = 'lighter'
    c.lineJoin = 'round'
    for (const pass of GLOW) {
      c.strokeStyle = `rgba(${r},${g},${b},${pass.alpha})`
      c.lineWidth = pass.width * this.dpr
      c.stroke(trace)
    }

    if (s.peakHold) {
      const [br, bg, bb] = hexToRgb(phosphor.p31.bloom)
      const hold = new Path2D()
      hold.moveTo(0, this.yFor(this.peaks[0], s))
      for (let x = 1; x < this.w; x++) hold.lineTo(x, this.yFor(this.peaks[x], s))
      c.strokeStyle = `rgba(${br},${bg},${bb},0.5)`
      c.lineWidth = Math.max(1, this.dpr)
      c.stroke(hold)
    }
    c.globalCompositeOperation = 'source-over'
  }

  // ----------------------------------------------------------- spectrogram --

  private colorAt(t: number, map: ColorMap, out: Uint8ClampedArray, at: number) {
    const v = clamp(t, 0, 1)
    if (map === 'phosphor') {
      const [r, g, b] = phosphor.p31.rgb
      // One hue ramping in lightness: monotonic in perceived brightness, so it
      // cannot fabricate edges the way a rainbow scale does.
      const lift = v * v
      const white = Math.max(0, v - 0.82) * 5
      out[at] = Math.min(255, r * lift * 1.1 + 255 * white)
      out[at + 1] = Math.min(255, g * lift)
      out[at + 2] = Math.min(255, b * lift * 1.1 + 255 * white)
      out[at + 3] = 255
      return
    }
    const scaled = v * (MAGMA.length - 1)
    const i = Math.min(MAGMA.length - 2, Math.floor(scaled))
    const f = scaled - i
    out[at] = MAGMA[i][0] + (MAGMA[i + 1][0] - MAGMA[i][0]) * f
    out[at + 1] = MAGMA[i][1] + (MAGMA[i + 1][1] - MAGMA[i][1]) * f
    out[at + 2] = MAGMA[i][2] + (MAGMA[i + 1][2] - MAGMA[i][2]) * f
    out[at + 3] = 255
  }

  /**
   * Advance the waterfall by elapsed time rather than by frame.
   *
   * One column per frame ties the time axis to the render loop, so a dropped
   * frame silently stretches history and the image stops being readable as time.
   * The burst is capped so a long stall does not try to redraw the whole surface
   * in one go.
   *
   * Any change to the range, scaling or colour map invalidates every stored
   * column, because each was coloured against the settings live at the time it
   * was written. Without the reset, old and new columns share a picture while
   * meaning different things.
   */
  private advanceSpectrogram(frame: AudioFrame, s: AnalyzerSettings) {
    const key = `${this.axisKey}:${s.floorDb}:${s.ceilDb}:${s.slope}:${s.map}`
    if (key !== this.sgramKey) {
      this.sgramKey = key
      this.sgramCtx?.clearRect(0, 0, this.w, this.h)
      this.head = 0
      this.scrollDebt = 0
    }

    const perColumn = 1 / Math.max(1, s.scrollRate)
    this.scrollDebt = Math.min(this.scrollDebt + frame.dt, perColumn * 8)
    let pushed = 0
    while (this.scrollDebt >= perColumn && pushed < 8) {
      this.pushColumn(frame, s)
      this.scrollDebt -= perColumn
      pushed++
    }
  }

  private pushColumn(frame: AudioFrame, s: AnalyzerSettings) {
    const ctx = this.sgramCtx
    const col = this.column
    if (!ctx || !col) return

    const spec = frame.spectrumShort
    const data = col.data
    const span = s.ceilDb - s.floorDb

    for (let y = 0; y < this.h; y++) {
      // Row 0 is the top of the image, so the highest frequency.
      const row = this.h - 1 - y
      const best = magnitudeAt(spec, this.rows, row)
      const db = best + tiltDb(hzAt(row, this.h, s.minHz, this.topHz), s.slope)
      this.colorAt((db - s.floorDb) / span, s.map, data, y * 4)
    }

    ctx.putImageData(col, this.head, 0)
    this.head = (this.head + 1) % this.w
  }

  /** Composite the ring in two slices so the newest column sits at the right edge. */
  private blitSpectrogram() {
    const src = this.sgram
    if (!src) return
    const c = this.ctx
    const tail = this.w - this.head
    if (tail > 0) c.drawImage(src, this.head, 0, tail, this.h, 0, 0, tail, this.h)
    if (this.head > 0) c.drawImage(src, 0, 0, this.head, this.h, tail, 0, this.head, this.h)
  }
}
