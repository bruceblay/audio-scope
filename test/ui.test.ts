/** Small state-machine regressions that do not need a browser DOM. */
import { HeldKeyboardNotes, HeldPointerNotes } from '../src/ui/Keyboard'
import { applyPreset, type Preset } from '../src/sidepanel/presets'
import { resolveCaptureTarget, type TabTarget } from '../src/audio/capture'

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`)
}

console.log('\n--- POINTER KEYBOARD: leaving a key ends its exact note ---')
{
  const held = new HeldPointerNotes()
  check('pointer down starts one note', held.press(7, 60), 'pointer 7 started C4')
  check(
    'pointer leave releases the note-on pitch',
    held.release(7) === 60,
    'released C4 without recomputing from the current octave',
  )
  check('drag-enter can start the next key', held.press(7, 62), 'same pointer started D4')
  check('pointer up releases the dragged-to key', held.release(7) === 62, 'released D4')
  check('duplicate pointer end is harmless', held.release(7) === null, 'no duplicate note-off')
  held.press(8, 64)
  held.press(9, 67)
  check('blur releases every pointer note', held.releaseAll().join(',') === '64,67', 'released E4, G4')
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

console.log('\n--- CAPTURE: manual connect uses the live active tab ---')
{
  const previous: TabTarget = { id: 1, title: 'Old', host: 'old.test', audible: true }
  const active: TabTarget = { id: 2, title: 'New', host: 'new.test', audible: true }
  let activeReads = 0
  let idReads = 0
  const readActive = async () => {
    activeReads++
    return active
  }
  const readById = async (id: number) => {
    idReads++
    return id === previous.id ? previous : null
  }

  const manual = await resolveCaptureTarget(undefined, readActive, readById)
  check(
    'manual Connect resolves the active tab',
    manual?.id === active.id && activeReads === 1 && idReads === 0,
    `selected tab ${manual?.id}, ignored cached tab ${previous.id}`,
  )

  const automatic = await resolveCaptureTarget(previous.id, readActive, readById)
  check(
    'automatic recovery honors its explicit tab',
    automatic?.id === previous.id && activeReads === 1 && idReads === 1,
    `selected explicit tab ${automatic?.id}`,
  )
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
