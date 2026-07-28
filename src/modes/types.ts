import type { AudioFrame } from '../audio/types'
import type { ThemeId } from '../ui/tokens'

/**
 * Every visualization mode implements this. Renderers own a canvas and are
 * driven by the shared render loop in Stage.tsx - they never start their own
 * requestAnimationFrame and never touch Web Audio.
 */
export interface Renderer<Settings, Readout> {
  /** Device-pixel dimensions changed. Reallocate any framebuffers here. */
  resize(width: number, height: number, dpr: number): void

  /**
   * Draw one frame. Must not allocate.
   *
   * Theme is passed rather than read from a module global so it stays typed and
   * so a renderer can be driven headlessly with either look.
   */
  render(frame: AudioFrame, settings: Settings, theme: ThemeId): void

  /**
   * Values to display in the readout row. Called after render(), so it can
   * report what the renderer actually measured rather than re-deriving it.
   */
  readout(): Readout

  /** Release framebuffers and any GPU resources. */
  dispose(): void
}
