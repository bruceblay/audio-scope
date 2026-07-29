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
 * Render one icon at `size`, supersampled, into an RGBA byte buffer.
 *
 * Geometry is all relative to the radius, so every size is the same drawing
 * rather than a scaled bitmap.
 */
function render(size) {
  const n = size * SS
  const px = new Float64Array(n * n * 4)

  const c = n / 2
  const R = c * 0.97
  const screenR = R * 0.87
  // Enough cycles to read as a wave at 16 px without becoming a comb.
  const cycles = 1.5
  const amp = screenR * 0.55

  // --- the trace, as a brightness field ------------------------------------
  // Walked along x and splatted, rather than measured per pixel: distance to a
  // curve has no closed form here, and splatting is O(samples) instead of
  // O(pixels x samples).
  const glow = new Float64Array(n * n)
  const steps = n * 4
  // Beam width has a floor in *final* pixels, not supersampled ones. Scaling it
  // purely with size is proportionally correct and practically useless: at 16 px
  // it works out to 0.4 px, which is a line you cannot see. Small icons need a
  // proportionally fatter stroke.
  const sigma = Math.max(1.0, size * 0.026) * SS
  const radius = Math.ceil(sigma * 3)
  const halfWidth = screenR * 0.94

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

  // --- compose --------------------------------------------------------------
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c
      const r = Math.hypot(dx, dy)

      if (r > R) continue // transparent outside the instrument

      let col
      if (r > screenR) {
        // Bezel, with a light-catching edge on the upper left so it reads as a
        // raised ring rather than a flat annulus.
        const lit = clamp01((-dx - dy) / (R * 1.6) + 0.35)
        const rim = clamp01((r - screenR) / (R - screenR))
        const t = lit * 0.5 * Math.pow(rim, 1.5)
        col = [mix(BODY[0], BEZEL_HI[0], t), mix(BODY[1], BEZEL_HI[1], t), mix(BODY[2], BEZEL_HI[2], t)]

        // A lit tube spills onto its bezel. This is also what gives the icon its
        // colour away from the trace, the job browser-fx's green arc does.
        const spill = clamp01(1 - (r - screenR) / (R - screenR)) ** 2 * 0.5
        col = [
          Math.min(255, col[0] + CORE[0] * spill * 0.25),
          Math.min(255, col[1] + CORE[1] * spill * 0.25),
          Math.min(255, col[2] + CORE[2] * spill * 0.25),
        ]
      } else {
        col = [...SCREEN]

        // Graticule: faint enough that it adds texture at 128 px and disappears
        // by 16, which is the correct behaviour rather than a compromise.
        const cell = screenR / 2
        const gx = Math.abs(((dx + cell * 10) % cell) - cell / 2)
        const gy = Math.abs(((dy + cell * 10) % cell) - cell / 2)
        const line = Math.max(0, 1 - Math.min(gx, gy) / (n * 0.0045))
        if (line > 0) {
          const a = line * 0.16
          col = [mix(col[0], GRATICULE[0], a), mix(col[1], GRATICULE[1], a), mix(col[2], GRATICULE[2], a)]
        }

        // Trace. Additive, and saturating toward the bloom colour at the
        // brightest points, exactly as a real phosphor does.
        const g = clamp01(glow[y * n + x] * inv * 3.4)
        if (g > 0) {
          const white = clamp01((g - 0.62) / 0.38)
          const tr = mix(CORE[0], BLOOM[0], white)
          const tg = mix(CORE[1], BLOOM[1], white)
          const tb = mix(CORE[2], BLOOM[2], white)
          col = [
            Math.min(255, col[0] + tr * g),
            Math.min(255, col[1] + tg * g),
            Math.min(255, col[2] + tb * g),
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
