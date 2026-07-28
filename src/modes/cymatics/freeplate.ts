/**
 * The free-edge circular plate: an actual Chladni plate.
 *
 * This is a different physical object from the drum head in plate.ts, and the
 * difference is the whole reason the patterns were wrong:
 *
 * | | Membrane (drum) | Plate (Chladni) |
 * | --- | --- | --- |
 * | Equation | wave, grad^2 | biharmonic, grad^4 |
 * | Restoring force | tension | flexural stiffness |
 * | Solutions | J_m only | J_m **and** I_m |
 * | Frequency | f ~ k | f ~ k^2 |
 * | Edge | fixed: a node | free: an **antinode** |
 * | Fundamental | (0,1) | (2,0), two nodal diameters |
 *
 * The edge row is the one you can see across a room. A fixed edge makes the rim
 * a node, so sand piles up in a ring around the boundary. A real Chladni plate
 * has a free rim that moves more than anywhere else, so sand is thrown off it
 * and the edge stays clean.
 *
 * Validated against Leissa, "Vibration of Plates" (1969) in
 * test/cymatics.test.ts.
 */

import { besselI, besselIRatio, besselJ, besselJPrime } from './bessel'

/** Poisson's ratio. 0.33 is aluminium and mild steel, what plates are made of. */
export const POISSON = 0.33

export const MAX_FREE_M = 8
/** Nodal circles per diametric family. */
export const FREE_N = 4

export interface FreeMode {
  /** Nodal diameters. */
  m: number
  /** Nodal circles. */
  n: number
  /** ka at the edge. */
  lambda: number
  /** Weight of the I_m term, set by the free-edge conditions. */
  c: number
  /** I_m(lambda), so profiles can be evaluated as a bounded ratio. */
  iAtEdge: number
  /** f / f_fundamental. Quadratic in lambda, because a plate is not a membrane. */
  ratio: number
}

/**
 * Free-edge boundary determinant.
 *
 * At r = a a free edge carries no radial moment and no Kelvin-Kirchhoff shear:
 *
 *   M_r = w_rr + nu·(w_r/r + w_tt/r^2)                             = 0
 *   V_r = d/dr(grad^2 w) + (1-nu)/r^2 · d^2/dt^2 (w_r - w/r)       = 0
 *
 * Substituting w = [A·J_m(kr) + B·I_m(kr)]·cos(m·theta) and eliminating second
 * derivatives through the Bessel equations gives a 2x2 system in (A, B). A
 * non-trivial solution needs its determinant to vanish, which is the frequency
 * equation solved below.
 *
 * Both I rows are divided through by I_m(x): the roots are unchanged, and it
 * keeps terms of order 1e5 from swamping terms of order 0.1.
 */
function determinant(m: number, x: number, nu: number): number {
  const j = besselJ(m, x)
  const jp = besselJPrime(m, x)
  const ir = besselIRatio(m, x)
  const m2 = m * m
  const x2 = x * x

  const momentJ = (nu - 1) * x * jp + ((1 - nu) * m2 - x2) * j
  const shearJ = -x2 * x * jp - (1 - nu) * m2 * (x * jp - j)
  const momentI = (nu - 1) * x * ir + ((1 - nu) * m2 + x2)
  const shearI = x2 * x * ir - (1 - nu) * m2 * (x * ir - 1)

  return momentJ * shearI - momentI * shearJ
}

/** The I-term weight for a mode, from the moment condition. */
function coefficient(m: number, x: number, nu: number): number {
  const j = besselJ(m, x)
  const jp = besselJPrime(m, x)
  const ir = besselIRatio(m, x)
  const m2 = m * m
  const momentJ = (nu - 1) * x * jp + ((1 - nu) * m2 - x * x) * j
  const momentI = (nu - 1) * x * ir + ((1 - nu) * m2 + x * x)
  return momentJ / momentI
}

let cached: FreeMode[] | null = null

/**
 * Every free-plate mode we display, sorted by frequency.
 *
 * Computed once by scanning the determinant for sign changes and bisecting.
 * Roots are spaced roughly pi apart so a coarse scan cannot skip one, and the
 * whole sweep costs a few milliseconds, once.
 */
export function freePlateModes(nu = POISSON): FreeMode[] {
  if (cached) return cached

  const found: FreeMode[] = []
  for (let m = 0; m <= MAX_FREE_M; m++) {
    const roots: number[] = []
    const step = 0.02
    let previous = determinant(m, 0.1, nu)

    for (let x = 0.1 + step; x < 40 && roots.length < FREE_N + 1; x += step) {
      const current = determinant(m, x, nu)
      if (previous !== 0 && previous < 0 !== current < 0) {
        let lo = x - step
        let hi = x
        for (let i = 0; i < 80; i++) {
          const mid = (lo + hi) / 2
          if (determinant(m, lo, nu) < 0 !== determinant(m, mid, nu) < 0) hi = mid
          else lo = mid
        }
        const root = (lo + hi) / 2
        // m = 0 and m = 1 have rigid-body modes at zero frequency (the plate
        // translating and rocking). Those are not vibrations and the scan can
        // pick up their numerical shadow near the origin.
        if (root > 0.6) roots.push(root)
      }
      previous = current
    }

    roots.forEach((lambda, index) => {
      // n counts nodal circles. For m >= 2 the first root has none; for m = 0
      // and m = 1 the n = 0 slot is the rigid-body mode, so counting starts at 1.
      const n = m >= 2 ? index : index + 1
      if (n > FREE_N) return
      found.push({
        m,
        n,
        lambda,
        c: coefficient(m, lambda, nu),
        iAtEdge: besselI(m, lambda),
        ratio: 0,
      })
    })
  }

  found.sort((a, b) => a.lambda - b.lambda)
  // The fundamental of a free plate is (2,0), the two-nodal-diameter mode - the
  // first Chladni figure anyone sees. Not (0,1) as on a drum head.
  const fundamental = found[0].lambda
  for (const mode of found) {
    mode.ratio = (mode.lambda / fundamental) ** 2
  }

  cached = found
  return found
}

/**
 * Radial profile w(rho) for rho in 0..1, sampled into a lookup table.
 *
 *   w(rho) = J_m(lambda·rho) - c · I_m(lambda·rho) / I_m(lambda)
 *
 * The I term is taken as a ratio so nothing ever holds I_m's raw magnitude.
 */
export function freePlateProfile(mode: FreeMode, steps: number): Float32Array {
  const lut = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const rho = i / (steps - 1)
    const x = mode.lambda * rho
    lut[i] = besselJ(mode.m, x) - mode.c * (besselI(mode.m, x) / mode.iAtEdge)
  }
  return lut
}
