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

export type Waveform = OscillatorType
export type ArpMode = 'up' | 'down' | 'updown' | 'random'

export interface SynthSettings {
  enabled: boolean
  waveform: Waveform
  /** Octave transpose applied to every note. */
  octave: number
  /** Spread between the two oscillators, in cents. */
  detune: number
  /** Filter cutoff in Hz. */
  cutoff: number
  /** Filter Q. */
  resonance: number
  /** How far the envelope opens the filter, in octaves above cutoff. */
  envAmount: number
  attack: number
  decay: number
  sustain: number
  release: number
  level: number

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
  octave: 0,
  detune: 12,
  cutoff: 2200,
  resonance: 6,
  envAmount: 1.8,
  attack: 0.01,
  decay: 0.18,
  sustain: 0.55,
  release: 0.25,
  level: 0.5,

  arpOn: false,
  arpRate: 8,
  arpMode: 'up',
  arpOctaves: 1,
  arpLatch: false,
}

/** Equal temperament, A440. MIDI 69 is A4. */
export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const midiToName = (midi: number) =>
  NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)

/** One sounding note. Two detuned oscillators into a filter into a VCA. */
class Voice {
  private readonly oscA: OscillatorNode
  private readonly oscB: OscillatorNode
  private readonly filter: BiquadFilterNode
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
    const hz = midiToHz(midi + s.octave * 12)
    this.startAt = now
    this.s = s

    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.Q.value = s.resonance

    this.amp = ctx.createGain()
    this.amp.gain.value = 0

    this.oscA = ctx.createOscillator()
    this.oscB = ctx.createOscillator()
    for (const [osc, sign] of [
      [this.oscA, -1],
      [this.oscB, 1],
    ] as const) {
      osc.type = s.waveform
      osc.frequency.value = hz
      // Two oscillators a few cents apart is the cheapest way to sound like an
      // instrument rather than a test tone, and at detune 0 they simply sum.
      osc.detune.value = (sign * s.detune) / 2
      osc.connect(this.filter)
      osc.start(now)
    }

    this.filter.connect(this.amp)
    this.amp.connect(destination)

    // Filter envelope: opens `envAmount` octaves above the cutoff on attack and
    // falls back to it. This is what makes a note have a shape rather than just
    // a volume.
    this.filter.frequency.setValueAtTime(s.cutoff, now)
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
      this.oscB.type = next.waveform
    }
    if (next.detune !== prev.detune) {
      // Short glide rather than a step: a jump in detune is an audible click on
      // the oscillator phase.
      this.oscA.detune.setTargetAtTime(-next.detune / 2, now, 0.01)
      this.oscB.detune.setTargetAtTime(next.detune / 2, now, 0.01)
    }
    if (next.octave !== prev.octave) {
      const hz = midiToHz(this.midi + next.octave * 12)
      this.oscA.frequency.setTargetAtTime(hz, now, 0.01)
      this.oscB.frequency.setTargetAtTime(hz, now, 0.01)
    }
    if (next.resonance !== prev.resonance) this.filter.Q.setTargetAtTime(next.resonance, now, 0.01)

    if (next.cutoff !== prev.cutoff || next.envAmount !== prev.envAmount || next.decay !== prev.decay)
      this.scheduleFilter(now)
    if (next.level !== prev.level || next.sustain !== prev.sustain || next.decay !== prev.decay)
      this.scheduleAmp(now)
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
    const open = clamp(s.cutoff * Math.pow(2, s.envAmount), 20, 20000)
    const freq = this.filter.frequency

    freq.cancelScheduledValues(now)
    freq.setValueAtTime(freq.value, now)
    if (now < attackEnd) {
      freq.linearRampToValueAtTime(open, attackEnd)
      freq.setTargetAtTime(s.cutoff, attackEnd, decay)
    } else {
      // Four time constants is within 2% of the target, so past that the decay
      // has effectively finished and there is no sweep left to preserve.
      freq.setTargetAtTime(s.cutoff, now, now > attackEnd + 4 * decay ? 0.04 : decay)
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
    try {
      this.oscA.stop()
      this.oscB.stop()
    } catch {
      // Already stopped.
    }
    this.disconnect()
  }

  private disconnect() {
    for (const node of [this.oscA, this.oscB, this.filter, this.amp]) {
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
  /** Dry path to the bus, duckable while the vocoder wears the synth. */
  private dry: GainNode | null = null
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

  connect(ctx: AudioContext, destination: AudioNode) {
    if (this.out) return
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.dry = ctx.createGain()
    this.dry.gain.value = 1
    this.out.connect(this.dry)
    this.dry.connect(destination)
  }

  /** The synth's full output, for the vocoder's carrier tap. */
  get carrierTap(): AudioNode | null {
    return this.out
  }

  /** Duck or restore the synth's dry level while the vocoder is engaged. */
  setDryLevel(v: number) {
    if (this.dry && this.ctx) this.dry.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03)
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
    for (const node of [this.out, this.dry]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.out = null
    this.dry = null
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
    this.arpVoice = new Voice(this.ctx, this.out, notes[index], this.settings)

    // Gate each step to a fraction of its slot, so the pattern articulates
    // rather than running together.
    const step = 1 / this.settings.arpRate
    window.setTimeout(() => this.arpVoice?.release(this.settings.release), step * 700)
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
