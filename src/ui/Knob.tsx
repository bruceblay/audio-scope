import { useCallback, useRef } from 'react'

/**
 * A continuous knob, following mcp-2000's: 270 degrees of sweep from the
 * seven-o'clock position, an arc that fills as it turns, and vertical dragging.
 *
 * Knobs earn their place where sliders do not. A synth has a dozen continuous
 * parameters, and a dozen full-width slider rows is a very tall panel to scroll;
 * knobs pack four to a row and read as an instrument. That is the opposite of the
 * TIME/DIV rotary switch, where the knob was carrying a printed twelve-position
 * scale it had no room for.
 */

const SWEEP = 270
const START = 135
/** Pixels of vertical drag for the full range. Fine drag divides this. */
const TRAVEL = 160

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  if (Math.abs(to - from) < 0.5) return ''
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const a = polar(cx, cy, r, hi)
  const b = polar(cx, cy, r, lo)
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${hi - lo > 180 ? 1 : 0} 0 ${b.x} ${b.y}`
}

export function Knob({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  /** Double-click returns here. */
  reset,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  reset?: number
}) {
  const drag = useRef<{ y: number; value: number } | null>(null)

  const snap = useCallback(
    (v: number) => {
      const snapped = Math.round(v / step) * step
      return Math.min(max, Math.max(min, Number(snapped.toFixed(10))))
    },
    [min, max, step],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, value }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    // A drag only exists while the button is held. If the pointerup was missed -
    // released outside the panel, capture lost, focus stolen mid-drag - the drag
    // state would linger and every later hover would keep turning the knob, with
    // nothing held down. Buttons tells the truth on every move event, so a move
    // without a held button ends the drag no matter how the release was lost.
    if (e.buttons === 0) {
      drag.current = null
      return
    }
    // Shift is fine adjust, which matters most on cutoff and the envelope times
    // where the useful range is a small part of the sweep.
    const travel = e.shiftKey ? TRAVEL * 5 : TRAVEL
    const delta = ((drag.current.y - e.clientY) / travel) * (max - min)
    onChange(snap(drag.current.value + delta))
  }

  const end = () => {
    drag.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const coarse = (max - min) / 20
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(snap(value + step))
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(snap(value - step))
    else if (e.key === 'PageUp') onChange(snap(value + coarse))
    else if (e.key === 'PageDown') onChange(snap(value - coarse))
    else if (e.key === 'Home') onChange(min)
    else if (e.key === 'End') onChange(max)
    else return
    e.preventDefault()
  }

  const fraction = max > min ? (value - min) / (max - min) : 0
  const angle = START + fraction * SWEEP
  const cx = 20
  const cy = 20
  const r = 15
  const tip = polar(cx, cy, r - 3.5, angle)
  const base = polar(cx, cy, r - 9.5, angle)

  return (
    <div className="knob">
      <svg
        className="knob-dial"
        viewBox="0 0 40 40"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onKeyDown={onKeyDown}
        onDoubleClick={() => reset !== undefined && onChange(reset)}
        onWheel={(e) => onChange(snap(value + (e.deltaY < 0 ? step : -step)))}
      >
        <path className="knob-track" d={arc(cx, cy, r, START, START + SWEEP)} />
        {fraction > 0.004 && (
          <path className="knob-fill" d={arc(cx, cy, r, START, angle)} />
        )}
        <circle className="knob-body" cx={cx} cy={cy} r={r - 4.5} />
        <line className="knob-pointer" x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} />
      </svg>
      <span className="knob-label">{label}</span>
      <span className="knob-value">{format(value)}</span>
    </div>
  )
}
