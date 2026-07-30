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
import { DEFAULT_SYNTH, arpSequence, midiToHz, midiToName } from '../src/audio/synth'
import { KEYS } from '../src/ui/Keyboard'

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
console.log('\n--- KEYBOARD: one octave, correctly shaped ---')
{
  check('spans C to C', KEYS[0].semitone === 0 && KEYS[KEYS.length - 1].semitone === 12, `${KEYS.length} keys`)
  check(
    'seven naturals and five sharps',
    KEYS.filter((k) => !k.black).length === 8 && KEYS.filter((k) => k.black).length === 5,
    `${KEYS.filter((k) => !k.black).length} white (7 + the octave), 5 black`,
  )
  // The black keys have to land on the right semitones or the keyboard is not a
  // keyboard: 1, 3, 6, 8, 10 within the octave.
  check(
    'sharps sit on the right semitones',
    KEYS.filter((k) => k.black)
      .map((k) => k.semitone)
      .join(',') === '1,3,6,8,10',
    KEYS.filter((k) => k.black).map((k) => k.semitone).join(', '),
  )
  check(
    'every key has a distinct computer key',
    new Set(KEYS.map((k) => k.code)).size === KEYS.length,
    `${KEYS.length} unique codes`,
  )
  // Z and X shift octaves, so neither may also be a note.
  check(
    'octave shift keys are not notes',
    !KEYS.some((k) => k.code === 'z' || k.code === 'x'),
    'z and x are free',
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

// --- Defaults --------------------------------------------------------------
console.log('\n--- DEFAULTS: sane and quiet on arrival ---')
{
  const d = DEFAULT_SYNTH
  check('starts disabled', d.enabled === false, 'an extension that makes noise on open is hostile')
  check('level leaves headroom', d.level > 0 && d.level <= 0.7, `${d.level}`)
  check('cutoff is audible', d.cutoff > 200 && d.cutoff < 20000, `${d.cutoff} Hz`)
  check('envelope times are positive', d.attack > 0 && d.release > 0, `A ${d.attack}s R ${d.release}s`)
  check('sustain is a level, not a time', d.sustain >= 0 && d.sustain <= 1, `${d.sustain}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
