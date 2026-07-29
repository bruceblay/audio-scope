/**
 * Button glyphs, drawn rather than typed.
 *
 * Centring a text character inside a circle centres its *line box*, not its ink,
 * and the two are not the same: a lowercase `i` carries ascender space above the
 * dot and none below, so it sits visibly low however the box is aligned. A `✕`
 * has the same problem from a different direction, and the two are wrong by
 * different amounts, so no single nudge fixes both.
 *
 * Drawn in a square viewBox they are geometrically centred by construction.
 * Same approach browser-fx takes for its disk icon, and for the same reason.
 *
 * All inherit `currentColor`, so the button's hover transition still works.
 */

const base = {
  width: 11,
  height: 11,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  style: { display: 'block' },
}

export const InfoGlyph = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="8" cy="3.6" r="0.35" fill="currentColor" stroke="none" />
    <path d="M8 7v5.4" />
  </svg>
)

export const CloseGlyph = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />
  </svg>
)

export const MinusGlyph = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4.2 8h7.6" />
  </svg>
)

export const PlusGlyph = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4.2 8h7.6M8 4.2v7.6" />
  </svg>
)
