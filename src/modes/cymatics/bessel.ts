/**
 * Bessel functions of the first kind, and the zeros that set a circular
 * membrane's mode frequencies. See docs/05-mode-cymatics.md#the-physics.
 *
 * There is no Math.besselJ. See besselJ() below for the two algorithms used and
 * why one is not enough.
 */

/**
 * The n-th positive zero of J_m, for m = 0..8 and n = 1..6.
 *
 * A fixed edge requires J_m(k·R) = 0, so these values *are* the mode spectrum:
 * f_mn is proportional to alpha_mn. A static table cannot drift, and it costs
 * nothing at startup.
 *
 * Range 2.4048 to 29.5457 spans about 3.6 octaves.
 *
 * Ten decimals, Newton-refined against the evaluator below. Six-decimal
 * published values are not enough: three of them (J7,3, J7,4, J8,5) are a full
 * unit off in the last place, which the test suite caught. The refinement is
 * cross-checked against the published mode ratios (1.5934, 2.1355, 2.2954,
 * 2.6531, 2.9173) in test/cymatics.test.ts, so it is not self-certifying.
 */
export const BESSEL_ZEROS: readonly (readonly number[])[] = [
  [2.4048255577, 5.5200781103, 8.6537279129, 11.7915344390, 14.9309177085, 18.0710639679], // J0
  [3.8317059702, 7.0155866698, 10.1734681351, 13.3236919363, 16.4706300509, 19.6158585105], // J1
  [5.1356223018, 8.4172441404, 11.6198411721, 14.7959517824, 17.9598194950, 21.1169970530], // J2
  [6.3801618959, 9.7610231300, 13.0152007217, 16.2234661603, 19.4094152264, 22.5827295931], // J3
  [7.5883424345, 11.0647094885, 14.3725366716, 17.6159660498, 20.8269329570, 24.0190195248], // J4
  [8.7714838160, 12.3386041975, 15.7001740797, 18.9801338752, 22.2177998966, 25.4303411542], // J5
  [9.9361095242, 13.5892901705, 17.0038196678, 20.3207892136, 23.5860844356, 26.8201519834], // J6
  [11.0863700192, 14.8212687270, 18.2875828325, 21.6415410198, 24.9349278877, 28.1911884595], // J7
  [12.2250922640, 16.0377741909, 19.5545364310, 22.9451731319, 26.2668146412, 29.5456596710], // J8
]

export const MAX_M = BESSEL_ZEROS.length - 1
export const MAX_N = BESSEL_ZEROS[0].length

/** alpha for the fundamental (0,1). Every other mode's frequency is relative to it. */
export const ALPHA_FUNDAMENTAL = BESSEL_ZEROS[0][0]

/**
 * Above this argument the ascending power series is not trustworthy. Its terms
 * peak near e^x / sqrt(x) while the result stays O(0.1), so the cancellation
 * costs roughly x/2.3 decimal digits. At x = 15 that leaves about eight good
 * digits; by x = 29.5 it leaves none.
 */
const SERIES_LIMIT = 15

/**
 * J_m(x), Bessel function of the first kind.
 *
 * Two algorithms, because neither is good everywhere:
 *
 * - **Ascending series** for small x. Exact and fast, each term following from
 *   the last by one multiply so no factorials are ever formed.
 * - **Miller's backward recurrence** for large x, where the series collapses to
 *   cancellation noise. Verified: the series returns -1.2e-6 for J8(29.5457)
 *   when the true value is 4.7e-8.
 *
 * *Upward* recurrence is never used at any size. It is unstable when m > x,
 * which is exactly the situation near the plate center where x = k·r is small
 * and m is large.
 *
 * Cost is irrelevant either way: every call happens while building a cached
 * radial lookup table, never per pixel.
 */
export function besselJ(m: number, x: number): number {
  if (x === 0) return m === 0 ? 1 : 0
  if (x < 0) return m % 2 === 0 ? besselJ(m, -x) : -besselJ(m, -x)
  return x <= SERIES_LIMIT ? seriesJ(m, x) : millerJ(m, x)
}

/**
 * J_m(x) = sum_k (-1)^k / (k! (k+m)!) · (x/2)^(2k+m)
 * Exported so the test suite can check the two algorithms against each other.
 */
export function seriesJ(m: number, x: number): number {
  const half = x / 2

  // First term: (x/2)^m / m!
  let term = 1
  for (let i = 1; i <= m; i++) term *= half / i
  let sum = term

  const halfSq = half * half
  for (let k = 1; k < 80; k++) {
    term *= -halfSq / (k * (k + m))
    sum += term
    // The series alternates and terms shrink once k passes x/2, so once a term
    // is negligible against the running sum every later one is too.
    if (Math.abs(term) < 1e-16 * Math.abs(sum) || term === 0) break
  }
  return sum
}

/**
 * Modified Bessel function of the first kind, I_m(x).
 *
 * Needed for plate modes: a stiff plate obeys the biharmonic equation, which
 * factors as (grad^2 + k^2)(grad^2 - k^2)w = 0, so its solutions carry an I_m
 * term alongside the J_m one. A membrane, obeying the plain wave equation, does
 * not.
 *
 * Every term of the series is positive, so unlike J_m there is no cancellation
 * at any argument and one algorithm covers the whole range. It grows like e^x,
 * so callers work with ratios rather than raw values.
 */
export function besselI(m: number, x: number): number {
  if (x === 0) return m === 0 ? 1 : 0
  const half = Math.abs(x) / 2

  let term = 1
  for (let i = 1; i <= m; i++) term *= half / i
  let sum = term

  const halfSq = half * half
  for (let k = 1; k < 300; k++) {
    term *= halfSq / (k * (k + m))
    sum += term
    if (term < 1e-17 * sum) break
  }
  return x < 0 && m % 2 !== 0 ? -sum : sum
}

/** d/dx J_m(x) = (J_{m-1} - J_{m+1}) / 2, with J_-1 = -J_1. */
export function besselJPrime(m: number, x: number): number {
  return m === 0 ? -besselJ(1, x) : (besselJ(m - 1, x) - besselJ(m + 1, x)) / 2
}

/**
 * I'_m(x) / I_m(x).
 *
 * The ratio rather than the derivative, because I_m itself reaches 1e5 and
 * beyond while J_m stays around 0.1. Returning the bounded ratio lets callers
 * keep both families at comparable magnitude.
 */
export function besselIRatio(m: number, x: number): number {
  const numerator = m === 0 ? besselI(1, x) : (besselI(m - 1, x) + besselI(m + 1, x)) / 2
  return numerator / besselI(m, x)
}

/**
 * Miller's backward recurrence.
 *
 * Start well above the order of interest with an arbitrary seed and recur
 * downward with J_{k-1} = (2k/x)·J_k - J_{k+1}. Downward is the stable
 * direction: the growing solution is the one being computed, so seed error
 * decays away instead of amplifying. The arbitrary scale then cancels against
 * the normalization identity
 *
 *   J_0(x) + 2·(J_2(x) + J_4(x) + ...) = 1
 *
 * Exported so the test suite can check the two algorithms against each other.
 */
export function millerJ(m: number, x: number): number {
  // Start far enough above both m and x that the seed is forgotten.
  const start = 2 * (Math.ceil(x) + 40) + m
  let next = 0
  let current = 1e-300
  let target = 0
  let norm = 0

  for (let k = start; k >= 1; k--) {
    const prev = (2 * k) / x * current - next
    next = current
    current = prev

    const order = k - 1
    if (order === m) target = current
    if (order > 0 && order % 2 === 0) norm += 2 * current

    // The downward recurrence grows fast; rescale everything together so the
    // ratios that actually matter are preserved.
    if (Math.abs(current) > 1e250) {
      next /= 1e250
      current /= 1e250
      target /= 1e250
      norm /= 1e250
    }
  }
  norm += current // the J_0 term

  return target / norm
}
