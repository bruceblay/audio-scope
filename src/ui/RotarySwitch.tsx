import { useCallback, useRef } from 'react'

/**
 * A detented rotary switch with its scale printed around the dial.
 *
 * This is the Tektronix front-panel gesture: TIME/DIV and VOLTS/DIV are not
 * sliders or steppers on a real scope, they are switches with the 1-2-5 sequence
 * silkscreened in an arc around the knob, and the pointer tells you where you
 * are at a glance. We already step through exactly those sequences, so the
 * control was always the wrong shape for the data.
 *
 * Drawn as SVG rather than CSS so the arc, the ticks and the radial labels can be
 * placed by geometry instead of by transform stacking.
 */

/** Degrees of rotation, matching a real switch's roughly three-quarter sweep. */
const SWEEP = 300
const START = -SWEEP / 2

const CX = 50
const CY = 52
const KNOB_R = 23
const TICK_INNER = 29
const TICK_OUTER = 34
const LABEL_R = 42

/** Position on the dial, in SVG coordinates. 0 degrees is straight up. */
function polar(radius: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) }
}

export function RotarySwitch<T>({
  label,
  options,
  value,
  tick,
  format,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  /** Short token printed on the dial, e.g. "50m". Keep it to 3-4 characters. */
  tick: (v: T) => string
  /** Full value with units, shown under the knob. */
  format: (v: T) => string
  onChange: (v: T) => void
}) {
  const found = options.indexOf(value)
  const index = found < 0 ? 0 : found
  const step = options.length > 1 ? SWEEP / (options.length - 1) : 0
  const angle = START + index * step
  const svgRef = useRef<SVGSVGElement | null>(null)

  const select = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(options.length - 1, next))
      if (clamped !== index) onChange(options[clamped])
    },
    [index, onChange, options],
  )

  /** Map a pointer position to the nearest detent, as a real switch snaps. */
  const selectFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const px = ((clientX - rect.left) / rect.width) * 100
      const py = ((clientY - rect.top) / rect.height) * (100 * (rect.height / rect.width))
      let deg = (Math.atan2(px - CX, CY - py) * 180) / Math.PI
      // Behind the knob the sweep is dead, as it is on the real switch.
      if (deg < START) deg = deg > 180 + START ? START + SWEEP : START
      if (deg > START + SWEEP) deg = START + SWEEP
      select(Math.round((deg - START) / step))
    },
    [select, step],
  )

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    selectFromPointer(e.clientX, e.clientY)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.buttons !== 1) return
    selectFromPointer(e.clientX, e.clientY)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') select(index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') select(index - 1)
    else if (e.key === 'Home') select(0)
    else if (e.key === 'End') select(options.length - 1)
    else return
    e.preventDefault()
  }

  const pointer = polar(KNOB_R - 5, angle)
  const pointerBase = polar(6, angle)

  return (
    <div className="rotary">
      <svg
        ref={svgRef}
        viewBox="0 0 100 116"
        className="rotary-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={options.length - 1}
        aria-valuenow={index}
        aria-valuetext={format(options[index])}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        onWheel={(e) => select(index + (e.deltaY > 0 ? 1 : -1))}
      >
        {options.map((option, i) => {
          const a = START + i * step
          const inner = polar(TICK_INNER, a)
          const outer = polar(TICK_OUTER, a)
          const text = polar(LABEL_R, a)
          const active = i === index
          return (
            <g key={i} className={active ? 'rotary-pos is-active' : 'rotary-pos'}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
              {/* Clicking a printed value jumps to it, which the physical switch
                  cannot do but every user will try. */}
              <text x={text.x} y={text.y} onPointerDown={() => select(i)}>
                {tick(option)}
              </text>
            </g>
          )
        })}

        <circle className="rotary-skirt" cx={CX} cy={CY} r={KNOB_R} />
        <circle className="rotary-face" cx={CX} cy={CY} r={KNOB_R - 3.5} />
        {/* Knurling: the grip ribs around the skirt. */}
        {Array.from({ length: 36 }, (_, i) => {
          const a = i * 10
          const from = polar(KNOB_R - 0.5, a)
          const to = polar(KNOB_R - 3, a)
          return (
            <line
              key={`k${i}`}
              className="rotary-knurl"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          )
        })}
        <line
          className="rotary-pointer"
          x1={pointerBase.x}
          y1={pointerBase.y}
          x2={pointer.x}
          y2={pointer.y}
        />
        <circle className="rotary-hub" cx={CX} cy={CY} r={3} />

        <text className="rotary-legend" x={CX} y={9}>
          {label}
        </text>
        <text className="rotary-value" x={CX} y={110}>
          {format(options[index])}
        </text>
      </svg>
    </div>
  )
}
