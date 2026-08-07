/** Real Chromium render of the production ReverbFx graph. */
import { ReverbFx } from '../src/audio/fx'

function rms(data: Float32Array, from: number, to: number) {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

function correlation(data: Float32Array, from: number, to: number, lag: number) {
  let cross = 0
  let aa = 0
  let bb = 0
  for (let i = from + lag; i < to; i++) {
    const a = data[i]
    const b = data[i - lag]
    cross += a * b
    aa += a * a
    bb += b * b
  }
  return cross / Math.sqrt(aa * bb)
}

async function run() {
  document.body.textContent = 'RUN'
  const sampleRate = 48000
  const context = new OfflineAudioContext(2, sampleRate * 2, sampleRate)
  const reverb = new ReverbFx(context as unknown as AudioContext)
  // Exercise the debounced live rebuild as well as the default constructor IR.
  reverb.apply(0.7, 1, 1)
  await new Promise((resolve) => window.setTimeout(resolve, 200))
  reverb.output.connect(context.destination)

  // A unit impulse reveals the reverb's own response without source tone.
  const click = context.createBuffer(1, 1, sampleRate)
  click.getChannelData(0)[0] = 1
  const source = context.createBufferSource()
  source.buffer = click
  source.connect(reverb.input)
  source.start(0.2)

  const rendered = await context.startRendering()
  const data = rendered.getChannelData(0)
  const right = rendered.getChannelData(1)
  const onset = Math.floor(0.2 * sampleRate)
  const end = Math.floor(1.2 * sampleRate)
  const early = rms(data, onset, onset + Math.floor(0.2 * sampleRate))
  const late = rms(data, end - Math.floor(0.2 * sampleRate), end)

  let peak = 0
  let finite = true
  for (let i = onset; i < end; i++) {
    finite &&= Number.isFinite(data[i])
    peak = Math.max(peak, Math.abs(data[i]))
  }
  let combCorrelation = 0
  for (const lag of [1426, 1781, 1973, 2098]) {
    combCorrelation = Math.max(combCorrelation, Math.abs(correlation(data, onset, end, lag)))
  }
  let stereoCross = 0
  let leftPower = 0
  let rightPower = 0
  for (let i = onset; i < end; i++) {
    stereoCross += data[i] * right[i]
    leftPower += data[i] * data[i]
    rightPower += right[i] * right[i]
  }
  const stereoCorrelation = stereoCross / Math.sqrt(leftPower * rightPower)

  const ok = finite && peak > 0 && peak < 4 && early > late * 3 && combCorrelation < 0.1 && Math.abs(stereoCorrelation) < 0.1
  document.body.textContent = `${ok ? 'PASS' : 'FAIL'} peak=${peak.toFixed(3)} early=${early.toFixed(5)} late=${late.toFixed(5)} comb=${combCorrelation.toFixed(3)} stereo=${stereoCorrelation.toFixed(3)}`
}

run().catch((error) => {
  document.body.textContent = `FAIL ${error instanceof Error ? error.stack : error}`
})
