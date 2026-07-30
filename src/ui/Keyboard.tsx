import { useEffect, useRef } from 'react'
import { midiToName } from '../audio/synth'

/**
 * One-octave chromatic keyboard, following the layout mcp-2000 uses: white keys
 * in a row, black keys absolutely positioned over the seams, and the computer
 * key printed on each so it can be played without a mouse.
 */

interface Key {
  semitone: number
  black: boolean
  /** Computer key that plays it. */
  code: string
  /** Position along the octave, as a percentage, for the black keys. */
  offset?: number
}

/**
 * Home row for the naturals, the row above for the sharps - the same shape as
 * every tracker and DAW, so it needs no learning.
 */
export const KEYS: Key[] = [
  { semitone: 0, black: false, code: 'a' },
  { semitone: 1, black: true, code: 'w', offset: 12.5 },
  { semitone: 2, black: false, code: 's' },
  { semitone: 3, black: true, code: 'e', offset: 25 },
  { semitone: 4, black: false, code: 'd' },
  { semitone: 5, black: false, code: 'f' },
  { semitone: 6, black: true, code: 't', offset: 50 },
  { semitone: 7, black: false, code: 'g' },
  { semitone: 8, black: true, code: 'y', offset: 62.5 },
  { semitone: 9, black: false, code: 'h' },
  { semitone: 10, black: true, code: 'u', offset: 75 },
  { semitone: 11, black: false, code: 'j' },
  { semitone: 12, black: false, code: 'k' },
]

const BY_CODE = new Map(KEYS.map((k) => [k.code, k]))

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

  useEffect(() => {
    // Tracks which computer keys are down, because keydown repeats while held
    // and would retrigger the note dozens of times a second.
    const down = new Set<string>()

    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const keyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const code = e.key.toLowerCase()
      if (code === 'z' || code === 'x') {
        shiftRef.current(code === 'z' ? -1 : 1)
        e.preventDefault()
        return
      }
      const key = BY_CODE.get(code)
      if (!key || down.has(code)) return
      down.add(code)
      onRef.current(rootRef.current + key.semitone)
      e.preventDefault()
    }

    const keyUp = (e: KeyboardEvent) => {
      const code = e.key.toLowerCase()
      const key = BY_CODE.get(code)
      if (!key || !down.has(code)) return
      down.delete(code)
      offRef.current(rootRef.current + key.semitone)
    }

    // A key held while the panel loses focus never sends keyup, so the note
    // would hang until it happened to be pressed again.
    const blur = () => {
      for (const code of down) {
        const key = BY_CODE.get(code)
        if (key) offRef.current(rootRef.current + key.semitone)
      }
      down.clear()
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      blur()
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const whites = KEYS.filter((k) => !k.black)
  const blacks = KEYS.filter((k) => k.black)

  const press = (e: React.PointerEvent, midi: number) => {
    // Capture, so a drag off the key still delivers its pointerup here and the
    // note cannot hang.
    e.currentTarget.setPointerCapture(e.pointerId)
    onNoteOn(midi)
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
              onPointerUp={() => onNoteOff(midi)}
              onPointerCancel={() => onNoteOff(midi)}
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
              style={{ left: `${k.offset}%` }}
              aria-label={midiToName(midi)}
              onPointerDown={(e) => press(e, midi)}
              onPointerUp={() => onNoteOff(midi)}
              onPointerCancel={() => onNoteOff(midi)}
            >
              <span className="key-code">{k.code}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
