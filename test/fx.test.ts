/** Mathematical regressions for effects that do not require Web Audio. */
import { fillReverbImpulse, reverbMixGains } from '../src/audio/fx'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail}`)
}

function rms(data: Float32Array, from: number, to: number) {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

function correlation(data: Float32Array, lag: number) {
  let cross = 0
  let aa = 0
  let bb = 0
  for (let i = lag; i < data.length; i++) {
    const a = data[i]
    const b = data[i - lag]
    cross += a * b
    aa += a * a
    bb += b * b
  }
  return cross / Math.sqrt(aa * bb)
}

console.log('\n--- REVERB: finite broadband impulse, never a resonant feedback loop ---')
{
  let state = 0x5eed1234
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const impulse = new Float32Array(48000)
  fillReverbImpulse(impulse, 0.7, random)

  let mean = 0
  let peak = 0
  let finite = true
  for (const sample of impulse) {
    finite &&= Number.isFinite(sample)
    mean += sample
    peak = Math.max(peak, Math.abs(sample))
  }
  mean /= impulse.length

  const early = rms(impulse, 0, 4800)
  const late = rms(impulse, 43200, 48000)
  let worstCorrelation = 0
  // These include the delay lengths used by the discarded comb reverb. A
  // noise impulse must have no repeating pitch at any of them.
  for (const lag of [82, 240, 1426, 1781, 1973, 2098]) {
    worstCorrelation = Math.max(worstCorrelation, Math.abs(correlation(impulse, lag)))
  }

  check('all impulse samples are finite and bounded', finite && peak <= 1, `peak ${peak.toFixed(3)}`)
  check('the tail loses energy instead of regenerating', early > late * 4, `RMS ${early.toFixed(3)} -> ${late.toFixed(3)}`)
  check('the impulse has no DC bias', Math.abs(mean) < 0.01, `mean ${mean.toExponential(2)}`)
  check('the impulse has no fixed comb pitch', worstCorrelation < 0.03, `worst correlation ${worstCorrelation.toFixed(3)}`)
}

console.log('\n--- REVERB MIX: matches browser-fx ---')
{
  const quarter = reverbMixGains(0.25)
  const wet = reverbMixGains(1)
  check('25% mix is 25% wet and 75% dry', quarter.wet === 0.25 && quarter.dry === 0.75, `${quarter.wet}/${quarter.dry}`)
  check('100% wet removes the direct signal', wet.wet === 1 && wet.dry === 0, `${wet.wet}/${wet.dry}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
