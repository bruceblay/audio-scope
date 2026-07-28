import { useEffect, useRef } from 'react'
import type { AudioEngine } from '../audio/engine'
import { CymaticsRenderer } from '../modes/cymatics/renderer'
import type { CymaticsReadout, CymaticsSettings } from '../modes/cymatics/settings'
import { ScopeRenderer } from '../modes/scope/renderer'
import type { ScopeReadout, ScopeSettings } from '../modes/scope/settings'
import type { Renderer } from '../modes/types'
import type { ThemeId } from './tokens'

export type ModeId = 'scope' | 'cymatics'

type AnySettings = ScopeSettings | CymaticsSettings
type AnyReadout = ScopeReadout | CymaticsReadout

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
  const settingsRef = useRef(settings)
  const themeRef = useRef(theme)
  const readoutRef = useRef(onReadout)
  settingsRef.current = settings
  themeRef.current = theme
  readoutRef.current = onReadout

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // App passes the settings object matching `mode`, and both change in the
    // same render, so the renderer never sees the other mode's shape.
    const renderer: Renderer<AnySettings, AnyReadout> = (
      mode === 'cymatics' ? new CymaticsRenderer(canvas) : new ScopeRenderer(canvas)
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
      const frame = engine.readFrame(now)
      renderer.render(frame, settingsRef.current, themeRef.current)

      if (now - lastPush > 100) {
        lastPush = now
        readoutRef.current(renderer.readout())
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
