/**
 * TUI display: the scope drawn the way a terminal draws, as a character-cell
 * lattice instead of a continuous beam.
 *
 * This is not a "retro filter" over the CRT image - it is a second display
 * discipline with real constraints, which is where the look actually comes
 * from. A terminal cell holds one glyph in one colour, so geometry quantizes
 * to a coarse cell grid refined by 2x4 sub-dots per cell (the Braille trick
 * every terminal plotter uses), brightness quantizes to a few levels, and the
 * screen refreshes at a terminal-ish tick rather than the display's frame
 * rate. Everything upstream - trigger, sweep, X-Y projection, measurements -
 * is identical to the CRT path; only the paint changes.
 *
 * Dwell-time physics carries over at grid resolution: each segment of the
 * trace deposits a fixed amount of energy spread along its length, so slow
 * beam travel makes bright cells exactly as it makes bright phosphor.
 */

/** Terminal refresh: ~18 Hz. The slight choppiness is part of the discipline. */
export const TUI_TICK = 1 / 18

/** Brightness quantization levels (0 = unlit). */
export const TUI_LEVELS = 4

/** Character cell size in CSS px, approximating a terminal's ~1:2 cell. */
const CELL_W = 7
const CELL_H = 14

/** Cap on line-walk steps per segment, to bound the per-tick cost. */
const MAX_STEPS = 128

export class CellGrid {
  cols = 0
  rows = 0
  cellW = 0
  cellH = 0
  /** Sub-dot lattice: 2 wide, 4 tall per cell. */
  gw = 0
  gh = 0
  private energy = new Float32Array(0)
  private subW = 1
  private subH = 1
  /** Smoothed grid maximum, so brightness normalization cannot flicker. */
  private runningMax = 0

  resize(width: number, height: number, dpr: number) {
    this.cellW = Math.max(4, Math.round(CELL_W * dpr))
    this.cellH = Math.max(8, Math.round(CELL_H * dpr))
    this.cols = Math.max(1, Math.floor(width / this.cellW))
    this.rows = Math.max(1, Math.floor(height / this.cellH))
    this.gw = this.cols * 2
    this.gh = this.rows * 4
    this.subW = this.cellW / 2
    this.subH = this.cellH / 4
    this.energy = new Float32Array(this.gw * this.gh)
    this.runningMax = 0
  }

  clear() {
    this.energy.fill(0)
    this.runningMax = 0
  }

  /** One persistence step: multiplicative fade with a flush to true zero, so
   * old trace ends rather than lingering as invisible energy. */
  decay(factor: number) {
    const e = this.energy
    if (factor <= 0) {
      e.fill(0)
      return
    }
    for (let i = 0; i < e.length; i++) {
      const v = e[i] * factor
      e[i] = v < 1e-4 ? 0 : v
    }
  }

  /**
   * Deposit one trace segment, in canvas pixel coordinates. The segment's
   * total energy is fixed (every segment spans the same slice of time), spread
   * over the sub-dots it crosses - dwell brightness at lattice resolution.
   */
  depositLine(x0: number, y0: number, x1: number, y1: number, gain: number) {
    const sx0 = x0 / this.subW
    const sy0 = y0 / this.subH
    const sx1 = x1 / this.subW
    const sy1 = y1 / this.subH
    const steps = Math.min(
      MAX_STEPS,
      Math.max(1, Math.ceil(Math.max(Math.abs(sx1 - sx0), Math.abs(sy1 - sy0)))),
    )
    // steps+1 points are visited (both endpoints inclusive), so the divisor
    // is steps+1 - dividing by steps over-deposited short segments by up to
    // 2x at one step, which the dwell test caught.
    const per = gain / (steps + 1)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const gx = Math.floor(sx0 + (sx1 - sx0) * t)
      const gy = Math.floor(sy0 + (sy1 - sy0) * t)
      if (gx < 0 || gx >= this.gw || gy < 0 || gy >= this.gh) continue
      this.energy[gx + gy * this.gw] += per
    }
  }

  /**
   * Paint the lattice: per cell one quantized brightness level (a terminal
   * cell has one colour), per lit sub-dot one square. `palette` maps level
   * 1..TUI_LEVELS-1 (index 0 unused) to a colour.
   */
  draw(ctx: CanvasRenderingContext2D, palette: string[]) {
    const e = this.energy
    let max = 0
    for (let i = 0; i < e.length; i++) if (e[i] > max) max = e[i]
    // Rise instantly, fall slowly: a burst sets the scale and quiet passages
    // decay it, so the trace neither blows out nor fades to nothing.
    this.runningMax = Math.max(max, this.runningMax * 0.94)
    if (this.runningMax <= 0) return

    const norm = 1 / this.runningMax
    const dot = Math.max(2, Math.round(this.cellW * 0.3))
    const oxDot = (this.subW - dot) / 2
    const oyDot = (this.subH - dot) / 2

    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        // Cell level from its brightest sub-dot.
        let cellMax = 0
        const gx0 = cx * 2
        const gy0 = cy * 4
        for (let sy = 0; sy < 4; sy++) {
          const row = (gy0 + sy) * this.gw + gx0
          const a = e[row]
          const b = e[row + 1]
          if (a > cellMax) cellMax = a
          if (b > cellMax) cellMax = b
        }
        const v = cellMax * norm
        // Quantized thresholds; the bottom one is the lit/unlit gate.
        const level = v >= 0.55 ? 3 : v >= 0.22 ? 2 : v >= 0.06 ? 1 : 0
        if (level === 0) continue

        ctx.fillStyle = palette[level]
        // Sub-dots at or above half the cell's own gate draw; the rest stay
        // dark, which is what keeps the geometry crisp inside a lit cell.
        const gate = cellMax * 0.35
        for (let sy = 0; sy < 4; sy++) {
          const row = (gy0 + sy) * this.gw + gx0
          for (let sx = 0; sx < 2; sx++) {
            if (e[row + sx] <= gate) continue
            ctx.fillRect(
              (gx0 + sx) * this.subW + oxDot,
              (gy0 + sy) * this.subH + oyDot,
              dot,
              dot,
            )
          }
        }
      }
    }
  }
}
