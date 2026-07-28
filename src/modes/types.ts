import type { AudioFrame } from '../audio/types'

/**
 * Every visualization mode implements this. Renderers own a canvas and are
 * driven by the shared render loop in Stage.tsx - they never start their own
 * requestAnimationFrame and never touch Web Audio.
 */
export interface Renderer<Settings, Readout> {
  /** Device-pixel dimensions changed. Reallocate any framebuffers here. */
  resize(width: number, height: number, dpr: number): void

  /** Draw one frame. Must not allocate. */
  render(frame: AudioFrame, settings: Settings): void

  /**
   * Values to display in the readout row. Called after render(), so it can
   * report what the renderer actually measured rather than re-deriving it.
   */
  readout(): Readout

  /** Release framebuffers and any GPU resources. */
  dispose(): void
}
