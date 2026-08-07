/** Real Chromium render verifying the production synth's selectable filter slope. */
import { DEFAULT_SYNTH, Synth, type FilterSlope, type SynthSettings } from '../src/audio/synth'

function rms(data: Float32Array, from: number, to: number) {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

async function render(slope: FilterSlope, liveSlope?: FilterSlope) {
  const sampleRate = 48000
  const seconds = 0.6
  const context = new OfflineAudioContext(1, sampleRate * seconds, sampleRate)
  const synth = new Synth()
  synth.connect(context as unknown as AudioContext, context.destination)
  const settings: SynthSettings = {
    ...DEFAULT_SYNTH,
    enabled: true,
    waveform: 'sine',
    oscBWaveform: 'sine',
    oscMix: 0,
    cutoff: 500,
    resonance: Math.SQRT1_2,
    filterSlope: slope,
    envAmount: 0,
    attack: 0.002,
    decay: 0.01,
    sustain: 1,
    level: 0.1,
  }
  synth.update(settings)
  // C6 is 1046.5 Hz: just over one octave above the 500 Hz cutoff, where the
  // added stage should make 24 dB visibly and audibly quieter than 12 dB.
  synth.noteOn(84)
  if (liveSlope !== undefined) synth.update({ ...settings, filterSlope: liveSlope })
  const rendered = await context.startRendering()
  synth.dispose()
  const data = rendered.getChannelData(0)
  return rms(data, Math.floor(sampleRate * 0.3), data.length)
}

async function run() {
  document.body.textContent = 'RUN synth filter render'
  const twelve = await render(12)
  const twentyFour = await render(24)
  const switched = await render(12, 24)
  const ratio = twentyFour / twelve
  const switchError = Math.abs(switched / twentyFour - 1)
  const ok = Number.isFinite(ratio) && twelve > 0 && twentyFour > 0 && ratio < 0.4 && switchError < 0.05
  document.body.textContent = `${ok ? 'PASS' : 'FAIL'} 12dB=${twelve.toFixed(6)} 24dB=${twentyFour.toFixed(6)} ratio=${ratio.toFixed(3)} live-error=${switchError.toFixed(3)}`
}

run().catch((error) => {
  document.body.textContent = `FAIL ${error instanceof Error ? error.stack : error}`
})
