// Small numeric helpers shared by the audio engine and the render modes.

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Convert a coefficient tuned at 60 Hz into the equivalent coefficient for dt. */
export const frameCoeff = (at60Hz: number, dt: number) =>
  1 - Math.pow(1 - clamp(at60Hz, 0, 1), Math.max(0, dt) * 60)

/** One-pole follower with frame-rate-independent attack and release. */
export const follow = (
  current: number,
  target: number,
  attack: number,
  release: number,
  dt = 1 / 60,
) => {
  const coefficient = frameCoeff(target > current ? attack : release, dt)
  return current + (target - current) * coefficient
}

/** Frame-rate independent exponential decay toward zero over `tau` seconds. */
export const decayCoeff = (dt: number, tau: number) =>
  tau <= 0 ? 1 : 1 - Math.exp(-dt / tau)

export const dbToLinear = (db: number) => Math.pow(10, db / 20)
export const linearToDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-9))

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface NoteName {
  /** Nearest equal-tempered note, e.g. "A4" */
  name: string
  /** Signed deviation from that note in cents, -50..+50 */
  cents: number
  /** Fractional MIDI note number */
  midi: number
}

/**
 * Equal temperament against a reference pitch (A440 by default). A configurable
 * reference matters for non-A440 material; see docs/07-plan.md.
 */
export function hzToNote(hz: number, referenceHz = 440): NoteName {
  if (!(hz > 0)) return { name: '--', cents: 0, midi: 0 }
  const midi = 69 + 12 * Math.log2(hz / referenceHz)
  const nearest = Math.round(midi)
  const cents = Math.round((midi - nearest) * 100)
  const name = NOTE_NAMES[((nearest % 12) + 12) % 12] + (Math.floor(nearest / 12) - 1)
  return { name, cents, midi }
}

/** Format a duration in seconds with the unit a scope would print. */
export function formatSeconds(s: number): string {
  const a = Math.abs(s)
  if (a < 1e-6) return `${(s * 1e9).toFixed(0)}ns`
  if (a < 1e-3) return `${(s * 1e6).toPrecision(3)}µs`
  if (a < 1) return `${(s * 1e3).toPrecision(3)}ms`
  return `${s.toPrecision(3)}s`
}

/** Format a frequency the way a bench instrument would. */
export function formatHz(hz: number): string {
  if (!(hz > 0) || !Number.isFinite(hz)) return '--'
  if (hz >= 10000) return `${(hz / 1000).toFixed(2)}kHz`
  if (hz >= 1000) return `${(hz / 1000).toFixed(3)}kHz`
  if (hz >= 100) return `${hz.toFixed(1)}Hz`
  return `${hz.toFixed(2)}Hz`
}
