import type { ReactNode } from 'react'

/**
 * `accent` paints a colored band down the left edge. Tektronix used thin colored
 * strips to bracket related controls on the front panel; it does nothing in the
 * dark theme and carries the grouping in the bench theme.
 */
export function Group({
  title,
  accent = 'blue',
  children,
}: {
  title: string
  accent?: 'blue' | 'red' | 'green'
  children: ReactNode
}) {
  return (
    <section className="group" data-accent={accent}>
      <div className="legend group-title">{title}</div>
      {children}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="legend">{label}</span>
      {children}
    </div>
  )
}

/**
 * Discrete stepper over a fixed sequence, the way a real front panel steps
 * through a 1-2-5 range. Arrow keys work because the buttons are real buttons.
 */
export function Stepper<T>({
  options,
  value,
  format,
  onChange,
  label,
}: {
  options: readonly T[]
  value: T
  format: (v: T) => string
  onChange: (v: T) => void
  label: string
}) {
  const index = options.indexOf(value)
  const at = index < 0 ? 0 : index
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label} down`}
        disabled={at <= 0}
        onClick={() => onChange(options[at - 1])}
      >
        ◀
      </button>
      <span className="stepper-value">{format(options[at])}</span>
      <button
        type="button"
        aria-label={`${label} up`}
        disabled={at >= options.length - 1}
        onClick={() => onChange(options[at + 1])}
      >
        ▶
      </button>
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  label: string
}) {
  return (
    <input
      className="slider"
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  )
}

export function Readout({
  label,
  value,
  dim = false,
}: {
  label: string
  value: string
  dim?: boolean
}) {
  return (
    <div className="readout">
      <span className="legend">{label}</span>
      <span className="readout-value" data-dim={dim}>
        {value}
      </span>
    </div>
  )
}
