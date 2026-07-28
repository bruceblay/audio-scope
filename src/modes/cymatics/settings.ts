import type { Surface } from './plate'

/** Sand collects at nodes. Fine powder in air streams to antinodes instead. */
export type Grain = 'sand' | 'powder'
export type Palette = 'slate' | 'ink'

export const GRAIN_COUNTS = [5000, 12000, 30000] as const

export interface CymaticsSettings {
  surface: Surface
  /** The plate's fundamental in Hz. Sets the whole mode spectrum. */
  plateHz: number
  /** Quality factor. Low is rubber and broad, high is steel and sharp. */
  q: number
  /** 0 = center (only axially symmetric modes), 1 = rim. */
  driveRadius: number
  driveAngle: number
  /** Fold the detected pitch into the plate's displayable range by octaves. */
  fold: boolean
  /** Scale the plate so the note lands on a resonance. See ExciteOptions.tune. */
  tune: boolean
  grain: Grain
  grainCount: number
  palette: Palette
  /** Show the signed displacement as a faint tint under the grains. */
  sheen: boolean
}

export const DEFAULT_CYMATICS_SETTINGS: CymaticsSettings = {
  surface: 'plate',
  plateHz: 110,
  q: 180,
  driveRadius: 0.62,
  driveAngle: 0,
  fold: true,
  tune: true,
  grain: 'sand',
  grainCount: 12000,
  palette: 'slate',
  sheen: true,
}

export interface CymaticsReadout {
  hz: number
  note: string
  cents: number
  confidence: number
  /** e.g. "J2,3" for a circular membrane, "3,5" for a square plate. */
  mode: string
  modeHz: number
  fold: number
  /** Semitones the plate was retuned by to land on a resonance. */
  detune: number
  /** Fraction of grains below the liftoff threshold. Rises as a pattern resolves. */
  settled: number
  grains: number
}
