/**
 * Synth verification.
 *
 * The synth exists so the scope has a signal with a known answer, which only
 * works if its pitches are actually right. Tuning and arpeggiator order are both
 * checkable without an AudioContext; the voice graph is not, and is left to the
 * ear.
 *
 * Run: npm run test:synth
 */
import { DEFAULT_SYNTH, Synth, arpSequence, midiToHz, midiToName } from '../src/audio/synth'
import { KEYS, OCTAVE_DOWN, OCTAVE_UP } from '../src/ui/Keyboard'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`)
}

// --- Tuning ----------------------------------------------------------------
console.log('\n--- TUNING: equal temperament, A440 ---')
{
  const known: [number, number, string][] = [
    [69, 440, 'A4'],
    [60, 261.6256, 'C4'],
    [57, 220, 'A3'],
    [81, 880, 'A5'],
    [21, 27.5, 'A0'],
    [108, 4186.009, 'C8'],
  ]
  for (const [midi, hz, name] of known) {
    const got = midiToHz(midi)
    const cents = 1200 * Math.log2(got / hz)
    check(
      `MIDI ${midi} is ${name}`,
      Math.abs(cents) < 0.01 && midiToName(midi) === name,
      `${got.toFixed(3)} Hz, named ${midiToName(midi)}`,
    )
  }

  // An octave has to be exactly a doubling, or every harmonic reading is off.
  let worst = 0
  for (let m = 21; m <= 96; m++) {
    worst = Math.max(worst, Math.abs(midiToHz(m + 12) / midiToHz(m) - 2))
  }
  check('an octave is exactly 2x', worst < 1e-12, `worst deviation ${worst.toExponential(1)}`)
}

// --- Keyboard layout -------------------------------------------------------
console.log('\n--- KEYBOARD: two octaves, correctly shaped ---')
{
  const white = KEYS.filter((k) => !k.black)
  const black = KEYS.filter((k) => k.black)

  check(
    'spans two octaves, C to C',
    KEYS.length === 25 && KEYS[0].semitone === 0 && KEYS[24].semitone === 24,
    `${KEYS.length} keys, semitone 0 to ${KEYS[KEYS.length - 1].semitone}`,
  )
  check(
    'fifteen naturals and ten sharps',
    white.length === 15 && black.length === 10,
    `${white.length} white, ${black.length} black`,
  )
  // Black keys must land on 1, 3, 6, 8, 10 within *every* octave, or the
  // keyboard stops being a keyboard past the first twelve keys.
  check(
    'sharps sit on the right semitones in both octaves',
    black.every((k) => [1, 3, 6, 8, 10].includes(k.semitone % 12)),
    black.map((k) => k.semitone).join(', '),
  )
  check(
    'every key has a distinct computer key',
    new Set(KEYS.map((k) => k.code)).size === KEYS.length,
    `${KEYS.length} unique codes`,
  )
  check(
    'octave shift keys are not notes',
    !KEYS.some((k) => k.code === OCTAVE_DOWN || k.code === OCTAVE_UP),
    `"${OCTAVE_DOWN}" and "${OCTAVE_UP}" are free`,
  )

  // Black key positions are generated from a running white-key count, so an
  // off-by-one anywhere would put a sharp over the wrong seam. They must climb
  // monotonically and stay inside the keyboard.
  const offsets = black.map((k) => k.offset ?? -1)
  check(
    'sharps are positioned in order across the whole keyboard',
    offsets.every((o, i) => o > 0 && o < 100 && (i === 0 || o > offsets[i - 1])),
    offsets.map((o) => o.toFixed(1)).join(' '),
  )
  // A sharp sits on the seam after n white keys, so its position is n/15 of the
  // width. C#, the first, follows exactly one white key.
  check(
    'the first sharp sits one white key in',
    Math.abs((offsets[0] ?? 0) - 100 / 15) < 0.01,
    `${offsets[0]?.toFixed(2)}% against ${(100 / 15).toFixed(2)}%`,
  )
}

// --- Arpeggiator -----------------------------------------------------------
console.log('\n--- ARPEGGIATOR: pattern order ---')
{
  const chord = [60, 64, 67] // C major
  const seq = (mode: 'up' | 'down' | 'updown' | 'random', octaves = 1) =>
    arpSequence(chord, { arpMode: mode, arpOctaves: octaves })

  check('up is ascending', seq('up').join(',') === '60,64,67', seq('up').join(' '))
  check('down is descending', seq('down').join(',') === '67,64,60', seq('down').join(' '))

  // The turn must not repeat its endpoints, or the top and bottom notes stutter.
  const ud = seq('updown')
  check(
    'up-down does not repeat endpoints',
    ud.join(',') === '60,64,67,64',
    `${ud.join(' ')} (a naive reverse would give 60 64 67 67 64 60)`,
  )

  const two = seq('up', 2)
  check(
    'octaves stack the whole chord',
    two.join(',') === '60,64,67,72,76,79',
    two.join(' '),
  )

  // Unsorted input is still played in pitch order: which key was pressed first
  // should not change the pattern.
  check(
    'input order does not matter',
    arpSequence([67, 60, 64], { arpMode: 'up', arpOctaves: 1 }).join(',') === '60,64,67',
    'pressed 67, 60, 64 -> 60 64 67',
  )

  check('a single note is a single step', seq('updown').length > 0 && arpSequence([60], { arpMode: 'updown', arpOctaves: 1 }).join(',') === '60', 'no phantom steps')
  check('no notes is no pattern', arpSequence([], { arpMode: 'up', arpOctaves: 1 }).length === 0, 'empty in, empty out')

  // Random draws from the same set, so it can never sound a note not held.
  const pool = new Set(seq('random'))
  check(
    'random draws only from held notes',
    [...pool].every((n) => chord.includes(n)),
    `pool ${[...pool].join(' ')}`,
  )
}

// --- Latch -----------------------------------------------------------------
// The note-set bookkeeping runs without an AudioContext (the context guards sit
// on the sound, not the sets), so latch semantics are checkable here.
console.log('\n--- LATCH: a toggle, not an accumulator ---')
{
  const s = new Synth()
  s.update({ ...DEFAULT_SYNTH, enabled: true, arpOn: true, arpLatch: true })

  const press = (m: number) => {
    s.noteOn(m)
    s.noteOff(m)
  }
  press(60)
  press(64)
  press(67)
  check(
    'released keys stay in the pattern',
    [...s.sounding].join() === '60,64,67',
    [...s.sounding].join(' '),
  )

  press(64)
  check(
    'pressing a latched note again removes it',
    [...s.sounding].join() === '60,67',
    `${[...s.sounding].join(' ')} (the only note-off a latched note can have)`,
  )

  press(64)
  check(
    'a removed note can be latched back',
    [...s.sounding].join() === '60,67,64',
    [...s.sounding].join(' '),
  )

  press(60)
  press(67)
  press(64)
  check('emptying the latch empties the pattern', s.sounding.size === 0, 'no stuck notes')
}

// --- Defaults --------------------------------------------------------------
console.log('\n--- DEFAULTS: sane and quiet on arrival ---')
{
  const d = DEFAULT_SYNTH
  check('starts disabled', d.enabled === false, 'an extension that makes noise on open is hostile')
  check('level leaves headroom', d.level > 0 && d.level <= 0.7, `${d.level}`)
  check('cutoff is audible', d.cutoff > 200 && d.cutoff < 20000, `${d.cutoff} Hz`)
  check('envelope times are positive', d.attack > 0 && d.release > 0, `A ${d.attack}s R ${d.release}s`)
  check('sustain is a level, not a time', d.sustain >= 0 && d.sustain <= 1, `${d.sustain}`)
  check(
    'effects are dry by default',
    d.delayMix === 0 && d.reverbMix === 0,
    'test equipment first: reverb would smear the waveforms it exists to show',
  )
  check(
    'delay feedback cannot regenerate forever',
    d.delayFeedback < 1,
    `${d.delayFeedback} (unity feedback never fades)`,
  )
}

// --- Recovery -------------------------------------------------------------
console.log('\n--- RECOVERY: rebuilding the graph preserves performance state ---')
{
  class Param {
    value = 0
    setTargetAtTime(value: number) { this.value = value }
    setValueAtTime(value: number) { this.value = value }
    linearRampToValueAtTime(value: number) { this.value = value }
    cancelScheduledValues() {}
  }
  class Node {
    gain = new Param()
    frequency = new Param()
    detune = new Param()
    Q = new Param()
    delayTime = new Param()
    threshold = new Param()
    knee = new Param()
    ratio = new Param()
    attack = new Param()
    release = new Param()
    type = ''
    connect() { return this }
    disconnect() {}
    start() {}
    stop() {}
  }
  class Context {
    currentTime = 0
    sampleRate = 48000
    createGain() { return new Node() }
    createOscillator() { return new Node() }
    createBiquadFilter() { return new Node() }
    createDelay() { return new Node() }
    createConvolver() { return new Node() }
    createBuffer(channels: number, length: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return { getChannelData: (channel: number) => data[channel] }
    }
    createDynamicsCompressor() { return new Node() }
  }

  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  const ctx = new Context() as unknown as AudioContext
  const destination = new Node() as unknown as AudioNode

  const arp = new Synth()
  arp.connect(ctx, destination)
  const arpSettings = { ...DEFAULT_SYNTH, enabled: true, arpOn: true, arpLatch: true }
  arp.update(arpSettings)
  arp.noteOn(60)
  arp.noteOff(60)
  const arpState = arp as unknown as { arpTimer: number | null }
  const before = arpState.arpTimer
  arp.update({ ...arpSettings, cutoff: 3300 })
  check(
    'an unrelated parameter edit leaves the arp clock alone',
    before !== null && arpState.arpTimer === before,
    'filter cutoff did not restart or clear the interval',
  )
  arp.recover()
  check(
    'recovery restarts a latched arpeggiator',
    before !== null && arpState.arpTimer !== null && arp.sounding.has(60),
    'Run still has a clock and its latched C4',
  )
  arp.dispose()

  const sustained = new Synth()
  sustained.connect(ctx, destination)
  sustained.update({ ...DEFAULT_SYNTH, enabled: true })
  sustained.noteOn(64)
  const voiceState = sustained as unknown as { voices: Map<number, unknown> }
  sustained.recover()
  check(
    'recovery recreates an ordinary held voice',
    voiceState.voices.has(64),
    'held E4 was rebuilt after the suspect filter was discarded',
  )
  sustained.noteOff(64)
  sustained.dispose()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
