import type { PhosphorId } from '../../ui/tokens'

export type TriggerMode = 'auto' | 'normal' | 'free'
export type TriggerSlope = 'rising' | 'falling' | 'either'
export type Channel = 'left' | 'right' | 'sum' | 'xy'

/**
 * 1-2-5 sequences, as on a real front panel. Values above ~8.5ms/div exceed the
 * 4096-sample record at 48 kHz and are gated in the UI until the AudioWorklet
 * ring buffer lands (docs/03-audio-engine.md).
 */
export const TIME_PER_DIV = [
  10e-6, 20e-6, 50e-6, 100e-6, 200e-6, 500e-6, 1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3,
] as const

/**
 * "Volts" here is normalized sample amplitude where full scale is +/-1.0. That is
 * the honest unit for digital audio, so the readout says FS rather than
 * pretending to be volts.
 */
export const VOLTS_PER_DIV = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1] as const

/**
 * Samples plotted per frame in X-Y, i.e. the exposure.
 *
 * The whole 4096-sample record is 85 ms at 48 kHz, and drawing all of it means
 * looking at an 85 ms exposure of a figure that is moving - which reads as both
 * lag and scribble. A shorter exposure is what a real scope does: the beam is at
 * one place now, and persistence draws the tail.
 */
export const XY_EXPOSURE = [128, 256, 512, 1024, 2048, 4096] as const

/** Widest smoothing half-window, in samples. */
export const MAX_SMOOTH_HALF = 32

/** The standard graticule. Every real scope uses 10 x 8. */
export const DIV_X = 10
export const DIV_Y = 8

export interface ScopeSettings {
  channel: Channel
  timePerDiv: number
  voltsPerDiv: number
  /** Vertical offset in divisions. */
  positionY: number
  /** Where the trigger point sits horizontally, 0..1. Real scopes default to center. */
  positionX: number

  triggerMode: TriggerMode
  triggerSlope: TriggerSlope
  /** When true, the level tracks the signal midpoint - the continuous version of "set level to 50%". */
  triggerAuto: boolean
  /** Manual trigger level in FS, used when triggerAuto is false. */
  triggerLevel: number
  /**
   * Noise reject: the signal must move back past the trigger level by this
   * fraction of the peak-to-peak amplitude before another edge counts. Amplitude
   * based rather than time based, so it never distorts frequency measurement.
   */
  hysteresis: number

  /** X-Y only: samples drawn per frame. Lower is tighter and more current. */
  xyExposure: number
  /**
   * X-Y only, 0..1. Band-limits the deflection signals before plotting.
   *
   * Physically this is what a real scope's deflection amplifiers and finite beam
   * spot already do. Implemented as a *centred* moving average: a one-pole filter
   * would phase-shift X against Y and skew the whole figure, which on a Lissajous
   * display is not smoothing but distortion.
   */
  xySmoothing: number
  /**
   * Beam spot size, 0..1, higher is tighter. The FOCUS knob on a real scope.
   *
   * Separate from intensity on purpose, as it is on a real front panel: one sets
   * how much light the beam deposits, the other how wide it lands.
   */
  beamFocus: number

  phosphor: PhosphorId
  /** Phosphor decay time constant in seconds. */
  persistence: number
  /** Beam energy multiplier. */
  intensity: number
  graticuleBrightness: number
}

export const DEFAULT_SCOPE_SETTINGS: ScopeSettings = {
  // L+R: the ordinary triggered trace is the display everyone recognises as an
  // oscilloscope, so it is what a new user should meet first. X-Y is one click
  // away and arguably the more interesting mode on music, but it reads as
  // abstract art until you know what you are looking at.
  channel: 'sum',
  timePerDiv: 1e-3,
  voltsPerDiv: 0.1,
  positionY: 0,
  positionX: 0.5,

  triggerMode: 'auto',
  triggerSlope: 'rising',
  triggerAuto: true,
  triggerLevel: 0,
  hysteresis: 0.04,

  xyExposure: 1024,
  xySmoothing: 0.15,
  beamFocus: 0.55,

  phosphor: 'p31',
  persistence: 0.25,
  intensity: 0.85,
  graticuleBrightness: 1,
}

export interface ScopeReadout {
  /** Peak-to-peak in FS. */
  vpp: number
  /** True RMS, not vpp/2.83 - that is only correct for a sine. */
  vrms: number
  /** From trigger-crossing intervals, which beats FFT interpolation at audio rates. */
  hz: number
  period: number
  /** Fraction of the period above the trigger level, 0..1. */
  duty: number
  dbfs: number
  triggered: boolean
  triggerLevel: number
  /** Stereo correlation, shown in X-Y mode. */
  correlation: number
}
