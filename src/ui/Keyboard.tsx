import { useEffect, useRef } from 'react'
import { midiToName } from '../audio/synth'

/**
 * Two-octave chromatic keyboard, following the layout mcp-2000 uses: white keys
 * in a row, black keys absolutely positioned over the seams, and the computer
 * key printed on each so it can be played without a mouse.
 */

interface Key {
  semitone: number
  black: boolean
  /** Computer key that plays it. */
  code: string
  /** Left edge as a percentage of the keyboard, for the black keys. */
  offset?: number
}

/**
 * The tracker layout, which is also what most DAWs use: the lower octave on the
 * bottom two rows and the upper octave on the top two, naturals below sharps in
 * each pair. Two octaves rather than one, because a single octave runs out
 * immediately and there is width for more.
 *
 * Octave shift moves to `-` and `=`. Z and X are the usual keys for it, but here
 * they are the bottom octave's C and D.
 */
const LOWER = ['z', 's', 'x', 'd', 'c', 'v', 'g', 'b', 'h', 'n', 'j', 'm']
const UPPER = ['q', '2', 'w', '3', 'e', 'r', '5', 't', '6', 'y', '7', 'u']
export const OCTAVE_DOWN = '-'
export const OCTAVE_UP = '='

/** Semitones within an octave that are black keys. */
const BLACK = new Set([1, 3, 6, 8, 10])

/**
 * Build the key list, positioning black keys as a percentage of the whole
 * keyboard.
 *
 * A black key sits over the seam between two whites, so its position depends on
 * how many white keys precede it across *all* octaves - which is why this is
 * generated rather than a table of hard-coded percentages like the one-octave
 * version had.
 */
function buildKeys(): Key[] {
  const codes = [...LOWER, ...UPPER, 'i']
  const keys: Key[] = []
  let whites = 0
  for (let i = 0; i < codes.length; i++) {
    const black = BLACK.has(i % 12)
    keys.push({ semitone: i, black, code: codes[i], offset: black ? whites : undefined })
    if (!black) whites++
  }
  // Second pass: `whites` is now the total, so the boundaries can be scaled.
  for (const key of keys) {
    if (key.offset !== undefined) key.offset = (key.offset / whites) * 100
  }
  return keys
}

export const KEYS = buildKeys()

const BY_CODE = new Map(KEYS.map((k) => [k.code, k]))

/**
 * Notes started by computer keys, recorded at note-on pitch.
 *
 * The keyboard root can change while a key is held. Recomputing the MIDI note
 * from the new root at key-up releases a different voice and leaves the
 * original hanging, so the exact note-on value travels with the key until it
 * is released.
 */
export class HeldKeyboardNotes {
  private readonly notes = new Map<string, number>()

  press(code: string, midi: number): boolean {
    if (this.notes.has(code)) return false
    this.notes.set(code, midi)
    return true
  }

  release(code: string): number | null {
    const midi = this.notes.get(code)
    if (midi === undefined) return null
    this.notes.delete(code)
    return midi
  }

  releaseAll(): number[] {
    const notes = [...this.notes.values()]
    this.notes.clear()
    return notes
  }
}

/** Notes begun by pointer id, so release never depends on a later render's root note. */
export class HeldPointerNotes {
  private readonly notes = new Map<number, number>()

  press(pointerId: number, midi: number): boolean {
    if (this.notes.has(pointerId)) return false
    this.notes.set(pointerId, midi)
    return true
  }

  release(pointerId: number): number | null {
    const midi = this.notes.get(pointerId)
    if (midi === undefined) return null
    this.notes.delete(pointerId)
    return midi
  }

  releaseAll(): number[] {
    const notes = [...this.notes.values()]
    this.notes.clear()
    return notes
  }
}

export function Keyboard({
  root,
  sounding,
  onNoteOn,
  onNoteOff,
  onOctaveShift,
}: {
  /** MIDI note of the leftmost key. */
  root: number
  sounding: Set<number>
  onNoteOn: (midi: number) => void
  onNoteOff: (midi: number) => void
  onOctaveShift: (delta: number) => void
}) {
  // Held in refs so the key listener can stay mounted for the life of the panel
  // instead of rebinding on every render.
  const rootRef = useRef(root)
  const onRef = useRef(onNoteOn)
  const offRef = useRef(onNoteOff)
  const shiftRef = useRef(onOctaveShift)
  rootRef.current = root
  onRef.current = onNoteOn
  offRef.current = onNoteOff
  shiftRef.current = onOctaveShift
  const pointerNotes = useRef(new HeldPointerNotes())

  const releasePointer = (pointerId: number) => {
    const midi = pointerNotes.current.release(pointerId)
    if (midi !== null) offRef.current(midi)
  }

  useEffect(() => {
    // Tracks which computer keys are down, because keydown repeats while held
    // and would retrigger the note dozens of times a second.
    const down = new HeldKeyboardNotes()

    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const keyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const code = e.key.toLowerCase()
      if (code === OCTAVE_DOWN || code === OCTAVE_UP) {
        shiftRef.current(code === OCTAVE_UP ? 1 : -1)
        e.preventDefault()
        return
      }
      const key = BY_CODE.get(code)
      if (!key) return
      const midi = rootRef.current + key.semitone
      if (!down.press(code, midi)) return
      onRef.current(midi)
      e.preventDefault()
    }

    const keyUp = (e: KeyboardEvent) => {
      const code = e.key.toLowerCase()
      const midi = down.release(code)
      if (midi === null) return
      offRef.current(midi)
    }

    // A key held while the panel loses focus never sends keyup, so the note
    // would hang until it happened to be pressed again.
    const blur = () => {
      for (const midi of down.releaseAll()) offRef.current(midi)
      for (const midi of pointerNotes.current.releaseAll()) offRef.current(midi)
    }

    // A pointer released outside a key—or outside the side panel entirely—may
    // skip that button's React handler. The window-level end is the backstop.
    const pointerEnd = (e: PointerEvent) => releasePointer(e.pointerId)

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('pointerup', pointerEnd)
    window.addEventListener('pointercancel', pointerEnd)
    window.addEventListener('blur', blur)
    return () => {
      blur()
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerEnd)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const whites = KEYS.filter((k) => !k.black)
  const blacks = KEYS.filter((k) => k.black)
  // Black keys are a fixed fraction of a white key, so their width follows the
  // white count rather than being a constant percentage.
  const blackWidth = (100 / whites.length) * 0.62

  const press = (e: React.PointerEvent, midi: number) => {
    if (e.button !== 0) return
    // Do not capture the pointer. A piano key is held only while the pointer is
    // physically over it; capture made dragging away look like a stuck note.
    // Touch browsers may apply implicit capture before pointerdown is delivered.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (pointerNotes.current.press(e.pointerId, midi)) onRef.current(midi)
    e.preventDefault()
  }

  const enter = (e: React.PointerEvent, midi: number) => {
    // Dragging across the keyboard becomes a glissando: leave releases the old
    // key and enter starts the new one while the primary button remains held.
    if ((e.buttons & 1) !== 0 && pointerNotes.current.press(e.pointerId, midi)) {
      onRef.current(midi)
    }
  }

  return (
    <div className="keys" role="group" aria-label="Synth keyboard">
      <div className="keys-white">
        {whites.map((k) => {
          const midi = root + k.semitone
          return (
            <button
              key={k.semitone}
              type="button"
              className={sounding.has(midi) ? 'key key-white is-on' : 'key key-white'}
              aria-label={midiToName(midi)}
              onPointerDown={(e) => press(e, midi)}
              onPointerEnter={(e) => enter(e, midi)}
              onPointerLeave={(e) => releasePointer(e.pointerId)}
              onPointerUp={(e) => releasePointer(e.pointerId)}
              onPointerCancel={(e) => releasePointer(e.pointerId)}
            >
              <span className="key-code">{k.code}</span>
            </button>
          )
        })}
      </div>
      <div className="keys-black">
        {blacks.map((k) => {
          const midi = root + k.semitone
          return (
            <button
              key={k.semitone}
              type="button"
              className={sounding.has(midi) ? 'key key-black is-on' : 'key key-black'}
              style={{ left: `${k.offset}%`, width: `${blackWidth}%` }}
              aria-label={midiToName(midi)}
              onPointerDown={(e) => press(e, midi)}
              onPointerEnter={(e) => enter(e, midi)}
              onPointerLeave={(e) => releasePointer(e.pointerId)}
              onPointerUp={(e) => releasePointer(e.pointerId)}
              onPointerCancel={(e) => releasePointer(e.pointerId)}
            >
              <span className="key-code">{k.code}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
