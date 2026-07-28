/**
 * The free-edge square plate: the classic Chladni plate.
 *
 * A clamped square plate (`sin(nπx)·sin(mπy)`) has nodes along all four edges,
 * so sand piles into a frame around the border. A real square Chladni plate has
 * free edges that move freely, and the sand forms arcs and crosses in the
 * interior with clean borders. Same lesson as the circular case in freeplate.ts,
 * different geometry.
 *
 * Method: single-term Rayleigh-Ritz with products of free-free beam functions,
 * `W(x,y) = X_i(x)·X_j(y)`. The beam functions satisfy the free-edge conditions
 * exactly, so the *shapes* - which is what the sand draws - come out right.
 * Frequencies are variational upper bounds, a few percent high on the lowest
 * modes; see the accuracy table in the tests.
 *
 * A full multi-term Ritz expansion would tighten the frequencies, but it would
 * not change the nodal patterns much, and it is not worth the machinery here.
 */

/**
 * Roots of cos(beta)·cosh(beta) = 1, the free-free beam eigenvalues. They
 * approach (k + 1/2)·pi.
 */
const BETA = [4.7300408, 7.8532046, 10.9956078, 14.1371655, 17.2787597, 20.4203522, 23.5619449]

/** Beam functions per axis: 2 rigid-body plus the flexible ones. */
export const BEAM_COUNT = BETA.length + 2

/** Quadrature resolution for the energy integrals. Simpson, so this is ample. */
const QUAD = 2000

export interface BeamShape {
  /** 0 = translation, 1 = rotation, 2+ = flexible. */
  index: number
  /** integral of X''^2, the bending energy. */
  a: number
  /** integral of X''·X, the cross-curvature term. */
  b: number
  /** integral of X'^2, the twisting term. */
  c: number
}

/**
 * X, X' and X'' for beam function `k` at position `xi` in 0..1.
 *
 * k = 0 is rigid translation and k = 1 is rigid rotation. Neither bends, so
 * neither stores bending energy on its own axis, but paired with a flexible
 * function on the other axis they give the cylindrical and twisting modes - and
 * the lowest mode of a free square plate is exactly the rotation-by-rotation
 * saddle.
 */
function beam(k: number, xi: number): [number, number, number] {
  if (k === 0) return [1, 0, 0]
  if (k === 1) return [Math.sqrt(3) * (2 * xi - 1), 2 * Math.sqrt(3), 0]

  const beta = BETA[k - 2]
  const bx = beta * xi
  const ch = Math.cosh(bx)
  const sh = Math.sinh(bx)
  const co = Math.cos(bx)
  const si = Math.sin(bx)
  const sigma =
    (Math.cosh(beta) - Math.cos(beta)) / (Math.sinh(beta) - Math.sin(beta))

  return [
    ch + co - sigma * (sh + si),
    beta * (sh - si - sigma * (ch + co)),
    beta * beta * (ch - co - sigma * (sh - si)),
  ]
}

/** Composite Simpson over 0..1. */
function integrate(f: (xi: number) => number): number {
  const n = QUAD
  const h = 1 / n
  let sum = f(0) + f(1)
  for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 === 0 ? 2 : 4)
  return (sum * h) / 3
}

let shapes: BeamShape[] | null = null

/**
 * Energy integrals for every beam function, normalized so integral of X^2 = 1.
 * Computed once; the whole sweep is a few milliseconds.
 */
export function beamShapes(): BeamShape[] {
  if (shapes) return shapes

  shapes = []
  for (let k = 0; k < BEAM_COUNT; k++) {
    const norm = Math.sqrt(integrate((xi) => beam(k, xi)[0] ** 2))
    const scale = 1 / norm
    shapes.push({
      index: k,
      a: integrate((xi) => (beam(k, xi)[2] * scale) ** 2),
      b: integrate((xi) => beam(k, xi)[2] * scale * (beam(k, xi)[0] * scale)),
      c: integrate((xi) => (beam(k, xi)[1] * scale) ** 2),
    })
  }
  return shapes
}

export interface FreeSquareMode {
  /** Beam index along x. */
  i: number
  /** Beam index along y. */
  j: number
  /**
   * Frequency parameter, omega·a^2·sqrt(rho·h/D).
   *
   * NOTE the convention, which differs from freeplate.ts and is easy to get
   * wrong: this lambda is proportional to **frequency** directly. The circular
   * solver's lambda is the wavenumber `ka`, where frequency goes as lambda^2.
   * Squaring this one produced mode frequencies up to 800 kHz.
   */
  lambda: number
  /** f / f_fundamental. Linear in lambda under this convention. */
  ratio: number
}

let squareCached: FreeSquareMode[] | null = null

/**
 * Free square plate modes, sorted by frequency.
 *
 * From the Rayleigh quotient for a Kirchhoff plate,
 *
 *   lambda^2 = A_i + A_j + 2·nu·B_i·B_j + 2·(1-nu)·C_i·C_j
 *
 * which is the plate strain energy
 * `W_xx^2 + W_yy^2 + 2·nu·W_xx·W_yy + 2·(1-nu)·W_xy^2` evaluated on the product
 * shape, with the beam functions normalized to unit mass.
 *
 * Rigid-body combinations (both indices below 2 with no twist) carry no energy
 * and are dropped - a plate translating or rocking is not vibrating.
 */
export function freeSquareModes(nu = 0.33): FreeSquareMode[] {
  if (squareCached) return squareCached
  const s = beamShapes()
  const modes: FreeSquareMode[] = []

  for (let i = 0; i < BEAM_COUNT; i++) {
    for (let j = 0; j < BEAM_COUNT; j++) {
      const lambdaSq =
        s[i].a + s[j].a + 2 * nu * s[i].b * s[j].b + 2 * (1 - nu) * s[i].c * s[j].c
      if (lambdaSq < 1e-6) continue // rigid body
      modes.push({ i, j, lambda: Math.sqrt(lambdaSq), ratio: 0 })
    }
  }

  modes.sort((a, b) => a.lambda - b.lambda)
  const fundamental = modes[0].lambda
  for (const mode of modes) mode.ratio = mode.lambda / fundamental

  squareCached = modes
  return modes
}

/**
 * Sample a beam function across `steps` grid cells, normalized to unit mass so
 * the tabulated shapes match the ones the frequencies were computed from.
 */
export function beamProfile(k: number, steps: number): Float32Array {
  const norm = Math.sqrt(integrate((xi) => beam(k, xi)[0] ** 2))
  const out = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    out[i] = beam(k, (i + 0.5) / steps)[0] / norm
  }
  return out
}
