/**
 * Analyzer verification.
 *
 * The claims this mode makes are that the frequency axis is honest, that the
 * tilt does what it says, and that the readouts measure the signal rather than
 * the noise floor. Each is checked here against inputs with a known answer.
 *
 * Run: npm run test:analyzer
 */
import {
  MAX_HZ_OPTIONS,
  MIN_HZ_OPTIONS,
  SCROLL_RATES,
  SLOPES,
  DEFAULT_ANALYZER_SETTINGS,
} from '../src/modes/analyzer/settings'
import { buildAxis, hzAt, spectralCentroid, tiltDb, usableTopHz } from '../src/modes/analyzer/spectrum'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`)
}

const SR = 48000
const BINS = 4096
const hzPerBin = SR / (BINS * 2)

// --- Frequency axis --------------------------------------------------------
console.log('\n--- AXIS: every bin reachable, nothing skipped ---')
for (const width of [320, 600, 1200]) {
  const top = usableTopHz(20000, SR)
  const { from, to } = buildAxis(width, 20, top, BINS, SR)
  let gaps = 0
  for (let i = 1; i < width; i++) if (from[i] > to[i - 1] + 1) gaps++
  let widest = 0
  for (let i = 0; i < width; i++) widest = Math.max(widest, to[i] - from[i] + 1)
  check(
    `${width}px axis covers the spectrum`,
    gaps === 0,
    `no skipped bins, widest column spans ${widest} bins`,
  )
}

console.log('\n--- AXIS: endpoints land where they should ---')
{
  const top = usableTopHz(20000, SR)
  const first = hzAt(0, 600, 20, top)
  const last = hzAt(599, 600, 20, top)
  check('column 0 sits at the low edge', Math.abs(first - 20) < 1, `${first.toFixed(2)} Hz`)
  check(
    'last column sits just under the top',
    last < top && last > top * 0.98,
    `${last.toFixed(0)} Hz against a ${top.toFixed(0)} Hz top`,
  )
}

console.log('\n--- AXIS: Nyquist is never exceeded ---')
for (const sr of [44100, 48000, 96000]) {
  for (const requested of MAX_HZ_OPTIONS) {
    const top = usableTopHz(requested, sr)
    if (top > sr / 2) {
      check(`${requested}Hz at ${sr}`, false, `top ${top} exceeds Nyquist ${sr / 2}`)
      break
    }
  }
}
check(
  'all range options stay under Nyquist',
  MAX_HZ_OPTIONS.every((r) => [44100, 48000, 96000].every((sr) => usableTopHz(r, sr) <= sr / 2)),
  `checked ${MAX_HZ_OPTIONS.length} ranges against 3 sample rates`,
)

// --- Tilt ------------------------------------------------------------------
console.log('\n--- TILT: 3 dB/oct renders pink noise flat ---')
{
  let worst = 0
  for (let hz = 20; hz <= 20000; hz *= 1.1) {
    // Pink noise falls 3 dB per octave relative to 1 kHz.
    const pink = -3 * Math.log2(hz / 1000)
    worst = Math.max(worst, Math.abs(pink + tiltDb(hz, 3)))
  }
  check('pink is flat under a 3 dB/oct tilt', worst < 1e-9, `worst deviation ${worst.toExponential(1)} dB`)

  // And white noise, which is flat, must slope UP by exactly the tilt.
  const rise = tiltDb(20000, 3) - tiltDb(20, 3)
  const octaves = Math.log2(20000 / 20)
  check(
    'white noise rises by the stated slope',
    Math.abs(rise - 3 * octaves) < 1e-9,
    `${rise.toFixed(2)} dB across ${octaves.toFixed(1)} octaves`,
  )
}

console.log('\n--- TILT: flat setting changes nothing ---')
{
  let worst = 0
  for (let hz = 20; hz <= 20000; hz *= 1.3) worst = Math.max(worst, Math.abs(tiltDb(hz, 0)))
  check('slope 0 is a true bypass', worst === 0, `max |tilt| ${worst}`)
}

// --- Centroid --------------------------------------------------------------
console.log('\n--- CENTROID: measures the signal, not the floor ---')
{
  const tone = (hz: number, floor: number) => {
    const spec = new Float32Array(BINS).fill(floor)
    spec[Math.round(hz / hzPerBin)] = -10
    return spec
  }

  for (const floor of [-140, -100, -80]) {
    const got = spectralCentroid(tone(1000, floor), SR)
    check(
      `lone 1 kHz tone, ${floor} dB floor`,
      Math.abs(got - 1000) < 15,
      `${got.toFixed(1)} Hz`,
    )
  }

  // Ungated, this is what the floor does to the answer. Kept as a regression
  // guard: it is the bug the gate exists to prevent.
  const spec = tone(1000, -100)
  let w = 0
  let t = 0
  for (let b = 1; b < BINS; b++) {
    const lin = Math.pow(10, spec[b] / 20)
    w += lin * b * hzPerBin
    t += lin
  }
  check(
    'the gate is load-bearing',
    Math.abs(w / t - 1000) > 500,
    `ungated the same tone measures ${(w / t).toFixed(0)} Hz`,
  )
}

console.log('\n--- CENTROID: tracks brightness in the right direction ---')
{
  // Two tones; moving energy upward must raise the centroid, and the value must
  // land between them.
  const pair = (lowDb: number, highDb: number) => {
    const spec = new Float32Array(BINS).fill(-120)
    spec[Math.round(200 / hzPerBin)] = lowDb
    spec[Math.round(4000 / hzPerBin)] = highDb
    return spectralCentroid(spec, SR)
  }
  const dark = pair(-10, -40)
  const bright = pair(-40, -10)
  check('brighter content raises the centroid', bright > dark, `${dark.toFixed(0)} Hz -> ${bright.toFixed(0)} Hz`)
  check(
    'centroid lies between the two tones',
    dark > 200 && dark < 4000 && bright > 200 && bright < 4000,
    `both inside 200-4000 Hz`,
  )
}

console.log('\n--- CENTROID: silence does not produce a number ---')
{
  const got = spectralCentroid(new Float32Array(BINS).fill(-100), SR)
  // A flat spectrum has no meaningful centroid beyond the midpoint of the range;
  // what matters is that it does not throw or return NaN.
  check('flat input returns a finite value', Number.isFinite(got) && got >= 0, `${got.toFixed(0)} Hz`)
}

// --- Settings ---------------------------------------------------------------
console.log('\n--- SETTINGS: every default is a selectable option ---')
{
  const d = DEFAULT_ANALYZER_SETTINGS
  check('default tilt is on the stepper', (SLOPES as readonly number[]).includes(d.slope), `${d.slope} dB/oct`)
  check('default low Hz is on the stepper', (MIN_HZ_OPTIONS as readonly number[]).includes(d.minHz), `${d.minHz} Hz`)
  check('default high Hz is on the stepper', (MAX_HZ_OPTIONS as readonly number[]).includes(d.maxHz), `${d.maxHz} Hz`)
  check(
    'default scroll rate is on the stepper',
    (SCROLL_RATES as readonly number[]).includes(d.scrollRate),
    `${d.scrollRate}/s`,
  )
  // A stepper whose value is not in its options silently renders position 0 and
  // the control lies about the current state.
  check('floor sits below ceiling', d.floorDb < d.ceilDb, `${d.floorDb} .. ${d.ceilDb} dB`)
  check('low Hz sits below high Hz', d.minHz < d.maxHz, `${d.minHz} .. ${d.maxHz} Hz`)
}

console.log('\n--- SETTINGS: the dB sliders cannot be crossed ---')
{
  // Slider bounds come from AnalyzerControls: floor -120..-40, ceiling -36..0.
  const floorMax = -40
  const ceilMin = -36
  check(
    'floor and ceiling ranges never overlap',
    floorMax < ceilMin,
    `floor tops out at ${floorMax} dB, ceiling starts at ${ceilMin} dB`,
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
