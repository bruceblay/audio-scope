/**
 * Sand transport on a vibrating plate.
 *
 * Separated from the renderer so it can be simulated headlessly and measured -
 * see test/sand.test.ts. The first version of this lived inside the renderer and
 * had a bug that no amount of looking at the code would have found: grains
 * collapsed onto isolated points instead of spreading along nodal lines, and the
 * only way to see it was to run it and count.
 *
 * Physics: a grain sees vertical acceleration -omega^2·u. Where that beats
 * gravity it leaves the surface and lands displaced; averaged over many bounces
 * the bias is down the gradient of local amplitude. Grains walk away from
 * antinodes, reach the nodes, and stop being thrown at all.
 */

import { clamp } from '../../lib/dsp'
import type { PlateField, Surface } from './plate'

export interface SandTuning {
  /** Amplitude above which a grain is thrown off the surface. */
  liftoff: number
  /** Pull down the amplitude gradient, per plate-width of gradient. */
  drift: number
  /** Random scatter, applied only to grains that are airborne. */
  scatter: number
  /** Friction per frame at 60 Hz. */
  damping: number
  /**
   * Hard cap on movement per frame, in grid cells.
   *
   * This is load-bearing. Without it, grains cross several cells per frame,
   * overshoot the nodal lines they are trying to reach, and get captured by
   * whichever cell they happen to land in - which is how 30,000 grains end up
   * stacked on a few dozen pixels.
   */
  maxCellsPerFrame: number
}

export const DEFAULT_SAND: SandTuning = {
  liftoff: 0.1,
  drift: 6e-5,
  scatter: 4e-4,
  damping: 0.82,
  maxCellsPerFrame: 0.55,
}

export class Sand {
  /** Positions in normalized plate space, 0..1 on both axes. */
  px = new Float32Array(0)
  py = new Float32Array(0)
  vx = new Float32Array(0)
  vy = new Float32Array(0)
  airborne = new Uint8Array(0)

  settled = 0

  private key = ''

  get count() {
    return this.px.length
  }

  /** Scatter grains uniformly over the plate. Cheap enough to call on any change. */
  reset(count: number, surface: Surface, random: () => number = Math.random) {
    const key = `${count}:${surface}`
    if (key === this.key) return
    this.key = key

    this.px = new Float32Array(count)
    this.py = new Float32Array(count)
    this.vx = new Float32Array(count)
    this.vy = new Float32Array(count)
    this.airborne = new Uint8Array(count)

    for (let i = 0; i < count; i++) {
      if (surface === 'square') {
        this.px[i] = random()
        this.py[i] = random()
      } else {
        // sqrt on the radius gives uniform area density; without it grains pile
        // into the middle before the physics has done anything.
        const r = Math.sqrt(random()) * 0.98
        const t = random() * Math.PI * 2
        this.px[i] = 0.5 + (Math.cos(t) * r) / 2
        this.py[i] = 0.5 + (Math.sin(t) * r) / 2
      }
    }
  }

  step(
    plate: PlateField,
    dt: number,
    surface: Surface,
    inverse: boolean,
    tuning: SandTuning = DEFAULT_SAND,
    random: () => number = Math.random,
  ) {
    const n = this.px.length
    if (!n) return

    const g = plate.grid
    const env = plate.env
    const cells = g - 1

    // Normalize the step to 60 Hz so behavior does not change with frame rate.
    const k = clamp(dt * 60, 0.25, 2)
    // Inverse cymatics: with very fine powder, acoustic streaming beats bouncing
    // and grains gather at antinodes instead. Real, documented, one sign flip.
    const dir = inverse ? -1 : 1
    const drift = tuning.drift * dir * k
    const scatter = tuning.scatter * k
    const damping = Math.pow(tuning.damping, k)
    const maxStep = (tuning.maxCellsPerFrame / cells) * k
    const disc = surface !== 'square'

    let settled = 0

    for (let i = 0; i < n; i++) {
      const gx = clamp(this.px[i] * cells, 0, cells - 1.001)
      const gy = clamp(this.py[i] * cells, 0, cells - 1.001)
      const ix = gx | 0
      const iy = gy | 0
      const fx = gx - ix
      const fy = gy - iy

      // Bilinear cell corners, reused for both the value and the gradient.
      const c = iy * g + ix
      const e00 = env[c]
      const e10 = env[c + 1]
      const e01 = env[c + g]
      const e11 = env[c + g + 1]
      const cross = e00 - e10 - e01 + e11

      const e = e00 + (e10 - e00) * fx + (e01 - e00) * fy + cross * fx * fy

      // Analytic gradient of the bilinear patch, in plate units. Nearest-cell
      // differences were the other half of the collapse bug: a piecewise-constant
      // force field has cells whose gradient points inward on every side, and
      // those act as point traps that grains can never leave.
      const dEx = ((e10 - e00) + cross * fy) * cells
      const dEy = ((e01 - e00) + cross * fx) * cells

      let vx = this.vx[i] - dEx * drift
      let vy = this.vy[i] - dEy * drift

      // Only airborne grains scatter. This is what makes settling read correctly:
      // as the pattern resolves, grains at the nodes drop below the threshold and
      // go completely still while everything else is still churning.
      const agitation = e - tuning.liftoff
      if (agitation > 0) {
        this.airborne[i] = 1
        vx += (random() - 0.5) * agitation * scatter
        vy += (random() - 0.5) * agitation * scatter
      } else {
        this.airborne[i] = 0
        settled++
      }

      vx *= damping
      vy *= damping

      // Never travel more than a fraction of a cell per frame, so a grain cannot
      // step over the nodal line it is converging on.
      const speed = Math.hypot(vx, vy)
      if (speed > maxStep) {
        const s = maxStep / speed
        vx *= s
        vy *= s
      }

      let x = this.px[i] + vx
      let y = this.py[i] + vy

      if (disc) {
        const ux = x * 2 - 1
        const uy = y * 2 - 1
        const r = Math.hypot(ux, uy)
        if (r > 0.99) {
          // Reflect off the rim rather than parking grains on it. Pinning them
          // there manufactured a bright ring at the boundary, the exact artifact
          // a free-edge plate must not have: its rim is an antinode that throws
          // sand off instead of collecting it.
          const nx = ux / r
          const ny = uy / r
          const vr = vx * nx + vy * ny
          if (vr > 0) {
            vx -= 1.6 * vr * nx
            vy -= 1.6 * vr * ny
          }
          const inv = 0.99 / r
          x = (ux * inv + 1) / 2
          y = (uy * inv + 1) / 2
        }
      } else {
        if (x < 0.002 || x > 0.998) vx = -vx * 0.6
        if (y < 0.002 || y > 0.998) vy = -vy * 0.6
        x = clamp(x, 0.002, 0.998)
        y = clamp(y, 0.002, 0.998)
      }

      this.px[i] = x
      this.py[i] = y
      this.vx[i] = vx
      this.vy[i] = vy
    }

    this.settled = settled / n
  }
}
