/** Small state-machine regressions that do not need a browser DOM. */
import { HeldKeyboardNotes } from '../src/ui/Keyboard'
import { applyPreset, type Preset } from '../src/sidepanel/presets'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`)
}

console.log('\n--- KEYBOARD: note-off releases the note that started ---')
{
  const held = new HeldKeyboardNotes()
  check('first keydown starts a note', held.press('z', 48), 'Z started C3')
  check('key repeat does not retrigger', !held.press('z', 60), 'repeat ignored after octave change')
  check(
    'keyup keeps the note-on octave',
    held.release('z') === 48,
    'released C3 even though the current root could now be C4',
  )
  check('a second keyup is harmless', held.release('z') === null, 'no duplicate note-off')

  held.press('q', 60)
  held.press('w', 62)
  check('blur releases every exact note', held.releaseAll().join(',') === '60,62', 'released 60, 62')
}

console.log('\n--- PRESETS: legacy invisible state is discarded ---')
{
  const legacy: Preset = {
    id: 'legacy',
    name: 'Legacy X-Y',
    mode: 'scope',
    scope: { channel: 'xy', xyExposure: 4096 } as Preset['scope'] & { xyExposure: number },
    analyzer: {},
  }
  const applied = applyPreset(legacy)
  check(
    'xyExposure does not survive loading',
    !('xyExposure' in applied.scope),
    'old stored field removed before dirty-state comparison',
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
