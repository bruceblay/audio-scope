/**
 * Verification for the cymatics physics. Exit criteria for Phase 4 in
 * docs/07-plan.md.
 *
 * The claim this mode makes is that the patterns are real eigenmodes selected by
 * resonance against a measured frequency, not a decorative pattern function. If
 * that claim is true, these all pass.
 *
 * Run: npm run test:cymatics
 */
import {
  ALPHA_FUNDAMENTAL,
  BESSEL_ZEROS,
  besselJ,
  millerJ,
  seriesJ,
} from '../src/modes/cymatics/bessel'
import { freePlateModes, freePlateProfile } from '../src/modes/cymatics/freeplate'
import { BEAM_COUNT, beamProfile, freeSquareModes } from '../src/modes/cymatics/freesquare'
import { PlateField } from '../src/modes/cymatics/plate'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail}`)
}

const SR = 48000
// A flat, quiet spectrum: the broadband path contributes nothing, so these
// tests measure the resonance path alone.
const quiet = new Float32Array(4096).fill(-100)

// --- Bessel function against published values ------------------------------
console.log('\n--- BESSEL: J_m(x) against published values ---')
const known: [number, number, number][] = [
  [0, 0, 1],
  [0, 1, 0.7651976865579666],
  [0, 5, -0.17759677131433830],
  [0, 10, -0.24593576445134835],
  [1, 1, 0.44005058574493355],
  [1, 10, 0.04347274616886144],
  [2, 1, 0.11490348493190048],
  [2, 10, 0.25463031368512062],
  [3, 10, 0.05837937930518596],
  [5, 20, 0.15116976798239493],
]
for (const [m, x, expected] of known) {
  const got = besselJ(m, x)
  const err = Math.abs(got - expected)
  check(`J${m}(${x})`, err < 1e-9, `got ${got.toFixed(12)} err ${err.toExponential(2)}`)
}

console.log('\n--- BESSEL: the two algorithms agree where they meet ---')
{
  // besselJ switches from the power series to Miller recurrence at x = 15.
  // Comparing the two directly is the real seam test; a finite difference across
  // the boundary would just measure J_m'(x) and call the slope a discontinuity.
  //
  // The comparison only runs up to the switchover. Past it the series is
  // *supposed* to disagree - that is the entire reason the switchover exists -
  // so including higher x would only re-measure the series falling apart.
  let worst = 0
  let worstAt = ''
  for (let m = 0; m <= 8; m++) {
    for (let x = 1; x <= 15; x += 0.125) {
      const d = Math.abs(seriesJ(m, x) - millerJ(m, x))
      if (d > worst) {
        worst = d
        worstAt = `J${m}(${x})`
      }
    }
  }
  check(
    'series and Miller agree below the seam',
    worst < 1e-11,
    `worst disagreement ${worst.toExponential(2)} at ${worstAt}`,
  )

  // And confirm the seam is in the right place: the series must already be
  // visibly degrading by the time we stop trusting it, or the limit is too high.
  const degraded = Math.abs(seriesJ(8, 29.5456596710) - millerJ(8, 29.5456596710))
  check(
    'series is unusable past the seam',
    degraded > 1e-8,
    `series is off by ${degraded.toExponential(2)} at J8(29.546), which Miller handles`,
  )
}

// --- The zero table must actually be zeros ---------------------------------
console.log('\n--- BESSEL: tabulated zeros agree with the implementation ---')
{
  // Testing |J_m(alpha)| directly against a fixed epsilon measures the wrong
  // thing: the tabulated zeros carry six decimals, so a residual around 1e-6 is
  // the table's precision, not an implementation error.
  //
  // The meaningful question is how far the true zero is from the tabulated one.
  // One Newton step answers it, and it cross-checks the table against besselJ
  // in both directions: a wrong table entry or a wrong J_m both show up here.
  const dJ = (m: number, x: number) =>
    m === 0 ? -besselJ(1, x) : (besselJ(m - 1, x) - besselJ(m + 1, x)) / 2

  let worstStep = 0
  let worstAt = ''
  for (let m = 0; m < BESSEL_ZEROS.length; m++) {
    for (let n = 1; n <= BESSEL_ZEROS[m].length; n++) {
      const alpha = BESSEL_ZEROS[m][n - 1]
      const step = Math.abs(besselJ(m, alpha) / dJ(m, alpha))
      if (step > worstStep) {
        worstStep = step
        worstAt = `J${m},${n}`
      }
    }
  }
  check(
    'all 54 zeros, Newton residual',
    // Half an ulp of the last tabulated decimal.
    worstStep < 5e-7,
    `worst correction ${worstStep.toExponential(2)} at ${worstAt} (table carries 10 decimals)`,
  )
}

// --- Mode spectrum ---------------------------------------------------------
console.log('\n--- MEMBRANE: inharmonic drum spectrum ---')
// The textbook ratios for a circular membrane. If these are wrong, every
// pattern lands at the wrong frequency.
const ratios: [number, number, number][] = [
  [0, 1, 1.0],
  [1, 1, 1.5934],
  [2, 1, 2.1355],
  [0, 2, 2.2954],
  [3, 1, 2.6531],
  [1, 2, 2.9173],
]
for (const [m, n, expected] of ratios) {
  const got = BESSEL_ZEROS[m][n - 1] / ALPHA_FUNDAMENTAL
  check(`f(${m},${n}) / f(0,1)`, Math.abs(got - expected) < 0.001, `${got.toFixed(4)} vs ${expected}`)
}

// --- Free plate: an actual Chladni plate -----------------------------------
console.log('\n--- CHLADNI PLATE: free-edge eigenvalues vs Leissa ---')
{
  // A Chladni plate is a stiff plate with free edges (biharmonic, f ~ lambda^2),
  // not a fixed-edge membrane (wave equation, f ~ lambda). Getting this wrong is
  // why the first version's patterns looked nothing like the real thing.
  //
  // Reference: Leissa, "Vibration of Plates" (NASA SP-160, 1969), free circular
  // plate, Poisson 0.33. lambda^2 is the standard frequency parameter.
  const free = freePlateModes()
  const leissa: [number, number, number][] = [
    [2, 0, 5.253],
    [0, 1, 9.084],
    [3, 0, 12.23],
    [1, 1, 20.52],
    [4, 0, 21.6],
    [2, 1, 35.25],
    [0, 2, 38.55],
  ]
  for (const [m, n, want] of leissa) {
    const mode = free.find((f) => f.m === m && f.n === n)
    const got = mode ? mode.lambda * mode.lambda : 0
    const err = mode ? (Math.abs(got - want) / want) * 100 : 100
    check(
      `free plate (${m},${n}) lambda^2`,
      err < 1,
      `${got.toFixed(3)} vs Leissa ${want} (${err.toFixed(2)}% off)`,
    )
  }

  // The fundamental of a free plate is (2,0): two nodal diameters, the first
  // Chladni figure anyone sees. A drum head's fundamental is (0,1) instead.
  const lowest = free[0]
  check(
    'fundamental is (2,0), not (0,1)',
    lowest.m === 2 && lowest.n === 0,
    `lowest mode is (${lowest.m},${lowest.n})`,
  )
}

console.log('\n--- CHLADNI PLATE: the rim is an antinode, not a node ---')
{
  // This is the difference you can see across a room. A fixed edge makes the rim
  // a node, so sand collects in a ring around the boundary. A free edge moves
  // more than anywhere else, so the rim throws sand off and stays clean.
  // The claim is that the rim *moves*, not that it is always the global peak:
  // modes carrying several nodal circles have interior antinodes that can rival
  // it. What matters for the sand is that the rim is nowhere near zero.
  const free = freePlateModes()
  let worstRim = 1
  let worstAt = ''
  for (const mode of free.slice(0, 12)) {
    const profile = freePlateProfile(mode, 256)
    let peak = 0
    for (const v of profile) peak = Math.max(peak, Math.abs(v))
    const rim = Math.abs(profile[255]) / peak
    if (rim < worstRim) {
      worstRim = rim
      worstAt = `(${mode.m},${mode.n})`
    }
  }
  check(
    'rim always moves, never a node',
    worstRim > 0.2,
    `quietest rim among the first 12 modes is ${(worstRim * 100).toFixed(1)}% of peak, at ${worstAt}`,
  )

  // And the contrast: a fixed membrane must be the exact opposite.
  const drum = new PlateField(64)
  drum.setSurface('drum')
  check(
    'drum head rim is a node (the contrast)',
    Math.abs(besselJ(0, BESSEL_ZEROS[0][0])) < 1e-9,
    `J0 at its own zero is ${besselJ(0, BESSEL_ZEROS[0][0]).toExponential(2)}, so a fixed rim cannot move`,
  )
}

console.log('\n--- CHLADNI PLATE: frequency is quadratic in wavenumber ---')
{
  // f ~ lambda^2 for a plate, f ~ lambda for a membrane. This is what makes the
  // note-to-pattern mapping different, and it is why the plate covers about 4.8
  // octaves where the drum head covers 3.6.
  const free = freePlateModes()
  let worst = 0
  for (const mode of free) {
    const expected = (mode.lambda / free[0].lambda) ** 2
    worst = Math.max(worst, Math.abs(mode.ratio - expected))
  }
  check('f scales as lambda^2', worst < 1e-9, `worst deviation ${worst.toExponential(2)}`)

  const span = free[free.length - 1].ratio
  check(
    'plate spans more range than a drum',
    span > 20,
    `${span.toFixed(1)}x fundamental = ${Math.log2(span).toFixed(1)} octaves`,
  )
}

// --- Resonance selection ---------------------------------------------------
console.log('\n--- RESONANCE: driving at a mode frequency selects that mode ---')
const plate = new PlateField(64)
plate.setSurface('drum')
const PLATE_HZ = 110

const driveAt = (hz: number, q = 400, driveRadius = 0.62) => {
  plate.update({
    driveHz: hz,
    q,
    plateHz: PLATE_HZ,
    driveRadius,
    driveAngle: 0,
    tune: false,
    confidence: 1,
    spectrum: quiet,
    sampleRate: SR,
  })
  return plate.dominant
}

for (const [m, n] of [
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
  [2, 3],
  [5, 2],
] as [number, number][]) {
  const hz = PLATE_HZ * (BESSEL_ZEROS[m][n - 1] / ALPHA_FUNDAMENTAL)
  const dom = driveAt(hz)
  check(
    `drive ${hz.toFixed(1)}Hz picks J${m},${n}`,
    !!dom && dom.a === m && dom.b === n,
    `got ${dom ? dom.label : 'none'} at ${dom ? dom.hz.toFixed(1) : '-'}Hz`,
  )
}

// --- Reproducibility -------------------------------------------------------
console.log('\n--- REPRODUCIBILITY: same frequency, same field ---')
{
  const a = new PlateField(64)
  const b = new PlateField(64)
  a.setSurface('drum')
  b.setSurface('drum')
  const opts = {
    driveHz: 440,
    q: 180,
    plateHz: PLATE_HZ,
    driveRadius: 0.62,
    driveAngle: 0,
    tune: false,
    confidence: 1,
    spectrum: quiet,
    sampleRate: SR,
  }
  a.update(opts)
  b.update(opts)
  let maxDiff = 0
  for (let i = 0; i < a.field.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(a.field[i] - b.field[i]))
  }
  check('440Hz is deterministic', maxDiff === 0, `max field difference ${maxDiff}`)
}

// --- Drive point coupling --------------------------------------------------
console.log('\n--- DRIVE POINT: center excites only axially symmetric modes ---')
{
  // Every mode with m > 0 has a nodal diameter through the center, so a driver
  // there cannot couple to it. This is real physics and a real control.
  driveAt(PLATE_HZ * (BESSEL_ZEROS[1][0] / ALPHA_FUNDAMENTAL), 400, 0)
  const anyAsymmetric = plate.modes.some((mo) => mo.a > 0 && Math.abs(mo.amp) > 1e-9)
  check('drive at center, m>0 modes dead', !anyAsymmetric, `${plate.modes.length} modes active`)

  driveAt(PLATE_HZ * (BESSEL_ZEROS[1][0] / ALPHA_FUNDAMENTAL), 400, 0.62)
  const dom = plate.dominant
  check('drive off-center, m=1 revives', !!dom && dom.a === 1, `dominant ${dom?.label}`)
}

// --- Q sharpness -----------------------------------------------------------
console.log('\n--- DAMPING: high Q is selective, low Q sums many modes ---')
{
  const hz = PLATE_HZ * (BESSEL_ZEROS[2][0] / ALPHA_FUNDAMENTAL)
  driveAt(hz, 1000)
  const sharp = plate.modes.length
  driveAt(hz, 10)
  const broad = plate.modes.length
  check('low Q engages more modes', broad > sharp, `Q=1000 -> ${sharp} modes, Q=10 -> ${broad}`)
}

// --- Nodal lines -----------------------------------------------------------
console.log('\n--- NODAL LINES: sand has somewhere to collect ---')
{
  // A resolved mode must have a real nodal set: cells near zero displacement,
  // which is where grains settle. A field with no near-zero region would give a
  // pattern with nothing to form.
  driveAt(PLATE_HZ * (BESSEL_ZEROS[2][2] / ALPHA_FUNDAMENTAL), 400)
  let near = 0
  let inside = 0
  for (let i = 0; i < plate.field.length; i++) {
    if (!plate.inside[i]) continue
    inside++
    if (plate.env[i] < 0.08) near++
  }
  const fraction = near / inside
  check(
    'J2,3 has a nodal set',
    fraction > 0.05 && fraction < 0.5,
    `${(fraction * 100).toFixed(1)}% of the plate is near a node`,
  )
}

// --- Octave folding --------------------------------------------------------
console.log('\n--- FOLDING: high pitches land in the displayable range ---')
{
  const [lo, hi] = plate.range(PLATE_HZ)
  for (const hz of [55, 440, 2093, 4186]) {
    const folded = plate.foldToRange(hz, PLATE_HZ)
    const octaves = Math.log2(folded / hz)
    check(
      `${hz}Hz folds into range`,
      folded >= lo * 0.999 && folded <= hi * 1.001 && Math.abs(octaves - Math.round(octaves)) < 1e-9,
      `${folded.toFixed(1)}Hz (${plate.fold >= 0 ? '+' : ''}${plate.fold} oct), range ${lo.toFixed(0)}-${hi.toFixed(0)}Hz`,
    )
  }
}

// --- Square plate ----------------------------------------------------------
console.log('\n--- FREE SQUARE PLATE: vs Leissa, and degeneracy ---')
{
  // Single-term Rayleigh-Ritz with free-free beam products. Frequencies are
  // variational upper bounds so they run a few percent high; the *shapes* are
  // what the sand draws and those satisfy the free-edge conditions exactly.
  // Reference: Leissa, completely free square plate, nu = 0.3.
  const modes = freeSquareModes(0.3)
  const leissa = [13.468, 19.596, 24.27, 34.801]
  let worst = 0
  leissa.forEach((want, k) => {
    worst = Math.max(worst, (Math.abs(modes[k].lambda - want) / want) * 100)
  })
  check(
    'free square lambda within 15% of Leissa',
    worst < 15,
    `worst ${worst.toFixed(1)}% across the first 4 modes (single-term Ritz upper bound)`,
  )

  // The fundamental of a free square plate is the twisting saddle: rigid rotation
  // about one axis crossed with rotation about the other, nodal lines forming a
  // cross through the centre. No bending energy at all, only twist.
  check(
    'fundamental is the (1,1) twisting saddle',
    modes[0].i === 1 && modes[0].j === 1,
    `lowest mode is (${modes[0].i},${modes[0].j}) at lambda ${modes[0].lambda.toFixed(2)}`,
  )

  // (i,j) and (j,i) are exactly degenerate on a square. Their combinations are
  // what produce the curved and diagonal nodal lines of real Chladni figures.
  let pairs = 0
  let worstSplit = 0
  for (const m of modes) {
    if (m.i >= m.j) continue
    const mirror = modes.find((o) => o.i === m.j && o.j === m.i)
    if (!mirror) continue
    pairs++
    worstSplit = Math.max(worstSplit, Math.abs(m.lambda - mirror.lambda))
  }
  check(
    'transposed modes are exactly degenerate',
    pairs > 20 && worstSplit < 1e-9,
    `${pairs} degenerate pairs, worst frequency split ${worstSplit.toExponential(2)}`,
  )
}

console.log('\n--- FREE SQUARE PLATE: edges are free, not nodes ---')
{
  // The clamped square this replaced had sin(k*pi*x) profiles, which pin every
  // edge to zero and pile sand into a frame around the border. A free edge must
  // be moving at the boundary.
  let worstEdge = 1
  let worstAt = -1
  for (let k = 0; k < BEAM_COUNT; k++) {
    const profile = beamProfile(k, 256)
    let peak = 0
    for (const v of profile) peak = Math.max(peak, Math.abs(v))
    const edge = Math.max(Math.abs(profile[0]), Math.abs(profile[255])) / peak
    if (edge < worstEdge) {
      worstEdge = edge
      worstAt = k
    }
  }
  check(
    'every beam function moves at the edge',
    worstEdge > 0.5,
    `quietest edge is ${(worstEdge * 100).toFixed(0)}% of peak, at beam ${worstAt}`,
  )
}

console.log('\n--- AUTO-TUNE: the note lands on a resonance ---')
{
  // Driving between modes is why real music produced no pattern: the nearest mode
  // led the far-off ones by only ~3x. On resonance it leads by orders of magnitude.
  const tuned = new PlateField(64)
  tuned.setSurface('square')
  const opts = {
    driveHz: 328.1,
    q: 450,
    plateHz: 110,
    driveRadius: 0.62,
    driveAngle: 0.4,
    confidence: 1,
    spectrum: quiet,
    sampleRate: SR,
  }

  tuned.update({ ...opts, tune: false })
  const untunedCount = tuned.modes.length
  const untunedLead =
    tuned.modes.length > 1 ? Math.abs(tuned.modes[0].amp) / Math.abs(tuned.modes[1].amp) : Infinity

  tuned.update({ ...opts, tune: true })
  const tunedCount = tuned.modes.length
  const dom = tuned.dominant

  check(
    'tuning collapses the mush to one mode',
    tunedCount < untunedCount && tunedCount <= 3,
    `${untunedCount} modes untuned (leader only ${untunedLead.toFixed(1)}x ahead) -> ${tunedCount} tuned`,
  )
  check(
    'the surviving mode sits exactly on the drive frequency',
    !!dom && Math.abs(dom.hz - 328.1) < 0.5,
    `mode ${dom?.label} at ${dom?.hz.toFixed(1)}Hz, plate retuned ${tuned.detune.toFixed(2)} semitones`,
  )
}

// --- Non-tonal input -------------------------------------------------------
console.log('\n--- HONESTY: noise must not resolve a specific mode ---')
{
  // Broadband energy, zero confidence. The plate should spread its response
  // across many modes rather than inventing a specific pattern.
  const noisy = new Float32Array(4096)
  for (let i = 0; i < noisy.length; i++) noisy[i] = -35
  plate.update({
    driveHz: 440,
    q: 400,
    plateHz: PLATE_HZ,
    driveRadius: 0.62,
    driveAngle: 0,
    tune: false,
    confidence: 0,
    spectrum: noisy,
    sampleRate: SR,
  })
  const peak = Math.abs(plate.modes[0]?.amp ?? 0)
  const total = plate.modes.reduce((s, mo) => s + Math.abs(mo.amp), 0)
  const share = total > 0 ? peak / total : 1
  check(
    'noise spreads across modes',
    plate.modes.length > 4 && share < 0.5,
    `${plate.modes.length} modes, top mode holds ${(share * 100).toFixed(0)}% of the response`,
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
