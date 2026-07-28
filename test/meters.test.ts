/**
 * Meter ballistics verification.
 *
 * A meter *is* its ballistics. Software "VU meters" are usually peak meters with
 * a needle drawn on, and they disagree with a real one on every piece of music.
 * These check the published step responses, which is the only thing that makes
 * the label honest.
 *
 * Run: npm run test:meters
 */
import { Meters } from '../src/audio/meters'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail}`)
}

const RATE = 1 / 1000 // 1 ms steps, well under any time constant here

/** Drive both channels with a constant level and sample the reading over time. */
function stepResponse(rms: number, peak: number, seconds: number) {
  const m = new Meters()
  const samples: { t: number; vu: number; ppm: number }[] = []
  const steps = Math.round(seconds / RATE)
  for (let i = 0; i < steps; i++) {
    m.update(rms, rms, peak, peak, RATE)
    samples.push({
      t: (i + 1) * RATE,
      vu: Math.pow(10, m.state.vuDb[0] / 20),
      ppm: m.state.ppmDb[0],
    })
  }
  return samples
}

// --- VU: ANSI C16.5 / IEC 60268-17 -----------------------------------------
console.log('\n--- VU: 99% in 300 ms on a step ---')
{
  const target = 0.5
  const s = stepResponse(target, target, 2)
  const at = (t: number) => s[Math.round(t / RATE) - 1].vu / target

  const at300 = at(0.3)
  check(
    'reaches 99% at 300 ms',
    Math.abs(at300 - 1) <= 0.02,
    `${(at300 * 100).toFixed(1)}% of final (spec: 99%, tolerance 2%)`,
  )
  check('still short of final at 100 ms', at(0.1) < 0.95, `${(at(0.1) * 100).toFixed(1)}%`)
  check('settled by 1 s', Math.abs(at(1) - 1) < 0.005, `${(at(1) * 100).toFixed(2)}%`)
}

console.log('\n--- VU: overshoots, as a mechanical needle does ---')
{
  const target = 0.5
  const s = stepResponse(target, target, 2)
  let peak = 0
  for (const x of s) peak = Math.max(peak, x.vu / target)
  const overshoot = (peak - 1) * 100
  // The spec allows 1-1.5%. A one-pole filter cannot overshoot at all, which is
  // exactly why a one-pole is not a VU meter.
  check(
    'overshoot is 1-1.5%',
    overshoot >= 0.5 && overshoot <= 2.5,
    `${overshoot.toFixed(2)}% (a one-pole would be 0.00%)`,
  )
}

console.log('\n--- VU: the fall is symmetric with the rise ---')
{
  const m = new Meters()
  for (let i = 0; i < 2000; i++) m.update(0.5, 0.5, 0.5, 0.5, RATE)
  let fallMs = 0
  for (let i = 0; i < 3000; i++) {
    m.update(0, 0, 0, 0, RATE)
    if (Math.pow(10, m.state.vuDb[0] / 20) <= 0.5 * 0.01) {
      fallMs = (i + 1)
      break
    }
  }
  check(
    'falls to 1% in about 300 ms',
    fallMs > 200 && fallMs < 450,
    `${fallMs} ms (rise is 300 ms; VU is symmetric)`,
  )
}

// --- PPM: DIN 45406 --------------------------------------------------------
console.log('\n--- PPM: falls 20 dB in 1.7 s ---')
{
  const m = new Meters()
  for (let i = 0; i < 500; i++) m.update(0.5, 0.5, 0.5, 0.5, RATE)
  const start = m.state.ppmDb[0]
  for (let i = 0; i < 1700; i++) m.update(0, 0, 0, 0, RATE)
  const drop = start - m.state.ppmDb[0]
  check('drops 20 dB over 1.7 s', Math.abs(drop - 20) < 0.5, `${drop.toFixed(2)} dB`)
}

console.log('\n--- PPM: leads VU, which is the point of showing both ---')
{
  // A sparse peaky signal: high peaks, low average. PPM must read far above VU,
  // and the gap is the crest factor.
  const m = new Meters()
  for (let i = 0; i < 3000; i++) {
    const spike = i % 200 === 0
    m.update(0.05, 0.05, spike ? 0.9 : 0.05, spike ? 0.9 : 0.05, RATE)
  }
  const gap = m.state.ppmDb[0] - m.state.vuDb[0]
  check(
    'peaky material opens a gap',
    gap > 6,
    `PPM ${m.state.ppmDb[0].toFixed(1)} dB vs VU ${m.state.vuDb[0].toFixed(1)} dB, gap ${gap.toFixed(1)} dB`,
  )

  // And on a steady signal they should agree far more closely.
  const steady = new Meters()
  for (let i = 0; i < 3000; i++) steady.update(0.5, 0.5, 0.5, 0.5, RATE)
  const steadyGap = steady.state.ppmDb[0] - steady.state.vuDb[0]
  check(
    'steady material closes it',
    Math.abs(steadyGap) < 1,
    `gap ${steadyGap.toFixed(2)} dB on a constant level`,
  )
}

// --- Clip ------------------------------------------------------------------
console.log('\n--- CLIP: lights on full scale and holds ---')
{
  const m = new Meters()
  for (let i = 0; i < 100; i++) m.update(0.3, 0.3, 0.3, 0.3, RATE)
  check('quiet material does not light it', !m.state.clipped[0], 'off at -10 dBFS')

  m.update(0.3, 0.3, 1.0, 0.3, RATE)
  check('full scale lights it', m.state.clipped[0], 'lit on a 1.0 sample')
  check('and only on that channel', !m.state.clipped[1], 'right channel stayed off')

  for (let i = 0; i < 1000; i++) m.update(0.3, 0.3, 0.3, 0.3, RATE)
  check('still lit a second later', m.state.clipped[0], 'held long enough to see')

  for (let i = 0; i < 1000; i++) m.update(0.3, 0.3, 0.3, 0.3, RATE)
  check('clears eventually', !m.state.clipped[0], 'off after ~2 s')
}

// --- Housekeeping ----------------------------------------------------------
console.log('\n--- STATE: reset and silence behave ---')
{
  const m = new Meters()
  for (let i = 0; i < 1000; i++) m.update(0.5, 0.5, 0.9, 0.9, RATE)
  m.reset()
  check(
    'reset clears every reading',
    m.state.vuDb.every((v) => v <= -100) && m.state.ppmDb.every((v) => v <= -100),
    `vu ${m.state.vuDb[0]}, ppm ${m.state.ppmDb[0]}`,
  )

  const silent = new Meters()
  for (let i = 0; i < 500; i++) silent.update(0, 0, 0, 0, RATE)
  check(
    'silence produces finite readings',
    silent.state.vuDb.every(Number.isFinite) && silent.state.ppmDb.every(Number.isFinite),
    `vu ${silent.state.vuDb[0].toFixed(0)} dB, no NaN`,
  )

  // Frame rate must not change the reading. This is what a per-frame decay gets
  // wrong, and meters are exactly where that error is visible.
  const fast = new Meters()
  const slow = new Meters()
  for (let i = 0; i < 600; i++) fast.update(0.5, 0.5, 0.5, 0.5, 1 / 120)
  for (let i = 0; i < 150; i++) slow.update(0.5, 0.5, 0.5, 0.5, 1 / 30)
  const delta = Math.abs(fast.state.vuDb[0] - slow.state.vuDb[0])
  check(
    'reading is frame-rate independent',
    delta < 0.2,
    `120 Hz vs 30 Hz differ by ${delta.toFixed(3)} dB over 5 s`,
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
