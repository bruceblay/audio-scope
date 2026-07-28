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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
