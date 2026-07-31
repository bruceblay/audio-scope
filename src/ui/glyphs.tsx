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

/**
 * Disclosure chevrons, pointing the way the panel will travel: down to fold the
 * control rail away, up to bring it back.
 */
/** Floppy disk, browser-fx's drawing: the presets button. */
export const DiskGlyph = () => (
  <svg
    {...base}
    strokeWidth={1.5}
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.6 2.6h8.3l2.5 2.5v8.3H2.6z" />
    <path d="M5.6 2.6v3.3h4.4V2.6" />
    <path d="M5.2 13.4V9.6h5.6v3.8" />
  </svg>
)

export const ChevronDown = () => (
  <svg {...base} width="13" height="13" strokeWidth={2} aria-hidden="true">
    <path d="M4 6.5l4 4 4-4" strokeLinejoin="round" />
  </svg>
)

export const ChevronUp = () => (
  <svg {...base} width="13" height="13" strokeWidth={2} aria-hidden="true">
    <path d="M4 9.5l4-4 4 4" strokeLinejoin="round" />
  </svg>
)
