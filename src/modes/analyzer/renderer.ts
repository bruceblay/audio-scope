/**
 * Spectrum analyzer and spectrogram.
 *
 * Both views read the same FFT and share a log frequency axis, which is the
 * reason they belong behind one selector: a spectrogram *is* the spectrum over
 * time, so switching between them changes the time window rather than the
 * instrument.
 */

import type { AudioFrame } from '../../audio/types'
import { clamp } from '../../lib/dsp'
import { font, phosphor, screenTheme, type ThemeId } from '../../ui/tokens'
import type { Renderer } from '../types'
import type { AnalyzerReadout, AnalyzerSettings, ColorMap } from './settings'

/** Octave centres, the frequencies an analyzer actually rules its grid on. */
const GRID_HZ = [
  20, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
]

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

export class AnalyzerRenderer implements Renderer<AnalyzerSettings, AnalyzerReadout> {
  private readonly ctx: CanvasRenderingContext2D

  private w = 0
  private h = 0
  private dpr = 1

  /** Per-column FFT bin range for the spectrum's log x axis. */
  private colFrom = new Int32Array(0)
  private colTo = new Int32Array(0)
  /** Per-row FFT bin range for the spectrogram's log y axis. */
  private rowFrom = new Int32Array(0)
  private rowTo = new Int32Array(0)
  private mapKey = ''

  /** Smoothed and held magnitudes, in dB, one per column. */
  private mags = new Float32Array(0)
  private peaks = new Float32Array(0)

  /**
   * Spectrogram history as a ring, written one column at a time.
   *
   * A ring rather than blitting the canvas onto itself each frame: self-copying
   * is an extra full-surface draw per frame and invites resampling artifacts,
   * whereas a ring writes one column and composites in two slices.
   */
  private sgram: HTMLCanvasElement | null = null
  private sgramCtx: CanvasRenderingContext2D | null = null
  private column: ImageData | null = null
  private head = 0

  private readonly out: AnalyzerReadout = {
    peakHz: 0,
    peakDb: -120,
    centroidHz: 0,
    rmsDb: -120,
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

    this.mags = new Float32Array(width)
    this.peaks = new Float32Array(width)
    this.mags.fill(-140)
    this.peaks.fill(-140)

    this.sgram = document.createElement('canvas')
    this.sgram.width = width
    this.sgram.height = height
    this.sgramCtx = this.sgram.getContext('2d')
    this.column = this.sgramCtx?.createImageData(1, height) ?? null
    this.head = 0
    this.mapKey = ''
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
      this.pushColumn(frame, s)
      this.blitSpectrogram()
      this.drawFreqGrid(s, skin, 'vertical')
    } else {
      this.drawGrid(s, skin)
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

  // ------------------------------------------------------------------------

  private topHz(frame: AudioFrame, s: AnalyzerSettings) {
    return Math.min(s.maxHz, frame.sampleRate * 0.5 * 0.98)
  }

  /**
   * Map each pixel to the FFT bins that fall inside it.
   *
   * Precomputed because it only changes with size, range or sample rate, and
   * because the mapping is not one-to-one in either direction: at 20 Hz a single
   * bin spans many pixels, while near 20 kHz hundreds of bins fall into one.
   * Taking the **maximum** over each pixel's bins rather than the mean is what
   * keeps a narrow peak from vanishing at the top end - an averaged analyzer
   * hides exactly the detail you are looking for.
   */
  private ensureAxes(frame: AudioFrame, s: AnalyzerSettings) {
    const top = this.topHz(frame, s)
    const key = `${this.w}x${this.h}:${s.minHz}:${top}:${frame.sampleRate}`
    if (key === this.mapKey) return
    this.mapKey = key

    const bins = frame.spectrum.length
    const hzPerBin = frame.sampleRate / (bins * 2)
    const ratio = Math.log(top / s.minHz)

    const build = (n: number) => {
      const from = new Int32Array(n)
      const to = new Int32Array(n)
      for (let i = 0; i < n; i++) {
        const f0 = s.minHz * Math.exp((i / n) * ratio)
        const f1 = s.minHz * Math.exp(((i + 1) / n) * ratio)
        const b0 = clamp(Math.floor(f0 / hzPerBin), 0, bins - 1)
        const b1 = clamp(Math.ceil(f1 / hzPerBin), 0, bins - 1)
        from[i] = b0
        to[i] = Math.max(b0, b1)
      }
      return { from, to }
    }

    const cols = build(this.w)
    this.colFrom = cols.from
    this.colTo = cols.to
    const rows = build(this.h)
    this.rowFrom = rows.from
    this.rowTo = rows.to
  }

  /** Tilt in dB at a given frequency. */
  private tilt(hz: number, s: AnalyzerSettings) {
    return s.slope === 0 ? 0 : s.slope * Math.log2(Math.max(hz, 1) / 1000)
  }

  private measure(frame: AudioFrame, s: AnalyzerSettings) {
    const spec = frame.spectrum
    const top = this.topHz(frame, s)
    const ratio = Math.log(top / s.minHz)
    const hzPerBin = frame.sampleRate / (spec.length * 2)

    // Fast attack, slow release. An analyzer must jump onto a transient and ease
    // off it, or peaks read late and the display lies about dynamics.
    const release = 1 - clamp(s.averaging, 0, 0.98) * 0.85
    const decayPerFrame = s.peakDecay * frame.dt

    let peakDb = -140
    let peakX = 0
    let weighted = 0
    let total = 0

    for (let x = 0; x < this.w; x++) {
      let best = -140
      for (let b = this.colFrom[x]; b <= this.colTo[x]; b++) {
        if (spec[b] > best) best = spec[b]
      }
      const hz = s.minHz * Math.exp(((x + 0.5) / this.w) * ratio)
      const v = best + this.tilt(hz, s)

      this.mags[x] = v > this.mags[x] ? v : this.mags[x] + (v - this.mags[x]) * release
      this.peaks[x] = Math.max(this.mags[x], this.peaks[x] - decayPerFrame)

      if (this.mags[x] > peakDb) {
        peakDb = this.mags[x]
        peakX = x
      }
    }

    // Spectral centroid from the untilted linear magnitudes, which is how the
    // measure is defined - tilting is a display choice, not a property of the
    // signal.
    //
    // Gated at 60 dB below the strongest bin. Without a gate the centroid is
    // dragged upward by the noise floor: thousands of floor-level bins carry
    // little energy each but sit at high frequencies, and they outvote the
    // signal. Measured on a lone 1 kHz tone against a -140 dB floor the centroid
    // read 1016 Hz; against AnalyserNode's real -100 dB floor the error is far
    // larger. The gate is signal-relative so it does not depend on any display
    // setting.
    let loudest = -140
    for (let b = 1; b < spec.length; b++) if (spec[b] > loudest) loudest = spec[b]
    const gate = loudest - 60
    for (let b = 1; b < spec.length; b++) {
      if (spec[b] < gate) continue
      const lin = Math.pow(10, spec[b] / 20)
      weighted += lin * b * hzPerBin
      total += lin
    }

    this.out.peakHz = s.minHz * Math.exp(((peakX + 0.5) / this.w) * ratio)
    this.out.peakDb = peakDb
    this.out.centroidHz = total > 1e-9 ? weighted / total : 0
    this.out.rmsDb = frame.rms > 1e-7 ? 20 * Math.log10(frame.rms) : -120
  }

  private yFor(db: number, s: AnalyzerSettings) {
    const t = (db - s.floorDb) / (s.ceilDb - s.floorDb)
    return this.h - clamp(t, 0, 1) * this.h
  }

  private drawGrid(s: AnalyzerSettings, skin: (typeof screenTheme)[ThemeId]) {
    const c = this.ctx
    c.lineWidth = Math.max(1, Math.round(this.dpr))

    // Decade-ish dB rules every 12 dB, which lines up with how levels are read.
    c.strokeStyle = skin.graticule
    c.beginPath()
    for (let db = Math.ceil(s.floorDb / 12) * 12; db <= s.ceilDb; db += 12) {
      const y = Math.round(this.yFor(db, s)) + 0.5
      c.moveTo(0, y)
      c.lineTo(this.w, y)
    }
    c.stroke()

    c.fillStyle = skin.graticule
    c.font = `${10 * this.dpr}px ${font.mono}`
    c.textAlign = 'left'
    c.textBaseline = 'bottom'
    for (let db = Math.ceil(s.floorDb / 12) * 12; db <= s.ceilDb; db += 12) {
      c.fillText(`${db}`, 3 * this.dpr, this.yFor(db, s) - 2 * this.dpr)
    }

    this.drawFreqGrid(s, skin, 'vertical')
  }

  private drawFreqGrid(
    s: AnalyzerSettings,
    skin: (typeof screenTheme)[ThemeId],
    orientation: 'vertical' | 'horizontal',
  ) {
    const c = this.ctx
    const top = Number(this.mapKey.split(':')[2])
    if (!(top > 0)) return
    const ratio = Math.log(top / s.minHz)
    const spectro = s.view === 'spectrogram'

    c.strokeStyle = skin.graticule
    c.lineWidth = Math.max(1, Math.round(this.dpr))
    c.beginPath()
    for (const hz of GRID_HZ) {
      if (hz < s.minHz || hz > top) continue
      const t = Math.log(hz / s.minHz) / ratio
      if (spectro) {
        // The spectrogram runs frequency up the side and time across.
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
      if (hz < s.minHz || hz > top) continue
      const t = Math.log(hz / s.minHz) / ratio
      if (spectro) {
        c.textAlign = 'left'
        c.textBaseline = 'bottom'
        c.fillText(labelFor(hz), 3 * this.dpr, this.h - t * this.h - 2 * this.dpr)
      } else {
        c.textAlign = 'center'
        c.textBaseline = 'bottom'
        c.fillText(labelFor(hz), t * this.w, this.h - 3 * this.dpr)
      }
    }
    void orientation
  }

  private drawSpectrum(s: AnalyzerSettings) {
    const c = this.ctx
    const tube = phosphor.p31
    const [r, g, b] = tube.rgb

    // Filled body first, so the curve reads as an edge on a mass rather than as
    // a floating line.
    const grad = c.createLinearGradient(0, 0, 0, this.h)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.34)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.02)`)
    c.fillStyle = grad
    c.beginPath()
    c.moveTo(0, this.h)
    if (s.bars) {
      const step = Math.max(2, Math.round(3 * this.dpr))
      for (let x = 0; x < this.w; x += step) {
        let best = -140
        for (let i = x; i < Math.min(this.w, x + step); i++) best = Math.max(best, this.mags[i])
        const y = this.yFor(best, s)
        c.lineTo(x, y)
        c.lineTo(Math.min(this.w, x + step - 1), y)
      }
    } else {
      for (let x = 0; x < this.w; x++) c.lineTo(x, this.yFor(this.mags[x], s))
    }
    c.lineTo(this.w, this.h)
    c.closePath()
    c.fill()

    // Curve, with the scope's additive glow so both modes read as one tube.
    c.globalCompositeOperation = 'lighter'
    c.lineJoin = 'round'
    const trace = new Path2D()
    trace.moveTo(0, this.yFor(this.mags[0], s))
    for (let x = 1; x < this.w; x++) trace.lineTo(x, this.yFor(this.mags[x], s))
    for (const pass of [
      { width: 5, alpha: 0.07 },
      { width: 2, alpha: 0.2 },
      { width: 1, alpha: 0.85 },
    ]) {
      c.strokeStyle = `rgba(${r},${g},${b},${pass.alpha})`
      c.lineWidth = pass.width * this.dpr
      c.stroke(trace)
    }

    if (s.peakHold) {
      const hold = new Path2D()
      hold.moveTo(0, this.yFor(this.peaks[0], s))
      for (let x = 1; x < this.w; x++) hold.lineTo(x, this.yFor(this.peaks[x], s))
      c.strokeStyle = `rgba(${tube.bloom.slice(1).match(/../g)!.map((v) => parseInt(v, 16)).join(',')},0.5)`
      c.lineWidth = Math.max(1, this.dpr)
      c.stroke(hold)
    }
    c.globalCompositeOperation = 'source-over'
  }

  private colorAt(t: number, map: ColorMap, out: Uint8ClampedArray, at: number) {
    const v = clamp(t, 0, 1)
    if (map === 'phosphor') {
      const [r, g, b] = phosphor.p31.rgb
      // Dark to tube colour to white: a single hue ramping in lightness, which is
      // monotonic in perceived brightness and so does not fabricate edges.
      const lift = v * v
      out[at] = Math.min(255, r * lift * 1.1 + 255 * Math.max(0, v - 0.82) * 5)
      out[at + 1] = Math.min(255, g * lift)
      out[at + 2] = Math.min(255, b * lift * 1.1 + 255 * Math.max(0, v - 0.82) * 5)
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

  private pushColumn(frame: AudioFrame, s: AnalyzerSettings) {
    const ctx = this.sgramCtx
    const col = this.column
    if (!ctx || !col) return

    const spec = frame.spectrum
    const top = this.topHz(frame, s)
    const ratio = Math.log(top / s.minHz)
    const data = col.data
    const span = s.ceilDb - s.floorDb

    for (let y = 0; y < this.h; y++) {
      // Row 0 is the top of the image, so the highest frequency.
      const row = this.h - 1 - y
      let best = -140
      for (let b = this.rowFrom[row]; b <= this.rowTo[row]; b++) {
        if (spec[b] > best) best = spec[b]
      }
      const hz = s.minHz * Math.exp(((row + 0.5) / this.h) * ratio)
      const db = best + this.tilt(hz, s)
      this.colorAt((db - s.floorDb) / span, s.map, data, y * 4)
    }

    ctx.putImageData(col, this.head, 0)
    this.head = (this.head + 1) % this.w
  }

  /** Composite the ring as two slices so the newest column sits at the right edge. */
  private blitSpectrogram() {
    const src = this.sgram
    if (!src) return
    const c = this.ctx
    const tail = this.w - this.head
    c.drawImage(src, this.head, 0, tail, this.h, 0, 0, tail, this.h)
    if (this.head > 0) c.drawImage(src, 0, 0, this.head, this.h, tail, 0, this.head, this.h)
  }
}
