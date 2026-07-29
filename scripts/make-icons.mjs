#!/usr/bin/env node
/**
 * Generate the extension icons.
 *
 * Committed rather than run once, so the icon is reproducible and tweakable
 * instead of being a binary nobody can edit. Run with `npm run icons`.
 *
 * There is no SVG rasterizer on this machine and no image library in the
 * dependency list, so this draws into a pixel buffer and writes the PNG itself.
 * That turns out to be the better option anyway: the trace is rendered with the
 * *same* beam model the oscilloscope uses, so the icon is a picture of what the
 * product actually does rather than an illustration of it.
 *
 * Style follows browser-fx's knob icon: a circular instrument filling the frame,
 * near-black body, one saturated green, bold flat shapes that survive at 16 px.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const SIZES = [16, 32, 48, 128]
/** Supersample factor. Integer, so the box downsample is exact. */
const SS = 8

// --- palette, from src/ui/tokens.ts ---------------------------------------
const BODY = [0x1b, 0x1f, 0x22]
const BEZEL_HI = [0x3a, 0x41, 0x46]
const SCREEN = [0x05, 0x08, 0x07]
const GRATICULE = [0x96, 0xbe, 0xd2]
const CORE = [0x2b, 0xff, 0x6a]
const BLOOM = [0xa9, 0xff, 0xc4]

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t

/**
 * Signed distance to a rounded rectangle centred at the origin.
 * Negative inside, and the value is the distance to the edge either way.
 */
function roundedRect(dx, dy, halfW, halfH, radius) {
  const qx = Math.abs(dx) - (halfW - radius)
  const qy = Math.abs(dy) - (halfH - radius)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * Render one icon at `size`, supersampled, into an RGBA byte buffer.
 *
 * The silhouette is a screen, not a knob.
 *
 * A circular body kept the family resemblance to browser-fx, but browser-fx *is*
 * a knob, so the circle was doing honest work there and none here - it read as a
 * letter or a zodiac mark rather than an instrument. What identifies an
 * oscilloscope at a glance is the graticule: a dark rectangular screen ruled into
 * divisions with a trace across it. Nothing else in the frame says "scope" as
 * quickly, so the grid is the subject and the wave is what is on it.
 *
 * Geometry is all relative to the frame, so every size is the same drawing rather
 * than a scaled bitmap.
 */
function render(size) {
  const n = size * SS
  const px = new Float64Array(n * n * 4)

  // Every size is the same drawing.
  //
  // 16 px used to get a simplified treatment - thinner frame, no graticule, one
  // and a half cycles instead of two - on the reasoning that a faithful reduction
  // turns to mud. Legible in isolation, but Chrome shows 16 in the toolbar and 48
  // in the extensions list at the same moment, and the two read as different
  // icons. A slightly muddy 16 that is recognisably the same mark beats a crisp
  // one that is not.
  const c = n / 2
  const outerH = n * 0.47
  const corner = outerH * 0.3
  const bezel = n * 0.055
  const screenH = outerH - bezel
  const screenCorner = corner - bezel * 0.6

  // 6 x 4 divisions. A real scope rules 10 x 8, which at 16 px is mud; six reads
  // as a graticule at every size and still blurs gracefully.
  const divX = 6
  const divY = 4

  const cycles = 2
  const amp = screenH * 0.58
  const halfWidth = screenH * 0.96

  // --- the trace, as a brightness field ------------------------------------
  // Walked along x and splatted, rather than measured per pixel: distance to a
  // curve has no closed form here, and splatting is O(samples) instead of
  // O(pixels x samples).
  const glow = new Float64Array(n * n)
  const steps = n * 4
  // Beam width has a floor in *final* pixels, not supersampled ones. Scaling it
  // purely with size is proportionally correct and practically useless: at 16 px
  // it works out under half a pixel, which is a line you cannot see.
  // The floor exists so 16 px is visible at all. Applying it at 32 as well made
  // the toolbar icon's beam proportionally fatter than the 48 px one in the
  // extensions list, which is why the two did not match.
  const sigma = Math.max(0.72, size * 0.023) * SS
  const radius = Math.ceil(sigma * 3)

  let prevX = null
  let prevY = null
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = c - halfWidth + t * halfWidth * 2
    const y = c - Math.sin(t * cycles * Math.PI * 2) * amp

    if (prevX !== null) {
      // The beam deposits energy at a constant rate, so brightness per unit
      // length goes as 1/length: bright at the crests where it turns slowly,
      // dim through the steep zero crossings. Same model as the scope renderer.
      const len = Math.hypot(x - prevX, y - prevY)
      const energy = 1 / Math.max(len, 0.35)

      const cx = Math.round(x)
      const cy = Math.round(y)
      for (let dy = -radius; dy <= radius; dy++) {
        const py = cy + dy
        if (py < 0 || py >= n) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const pxx = cx + dx
          if (pxx < 0 || pxx >= n) continue
          const d2 = (pxx - x) ** 2 + (py - y) ** 2
          glow[py * n + pxx] += energy * Math.exp(-d2 / (2 * sigma * sigma))
        }
      }
    }
    prevX = x
    prevY = y
  }

  let peak = 0
  for (const v of glow) if (v > peak) peak = v
  const inv = peak > 0 ? 1 / peak : 0

  // The grid thins out as the icon shrinks and is dropped entirely at 16, where
  // it only ever muddied the screen. Same reasoning as the beam-width floor:
  // legibility is not scale-invariant.
  // Flat across sizes. Fading it with size meant the 32 px toolbar icon showed a
  // fainter graticule than the 48 px one in the extensions list, and the
  // graticule is the thing that says "oscilloscope".
  const gridAlpha = 0.3

  // --- compose --------------------------------------------------------------
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c

      const dOuter = roundedRect(dx, dy, outerH, outerH, corner)
      if (dOuter > 0) continue // transparent outside the instrument

      const dScreen = roundedRect(dx, dy, screenH, screenH, screenCorner)
      let col

      if (dScreen > 0) {
        // Bezel, with a light-catching edge on the upper left so it reads as a
        // raised frame rather than a flat border.
        const lit = clamp01((-dx - dy) / (outerH * 1.6) + 0.4)
        col = [
          mix(BODY[0], BEZEL_HI[0], lit * 0.55),
          mix(BODY[1], BEZEL_HI[1], lit * 0.55),
          mix(BODY[2], BEZEL_HI[2], lit * 0.55),
        ]
      } else {
        col = [...SCREEN]

        // Graticule. The centre rules are brighter, as they are on a real
        // faceplate, which also keeps a cross visible once the rest has blurred
        // away at small sizes.
        const cellX = (screenH * 2) / divX
        const cellY = (screenH * 2) / divY
        // Grid lines need a floor in final pixels for the same reason the beam
        // does: at 32 px a proportional line is a fifth of a pixel and washes out.
        const lineW = Math.max(0.42, size * 0.006) * SS
        const fx = Math.abs(((dx + screenH + cellX * 10) % cellX) - cellX / 2)
        const fy = Math.abs(((dy + screenH + cellY * 10) % cellY) - cellY / 2)
        const grid = Math.max(0, 1 - Math.min(fx, fy) / lineW)
        const axis = Math.max(
          0,
          1 - Math.min(Math.abs(dx), Math.abs(dy)) / (lineW * 1.3),
        )
        const a = clamp01(grid * gridAlpha + axis * gridAlpha * 1.5)
        if (a > 0) {
          col = [
            mix(col[0], GRATICULE[0], a),
            mix(col[1], GRATICULE[1], a),
            mix(col[2], GRATICULE[2], a),
          ]
        }

        // Trace. Additive, and saturating toward the bloom colour at the
        // brightest points, exactly as a real phosphor does.
        const g = clamp01(glow[y * n + x] * inv * 3.2)
        if (g > 0) {
          const white = clamp01((g - 0.6) / 0.4)
          col = [
            Math.min(255, col[0] + mix(CORE[0], BLOOM[0], white) * g),
            Math.min(255, col[1] + mix(CORE[1], BLOOM[1], white) * g),
            Math.min(255, col[2] + mix(CORE[2], BLOOM[2], white) * g),
          ]
        }
      }

      px[i] = col[0]
      px[i + 1] = col[1]
      px[i + 2] = col[2]
      px[i + 3] = 255
    }
  }

  return downsample(px, n, size)
}

/** Exact box filter, which is why SS is an integer factor. */
function downsample(src, n, size) {
  const out = Buffer.alloc(size * size * 4)
  const area = SS * SS
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * n + (x * SS + sx)) * 4
          const alpha = src[i + 3] / 255
          // Weight colour by coverage so the edge does not darken toward black.
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += src[i + 3]
        }
      }
      const cov = a / area / 255
      const o = (y * size + x) * 4
      out[o] = cov > 0 ? Math.round(r / area / cov) : 0
      out[o + 1] = cov > 0 ? Math.round(g / area / cov) : 0
      out[o + 2] = cov > 0 ? Math.round(b / area / cov) : 0
      out[o + 3] = Math.round(a / area)
    }
  }
  return out
}

// --- minimal PNG writer ----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // Filter byte 0 on every scanline: these are tiny, and deflate does the work.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- go ---------------------------------------------------------------------

mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  const png = encodePng(render(size), size)
  writeFileSync(join(OUT, `icon${size}.png`), png)
  console.log(`  icon${size}.png  ${String(png.length).padStart(6)} bytes`)
}
console.log(`\nWritten to ${OUT}`)
