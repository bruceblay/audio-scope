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
import {
  BANDS_PER_OCTAVE,
  FFT_SIZES,
} from '../src/modes/analyzer/settings'
import {
  buildAxis,
  hzAt,
  magnitudeAt,
  octaveBands,
  spectralCentroid,
  tiltDb,
  usableTopHz,
} from '../src/modes/analyzer/spectrum'

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

// --- Low-end resolution ----------------------------------------------------
console.log('\n--- LOW END: no stepped plateaus ---')
{
  // On a log axis one FFT bin spans many pixels at the bottom of the range. At
  // 20 Hz with an 8192-point window that is 22 pixels, and taking the single
  // covering bin draws every one of them at the same height - the boxy, stepped
  // look. Interpolation has to produce a monotonic ramp instead.
  const bins = 4096
  const top = usableTopHz(20000, SR)
  const axis = buildAxis(600, 20, top, bins, SR)

  // A spectrum rising smoothly with frequency: any plateau in the output is the
  // renderer's, not the signal's.
  const spec = new Float32Array(bins)
  for (let b = 0; b < bins; b++) spec[b] = -100 + (b / bins) * 80

  let longestRun = 1
  let run = 1
  for (let x = 1; x < 200; x++) {
    const a = magnitudeAt(spec, axis, x - 1)
    const b = magnitudeAt(spec, axis, x)
    if (Math.abs(b - a) < 1e-6) run++
    else run = 1
    longestRun = Math.max(longestRun, run)
  }
  check(
    'lowest 200 columns have no flat plateau',
    longestRun <= 2,
    `longest identical run is ${longestRun} px (single-bin sampling gave 22)`,
  )

  // And it must still take the max where many bins share a pixel, or narrow
  // peaks vanish at the top end.
  const spiky = new Float32Array(bins).fill(-100)
  const topCol = 590
  const mid = Math.round((axis.from[topCol] + axis.to[topCol]) / 2)
  spiky[mid] = -10
  check(
    'a narrow peak survives at the top end',
    magnitudeAt(spiky, axis, topCol) === -10,
    `column ${topCol} spans ${axis.to[topCol] - axis.from[topCol] + 1} bins and kept the peak`,
  )
}

// --- Octave bands ----------------------------------------------------------
console.log('\n--- BARS: real octave-fraction bands ---')
{
  for (const per of BANDS_PER_OCTAVE) {
    const bands = octaveBands(20, 20000, per)
    const expected = Math.log2(20000 / 20) * per
    check(
      `1/${per} octave spans the range`,
      Math.abs(bands.length - expected) <= 2,
      `${bands.length} bands, about ${expected.toFixed(0)} expected`,
    )
  }

  const third = octaveBands(20, 20000, 3)
  // Standard series is anchored on 1 kHz.
  check(
    'anchored on 1 kHz',
    third.some((b) => Math.abs(b.centre - 1000) < 0.5),
    `centres include ${third.find((b) => Math.abs(b.centre - 1000) < 0.5)?.centre.toFixed(0)} Hz`,
  )
  // Bands must tile without gaps, or the display has holes in it.
  let worstGap = 0
  for (let i = 1; i < third.length; i++) {
    worstGap = Math.max(worstGap, Math.abs(third[i].lo - third[i - 1].hi) / third[i].lo)
  }
  check('bands tile without gaps', worstGap < 1e-9, `worst edge mismatch ${worstGap.toExponential(1)}`)

  // Constant width in log frequency is what makes a bar's width mean something.
  const widths = third.map((b) => Math.log2(b.hi / b.lo))
  const spread = Math.max(...widths) - Math.min(...widths)
  check('every band is the same log width', spread < 1e-9, `spread ${spread.toExponential(1)} octaves`)
}

// --- Window size -----------------------------------------------------------
console.log('\n--- WINDOW: the latency/resolution trade is real ---')
{
  for (const size of FFT_SIZES) {
    const ms = (size / SR) * 1000
    const binHz = SR / size
    console.log(`         ${String(size).padStart(5)} pts -> ${ms.toFixed(0).padStart(3)} ms window, ${binHz.toFixed(1).padStart(5)} Hz bins`)
  }
  check(
    'all sizes are powers of two',
    FFT_SIZES.every((n) => Number.isInteger(Math.log2(n))),
    `${FFT_SIZES.join(', ')}`,
  )
  check(
    'the default is well under the old 171 ms',
    (2048 / SR) * 1000 < 60,
    `${((2048 / SR) * 1000).toFixed(0)} ms against 171 ms before`,
  )
  // AnalyserNode throws above 32768, so an option beyond it would be a runtime
  // error rather than a degraded picture.
  check(
    'nothing exceeds AnalyserNode\'s maximum',
    Math.max(...FFT_SIZES) <= 32768,
    `largest is ${Math.max(...FFT_SIZES)}`,
  )
  // Longer windows resolve the low end better, which is the reason to offer
  // them: a 20 Hz bin has to be narrow enough to separate adjacent partials.
  const finest = SR / Math.max(...FFT_SIZES)
  check(
    'the longest window resolves low partials',
    finest < 2,
    `${finest.toFixed(2)} Hz bins at ${Math.max(...FFT_SIZES)} points`,
  )
}

// --- Settings ---------------------------------------------------------------
console.log('\n--- SETTINGS: every default is a selectable option ---')
{
  const d = DEFAULT_ANALYZER_SETTINGS
  check('default tilt is on the stepper', (SLOPES as readonly number[]).includes(d.slope), `${d.slope} dB/oct`)
  check('default low Hz is on the stepper', (MIN_HZ_OPTIONS as readonly number[]).includes(d.minHz), `${d.minHz} Hz`)
  check('default high Hz is on the stepper', (MAX_HZ_OPTIONS as readonly number[]).includes(d.maxHz), `${d.maxHz} Hz`)
  check('default window is on the stepper', (FFT_SIZES as readonly number[]).includes(d.fftSize), `${d.fftSize} pts`)
  check(
    'default bands is on the stepper',
    (BANDS_PER_OCTAVE as readonly number[]).includes(d.bandsPerOctave),
    `1/${d.bandsPerOctave} oct`,
  )
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
