/**
 * The synth's effects: a feedback delay and a simple convolver reverb, both
 * ported from browser-fx's shipped implementations (offscreen-effects.js,
 * createDelay and createReverb) - production-tested graphs, not new designs.
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
 * browser-fx's simple reverb: a convolver whose impulse is generated noise
 * with an exponential decay envelope. Bigger rooms decay more slowly - size
 * maps to the decay exponent (1.5 tight down to 0.3 spacious), exactly as the
 * original does.
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
    this.wet.gain.setTargetAtTime(clamp(mix, 0, 1), now, RAMP)
    this.dry.gain.setTargetAtTime(1 - clamp(mix, 0, 1) * 0.5, now, RAMP)

    // The impulse is a buffer, not a parameter: rebuilding means allocating
    // and filling seconds of stereo noise, which cannot run on every tick of
    // a knob drag. Debounced until the knob settles.
    const key = `${size.toFixed(2)}:${decay.toFixed(1)}`
    if (key === this.impulseKey) return
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null
      this.buildImpulse(size, decay)
    }, 150)
  }

  private buildImpulse(size: number, decay: number) {
    const key = `${size.toFixed(2)}:${decay.toFixed(1)}`
    if (key === this.impulseKey) return
    this.impulseKey = key

    const sr = this.ctx.sampleRate
    const length = Math.max(1, Math.floor(sr * clamp(decay, 0.1, 10)))
    const impulse = this.ctx.createBuffer(2, length, sr)
    // browser-fx's mapping: bigger rooms decay more slowly.
    const exponent = Math.max(1.5 - clamp(size, 0, 1), 0.3)
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const n = length - i
        data[i] = (Math.random() * 2 - 1) * Math.pow(n / length, exponent)
      }
    }
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
