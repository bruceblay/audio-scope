/**
 * A small built-in synthesizer, so the scope has something to look at that you
 * control.
 *
 * The point is analysis, not performance: a known waveform at a known pitch is
 * the only way to tell whether the display is telling the truth, and hunting for
 * a tab playing a clean sine is a poor substitute. It should still sound good,
 * because an instrument you dislike playing does not get played.
 *
 * Everything is built from Web Audio nodes rather than an AudioWorklet. The
 * voices are simple enough that the extra machinery would buy nothing, and
 * native oscillators are already band-limited, which a hand-rolled saw would not
 * be - aliasing is exactly the artifact a spectrum analyzer would show first.
 */

import { clamp } from '../lib/dsp'
import { DelayFx, ReverbFx } from './fx'

export type Waveform = OscillatorType
export type ArpMode = 'up' | 'down' | 'updown' | 'random'
export type FilterSlope = 12 | 24

export interface SynthSettings {
  enabled: boolean
  /** Oscillator A waveform; kept as `waveform` for stored-settings compatibility. */
  waveform: Waveform
  /** Oscillator B can supply a different harmonic source. */
  oscBWaveform: Waveform
  /** Coarse tuning of oscillator B relative to the played note. */
  oscBSemitones: number
  /** Crossfade from oscillator A (0) to B (1). */
  oscMix: number
  /** Spread between the two oscillators, in cents. */
  detune: number
  /** Filter cutoff in Hz. */
  cutoff: number
  /** Filter Q. */
  resonance: number
  /** Low-pass rolloff in dB per octave. */
  filterSlope: FilterSlope
  /** How far the envelope opens the filter, in octaves above cutoff. */
  envAmount: number
  attack: number
  decay: number
  sustain: number
  release: number
  level: number

  /** Delay and reverb, mix 0 = off. Ported from browser-fx; see fx.ts. */
  delayTime: number
  delayFeedback: number
  delayMix: number
  reverbSize: number
  reverbDecay: number
  reverbMix: number

  arpOn: boolean
  /** Steps per second. */
  arpRate: number
  arpMode: ArpMode
  /** How many octaves the pattern climbs before repeating. */
  arpOctaves: number
  /** Held notes keep sounding after release, so the pattern can be built up. */
  arpLatch: boolean
}

export const DEFAULT_SYNTH: SynthSettings = {
  enabled: false,
  // Sine, because the synth is test equipment first: a sine is the signal with
  // the known answer - one spectral line, a perfect X-Y circle at 1:1.
  waveform: 'sine',
  oscBWaveform: 'sine',
  oscBSemitones: 0,
  oscMix: 0.5,
  // Zero detune: two oscillators in phase sum to one waveform, which is the
  // honest signal to measure with. Detune is one knob away when wanted.
  detune: 0,
  cutoff: 2200,
  resonance: 6,
  filterSlope: 12,
  envAmount: 1.8,
  attack: 0.01,
  decay: 0.18,
  sustain: 0.55,
  release: 0.25,
  level: 0.5,

  // Dry by default: the synth is test equipment first, and a probe with
  // reverb baked in would smear the very waveforms it exists to show.
  delayTime: 0.25,
  delayFeedback: 0.3,
  delayMix: 0,
  reverbSize: 0.7,
  reverbDecay: 2,
  reverbMix: 0,

  arpOn: false,
  arpRate: 8,
  arpMode: 'up',
  arpOctaves: 1,
  arpLatch: false,
}

/** Equal temperament, A440. MIDI 69 is A4. */
export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

/** Pitch and balance are pure so stored-setting migrations and DSP tests agree with voices. */
export function oscillatorPitches(midi: number, bSemitones: number, spreadCents: number) {
  return {
    aHz: midiToHz(midi),
    bHz: midiToHz(midi + bSemitones),
    aDetune: -spreadCents / 2,
    bDetune: spreadCents / 2,
  }
}

export function oscillatorMixGains(mix: number) {
  const b = clamp(mix, 0, 1)
  return { a: 1 - b, b }
}

/** Preserve the old unison sound when loading settings saved before Osc B was exposed. */
export function migrateSynthSettings(saved?: Partial<SynthSettings>): Partial<SynthSettings> | undefined {
  if (!saved || 'oscBWaveform' in saved || saved.waveform === undefined) return saved
  return { ...saved, oscBWaveform: saved.waveform }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const midiToName = (midi: number) =>
  NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)

/** One sounding note. Two independently voiced oscillators into a selectable-slope filter and VCA. */
class Voice {
  private readonly oscA: OscillatorNode
  private readonly oscB: OscillatorNode
  private readonly oscAGain: GainNode
  private readonly oscBGain: GainNode
  private readonly mix: GainNode
  private readonly filterA: BiquadFilterNode
  private readonly filterB: BiquadFilterNode
  private readonly slope12: GainNode
  private readonly slope24: GainNode
  private readonly amp: GainNode
  private stopped = false
  /** When the note began, so a live edit knows which envelope stage it is in. */
  private readonly startAt: number
  private s: SynthSettings

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    readonly midi: number,
    s: SynthSettings,
  ) {
    const now = ctx.currentTime
    const pitch = oscillatorPitches(midi, s.oscBSemitones, s.detune)
    this.startAt = now
    this.s = s

    this.filterA = ctx.createBiquadFilter()
    this.filterB = ctx.createBiquadFilter()
    this.filterA.type = 'lowpass'
    this.filterB.type = 'lowpass'
    // Q capped at 10 in the audio layer no matter what settings carry: still a
    // screaming resonance, but inside the region where swept biquads stay
    // numerically stable. The second stage stays neutral: applying resonance
    // twice would square the peak and immediately drive the limiter.
    this.filterA.Q.value = clamp(s.resonance, 0.5, 10)
    this.filterB.Q.value = Math.SQRT1_2

    // Both slopes remain connected and a short gain crossfade selects one.
    // That makes slope changes live without disconnect clicks or stranded
    // AudioNodes: 12 dB exits after stage A; 24 dB passes through stage B too.
    this.slope12 = ctx.createGain()
    this.slope24 = ctx.createGain()
    this.slope12.gain.value = s.filterSlope === 12 ? 1 : 0
    this.slope24.gain.value = s.filterSlope === 24 ? 1 : 0

    this.amp = ctx.createGain()
    this.amp.gain.value = 0

    // The A/B crossfade always sums to one. At 50/50 this is exactly the old
    // half-gain unison pair; at either edge one oscillator remains full scale.
    this.mix = ctx.createGain()
    this.mix.gain.value = 1
    this.oscAGain = ctx.createGain()
    this.oscBGain = ctx.createGain()
    const balance = oscillatorMixGains(s.oscMix)
    this.oscAGain.gain.value = balance.a
    this.oscBGain.gain.value = balance.b
    this.oscAGain.connect(this.mix)
    this.oscBGain.connect(this.mix)
    this.mix.connect(this.filterA)

    this.oscA = ctx.createOscillator()
    this.oscB = ctx.createOscillator()
    this.oscA.type = s.waveform
    this.oscA.frequency.value = pitch.aHz
    this.oscA.detune.value = pitch.aDetune
    this.oscA.connect(this.oscAGain)
    this.oscB.type = s.oscBWaveform
    this.oscB.frequency.value = pitch.bHz
    this.oscB.detune.value = pitch.bDetune
    this.oscB.connect(this.oscBGain)
    this.oscA.start(now)
    this.oscB.start(now)

    this.filterA.connect(this.slope12)
    this.filterA.connect(this.filterB)
    this.filterB.connect(this.slope24)
    this.slope12.connect(this.amp)
    this.slope24.connect(this.amp)
    this.amp.connect(destination)

    // Filter envelope: opens `envAmount` octaves above the cutoff on attack and
    // falls back to it. This is what makes a note have a shape rather than just
    // a volume.
    //
    // Set directly, not via setValueAtTime: scheduleFilter starts by cancelling
    // scheduled events, and a setValueAtTime here was being cancelled before it
    // ever rendered - leaving the filter at the node's 350 Hz default and
    // turning every note-on into a giant surprise sweep. At high resonance that
    // sweep is exactly the "fast parameter automation" that destabilizes
    // Chrome's biquad, which then rings a pure sine at its own frequency no
    // matter what waveform feeds it.
    this.filterA.frequency.value = s.cutoff
    this.filterB.frequency.value = s.cutoff
    this.scheduleFilter(now)

    // Amp envelope. Ramps rather than steps: a step on a gain node is a click.
    this.amp.gain.setValueAtTime(0, now)
    this.scheduleAmp(now)
  }

  /**
   * Apply a settings change to a note that is already sounding.
   *
   * On a real synth every knob is live: you hold a chord and open the filter and
   * hear it open. Baking the settings into the voice at note-on and leaving them
   * meant every parameter was deaf until the next keypress, which is the opposite
   * of what the synth is here for - you tune a sound by listening to it change.
   */
  applySettings(next: SynthSettings) {
    if (this.stopped) return
    const now = this.ctx.currentTime
    const prev = this.s
    this.s = next

    if (next.waveform !== prev.waveform) {
      this.oscA.type = next.waveform
    }
    if (next.oscBWaveform !== prev.oscBWaveform) this.oscB.type = next.oscBWaveform
    if (next.oscBSemitones !== prev.oscBSemitones) {
      this.oscB.frequency.setTargetAtTime(midiToHz(this.midi + next.oscBSemitones), now, 0.01)
    }
    if (next.oscMix !== prev.oscMix) {
      const balance = oscillatorMixGains(next.oscMix)
      this.oscAGain.gain.setTargetAtTime(balance.a, now, 0.01)
      this.oscBGain.gain.setTargetAtTime(balance.b, now, 0.01)
    }
    if (next.detune !== prev.detune) {
      // Short glide rather than a step: a jump in detune is an audible click on
      // the oscillator phase.
      this.oscA.detune.setTargetAtTime(-next.detune / 2, now, 0.01)
      this.oscB.detune.setTargetAtTime(next.detune / 2, now, 0.01)
    }
    if (next.filterSlope !== prev.filterSlope) {
      this.slope12.gain.setTargetAtTime(next.filterSlope === 12 ? 1 : 0, now, 0.01)
      this.slope24.gain.setTargetAtTime(next.filterSlope === 24 ? 1 : 0, now, 0.01)
    }
    // Q moves slowly on purpose: frequency and Q automating fast together is
    // the classic biquad instability recipe.
    if (next.resonance !== prev.resonance)
      this.filterA.Q.setTargetAtTime(clamp(next.resonance, 0.5, 10), now, 0.08)

    if (
      next.cutoff !== prev.cutoff ||
      next.envAmount !== prev.envAmount ||
      next.attack !== prev.attack ||
      next.decay !== prev.decay
    )
      this.requestFilterReschedule()
    if (
      next.level !== prev.level ||
      next.attack !== prev.attack ||
      next.sustain !== prev.sustain ||
      next.decay !== prev.decay
    )
      this.scheduleAmp(now)
  }

  /**
   * Coalesce knob-drag reschedules. A drag patches settings dozens of times a
   * second, and each filter reschedule is a cancel-and-retarget on every
   * sounding voice - itself the "fast parameter automation" Chrome warns
   * about. One reschedule per 50 ms window, trailing edge, keeps the knob
   * feeling live without machine-gunning the filter.
   */
  private rescheduleTimer: number | null = null
  private requestFilterReschedule() {
    if (this.rescheduleTimer !== null) return
    this.rescheduleTimer = window.setTimeout(() => {
      this.rescheduleTimer = null
      if (!this.stopped) this.scheduleFilter(this.ctx.currentTime)
    }, 50)
  }

  /**
   * (Re)schedule the filter envelope from `now`.
   *
   * Where the note is in its envelope decides the shape. Before the attack peak
   * the ramp continues to the (possibly new) open frequency; after it, the note
   * glides to the cutoff. The glide uses the decay constant while the decay is
   * still running, so turning cutoff mid-note bends the sweep rather than cutting
   * it off, and a fast constant once the decay has settled, so a knob turn on a
   * held note is heard immediately instead of crawling for seconds.
   */
  private scheduleFilter(now: number) {
    const s = this.s
    const attackEnd = this.startAt + Math.max(0.002, s.attack)
    const decay = Math.max(0.01, s.decay)
    // The envelope's open frequency stays well below Nyquist: a high-Q lowpass
    // swept toward Nyquist is the least numerically stable place a biquad can
    // be, and is where Chrome's "state is bad" warning lives.
    const open = clamp(s.cutoff * Math.pow(2, s.envAmount), 20, this.ctx.sampleRate * 0.35)
    for (const filter of [this.filterA, this.filterB]) {
      const freq = filter.frequency
      freq.cancelScheduledValues(now)
      freq.setValueAtTime(freq.value, now)
      // Exponential approaches only, never linear ramps: setTargetAtTime moves
      // the frequency asymptotically, which is far gentler on the biquad's
      // coefficient interpolation than a linear race to the target. The attack
      // approach uses a third of the attack time as its constant, so it reaches
      // ~95% of open by the attack's end - the same audible shape without the
      // instability-triggering sweep.
      if (now < attackEnd) {
        // 8 ms floor on the approach constant: below that, a high-Q sweep is
        // fast enough to destabilize the coefficient interpolation.
        freq.setTargetAtTime(open, now, Math.max(0.008, s.attack / 3))
        freq.setTargetAtTime(s.cutoff, attackEnd, decay)
      } else {
        // Four time constants is within 2% of the target, so past that the decay
        // has effectively finished and the glide can switch to a fast constant.
        freq.setTargetAtTime(s.cutoff, now, now > attackEnd + 4 * decay ? 0.08 : decay)
      }
    }
  }

  /** The same, for the amp envelope. */
  private scheduleAmp(now: number) {
    const s = this.s
    const attackEnd = this.startAt + Math.max(0.002, s.attack)
    const decay = Math.max(0.01, s.decay) / 3
    const peak = clamp(s.level, 0, 1)
    const gain = this.amp.gain

    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    if (now < attackEnd) {
      gain.linearRampToValueAtTime(peak, attackEnd)
      gain.setTargetAtTime(peak * clamp(s.sustain, 0, 1), attackEnd, decay)
    } else {
      gain.setTargetAtTime(
        peak * clamp(s.sustain, 0, 1),
        now,
        now > attackEnd + 4 * decay ? 0.03 : decay,
      )
    }
  }

  release(seconds: number) {
    if (this.stopped) return
    this.stopped = true
    if (this.rescheduleTimer !== null) window.clearTimeout(this.rescheduleTimer)
    const now = this.ctx.currentTime
    const tail = Math.max(0.02, seconds)
    this.amp.gain.cancelScheduledValues(now)
    this.amp.gain.setValueAtTime(this.amp.gain.value, now)
    this.amp.gain.linearRampToValueAtTime(0, now + tail)
    // Oscillators are stopped rather than left running: a released voice that
    // keeps oscillating into a zero gain still costs CPU, and with an arpeggiator
    // running they accumulate fast.
    this.oscA.stop(now + tail + 0.02)
    this.oscB.stop(now + tail + 0.02)
    window.setTimeout(() => this.disconnect(), (tail + 0.1) * 1000)
  }

  /** Cut immediately, for panic and teardown. */
  kill() {
    this.stopped = true
    if (this.rescheduleTimer !== null) window.clearTimeout(this.rescheduleTimer)
    try {
      this.oscA.stop()
      this.oscB.stop()
    } catch {
      // Already stopped.
    }
    this.disconnect()
  }

  private disconnect() {
    for (const node of [
      this.oscA,
      this.oscB,
      this.oscAGain,
      this.oscBGain,
      this.mix,
      this.filterA,
      this.filterB,
      this.slope12,
      this.slope24,
      this.amp,
    ]) {
      try {
        node.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }
}

export class Synth {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  /** Brickwall on the synth's own output - resonance boost and stacked voices
   * are unbounded, and a limiter is how every synth keeps a resonant filter
   * sweep or a fat chord from hard-clipping the DAC. Synth only; the tab's
   * audio never passes through it. */
  private limiter: DynamicsCompressorNode | null = null
  private delayFx: DelayFx | null = null
  private reverbFx: ReverbFx | null = null
  private settings: SynthSettings = DEFAULT_SYNTH

  /** Notes physically held down. */
  private readonly held = new Set<number>()
  /** Notes the arpeggiator is cycling, which latch can outlive `held`. */
  private readonly latched = new Set<number>()
  /** Sounding voices, keyed by note. Only used when the arpeggiator is off. */
  private readonly voices = new Map<number, Voice>()

  private arpTimer: number | null = null
  private arpStep = 0
  private arpVoice: Voice | null = null

  private onNotesChanged: (() => void) | null = null

  /** Notes currently lit on the keyboard. */
  get sounding(): Set<number> {
    return this.settings.arpOn && this.settings.arpLatch ? this.latched : this.held
  }

  private destination: AudioNode | null = null

  connect(ctx: AudioContext, destination: AudioNode) {
    if (this.out) return
    this.ctx = ctx
    this.destination = destination
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.buildChain()
  }

  private buildChain() {
    const ctx = this.ctx
    if (!ctx || !this.out || !this.destination) return
    this.limiter = ctx.createDynamicsCompressor()
    // Limiter settings, not compressor settings: high threshold, hard knee,
    // maximum ratio, fastest attack. Idle until the mix actually gets hot.
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.1
    // Voices -> delay -> reverb -> limiter. The effects are ahead of the
    // limiter so a feedback build-up or a long reverb tail cannot clip either.
    this.delayFx = new DelayFx(ctx)
    this.reverbFx = new ReverbFx(ctx)
    this.out.connect(this.delayFx.input)
    this.delayFx.output.connect(this.reverbFx.input)
    this.reverbFx.output.connect(this.limiter)
    this.limiter.connect(this.destination)
    this.applyFx(this.settings)
  }

  /**
   * Recover from non-finite audio in the graph.
   *
   * When a biquad destabilizes, Chrome resets the filter itself - that is
   * what its "state is bad" warning means - but any NaN samples that escaped
   * first can poison the delay's feedback line and downstream limiter state. A
   * transient glitch became a permanently dead synth. Everything stateful
   * downstream of the voices is disposable by design, so recovery is: kill
   * the voices (their filters are suspect), tear out the chain, rebuild it,
   * then recreate whatever the player is still holding. The last step matters:
   * without it the Arp switch stays visibly on while its clock is gone, making
   * a filter edit look as though it randomly stopped the sequencer.
   */
  recover() {
    if (!this.ctx || !this.out) return
    this.stopSustained()
    this.stopArp()
    try {
      this.out.disconnect()
    } catch {
      // Already disconnected.
    }
    this.delayFx?.dispose()
    this.reverbFx?.dispose()
    try {
      this.limiter?.disconnect()
    } catch {
      // Already disconnected.
    }
    this.buildChain()
    this.resumeSounding()
  }

  /** Recreate held or latched notes after the disposable graph is rebuilt. */
  private resumeSounding() {
    const ctx = this.ctx
    const out = this.out
    if (!ctx || !out || !this.settings.enabled) return
    if (this.settings.arpOn) {
      if (this.sounding.size > 0) this.startArp()
      return
    }
    for (const midi of this.held) {
      this.voices.set(midi, new Voice(ctx, out, midi, this.settings))
    }
  }

  private applyFx(s: SynthSettings) {
    this.delayFx?.apply(s.delayTime, s.delayFeedback, s.delayMix)
    this.reverbFx?.apply(s.reverbSize, s.reverbDecay, s.reverbMix)
  }

  setNotesChangedHandler(fn: (() => void) | null) {
    this.onNotesChanged = fn
  }

  update(next: SynthSettings) {
    const prev = this.settings
    this.settings = next
    if (!next.enabled) {
      this.allNotesOff()
      return
    }
    if (next.arpOn !== prev.arpOn) {
      // Switching modes strands whichever set of voices the other mode owns.
      this.stopSustained()
      this.stopArp()
      if (next.arpOn && this.sounding.size) this.startArp()
    } else if (next.arpOn && next.arpRate !== prev.arpRate) {
      // Only when the rate actually changed. Restarting the clock on every
      // update meant a knob drag - which patches settings dozens of times a
      // second - cleared the interval before it could ever fire, and the
      // arpeggiator fell silent for as long as the knob was moving.
      this.restartArpClock()
    }
    if (!next.arpLatch) this.latched.clear()

    // Everything else is live on whatever is currently sounding.
    this.applyFx(next)
    for (const voice of this.voices.values()) voice.applySettings(next)
    this.arpVoice?.applySettings(next)
  }

  noteOn(midi: number) {
    if (!this.settings.enabled) return

    if (this.settings.arpOn && this.settings.arpLatch) {
      // Latch is a toggle, not an accumulator. A latched note is sounding with
      // no key held, so pressing its key again is the only note-off it can
      // have; without this, the one way to remove a wrong note was to throw
      // away the whole pattern with the latch switch. Hardware latches work
      // this way for the same reason.
      if (this.latched.has(midi)) {
        this.latched.delete(midi)
        this.held.add(midi)
        if (this.latched.size === 0) this.stopArp()
        this.onNotesChanged?.()
        return
      }
      this.latched.add(midi)
    }

    this.held.add(midi)
    // The context guards sit on the sound, not the bookkeeping, so the note
    // sets stay truthful (and testable) even with no audio graph.
    if (this.settings.arpOn) {
      if (this.ctx && !this.arpTimer) this.startArp()
    } else if (this.ctx && this.out && !this.voices.has(midi)) {
      this.voices.set(midi, new Voice(this.ctx, this.out, midi, this.settings))
    }
    this.onNotesChanged?.()
  }

  noteOff(midi: number) {
    this.held.delete(midi)
    if (!this.settings.arpOn) {
      this.voices.get(midi)?.release(this.settings.release)
      this.voices.delete(midi)
    } else if (!this.settings.arpLatch && this.sounding.size === 0) {
      this.stopArp()
    }
    this.onNotesChanged?.()
  }

  allNotesOff() {
    this.held.clear()
    this.latched.clear()
    this.stopSustained()
    this.stopArp()
    this.onNotesChanged?.()
  }

  dispose() {
    this.allNotesOff()
    this.delayFx?.dispose()
    this.reverbFx?.dispose()
    this.delayFx = null
    this.reverbFx = null
    for (const node of [this.out, this.limiter]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.out = null
    this.limiter = null
    this.ctx = null
  }

  private stopSustained() {
    for (const voice of this.voices.values()) voice.kill()
    this.voices.clear()
  }

  private stopArp() {
    if (this.arpTimer !== null) window.clearInterval(this.arpTimer)
    this.arpTimer = null
    this.arpVoice?.kill()
    this.arpVoice = null
    this.arpStep = 0
  }

  private restartArpClock() {
    if (this.arpTimer === null) return
    window.clearInterval(this.arpTimer)
    this.arpTimer = window.setInterval(() => this.arpTick(), 1000 / this.settings.arpRate)
  }

  private startArp() {
    this.arpStep = 0
    this.arpTick()
    this.arpTimer = window.setInterval(() => this.arpTick(), 1000 / this.settings.arpRate)
  }

  /**
   * One arpeggiator step.
   *
   * Driven by setInterval rather than scheduled ahead on the audio clock. For a
   * sequencer that would be wrong - timer jitter would be audible as swing - but
   * here the arpeggiator exists to give the analyzer something repeating to look
   * at, and a millisecond of jitter changes nothing about the spectrum. The
   * simpler loop is worth more than the precision.
   */
  private arpTick() {
    const notes = arpSequence([...this.sounding], this.settings)
    if (!notes.length || !this.ctx || !this.out) {
      this.stopArp()
      return
    }

    this.arpVoice?.release(0.02)
    const index =
      this.settings.arpMode === 'random'
        ? Math.floor(Math.random() * notes.length)
        : this.arpStep % notes.length
    const voice = new Voice(this.ctx, this.out, notes[index], this.settings)
    this.arpVoice = voice

    // Gate each step to a fraction of its slot, so the pattern articulates
    // rather than running together.
    const step = 1 / this.settings.arpRate
    // Capture this step's voice. A throttled timer must never release whichever
    // newer voice happens to occupy `arpVoice` when the callback finally runs.
    window.setTimeout(() => voice.release(this.settings.release), step * 700)
    this.arpStep++
  }
}

/**
 * The order the arpeggiator walks its held notes.
 *
 * Split out and exported because it is the one part with a right answer that can
 * be checked without an AudioContext. See test/synth.test.ts.
 */
export function arpSequence(held: number[], s: Pick<SynthSettings, 'arpMode' | 'arpOctaves'>) {
  if (!held.length) return []
  const base = [...held].sort((a, b) => a - b)

  const spread: number[] = []
  for (let o = 0; o < Math.max(1, s.arpOctaves); o++) {
    for (const note of base) spread.push(note + o * 12)
  }

  if (s.arpMode === 'down') return spread.slice().reverse()
  if (s.arpMode === 'updown') {
    // Endpoints are not repeated, which is what makes it read as a turn rather
    // than a stutter at the top and bottom.
    return spread.length < 3 ? spread : spread.concat(spread.slice(1, -1).reverse())
  }
  return spread
}
