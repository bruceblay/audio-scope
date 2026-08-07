/**
 * Verification harness for the audio DSP. These are the exit criteria for
 * Phases 2 and 3 in docs/07-plan.md.
 *
 * It runs the real PitchDetector and Trigger against synthetic signals,
 * replicating how AnalyserNode produces its dBFS spectrum (Blackman window,
 * magnitude / fftSize, 20log10).
 *
 * Run: npm test
 */
import { PitchDetector } from '../src/audio/pitch'
import { follow } from '../src/lib/dsp'
import { Trigger } from '../src/modes/scope/trigger'
import type { Pitch } from '../src/audio/types'

const SR = 48000
const FFT = 8192

// --- Minimal radix-2 FFT (iterative, in place) -----------------------------
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Produce a dBFS spectrum the way AnalyserNode.getFloatFrequencyData does. */
function analyse(signal: Float32Array): Float32Array {
  const re = new Float64Array(FFT)
  const im = new Float64Array(FFT)
  for (let i = 0; i < FFT; i++) {
    // Blackman window, as specified for AnalyserNode.
    const a = (2 * Math.PI * i) / (FFT - 1)
    const w = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a)
    re[i] = signal[i] * w
  }
  fft(re, im)
  const out = new Float32Array(FFT / 2)
  for (let k = 0; k < FFT / 2; k++) {
    const mag = Math.hypot(re[k], im[k]) / FFT
    out[k] = Math.max(-100, 20 * Math.log10(Math.max(mag, 1e-12)))
  }
  return out
}

function rms(buf: Float32Array) {
  let s = 0
  for (const v of buf) s += v * v
  return Math.sqrt(s / buf.length)
}

// --- Signal generators -----------------------------------------------------
const sine = (hz: number, n: number, amp = 0.5, phase = 0) => {
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR + phase)
  return b
}
const saw = (hz: number, n: number, amp = 0.5) => {
  const b = new Float32Array(n)
  // Band-limited by summing harmonics up to Nyquist.
  const harmonics = Math.floor(SR / 2 / hz)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let k = 1; k <= Math.min(harmonics, 40); k++) {
      v += Math.sin((2 * Math.PI * hz * k * i) / SR) / k
    }
    b[i] = (amp * v * 2) / Math.PI
  }
  return b
}
const square = (hz: number, n: number, amp = 0.5) => {
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) b[i] = Math.sin((2 * Math.PI * hz * i) / SR) >= 0 ? amp : -amp
  return b
}
const noise = (n: number, amp = 0.3) => {
  const b = new Float32Array(n)
  let s = 12345
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    b[i] = ((s / 0x7fffffff) * 2 - 1) * amp
  }
  return b
}

// --- Pitch tests -----------------------------------------------------------
const blank = (): Pitch => ({ hz: 0, confidence: 0, note: '--', cents: 0, midi: 0, fold: 0 })

function detectSteady(signal: Float32Array): Pitch {
  // Run several frames so the temporal smoother settles, as it would live.
  const det = new PitchDetector()
  const spec = analyse(signal)
  const r = rms(signal)
  const out = blank()
  for (let i = 0; i < 30; i++) det.detect(spec, SR, r, out)
  return { ...out }
}

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
}

console.log('\n--- PITCH: accuracy on clean sines ---')
for (const hz of [110, 220, 440, 1000, 2000]) {
  const p = detectSteady(sine(hz, FFT))
  const cents = 1200 * Math.log2(p.hz / hz)
  check(
    `sine ${hz}Hz`,
    Math.abs(cents) < 5 && p.confidence > 0.4,
    `got ${p.hz.toFixed(2)}Hz (${cents >= 0 ? '+' : ''}${cents.toFixed(2)}c) ${p.note} conf=${p.confidence.toFixed(2)}`,
  )
}

console.log('\n--- PITCH: octave correctness on harmonic-rich signals ---')
for (const hz of [110, 220, 440]) {
  const p = detectSteady(saw(hz, FFT))
  const octaves = Math.log2(p.hz / hz)
  check(
    `sawtooth ${hz}Hz`,
    Math.abs(octaves) < 0.08,
    `got ${p.hz.toFixed(2)}Hz (${octaves >= 0 ? '+' : ''}${octaves.toFixed(2)} oct) ${p.note} conf=${p.confidence.toFixed(2)}`,
  )
}
for (const hz of [147, 330]) {
  const p = detectSteady(square(hz, FFT))
  const octaves = Math.log2(p.hz / hz)
  check(
    `square ${hz}Hz`,
    Math.abs(octaves) < 0.08,
    `got ${p.hz.toFixed(2)}Hz (${octaves >= 0 ? '+' : ''}${octaves.toFixed(2)} oct) ${p.note} conf=${p.confidence.toFixed(2)}`,
  )
}

console.log('\n--- PITCH: confidence must collapse on non-tonal input ---')
{
  const p = detectSteady(noise(FFT))
  check('white noise', p.confidence < 0.2, `conf=${p.confidence.toFixed(3)}`)
}
{
  const det = new PitchDetector()
  const sig = sine(440, FFT, 0.00002)
  const out = blank()
  for (let i = 0; i < 30; i++) det.detect(analyse(sig), SR, rms(sig), out)
  check('silence (gated)', out.confidence < 0.05, `conf=${out.confidence.toFixed(3)}`)
}

console.log('\n--- PITCH: note naming ---')
{
  const p = detectSteady(sine(440, FFT))
  check('440Hz names A4', p.note === 'A4' && Math.abs(p.cents) <= 2, `${p.note} ${p.cents >= 0 ? '+' : ''}${p.cents}c`)
  const q = detectSteady(sine(261.626, FFT))
  check('261.6Hz names C4', q.note === 'C4' && Math.abs(q.cents) <= 3, `${q.note} ${q.cents >= 0 ? '+' : ''}${q.cents}c`)
}

// --- Trigger tests ---------------------------------------------------------
console.log('\n--- TRIGGER: period measurement ---')
for (const hz of [100, 440, 1000, 4410]) {
  const t = new Trigger()
  const buf = sine(hz, 4096)
  const samplesOnScreen = Math.min(1e-3 * 10 * SR, 4090)
  let r = t.find(buf, samplesOnScreen, 0.5, 'rising', true, 0, 0.04, 1 / 60)
  r = t.find(buf, samplesOnScreen, 0.5, 'rising', true, 0, 0.04, 1 / 60)
  const measured = r.periodSamples > 0 ? SR / r.periodSamples : 0
  const errPct = Math.abs((measured - hz) / hz) * 100
  check(`sine ${hz}Hz period`, r.found && errPct < 0.1, `measured ${measured.toFixed(3)}Hz (${errPct.toFixed(4)}% err)`)
}

console.log('\n--- TRIGGER: phase stability across frames ---')
{
  // Same waveform captured at different arbitrary offsets, as the analyser
  // would deliver it. A correct trigger puts them all at the same phase.
  const t = new Trigger()
  const hz = 440
  const phases: number[] = []
  for (let f = 0; f < 24; f++) {
    const offset = (f * 137) % 1000
    const buf = sine(hz, 4096, 0.5, (2 * Math.PI * hz * offset) / SR)
    const r = t.find(buf, 480, 0.5, 'rising', true, 0, 0.04, 1 / 60)
    if (!r.found) continue
    // Phase of the waveform at the trigger point, in cycles.
    const cyclesPerSample = hz / SR
    const startIndex = r.index - 480 * 0.5
    const phase = ((startIndex * cyclesPerSample + (offset * hz) / SR) % 1 + 1) % 1
    phases.push(phase)
  }
  const spread = Math.max(...phases) - Math.min(...phases)
  check('440Hz trace phase jitter', spread < 0.002, `spread ${(spread * 100).toFixed(4)}% of a cycle over ${phases.length} frames`)
}

console.log('\n--- TRIGGER: duty cycle ---')
{
  const t = new Trigger()
  const buf = square(500, 4096)
  let r = t.find(buf, 960, 0.5, 'rising', true, 0, 0.04, 1 / 60)
  r = t.find(buf, 960, 0.5, 'rising', true, 0, 0.04, 1 / 60)
  check('square 500Hz duty ~50%', Math.abs(r.duty - 0.5) < 0.02, `duty ${(r.duty * 100).toFixed(2)}%`)
}

console.log('\n--- TRIGGER: DC-offset signal (auto level must follow) ---')
{
  const t = new Trigger()
  const buf = sine(440, 4096)
  for (let i = 0; i < buf.length; i++) buf[i] += 0.4 // large DC offset
  let r = t.find(buf, 480, 0.5, 'rising', true, 0, 0.04, 1 / 60)
  r = t.find(buf, 480, 0.5, 'rising', true, 0, 0.04, 1 / 60)
  const measured = r.periodSamples > 0 ? SR / r.periodSamples : 0
  check(
    'DC+0.4 sine still triggers',
    r.found && Math.abs(measured - 440) / 440 < 0.01,
    `level=${r.level.toFixed(3)} measured ${measured.toFixed(2)}Hz`,
  )
}

// --- Bandwidth limit -------------------------------------------------------
{
  const { bwKernel, bandlimit } = await import('../src/modes/scope/bandwidth')
  console.log('\n--- BW LIMIT: a real filter, not a vibe ---')

  const SR = 48000
  const N = 4096
  const gainAt = (hz: number, cutoff: number) => {
    const k = bwKernel(cutoff, SR)
    if (!k) return 1
    const src = new Float32Array(N)
    for (let i = 0; i < N; i++) src[i] = Math.sin((2 * Math.PI * hz * i) / SR)
    const dst = new Float32Array(N)
    bandlimit(src, dst, k)
    // Peak over the middle half, away from the clamped edges.
    let peak = 0
    for (let i = N / 4; i < (3 * N) / 4; i++) {
      const v = Math.abs(dst[i])
      if (v > peak) peak = v
    }
    return peak
  }

  check('full bandwidth is a bypass', bwKernel(0, SR) === null, 'no kernel, no cost')
  check('DC passes at unity', Math.abs(1 - gainDC(2000)) < 0.001, `${gainDC(2000).toFixed(4)}`)

  // Every offered cutoff, not a sample of them. The 8 kHz step failed this
  // check (sigma under one sample misstates the cutoff by over 1 dB) and was
  // removed from the panel rather than excused in the test.
  for (const fc of [4000, 2000, 1000, 500]) {
    const g = gainAt(fc, fc)
    check(
      `${fc} Hz setting is -3 dB at ${fc} Hz`,
      Math.abs(20 * Math.log10(g) + 3) < 0.6,
      `${(20 * Math.log10(g)).toFixed(2)} dB`,
    )
    // Two octaves up must be gone. Kept below Nyquist, which the first draft
    // of this check was not - a 32 kHz probe aliased to 16 kHz and "failed".
    const g4 = gainAt(fc * 4, fc)
    check(
      `${fc} Hz setting crushes ${fc * 4} Hz`,
      20 * Math.log10(Math.max(g4, 1e-9)) < -30,
      `${(20 * Math.log10(Math.max(g4, 1e-9))).toFixed(1)} dB (Gaussian: no sidelobe leakage)`,
    )
  }

  function gainDC(cutoff: number) {
    const k = bwKernel(cutoff, SR)!
    const src = new Float32Array(N).fill(0.5)
    const dst = new Float32Array(N)
    bandlimit(src, dst, k)
    return dst[N >> 1] / 0.5
  }
}

// --- TUI cell lattice ------------------------------------------------------
{
  const { CellGrid } = await import('../src/lib/tui')
  console.log('\n--- TUI: the lattice is a real quantization ---')

  const g = new CellGrid()
  g.resize(700, 420, 1)
  check(
    'cells approximate a terminal grid',
    g.cols === 100 && g.rows === 30 && g.gw === 200 && g.gh === 120,
    `${g.cols}x${g.rows} cells, ${g.gw}x${g.gh} sub-dots`,
  )

  // A horizontal segment across the top row deposits only into that band.
  g.depositLine(0, 3, 699, 3, 1)
  const e = (g as unknown as { energy: Float32Array }).energy
  let inBand = 0
  let outOfBand = 0
  for (let gy = 0; gy < g.gh; gy++) {
    for (let gx = 0; gx < g.gw; gx++) {
      const v = e[gx + gy * g.gw]
      if (v <= 0) continue
      if (gy === 0) inBand++
      else outOfBand++
    }
  }
  check(
    'a segment lands only where it travels',
    inBand > 0 && outOfBand === 0,
    `${inBand} sub-dots in the travelled band, ${outOfBand} strays`,
  )

  // Deposited energy is the segment's gain regardless of length, which is the
  // dwell-brightness rule: same time, same energy, spread thinner when moving
  // fast.
  const g2 = new CellGrid()
  g2.resize(700, 420, 1)
  g2.depositLine(0, 100, 20, 100, 1)
  g2.depositLine(0, 300, 690, 300, 1)
  const e2 = (g2 as unknown as { energy: Float32Array }).energy
  let short = 0
  let long = 0
  for (let gy = 0; gy < g2.gh; gy++) {
    for (let gx = 0; gx < g2.gw; gx++) {
      const v = e2[gx + gy * g2.gw]
      if (gy < g2.gh / 2) short += v
      else long += v
    }
  }
  check(
    'equal time deposits equal energy at any speed',
    Math.abs(short - long) / long < 0.1,
    `short ${short.toFixed(3)} vs long ${long.toFixed(3)}`,
  )

  // Decay flushes to true zero rather than lingering forever.
  g2.decay(0.001)
  g2.decay(0.001)
  let residue = 0
  for (let i = 0; i < e2.length; i++) residue += e2[i]
  check('decay reaches actual zero', residue === 0, 'no immortal ghost energy')
}

// --- Frame-rate-independent followers -------------------------------------
console.log('\n--- FOLLOWERS: the same time constants at any frame rate ---')
{
  const run = (fps: number, target: number, seconds: number) => {
    let value = 0
    for (let i = 0; i < fps * seconds; i++) value = follow(value, target, 0.55, 0.1, 1 / fps)
    return value
  }
  const readings = [30, 60, 120].map((fps) => run(fps, 1, 1))
  const spread = Math.max(...readings) - Math.min(...readings)
  check(
    'attack is frame-rate independent',
    spread < 1e-9,
    `30/60/120 Hz spread ${spread.toExponential(1)}`,
  )

  const release = (fps: number) => {
    let value = 1
    for (let i = 0; i < fps; i++) value = follow(value, 0, 0.55, 0.1, 1 / fps)
    return value
  }
  const tails = [30, 60, 120].map(release)
  const tailSpread = Math.max(...tails) - Math.min(...tails)
  check(
    'release is frame-rate independent',
    tailSpread < 1e-9,
    `30/60/120 Hz spread ${tailSpread.toExponential(1)}`,
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
