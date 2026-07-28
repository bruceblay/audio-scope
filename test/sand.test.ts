/**
 * Sand transport verification.
 *
 * This suite exists because of a bug that reading the code would never have
 * found. On screen, 30,000 grains produced about thirty visible marks: they had
 * collapsed onto isolated points instead of spreading along nodal lines, while
 * the settled readout cheerfully said 100%.
 *
 * "Looks like a pattern" turns into two numbers here: what share of the nodal
 * core the grains cover, and how large the worst single pile is. Lines cover a
 * third to a half of the core with no pile above ~1% of the population.
 * Point-collapse covered a few percent of the core with piles of ~8%.
 *
 * Run: npm run test:sand
 */
import { PlateField } from '../src/modes/cymatics/plate'
import { DEFAULT_SAND, Sand, type SandTuning } from '../src/modes/cymatics/sand'
import type { Surface } from '../src/modes/cymatics/plate'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`)
}

/** Deterministic PRNG, so a failure is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const SR = 48000
const quiet = new Float32Array(4096).fill(-100)
const GRID = 128
const COUNT = 12000

interface Stats {
  settled: number
  /** Distinct 128x128 cells holding at least one grain. */
  occupied: number
  /** Cells whose amplitude is low enough for a grain to rest, the true nodal set. */
  nodalCells: number
  /**
   * Share of the nodal set the grains actually cover.
   *
   * This is the metric that captures "looks like a pattern". Raw occupied-cell
   * count does not: a low-order mode has a genuinely small nodal set, so a
   * correct simulation of it occupies few cells. Coverage asks the real question
   * - did the grains spread along the nodal set, or pile onto a few points of it?
   */
  coverage: number
  /** Mean |displacement| under the grains. Near zero means they found the nodes. */
  meanEnv: number
  /** Mean |displacement| over the whole plate, for comparison. */
  plateEnv: number
  /** Largest number of grains stacked in a single cell. */
  worstPile: number
  mode: string
}

function simulate(
  surface: Surface,
  driveHz: number,
  q: number,
  frames: number,
  tuning: SandTuning = DEFAULT_SAND,
): Stats {
  const plate = new PlateField(GRID)
  plate.setSurface(surface)
  plate.update({
    driveHz,
    q,
    plateHz: 110,
    driveRadius: 0.62,
    driveAngle: 0.4,
    // Auto-tune on, matching the shipping default. With it off the plate is
    // driven between resonances, which produces mush by design and would make
    // these measurements test the wrong thing.
    tune: true,
    confidence: 1,
    spectrum: quiet,
    sampleRate: SR,
  })

  const random = rng(12345)
  const sand = new Sand()
  sand.reset(COUNT, surface, random)
  for (let f = 0; f < frames; f++) {
    sand.step(plate, 1 / 60, surface, false, tuning, random)
  }

  const cells = GRID - 1
  const histogram = new Int32Array(GRID * GRID)
  let sumEnv = 0
  for (let i = 0; i < COUNT; i++) {
    const ix = Math.min(cells, Math.max(0, Math.round(sand.px[i] * cells)))
    const iy = Math.min(cells, Math.max(0, Math.round(sand.py[i] * cells)))
    histogram[iy * GRID + ix]++
    sumEnv += plate.envAt(sand.px[i] * cells, sand.py[i] * cells)
  }
  let occupied = 0
  let worstPile = 0
  for (const v of histogram) {
    if (v > 0) occupied++
    if (v > worstPile) worstPile = v
  }

  let plateSum = 0
  let inside = 0
  let nodalCells = 0
  let covered = 0
  for (let i = 0; i < plate.env.length; i++) {
    if (!plate.inside[i]) continue
    plateSum += plate.env[i]
    inside++
    // The nodal *core*, not the whole band a grain could rest in. Grains pile
    // far tighter than the liftoff threshold allows, so measuring against the
    // wide band understates coverage badly.
    if (plate.env[i] < 0.02) {
      nodalCells++
      if (histogram[i] > 0) covered++
    }
  }

  return {
    settled: sand.settled,
    occupied,
    nodalCells,
    coverage: nodalCells > 0 ? covered / nodalCells : 0,
    meanEnv: sumEnv / COUNT,
    plateEnv: plateSum / inside,
    worstPile,
    mode: plate.dominant?.label ?? '--',
  }
}

// --- The regression that motivated this file -------------------------------
console.log('\n--- SAND: grains form lines, not points ---')
for (const surface of ['plate', 'drum', 'square'] as Surface[]) {
  const s = simulate(surface, 430, 400, 400)
  check(
    `${surface}: covers the nodal set`,
    // Point-collapse covered a few percent of the core. Real spreading covers a
    // third to a half: grains bunch where nodal lines cross and where amplitude
    // dips along a line, which is what real sand does too, so full coverage is
    // not the target.
    s.coverage > 0.3,
    `mode ${s.mode}: ${(s.coverage * 100).toFixed(0)}% of ${s.nodalCells} nodal cells, ${s.occupied} cells occupied, worst pile ${s.worstPile}`,
  )
}

console.log('\n--- SAND: no point-collapse (the original bug) ---')
for (const surface of ['plate', 'drum', 'square'] as Surface[]) {
  const s = simulate(surface, 430, 400, 400)
  // The bug stacked ~1000 grains per visible mark. Bound the worst pile as a
  // share of the population so this cannot silently come back.
  const share = s.worstPile / COUNT
  check(
    `${surface}: no grain pile dominates`,
    share < 0.02,
    `worst pile is ${(share * 100).toFixed(2)}% of all grains (${s.worstPile} of ${COUNT})`,
  )
}

console.log('\n--- SAND: grains actually find the nodes ---')
for (const surface of ['plate', 'drum', 'square'] as Surface[]) {
  const s = simulate(surface, 430, 400, 400)
  check(
    `${surface}: settles into low amplitude`,
    // Grains must end up somewhere much quieter than the plate average, or they
    // are not tracking the nodal set at all.
    s.meanEnv < s.plateEnv * 0.45,
    `mean |u| under grains ${s.meanEnv.toFixed(4)} vs plate average ${s.plateEnv.toFixed(4)}`,
  )
}

console.log('\n--- SAND: the settled readout means something ---')
{
  const early = simulate('plate', 430, 400, 20)
  const late = simulate('plate', 430, 400, 400)
  check(
    'settled rises as the pattern resolves',
    late.settled > early.settled,
    `${(early.settled * 100).toFixed(0)}% after 20 frames -> ${(late.settled * 100).toFixed(0)}% after 400`,
  )
  check(
    'settled is not trivially 100% at the start',
    early.settled < 0.9,
    `${(early.settled * 100).toFixed(0)}% while still churning`,
  )
}

console.log('\n--- SAND: convergence is bounded, not explosive ---')
{
  // A grain must never cross a nodal line in one frame, or it can be captured on
  // the wrong side. This is the guard that broke the original version.
  const plate = new PlateField(GRID)
  plate.setSurface('plate')
  plate.update({
    driveHz: 430,
    q: 400,
    plateHz: 110,
    driveRadius: 0.62,
    driveAngle: 0.4,
    // Auto-tune on, matching the shipping default. With it off the plate is
    // driven between resonances, which produces mush by design and would make
    // these measurements test the wrong thing.
    tune: true,
    confidence: 1,
    spectrum: quiet,
    sampleRate: SR,
  })
  const random = rng(777)
  const sand = new Sand()
  sand.reset(COUNT, 'plate', random)

  let worstStep = 0
  const prevX = new Float32Array(COUNT)
  const prevY = new Float32Array(COUNT)
  for (let f = 0; f < 200; f++) {
    prevX.set(sand.px)
    prevY.set(sand.py)
    sand.step(plate, 1 / 60, 'plate', false, DEFAULT_SAND, random)
    for (let i = 0; i < COUNT; i++) {
      const d = Math.hypot(sand.px[i] - prevX[i], sand.py[i] - prevY[i]) * (GRID - 1)
      if (d > worstStep) worstStep = d
    }
  }
  check(
    'no grain moves more than a cell per frame',
    worstStep <= DEFAULT_SAND.maxCellsPerFrame * 1.05,
    `worst single-frame travel ${worstStep.toFixed(3)} cells (cap ${DEFAULT_SAND.maxCellsPerFrame})`,
  )
}

console.log('\n--- SAND: grains stay on the plate ---')
{
  const plate = new PlateField(GRID)
  plate.setSurface('plate')
  plate.update({
    driveHz: 700,
    q: 200,
    plateHz: 110,
    driveRadius: 0.9,
    driveAngle: 0,
    tune: true,
    confidence: 1,
    spectrum: quiet,
    sampleRate: SR,
  })
  const random = rng(99)
  const sand = new Sand()
  sand.reset(COUNT, 'plate', random)
  for (let f = 0; f < 300; f++) sand.step(plate, 1 / 60, 'plate', false, DEFAULT_SAND, random)

  let escaped = 0
  for (let i = 0; i < COUNT; i++) {
    const r = Math.hypot(sand.px[i] * 2 - 1, sand.py[i] * 2 - 1)
    if (r > 1.001) escaped++
  }
  check('none escape the disc', escaped === 0, `${escaped} grains outside the rim`)
}

console.log('\n--- SAND: a free plate keeps its rim clean ---')
{
  // The physical signature of a free edge. A fixed membrane must do the opposite,
  // so the two are compared rather than asserted in isolation.
  const rimShare = (surface: Surface) => {
    const plate = new PlateField(GRID)
    plate.setSurface(surface)
    plate.update({
      driveHz: 430,
      q: 400,
      plateHz: 110,
      driveRadius: 0.62,
      driveAngle: 0.4,
    tune: false,
      confidence: 1,
      spectrum: quiet,
      sampleRate: SR,
    })
    const random = rng(4242)
    const sand = new Sand()
    sand.reset(COUNT, surface, random)
    for (let f = 0; f < 400; f++) sand.step(plate, 1 / 60, surface, false, DEFAULT_SAND, random)

    let near = 0
    for (let i = 0; i < COUNT; i++) {
      const r = Math.hypot(sand.px[i] * 2 - 1, sand.py[i] * 2 - 1)
      if (r > 0.93) near++
    }
    return near / COUNT
  }

  const free = rimShare('plate')
  const fixed = rimShare('drum')
  // The outer 7% of the radius is about 13% of the area, so that is the neutral
  // share. A fixed rim is a node and should exceed it; a free rim should not.
  check(
    'free plate rim holds less sand than a drum rim',
    free < fixed,
    `free ${(free * 100).toFixed(1)}% vs fixed ${(fixed * 100).toFixed(1)}% of grains in the outer 7%`,
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
