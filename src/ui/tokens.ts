/**
 * Design tokens. Structure follows browser-fx's src/theme.ts; the palette is
 * deliberately cooler and slightly lighter, because test gear is grey-blue while
 * an Ableton device is neutral grey. See docs/06-design-system.md.
 */

export const surface = {
  void: '#08090a',
  chassis: '#16181b',
  rail: '#1d2024',
  control: '#252930',
  raised: '#2e333b',
  line: '#0b0c0e',
  hairline: 'rgba(255,255,255,0.06)',
  highlight: 'rgba(255,255,255,0.05)',
} as const

export const text = {
  primary: '#dfe3e8',
  legend: '#8b939d',
  faint: '#5a626c',
} as const

export const status = {
  live: '#3ddc84',
  idle: '#4a525c',
  error: '#ff6b5e',
} as const

export type PhosphorId = 'p31' | 'p7' | 'p1'

/** `bloom` is the core hue desaturated toward white: what a saturating phosphor does. */
export const phosphor: Record<PhosphorId, { core: string; bloom: string; label: string; rgb: [number, number, number] }> = {
  p31: { core: '#2bff6a', bloom: '#a9ffc4', label: 'P31 GREEN', rgb: [43, 255, 106] },
  p7: { core: '#a8d8ff', bloom: '#e8f4ff', label: 'P7 BLUE', rgb: [168, 216, 255] },
  p1: { core: '#ffb340', bloom: '#ffe0b0', label: 'P1 AMBER', rgb: [255, 179, 64] },
}

export type ThemeId = 'dark' | 'tek'

/**
 * Canvas-side theme values. The CSS chrome mirrors these in styles.css; keep the
 * two in step.
 *
 * The Tek screen is **not** blue. Reference photographs of a powered-off 2236
 * show a blue-cyan face because an unlit CRT behind an anti-glare filter is
 * reflecting the room. In use the face reads as a creamy dark grey-green, which
 * is what this is. Lighter than the dark theme's near-black, warmer, and still
 * dark enough that an emissive trace carries.
 */
export const screenTheme: Record<
  ThemeId,
  { screen: string; graticule: string; graticuleMajor: string; vignette: number }
> = {
  dark: {
    screen: '#050807',
    graticule: 'rgba(150,190,210,0.13)',
    graticuleMajor: 'rgba(150,190,210,0.22)',
    vignette: 0.55,
  },
  tek: {
    screen: '#171b16',
    // Warm grey-green rather than the dark theme's cool blue-white, matching an
    // internal graticule lit by the scale illumination.
    graticule: 'rgba(198,208,182,0.15)',
    graticuleMajor: 'rgba(198,208,182,0.27)',
    // A bench instrument under room light has far less falloff than a dark room.
    vignette: 0.3,
  },
}

export type CymaticPaletteId = 'slate' | 'ink'

/**
 * Two registers, not two tints. Slate is a dark plate under warm sand; Ink is
 * near-white with near-black grains and reads like a laboratory photograph.
 * `up` and `down` tint the plate by signed displacement - light on a moving
 * surface, not a heat map, so they stay very low alpha.
 */
export const cymatic: Record<
  CymaticPaletteId,
  {
    label: string
    void: string
    plate: string
    plateEdge: string
    grain: [number, number, number]
    rim: string
    up: [number, number, number]
    down: [number, number, number]
  }
> = {
  slate: {
    label: 'SLATE',
    void: '#07080a',
    plate: '#181b1f',
    plateEdge: '#0e1013',
    grain: [242, 236, 224],
    rim: 'rgba(255,255,255,0.10)',
    up: [120, 180, 230],
    down: [230, 160, 110],
  },
  ink: {
    label: 'INK',
    void: '#d8d4cc',
    plate: '#ebe7df',
    plateEdge: '#cdc8bd',
    grain: [20, 16, 12],
    rim: 'rgba(0,0,0,0.14)',
    up: [70, 110, 160],
    down: [170, 100, 60],
  },
}

export const font = {
  ui: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

export const motion = {
  fast: '110ms cubic-bezier(0.2, 0, 0.2, 1)',
  considered: '260ms cubic-bezier(0.16, 1, 0.3, 1)',
} as const
