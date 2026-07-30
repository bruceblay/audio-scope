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
  waveform: 'sawtooth',
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

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    readonly midi: number,
    s: SynthSettings,
  ) {
    const now = ctx.currentTime
    const hz = midiToHz(midi + s.octave * 12)

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
    const open = clamp(s.cutoff * Math.pow(2, s.envAmount), 20, 20000)
    this.filter.frequency.setValueAtTime(s.cutoff, now)
    this.filter.frequency.linearRampToValueAtTime(open, now + Math.max(0.002, s.attack))
    this.filter.frequency.setTargetAtTime(s.cutoff, now + s.attack, Math.max(0.01, s.decay))

    // Amp envelope. Ramps rather than steps: a step on a gain node is a click.
    const peak = clamp(s.level, 0, 1)
    this.amp.gain.setValueAtTime(0, now)
    this.amp.gain.linearRampToValueAtTime(peak, now + Math.max(0.002, s.attack))
    this.amp.gain.setTargetAtTime(
      peak * clamp(s.sustain, 0, 1),
      now + s.attack,
      Math.max(0.01, s.decay) / 3,
    )
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
    this.out.connect(destination)
  }

  setNotesChangedHandler(fn: (() => void) | null) {
    this.onNotesChanged = fn
  }

  update(next: SynthSettings) {
    const wasArp = this.settings.arpOn
    this.settings = next
    if (!next.enabled) {
      this.allNotesOff()
      return
    }
    if (next.arpOn !== wasArp) {
      // Switching modes strands whichever set of voices the other mode owns.
      this.stopSustained()
      this.stopArp()
      if (next.arpOn && this.sounding.size) this.startArp()
    } else if (next.arpOn) {
      this.restartArpClock()
    }
    if (!next.arpLatch) this.latched.clear()
  }

  noteOn(midi: number) {
    if (!this.settings.enabled || !this.ctx || !this.out) return
    this.held.add(midi)

    if (this.settings.arpOn) {
      if (this.settings.arpLatch) this.latched.add(midi)
      if (!this.arpTimer) this.startArp()
    } else if (!this.voices.has(midi)) {
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
    try {
      this.out?.disconnect()
    } catch {
      // Already disconnected.
    }
    this.out = null
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
