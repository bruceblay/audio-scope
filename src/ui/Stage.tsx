import { useEffect, useRef } from 'react'
import type { AudioEngine } from '../audio/engine'
import { AnalyzerRenderer } from '../modes/analyzer/renderer'
import type { AnalyzerReadout, AnalyzerSettings } from '../modes/analyzer/settings'
import { CymaticsRenderer } from '../modes/cymatics/renderer'
import type { CymaticsReadout, CymaticsSettings } from '../modes/cymatics/settings'
import { ScopeRenderer } from '../modes/scope/renderer'
import type { ScopeReadout, ScopeSettings } from '../modes/scope/settings'
import type { Renderer } from '../modes/types'
import type { ThemeId } from './tokens'

export type ModeId = 'scope' | 'analyzer' | 'cymatics'

type AnySettings = ScopeSettings | CymaticsSettings | AnalyzerSettings
type AnyReadout = ScopeReadout | CymaticsReadout | AnalyzerReadout

/**
 * The canvas surface and the single render loop. One rAF drives everything:
 * read a frame of measurements, hand it to the active renderer, done.
 *
 * Settings and callbacks are held in refs so changing a control does not tear
 * down and restart the loop, and so the loop always sees the current values.
 *
 * Readouts are pushed to React on a timer rather than per frame - a setState at
 * 60 Hz would re-render the whole panel sixty times a second to update six
 * numbers.
 */
export function Stage({
  engine,
  mode,
  settings,
  theme,
  onReadout,
  children,
}: {
  engine: AudioEngine
  mode: ModeId
  settings: AnySettings
  theme: ThemeId
  onReadout: (r: AnyReadout) => void
  children?: React.ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Mode travels with the settings, in one ref, so the loop can tell whether the
  // settings it is about to hand over belong to the renderer it is holding.
  const stateRef = useRef({ mode, settings, theme })
  const readoutRef = useRef(onReadout)
  stateRef.current = { mode, settings, theme }
  readoutRef.current = onReadout

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer: Renderer<AnySettings, AnyReadout> = (
      mode === 'cymatics'
        ? new CymaticsRenderer(canvas)
        : mode === 'analyzer'
          ? new AnalyzerRenderer(canvas)
          : new ScopeRenderer(canvas)
    ) as Renderer<AnySettings, AnyReadout>

    const applySize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      renderer.resize(w, h, dpr)
    }
    applySize()

    const observer = new ResizeObserver(applySize)
    observer.observe(canvas)

    let raf = 0
    let lastPush = 0

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      // Keep the timeline advancing even on a skipped frame, so the followers
      // and frame delta stay continuous.
      const frame = engine.readFrame(now)

      const state = stateRef.current
      // Mode changes reach the refs during render, but this renderer is only
      // replaced later, when the effect re-runs. A frame scheduled in between
      // would hand one renderer the other mode's settings - which is how the
      // scope came to look up phosphor[undefined] and crash on switching modes.
      // The settings and the renderer have to agree, and only the mode tag says
      // whether they do.
      if (state.mode !== mode) return

      renderer.render(frame, state.settings, state.theme)

      if (now - lastPush > 100) {
        lastPush = now
        // Renderers reuse one mutable readout object to keep the frame path
        // allocation-free. React state, however, uses object identity to decide
        // whether an update changed. Passing the reused object directly makes
        // the readout rail render once and then freeze. The rail updates at only
        // 10 Hz, so this small snapshot belongs here, outside the hot path.
        readoutRef.current({ ...renderer.readout() } as AnyReadout)
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.dispose()
    }
  }, [engine, mode])

  return (
    <div className="stage" data-mode={mode}>
      <canvas ref={canvasRef} />
      {children}
    </div>
  )
}
