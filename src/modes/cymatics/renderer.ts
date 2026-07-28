/**
 * Cymatics renderer: a driven plate with sand on it.
 *
 * The pattern is never drawn as a contour of |u| = 0. It emerges from grains
 * that random-walk away from antinodes and stop moving at nodes, because that is
 * the actual mechanism and because the emergence is most of the beauty. See
 * docs/05-mode-cymatics.md#sand-transport.
 */

import type { AudioFrame } from '../../audio/types'
import { cymatic } from '../../ui/tokens'
import type { Renderer } from '../types'
import { PlateField } from './plate'
import { Sand } from './sand'
import type { CymaticsReadout, CymaticsSettings } from './settings'

const GRID = 128

/** Trail length for airborne grains, in frames of velocity. */
const TRAIL = 6

export class CymaticsRenderer implements Renderer<CymaticsSettings, CymaticsReadout> {
  private readonly ctx: CanvasRenderingContext2D
  private readonly plate = new PlateField(GRID)

  /** Small canvas holding the displacement sheen at grid resolution. */
  private readonly sheen: HTMLCanvasElement
  private readonly sheenCtx: CanvasRenderingContext2D | null
  private readonly sheenData: ImageData

  private w = 0
  private h = 0
  private dpr = 1

  /** Grain simulation. Lives in sand.ts so it can be verified headlessly. */
  private readonly sand = new Sand()

  private readonly out: CymaticsReadout = {
    hz: 0,
    note: '--',
    cents: 0,
    confidence: 0,
    mode: '--',
    modeHz: 0,
    fold: 0,
    detune: 0,
    settled: 0,
    grains: 0,
  }

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx

    this.sheen = document.createElement('canvas')
    this.sheen.width = GRID
    this.sheen.height = GRID
    this.sheenCtx = this.sheen.getContext('2d')
    this.sheenData = new ImageData(GRID, GRID)
  }

  resize(width: number, height: number, dpr: number) {
    this.w = width
    this.h = height
    this.dpr = dpr
    this.ctx.canvas.width = width
    this.ctx.canvas.height = height
  }

  render(frame: AudioFrame, s: CymaticsSettings) {
    if (!this.w || !this.h) return

    this.sand.reset(s.grainCount, s.surface)
    this.out.grains = this.sand.count
    this.drive(frame, s)
    this.sand.step(this.plate, frame.dt, s.surface, s.grain === 'powder')
    this.out.settled = this.sand.settled
    this.paint(s)
  }

  readout(): CymaticsReadout {
    return this.out
  }

  dispose() {
    this.sand.reset(0, 'plate')
  }

  // ------------------------------------------------------------------------
  // Physics
  // ------------------------------------------------------------------------

  private drive(frame: AudioFrame, s: CymaticsSettings) {
    this.plate.setSurface(s.surface)

    const pitch = frame.pitch
    this.out.hz = pitch.hz
    this.out.note = pitch.note
    this.out.cents = pitch.cents
    this.out.confidence = pitch.confidence

    // Silence freezes the pattern rather than dissolving it. A plate that stops
    // being driven keeps its sand exactly where it settled.
    if (frame.silent || !(pitch.hz > 0)) {
      this.out.fold = this.plate.fold
      return
    }

    const driveHz = s.fold ? this.plate.foldToRange(pitch.hz, s.plateHz) : pitch.hz

    this.plate.update({
      driveHz,
      q: s.q,
      plateHz: s.plateHz,
      driveRadius: s.driveRadius,
      driveAngle: s.driveAngle,
      tune: s.tune,
      confidence: pitch.confidence,
      spectrum: frame.spectrum,
      sampleRate: frame.sampleRate,
    })

    const dom = this.plate.dominant
    this.out.mode = dom ? dom.label : '--'
    this.out.modeHz = dom ? dom.hz : 0
    this.out.fold = s.fold ? this.plate.fold : 0
    this.out.detune = s.tune ? this.plate.detune : 0
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  private paint(s: CymaticsSettings) {
    const c = this.ctx
    const pal = cymatic[s.palette]
    const w = this.w
    const h = this.h

    c.globalCompositeOperation = 'source-over'
    c.fillStyle = pal.void
    c.fillRect(0, 0, w, h)

    // Square stage centered in the canvas, so a circular plate stays circular.
    const size = Math.min(w, h) * 0.92
    const ox = (w - size) / 2
    const oy = (h - size) / 2
    const disc = s.surface !== 'square'

    c.save()
    c.beginPath()
    if (disc) c.arc(ox + size / 2, oy + size / 2, size / 2, 0, Math.PI * 2)
    else c.rect(ox, oy, size, size)
    c.clip()

    // Plate surface: a subtle radial sheen so it reads as a lit object rather
    // than a flat shape.
    const grad = c.createRadialGradient(
      ox + size * 0.38,
      oy + size * 0.32,
      size * 0.04,
      ox + size / 2,
      oy + size / 2,
      size * 0.78,
    )
    grad.addColorStop(0, pal.plate)
    grad.addColorStop(1, pal.plateEdge)
    c.fillStyle = grad
    c.fillRect(ox, oy, size, size)

    if (s.sheen) this.paintSheen(ox, oy, size, s)
    this.paintGrains(ox, oy, size, s)

    c.restore()

    // Rim: a bright edge plus a contact shadow, which is what makes the plate
    // sit in space instead of being a circle on a background.
    c.strokeStyle = pal.rim
    c.lineWidth = Math.max(1, this.dpr)
    c.beginPath()
    if (disc) c.arc(ox + size / 2, oy + size / 2, size / 2, 0, Math.PI * 2)
    else c.rect(ox, oy, size, size)
    c.stroke()

    const vig = c.createRadialGradient(
      ox + size / 2,
      oy + size / 2,
      size * 0.3,
      ox + size / 2,
      oy + size / 2,
      size * 0.78,
    )
    vig.addColorStop(0, 'rgba(0,0,0,0)')
    vig.addColorStop(1, s.palette === 'ink' ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.5)')
    c.fillStyle = vig
    c.fillRect(0, 0, w, h)
  }

  /** Signed displacement as a faint tint: light on a moving surface. */
  private paintSheen(ox: number, oy: number, size: number, s: CymaticsSettings) {
    if (!this.sheenCtx) return
    const pal = cymatic[s.palette]
    const data = this.sheenData.data
    const field = this.plate.field
    const inside = this.plate.inside

    for (let i = 0; i < field.length; i++) {
      const p = i * 4
      if (!inside[i]) {
        data[p + 3] = 0
        continue
      }
      const v = field[i]
      const tint = v >= 0 ? pal.up : pal.down
      data[p] = tint[0]
      data[p + 1] = tint[1]
      data[p + 2] = tint[2]
      data[p + 3] = Math.min(255, Math.abs(v) * 74)
    }
    this.sheenCtx.putImageData(this.sheenData, 0, 0)

    const c = this.ctx
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(this.sheen, ox, oy, size, size)
  }

  /**
   * Grains in two passes: settled and airborne. Each pass is one Path2D holding
   * every grain, filled once. Twelve thousand individual fill calls would not
   * hold 60 Hz; a single filled path with twelve thousand subpaths does.
   *
   * A filled path unions rather than accumulating, so dense regions come out
   * solid and sparse ones stay as separate dots. That is exactly what sand does.
   */
  private paintGrains(ox: number, oy: number, size: number, s: CymaticsSettings) {
    const c = this.ctx
    const pal = cymatic[s.palette]
    const [r, g, b] = pal.grain
    const n = this.sand.count
    const dot = Math.max(1, Math.round(this.dpr))

    const still = new Path2D()
    const moving = new Path2D()

    const { px, py, vx, vy, airborne } = this.sand
    for (let i = 0; i < n; i++) {
      const x = ox + px[i] * size
      const y = oy + py[i] * size
      if (airborne[i]) {
        // A short trail along the velocity: airborne grains blur, settled ones
        // are razor sharp, and the contrast between the two is the whole effect.
        moving.moveTo(x, y)
        moving.lineTo(x - vx[i] * size * TRAIL, y - vy[i] * size * TRAIL)
      } else {
        still.rect(x, y, dot, dot)
      }
    }

    c.strokeStyle = `rgba(${r},${g},${b},0.30)`
    c.lineWidth = dot
    c.lineCap = 'round'
    c.stroke(moving)

    c.fillStyle = `rgba(${r},${g},${b},0.92)`
    c.fill(still)
  }
}
