/**
 * Vertical-channel bandwidth limit: the BW LIMIT button on a bench scope.
 *
 * The scribble on musical material is high-frequency content - genuine HF plus
 * codec noise - and the X-Y box-cascade smoothing leaks exactly that through
 * its sidelobes, the lesson the analyzer's smoothing already taught once. A
 * real scope's answer is a lowpass on the vertical channel, labeled in hertz,
 * pressed when the trace is fuzzy; it cleans the drawing and steadies the
 * trigger for the same reason.
 *
 * The filter is a Gaussian FIR because that is the response scope front ends
 * are deliberately designed toward: monotonic step response, no ringing, no
 * sidelobes. |H(f)| = exp(-((2*pi*sigma*f)^2)/2), which is -3 dB where
 * 2*pi*fc*sigma = sqrt(ln 2), so sigma = 0.1325 / fc seconds.
 */

/** Cutoffs offered by the front panel; 0 is full bandwidth (filter off).
 *
 * The range starts at 4 kHz because that is where the filter can still keep
 * its word: at 8 kHz sigma falls below one sample and a discretely sampled
 * Gaussian that narrow misstates its own cutoff by over a decibel. Verified in
 * test/dsp.test.ts, which is how the 8 kHz step got caught and removed. */
export const BW_OPTIONS = [0, 4000, 2000, 1000, 500] as const

const SIGMA_SECONDS = Math.sqrt(Math.LN2) / (2 * Math.PI)

/**
 * Gaussian kernel for a -3 dB cutoff, normalized to unit sum so DC passes at
 * exactly unity gain. Null means full bandwidth - the caller draws the raw
 * signal and pays nothing.
 */
export function bwKernel(cutoffHz: number, sampleRate: number): Float32Array | null {
  if (cutoffHz <= 0) return null
  const sigma = (SIGMA_SECONDS * sampleRate) / cutoffHz
  // Three sigma per side holds truncation error under 0.3%; the cap bounds the
  // per-frame cost at the lowest cutoff.
  const half = Math.min(96, Math.max(1, Math.ceil(sigma * 3)))
  const k = new Float32Array(half * 2 + 1)
  let sum = 0
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + half] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

/**
 * Convolve `src` into `dst`, clamping at the record edges. Clamping repeats the
 * boundary sample rather than assuming silence beyond it, so the ends of the
 * trace hold their level instead of drooping toward zero.
 */
export function bandlimit(src: Float32Array, dst: Float32Array, kernel: Float32Array) {
  const n = src.length
  const half = (kernel.length - 1) >> 1
  const last = n - 1
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let t = -half; t <= half; t++) {
      const j = i + t
      acc += src[j < 0 ? 0 : j > last ? last : j] * kernel[t + half]
    }
    dst[i] = acc
  }
}
