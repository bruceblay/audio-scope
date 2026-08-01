/**
 * The synth's effects: a feedback delay (ported from browser-fx's shipped
 * createDelay) and a Schroeder reverb (built here after browser-fx's convolver
 * design hit a Chromium ConvolverNode bug; see ReverbFx).
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
 * A Schroeder reverb: four damped parallel comb filters into two series
 * allpasses, built entirely from DelayNodes, gains and one-pole damping.
 *
 * This replaced a port of browser-fx's convolver reverb after a hunt: with the
 * convolver in the synth chain, every oscillator waveform played and displayed
 * as a sine. Bisecting the chain offline proved every other node transparent
 * (a sawtooth kept its textbook -6/-9.5/-12/-13.9 dB harmonics through voices,
 * mix, filter, delay and limiter), and this Chrome build's ConvolverNode was
 * separately shown to wedge a graph outright in exactly the parallel wet/dry
 * topology a reverb needs. No convolver, no wedge - and the classic network is
 * more honest anyway: decay here is literal RT60 (the comb feedbacks follow
 * g = 10^(-3 d / RT60)), not a noise-buffer exponent.
 */
export class ReverbFx {
  readonly input: GainNode
  readonly output: GainNode
  private readonly wet: GainNode
  private readonly dry: GainNode
  private readonly combDelays: DelayNode[] = []
  private readonly combGains: GainNode[] = []
  private readonly ctx: AudioContext

  /** Freeverb's comb tunings, in seconds at their reference size. */
  private static readonly COMBS = [0.0297, 0.0371, 0.0411, 0.0437]
  private static readonly ALLPASSES = [0.005, 0.0017]

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet.gain.value = 0
    this.dry.gain.value = 1

    this.input.connect(this.dry)
    this.dry.connect(this.output)

    // Parallel combs, each with a damping lowpass inside its loop so high
    // frequencies die faster than lows, as they do in a room.
    const combSum = ctx.createGain()
    combSum.gain.value = 0.25
    for (const seconds of ReverbFx.COMBS) {
      const delay = ctx.createDelay(0.2)
      delay.delayTime.value = seconds
      const damp = ctx.createBiquadFilter()
      damp.type = 'lowpass'
      damp.frequency.value = 4500
      const fb = ctx.createGain()
      fb.gain.value = 0.7
      this.input.connect(delay)
      delay.connect(damp)
      damp.connect(fb)
      fb.connect(delay)
      delay.connect(combSum)
      this.combDelays.push(delay)
      this.combGains.push(fb)
    }

    // Series allpasses smear the comb resonances into a diffuse tail:
    // y = -g x + x[n-t] + g y[n-t].
    let stage: AudioNode = combSum
    for (const seconds of ReverbFx.ALLPASSES) {
      const sum = ctx.createGain()
      const delay = ctx.createDelay(0.05)
      delay.delayTime.value = seconds
      const ff = ctx.createGain()
      ff.gain.value = -0.7
      const fbg = ctx.createGain()
      fbg.gain.value = 0.7
      const out = ctx.createGain()
      stage.connect(sum)
      stage.connect(ff)
      ff.connect(out)
      sum.connect(delay)
      delay.connect(out)
      out.connect(fbg)
      fbg.connect(sum)
      stage = out
    }
    stage.connect(this.wet)
    this.wet.connect(this.output)
  }

  apply(size: number, decay: number, mix: number) {
    const now = this.ctx.currentTime
    this.wet.gain.setTargetAtTime(clamp(mix, 0, 1), now, RAMP)
    this.dry.gain.setTargetAtTime(1 - clamp(mix, 0, 1) * 0.5, now, RAMP)

    // Size scales the comb lengths (a bigger room has longer reflections);
    // decay sets each comb's feedback from the RT60 relation, so the Decay
    // knob's seconds are the seconds you hear.
    const scale = 0.6 + clamp(size, 0, 1) * 0.9
    const rt60 = clamp(decay, 0.1, 10)
    for (let i = 0; i < this.combDelays.length; i++) {
      const d = ReverbFx.COMBS[i] * scale
      this.combDelays[i].delayTime.setTargetAtTime(d, now, RAMP)
      const g = Math.min(0.93, Math.pow(10, (-3 * d) / rt60))
      this.combGains[i].gain.setTargetAtTime(g, now, RAMP)
    }
  }

  dispose() {
    for (const n of [this.input, this.output, this.wet, this.dry, ...this.combDelays, ...this.combGains]) {
      try {
        n.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }
}
