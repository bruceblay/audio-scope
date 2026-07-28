import { useEffect, useRef } from 'react'
import type { AudioEngine } from '../audio/engine'
import { clamp } from '../lib/dsp'
import { screenTheme, type ThemeId } from './tokens'

/**
 * Level meters, always visible rather than a mode.
 *
 * Level and phase are things you want in view *while* watching something else -
 * a scope trace tells you nothing about whether you are clipping. Making them a
 * mode would mean choosing between the two, which is backwards.
 *
 * Draws from the engine's last frame rather than pulling a new one. `readFrame`
 * advances every follower and the frame delta, so calling it from a second loop
 * would run the ballistics at double rate and make every meter read wrong.
 */

/** Displayed range. 60 dB is the usual span on a digital meter. */
const FLOOR_DB = -60
const CEIL_DB = 0

/**
 * Alignment level, marked on the scale.
 *
 * -18 dBFS is EBU R68 alignment, where 0 VU sits in European broadcast. It gives
 * the scale a reference that means something rather than being a bare gradient.
 */
const ALIGN_DB = -18

const TICKS = [-60, -50, -40, -30, -20, -18, -12, -6, -3, 0]

export function Meters({ engine, theme }: { engine: AudioEngine; theme: ThemeId }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    const applySize = () => {
      dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width * dpr))
      h = Math.max(1, Math.round(rect.height * dpr))
      canvas.width = w
      canvas.height = h
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(canvas)

    const xFor = (db: number, left: number, span: number) =>
      left + clamp((db - FLOOR_DB) / (CEIL_DB - FLOOR_DB), 0, 1) * span

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const frame = engine.lastFrame
      const skin = screenTheme[themeRef.current]
      const m = frame.meters

      ctx.fillStyle = skin.screen
      ctx.fillRect(0, 0, w, h)

      const pad = 4 * dpr
      const labelW = 13 * dpr
      const clipW = 9 * dpr
      const left = pad + labelW
      const span = w - left - pad - clipW - 3 * dpr
      const barH = 7 * dpr
      const gap = 4 * dpr
      const top = pad + 7 * dpr

      // Scale ticks first, so the bars sit over them.
      ctx.strokeStyle = skin.graticule
      ctx.lineWidth = Math.max(1, Math.round(dpr))
      ctx.beginPath()
      for (const db of TICKS) {
        const x = Math.round(xFor(db, left, span)) + 0.5
        ctx.moveTo(x, top - 3 * dpr)
        ctx.lineTo(x, top + barH * 2 + gap + 2 * dpr)
      }
      ctx.stroke()

      ctx.fillStyle = skin.graticuleMajor
      ctx.font = `${8 * dpr}px ui-monospace, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const db of [-60, -40, -20, ALIGN_DB, -6, 0]) {
        ctx.fillText(db === ALIGN_DB ? '18' : `${Math.abs(db)}`, xFor(db, left, span), 0)
      }

      // Alignment mark, brighter than the rest of the scale.
      const alignX = Math.round(xFor(ALIGN_DB, left, span)) + 0.5
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'
      ctx.beginPath()
      ctx.moveTo(alignX, top - 3 * dpr)
      ctx.lineTo(alignX, top + barH * 2 + gap + 2 * dpr)
      ctx.stroke()

      for (let ch = 0; ch < 2; ch++) {
        const y = top + ch * (barH + gap)

        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        ctx.fillRect(left, y, span, barH)

        // VU bar: the slow, loudness-weighted reading.
        const vuX = xFor(m.vuDb[ch], left, span)
        const grad = ctx.createLinearGradient(left, 0, left + span, 0)
        grad.addColorStop(0, '#2f9e5a')
        grad.addColorStop(0.7, '#5ccf7a')
        grad.addColorStop(0.88, '#e0c341')
        grad.addColorStop(1, '#d9483b')
        ctx.fillStyle = grad
        ctx.fillRect(left, y, Math.max(0, vuX - left), barH)

        // PPM: a bright line ahead of the bar. The gap between the two is the
        // crest factor, which is the reason to show both.
        const ppmX = Math.round(xFor(m.ppmDb[ch], left, span))
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fillRect(ppmX - 1 * dpr, y, Math.max(1, dpr), barH)

        // Peak hold marker.
        if (m.holdDb[ch] > FLOOR_DB) {
          const holdX = Math.round(xFor(m.holdDb[ch], left, span))
          ctx.fillStyle = 'rgba(255,255,255,0.55)'
          ctx.fillRect(holdX - 1 * dpr, y, Math.max(1, dpr), barH)
        }

        ctx.fillStyle = skin.graticuleMajor
        ctx.font = `${8 * dpr}px ui-monospace, monospace`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(ch === 0 ? 'L' : 'R', pad, y + barH / 2)

        // Clip light, held long enough to catch.
        ctx.fillStyle = m.clipped[ch] ? '#ff5b4d' : 'rgba(255,255,255,0.09)'
        ctx.fillRect(w - pad - clipW, y, clipW, barH)
      }

      // Correlation: +1 is mono, 0 uncorrelated, -1 out of phase. Drawn from
      // centre so the direction of the deviation is the information.
      const corrY = top + barH * 2 + gap + 6 * dpr
      const corrH = 4 * dpr
      const mid = left + span / 2
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(left, corrY, span, corrH)
      ctx.strokeStyle = skin.graticule
      ctx.beginPath()
      ctx.moveTo(Math.round(mid) + 0.5, corrY)
      ctx.lineTo(Math.round(mid) + 0.5, corrY + corrH)
      ctx.stroke()

      const corr = clamp(frame.correlation, -1, 1)
      // Negative correlation is the condition worth noticing, so it is the only
      // thing here that changes colour.
      ctx.fillStyle = corr < 0 ? '#d9483b' : '#5ccf7a'
      ctx.fillRect(
        corr >= 0 ? mid : mid + (corr * span) / 2,
        corrY,
        Math.abs((corr * span) / 2),
        corrH,
      )

      ctx.fillStyle = skin.graticuleMajor
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText('φ', pad, corrY + corrH / 2)
      ctx.textAlign = 'right'
      ctx.fillText(corr.toFixed(2), w - pad, corrY + corrH / 2)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [engine])

  return (
    <div className="meters">
      <canvas ref={canvasRef} />
    </div>
  )
}
