/**
 * The synth's effects, ported from browser-fx's shipped createDelay and
 * createReverb implementations.
 *
 * Both sit in the synth's private chain ahead of its limiter. Tab audio never
 * passes through them. Mix at zero is the off state: the panel stays minimal
 * (no toggles) and the synth stays honest test equipment by default - a probe
 * with reverb baked in would smear the very waveforms it exists to show.
 */

import { clamp } from '../lib/dsp'

const RAMP = 0.03

/**
 * browser-fx's delay: input feeds a DelayNode whose output returns to itself
 * through a feedback gain, with parallel wet/dry into the output.
 */
export class DelayFx {
  readonly input: GainNode
  readonly output: GainNode
  private readonly delay: DelayNode
  private readonly feedback: GainNode
  private readonly wet: GainNode
  private readonly dry: GainNode
  private readonly ctx: AudioContext

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.delay = ctx.createDelay(2)
    this.feedback = ctx.createGain()
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()

    this.delay.delayTime.value = 0.25
    this.feedback.gain.value = 0.3
    this.wet.gain.value = 0
    this.dry.gain.value = 1

    this.input.connect(this.delay)
    this.delay.connect(this.feedback)
    this.feedback.connect(this.delay)
    this.delay.connect(this.wet)
    this.input.connect(this.dry)
    this.wet.connect(this.output)
    this.dry.connect(this.output)
  }

  apply(time: number, feedback: number, mix: number) {
    const now = this.ctx.currentTime
    this.delay.delayTime.setTargetAtTime(clamp(time, 0.02, 2), now, RAMP)
    // Capped below unity, or the loop regenerates forever and eventually the
    // limiter is all you hear.
    this.feedback.gain.setTargetAtTime(clamp(feedback, 0, 0.9), now, RAMP)
    this.wet.gain.setTargetAtTime(clamp(mix, 0, 1), now, RAMP)
    this.dry.gain.setTargetAtTime(1 - clamp(mix, 0, 1) * 0.5, now, RAMP)
  }

  dispose() {
    for (const n of [this.input, this.output, this.delay, this.feedback, this.wet, this.dry]) {
      try {
        n.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }
}

/**
 * Fill one channel of browser-fx's noise impulse. Exported so its essential
 * acoustic properties can be checked without pretending Node has Web Audio.
 */
export function fillReverbImpulse(
  data: Float32Array,
  roomSize: number,
  random: () => number = Math.random,
) {
  const exponent = Math.max(1.5 - clamp(roomSize, 0, 1), 0.3)
  for (let i = 0; i < data.length; i++) {
    const remaining = (data.length - i) / data.length
    data[i] = (random() * 2 - 1) * Math.pow(remaining, exponent)
  }
}

/** browser-fx uses a real crossfade: fully wet contains no direct signal. */
export function reverbMixGains(mix: number) {
  const wet = clamp(mix, 0, 1)
  return { wet, dry: 1 - wet }
}

/**
 * browser-fx's stereo convolution reverb.
 *
 * The short-lived Schroeder replacement used only four combs and two mono
 * allpasses. A sustained synth note repeatedly reinforced those comb
 * frequencies, producing the narrow, shrill ringing reported in practice.
 * A finite noise impulse has no feedback path and no fixed resonant pitch.
 * Size controls the envelope shape; Decay controls the impulse duration.
 */
export class ReverbFx {
  readonly input: GainNode
  readonly output: GainNode
  private readonly convolver: ConvolverNode
  private readonly wet: GainNode
  private readonly dry: GainNode
  private readonly ctx: AudioContext
  private impulseKey = ''
  private rebuildTimer: number | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.convolver = ctx.createConvolver()
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet.gain.value = 0
    this.dry.gain.value = 1

    this.input.connect(this.convolver)
    this.input.connect(this.dry)
    this.convolver.connect(this.wet)
    this.wet.connect(this.output)
    this.dry.connect(this.output)

    this.buildImpulse(0.7, 2)
  }

  apply(size: number, decay: number, mix: number) {
    const now = this.ctx.currentTime
    const gains = reverbMixGains(mix)
    this.wet.gain.setTargetAtTime(gains.wet, now, RAMP)
    this.dry.gain.setTargetAtTime(gains.dry, now, RAMP)

    // An impulse is a buffer rather than an AudioParam. Match browser-fx's
    // rebuild semantics, but debounce a drag so we allocate once when the knob
    // settles instead of several seconds of stereo data on every pointer move.
    const key = this.key(size, decay)
    if (key === this.impulseKey) return
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null
      this.buildImpulse(size, decay)
    }, 150)
  }

  private key(size: number, decay: number) {
    return `${clamp(size, 0, 1).toFixed(2)}:${clamp(decay, 0.1, 10).toFixed(1)}`
  }

  private buildImpulse(size: number, decay: number) {
    const key = this.key(size, decay)
    if (key === this.impulseKey) return
    this.impulseKey = key

    const length = Math.max(1, Math.floor(this.ctx.sampleRate * clamp(decay, 0.1, 10)))
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate)
    fillReverbImpulse(impulse.getChannelData(0), size)
    fillReverbImpulse(impulse.getChannelData(1), size)
    this.convolver.buffer = impulse
  }

  dispose() {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    for (const n of [this.input, this.output, this.convolver, this.wet, this.dry]) {
      try {
        n.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }
}
