/**
 * The driven plate itself: mode spectrum, resonance response, and the standing
 * wave field. See docs/05-mode-cymatics.md.
 *
 * The one rule this file exists to enforce: mode numbers are integers chosen by
 * resonance against a measured frequency. Nothing here is a decorative pattern
 * function with continuous parameters wired to bass and treble.
 */

import { clamp } from '../../lib/dsp'
import { ALPHA_FUNDAMENTAL, BESSEL_ZEROS, MAX_M, MAX_N, besselJ } from './bessel'
import { freePlateModes, freePlateProfile, type FreeMode } from './freeplate'
import { BEAM_COUNT, beamProfile, freeSquareModes } from './freesquare'

/**
 * - `plate`  free-edge circular plate. An actual Chladni plate: stiff, rim free
 *            to move, biharmonic equation. This is what the videos show.
 * - `drum`   fixed-edge circular membrane. Correct physics for a drum head, and
 *            a genuinely different instrument.
 * - `square` free-edge square plate. The other classic Chladni geometry, and
 *            the one most demonstrations film. Clamped-edge square plates were
 *            the first implementation and were wrong for the same reason the
 *            membrane was: their four edges are nodes, so sand piled into a
 *            frame around the border that a real plate never has.
 */
export type Surface = 'plate' | 'drum' | 'square'

/**
 * Free-free beam functions per axis. Index k has k nodal lines, so the mode label
 * `i,j` reads directly as the number of nodal lines each way - which is how
 * Chladni figures are conventionally named.
 */
const MAX_SQUARE = BEAM_COUNT - 1

/** Radial profile resolution. Sampled bilinearly, so this is plenty. */
const RAD_STEPS = 256

/** Angular table resolution for cos/sin of m·theta. */
const ANG_STEPS = 1024

/** Modes summed per frame. High Q needs 1-3; low Q genuinely needs a dozen. */
const MAX_ACTIVE = 14

/**
 * Below this share of the peak response a mode is skipped.
 *
 * Raised from 0.012 after seeing the result on real music: at moderate
 * confidence every mode landed within a factor of two of every other, so all 14
 * slots filled with near-equal amplitudes and their sum had no clean nodal
 * structure left. A pattern needs a few modes to dominate.
 */
const AMP_FLOOR = 0.12

/**
 * Confidence at which the response is treated as fully resonant. Above this the
 * broadband path contributes nothing.
 */
const TONAL_CONFIDENCE = 0.35

export interface ActiveMode {
  /** Circular: nodal diameters (m). Square: first index (n). */
  a: number
  /** Circular: nodal circles (n). Square: second index (m). */
  b: number
  hz: number
  /** Driven response, including drive-point coupling. Signed. */
  amp: number
  label: string
}

export interface ExciteOptions {
  /** Frequency actually driving the plate, after octave folding. */
  driveHz: number
  /** Quality factor: material damping. 10 is rubber, 1000 is steel. */
  q: number
  /** The plate's fundamental, which sets the whole spectrum. */
  plateHz: number
  /** Drive point, 0 = center, 1 = rim. */
  driveRadius: number
  driveAngle: number
  /**
   * Scale the plate so the incoming note lands exactly on a resonance.
   *
   * Without this the mode is unusable on real music, and for an honest reason:
   * a plate driven *between* two resonances barely responds, and every mode
   * responds about equally weakly, so their sum has no pattern. Measured on a
   * square plate at 328 Hz whose nearest mode sits at 285 Hz, the "resonant"
   * mode led the far-off ones by only 3x - which on screen is mush. Land on the
   * mode instead and it leads by 450x.
   *
   * Real demonstrations solve this by sweeping the generator until a figure
   * appears, or by picking a plate whose modes suit the notes. This does the
   * latter: mode shapes and the relative spectrum stay exact, and the plate's
   * size is nudged so the note is a resonance. The nudge is shown in the readout.
   */
  tune: boolean
  /** 0..1 from the pitch detector. Below ~0.3 the broadband path takes over. */
  confidence: number
  spectrum: Float32Array
  sampleRate: number
}

export class PlateField {
  readonly grid: number
  /** Signed displacement, normalized to -1..1. Row-major, grid x grid. */
  readonly field: Float32Array
  /** |field|, precomputed so the particle loop does not recompute it per grain. */
  readonly env: Float32Array
  /** 1 where the cell is on the plate. Only meaningful for the circular surface. */
  readonly inside: Uint8Array

  private surface: Surface = 'plate'
  private readonly freeModes = freePlateModes()

  // Per-cell geometry, recomputed only when the surface changes.
  private readonly radIdx: Int32Array
  private readonly angIdx: Int32Array

  // Angular tables: cos(m·theta) and sin(m·theta). Built once. The drive angle
  // enters through the identity cos(m(t - td)) = cos(mt)cos(mtd) + sin(mt)sin(mtd),
  // so moving the drive point never rebuilds a table.
  private readonly cosTab: Float32Array[] = []
  private readonly sinTab: Float32Array[] = []

  /** sin(k·pi·x) sampled across the grid, for square-plate mode shapes. */
  private readonly sqTab: Float32Array[] = []

  /** Radial profiles J_m(alpha_mn · rho), cached by mode. 54 possible entries. */
  private readonly radCache = new Map<number, Float32Array>()

  private activeModes: ActiveMode[] = []
  /** Per-active-mode drive coefficients, parallel to activeModes. */
  private readonly coefA = new Float32Array(MAX_ACTIVE)
  private readonly coefB = new Float32Array(MAX_ACTIVE)

  private lastFold = 0
  private lastDetune = 0
  private lastPlateHz = 0

  constructor(grid = 128) {
    this.grid = grid
    const n = grid * grid
    this.field = new Float32Array(n)
    this.env = new Float32Array(n)
    this.inside = new Uint8Array(n)
    this.radIdx = new Int32Array(n)
    this.angIdx = new Int32Array(n)

    for (let m = 0; m <= MAX_M; m++) {
      const c = new Float32Array(ANG_STEPS)
      const s = new Float32Array(ANG_STEPS)
      for (let i = 0; i < ANG_STEPS; i++) {
        const theta = (i / ANG_STEPS) * Math.PI * 2
        c[i] = Math.cos(m * theta)
        s[i] = Math.sin(m * theta)
      }
      this.cosTab.push(c)
      this.sinTab.push(s)
    }

    // Free-free beam profiles rather than sin(k·pi·x): the latter pins the edges
    // to zero, which is the clamped boundary condition and the wrong plate.
    for (let k = 0; k <= MAX_SQUARE; k++) this.sqTab.push(beamProfile(k, grid))

    this.setSurface('plate')
  }

  get modes(): readonly ActiveMode[] {
    return this.activeModes
  }

  get dominant(): ActiveMode | null {
    return this.activeModes.length ? this.activeModes[0] : null
  }

  /** Octaves the raw pitch was shifted by to reach the plate's range. */
  get fold(): number {
    return this.lastFold
  }

  /** Semitones of plate retuning applied to land on a resonance. */
  get detune(): number {
    return this.lastDetune
  }

  /** The plate fundamental actually used, after any retuning. */
  get effectiveHz(): number {
    return this.lastPlateHz
  }

  /** Every mode frequency ratio for the current surface, ascending. */
  private ratios(): number[] {
    if (this.surface === 'plate') return this.freeModes.map((m) => m.ratio)
    if (this.surface === 'drum') {
      const out: number[] = []
      for (let m = 0; m <= MAX_M; m++) {
        for (let n = 1; n <= MAX_N; n++) out.push(BESSEL_ZEROS[m][n - 1] / ALPHA_FUNDAMENTAL)
      }
      return out.sort((a, b) => a - b)
    }
    return freeSquareModes().map((m) => m.ratio)
  }

  /**
   * Plate fundamental that puts `driveHz` on a resonance, by picking the mode
   * whose ratio is nearest in log-frequency to where the note would have fallen.
   */
  private tunedPlateHz(driveHz: number, plateHz: number): number {
    const target = driveHz / plateHz
    let best = 1
    let bestErr = Infinity
    for (const ratio of this.ratios()) {
      const err = Math.abs(Math.log(ratio / target))
      if (err < bestErr) {
        bestErr = err
        best = ratio
      }
    }
    return driveHz / best
  }

  setSurface(surface: Surface) {
    if (surface === this.surface && this.radIdx[0] !== undefined) {
      // Geometry is already built for this surface.
    }
    this.surface = surface
    const g = this.grid
    for (let iy = 0; iy < g; iy++) {
      for (let ix = 0; ix < g; ix++) {
        const i = iy * g + ix
        if (surface !== 'square') {
          const u = ((ix + 0.5) / g) * 2 - 1
          const v = ((iy + 0.5) / g) * 2 - 1
          const rho = Math.hypot(u, v)
          this.inside[i] = rho <= 1 ? 1 : 0
          this.radIdx[i] = Math.min(RAD_STEPS - 1, Math.round(rho * (RAD_STEPS - 1)))
          let theta = Math.atan2(v, u)
          if (theta < 0) theta += Math.PI * 2
          this.angIdx[i] = Math.min(
            ANG_STEPS - 1,
            Math.round((theta / (Math.PI * 2)) * ANG_STEPS) % ANG_STEPS,
          )
        } else {
          this.inside[i] = 1
        }
      }
    }
  }

  /** Frequency range the plate can actually display, given its fundamental. */
  range(plateHz: number): [number, number] {
    if (this.surface === 'plate') {
      // Frequency goes as lambda^2 on a plate, so the same range of wavenumbers
      // spans far more octaves than on a membrane: about 4.8 against 3.6.
      const top = this.freeModes[this.freeModes.length - 1].ratio
      return [plateHz, plateHz * top]
    }
    if (this.surface === 'drum') {
      const top = BESSEL_ZEROS[MAX_M][MAX_N - 1] / ALPHA_FUNDAMENTAL
      return [plateHz, plateHz * top]
    }
    const squareModes = freeSquareModes()
    return [plateHz, plateHz * squareModes[squareModes.length - 1].ratio]
  }

  /**
   * Fold a frequency into the plate's displayable range by octaves.
   *
   * A real plate driven at 4 kHz has hundreds of nodal lines, which on a
   * 500-pixel canvas is a grey blur. Each mode's physics stays exact; this
   * mapping is the one deliberate modeling choice, and the fold amount is
   * surfaced in the readout so it is never hidden.
   */
  foldToRange(hz: number, plateHz: number): number {
    const [lo, hi] = this.range(plateHz)
    if (!(hz > 0)) return 0
    let f = hz
    let fold = 0
    while (f > hi && fold > -12) {
      f /= 2
      fold--
    }
    while (f < lo && fold < 12) {
      f *= 2
      fold++
    }
    this.lastFold = fold
    return f
  }

  /**
   * Choose which modes respond, then evaluate the superposition into `field`.
   *
   * Every mode responds at the *drive* frequency, not at its own resonance. That
   * is a real property of a driven system and it is commonly gotten wrong; the
   * mode's own frequency enters only through the amplitude.
   */
  update(o: ExciteOptions) {
    const plateHz = o.tune ? this.tunedPlateHz(o.driveHz, o.plateHz) : o.plateHz
    this.lastPlateHz = plateHz
    this.lastDetune = 12 * Math.log2(plateHz / o.plateHz)
    this.selectModes({ ...o, plateHz })
    this.evaluate()
  }

  private selectModes(o: ExciteOptions) {
    const candidates: ActiveMode[] = []
    const omega = o.driveHz
    const bins = o.spectrum.length
    const fftSize = bins * 2

    const consider = (a: number, b: number, hz: number, coupling: number, label: string) => {
      // Driven damped oscillator, normalized so the peak response is 1.
      const r = omega / hz
      const resonant = 1 / (Math.sqrt((1 - r * r) ** 2 + (r / o.q) ** 2) * o.q)

      // Broadband path: weight by the energy actually measured near this mode's
      // frequency. What a real plate driven by noise does, and the honest answer
      // when there is no dominant pitch to resonate with.
      const bin = Math.round((hz * fftSize) / o.sampleRate)
      const db = bin > 0 && bin < bins ? o.spectrum[bin] : -100
      const broadband = clamp((db + 90) / 80, 0, 1) * 0.35

      // Broadband must vanish quickly, not fade linearly.
      //
      // Real music reads around 0.3-0.4 confidence even on a clear synth note, and
      // with a linear blend that left broadband holding 40% of the weight - enough
      // that a far-off-resonance mode which merely couples well to the drive point
      // tied the genuinely resonant one. Measured: driving a square plate at
      // 328 Hz gave mode (7,7) at 770 Hz the same amplitude as (3,3) at 330 Hz,
      // and fourteen modes summed into visual mush.
      //
      // Broadband exists for input that is genuinely not tonal - a cymbal crash,
      // where there is no correct pattern and inventing one would be the fakery
      // this mode exists to avoid. That is confidence below ~0.2, not 0.35.
      const tonal = clamp(o.confidence / TONAL_CONFIDENCE, 0, 1)
      const blended = resonant * tonal + broadband * (1 - tonal)
      candidates.push({ a, b, hz, amp: blended * coupling, label })
    }

    if (this.surface === 'plate') {
      for (const mode of this.freeModes) {
        const hz = o.plateHz * mode.ratio
        // Coupling is the mode's own displacement at the driver. On a free plate
        // w(0) vanishes for every m > 0, so a centre-mounted driver raises only
        // the concentric-ring modes - which is exactly what a centre-driven
        // Chladni disc does.
        const profile = this.freeProfile(mode)
        const idx = Math.min(RAD_STEPS - 1, Math.round(o.driveRadius * (RAD_STEPS - 1)))
        consider(mode.m, mode.n, hz, profile[idx], `${mode.m},${mode.n}`)
      }
    } else if (this.surface === 'drum') {
      for (let m = 0; m <= MAX_M; m++) {
        for (let n = 1; n <= MAX_N; n++) {
          const alpha = BESSEL_ZEROS[m][n - 1]
          const hz = o.plateHz * (alpha / ALPHA_FUNDAMENTAL)
          // Coupling is the mode's own shape at the driver. Driving at the
          // center gives J_m(0), which is 0 for every m > 0, so only the axially
          // symmetric modes light up. That is real and it is a control.
          const coupling = besselJ(m, alpha * o.driveRadius)
          consider(m, n, hz, coupling, `J${m},${n}`)
        }
      }
    } else {
      const xd = clamp(0.5 + Math.cos(o.driveAngle) * o.driveRadius * 0.5, 0, 0.999)
      const yd = clamp(0.5 + Math.sin(o.driveAngle) * o.driveRadius * 0.5, 0, 0.999)
      const ix = Math.round(xd * (this.grid - 1))
      const iy = Math.round(yd * (this.grid - 1))
      for (const mode of freeSquareModes()) {
        // (i,j) and (j,i) are exactly degenerate, so only one of each pair is
        // enumerated; evaluate() sums both orientations, weighted by how well the
        // driver couples to each. That superposition is what produces the curved
        // and diagonal nodal lines of a real Chladni figure rather than a plain
        // rectangular grid.
        if (mode.i > mode.j) continue
        const hz = o.plateHz * mode.ratio
        const dA = this.sqTab[mode.i][ix] * this.sqTab[mode.j][iy]
        const dB = this.sqTab[mode.j][ix] * this.sqTab[mode.i][iy]
        consider(mode.i, mode.j, hz, Math.hypot(dA, dB), `${mode.i},${mode.j}`)
      }
    }

    candidates.sort((p, q) => Math.abs(q.amp) - Math.abs(p.amp))
    const peak = candidates.length ? Math.abs(candidates[0].amp) : 0
    this.activeModes = candidates
      .slice(0, MAX_ACTIVE)
      .filter((c) => peak > 0 && Math.abs(c.amp) / peak > AMP_FLOOR)

    // Drive-point coefficients for the degenerate pair, recomputed here so
    // evaluate() stays a tight numeric loop.
    if (this.surface !== 'square') {
      for (let j = 0; j < this.activeModes.length; j++) {
        const m = this.activeModes[j].a
        this.coefA[j] = Math.cos(m * o.driveAngle)
        this.coefB[j] = Math.sin(m * o.driveAngle)
      }
    } else {
      const xd = clamp(0.5 + Math.cos(o.driveAngle) * o.driveRadius * 0.5, 0, 0.999)
      const yd = clamp(0.5 + Math.sin(o.driveAngle) * o.driveRadius * 0.5, 0, 0.999)
      const ix = Math.round(xd * (this.grid - 1))
      const iy = Math.round(yd * (this.grid - 1))
      for (let j = 0; j < this.activeModes.length; j++) {
        const { a, b } = this.activeModes[j]
        this.coefA[j] = this.sqTab[a][ix] * this.sqTab[b][iy]
        this.coefB[j] = this.sqTab[b][ix] * this.sqTab[a][iy]
      }
    }
  }

  /** Free-plate radial profiles, cached by mode. */
  private readonly freeCache = new Map<FreeMode, Float32Array>()

  private freeProfile(mode: FreeMode): Float32Array {
    let lut = this.freeCache.get(mode)
    if (!lut) {
      lut = freePlateProfile(mode, RAD_STEPS)
      this.freeCache.set(mode, lut)
    }
    return lut
  }

  private radialFor(m: number, n: number): Float32Array {
    if (this.surface === 'plate') {
      const mode = this.freeModes.find((f) => f.m === m && f.n === n)
      if (mode) return this.freeProfile(mode)
    }
    const key = m * 100 + n
    let lut = this.radCache.get(key)
    if (lut) return lut
    const alpha = BESSEL_ZEROS[m][n - 1]
    lut = new Float32Array(RAD_STEPS)
    for (let i = 0; i < RAD_STEPS; i++) {
      lut[i] = besselJ(m, alpha * (i / (RAD_STEPS - 1)))
    }
    this.radCache.set(key, lut)
    return lut
  }

  private evaluate() {
    const g = this.grid
    const n = g * g
    const field = this.field
    field.fill(0)

    const modes = this.activeModes
    if (this.surface !== 'square') {
      for (let j = 0; j < modes.length; j++) {
        const md = modes[j]
        const rad = this.radialFor(md.a, md.b)
        const cos = this.cosTab[md.a]
        const sin = this.sinTab[md.a]
        const ca = md.amp * this.coefA[j]
        const cb = md.amp * this.coefB[j]
        for (let i = 0; i < n; i++) {
          if (!this.inside[i]) continue
          const angular = ca * cos[this.angIdx[i]] + cb * sin[this.angIdx[i]]
          field[i] += rad[this.radIdx[i]] * angular
        }
      }
    } else {
      for (let j = 0; j < modes.length; j++) {
        const md = modes[j]
        const tn = this.sqTab[md.a]
        const tm = this.sqTab[md.b]
        const ca = md.amp * this.coefA[j]
        const cb = md.amp * this.coefB[j]
        for (let iy = 0; iy < g; iy++) {
          const row = iy * g
          const tnY = tn[iy]
          const tmY = tm[iy]
          for (let ix = 0; ix < g; ix++) {
            field[row + ix] += ca * tn[ix] * tmY + cb * tm[ix] * tnY
          }
        }
      }
    }

    // Normalize so the display is stable as amplitudes swing with the music.
    let max = 1e-6
    for (let i = 0; i < n; i++) {
      const a = field[i] < 0 ? -field[i] : field[i]
      if (a > max) max = a
    }
    const inv = 1 / max
    for (let i = 0; i < n; i++) {
      const v = field[i] * inv
      field[i] = v
      this.env[i] = v < 0 ? -v : v
    }
  }

  /** Bilinear |displacement| at grid-space coordinates. */
  envAt(gx: number, gy: number): number {
    const g = this.grid
    const x = clamp(gx, 0, g - 1.001)
    const y = clamp(gy, 0, g - 1.001)
    const ix = x | 0
    const iy = y | 0
    const fx = x - ix
    const fy = y - iy
    const i = iy * g + ix
    const a = this.env[i]
    const b = this.env[i + 1]
    const c = this.env[i + g]
    const d = this.env[i + g + 1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
}
