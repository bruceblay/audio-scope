/**
 * The analytic CRT beam, on the GPU.
 *
 * This is the technique every serious web oscilloscope converged on
 * independently - woscope (m1el), XXY Oscilloscope (N. Thapen), Nick Tasios'
 * write-up - and the math is theirs, not ours: each audio segment becomes a
 * quad, and the fragment shader evaluates the exact integrated intensity of a
 * Gaussian beam spot travelling the segment at constant speed,
 *
 *   F(p) = (E / 2l) * exp(-py^2 / 2s^2) * [erf(px / s*sqrt2) - erf((px - l) / s*sqrt2)]
 *
 * with px along the segment, py perpendicular, l the segment length. The 1/l
 * factor is dwell-time physics falling out of the integral: the same energy
 * spread over a longer path is dimmer, per pixel, exactly as on the tube.
 *
 * Frames accumulate linearly into a half-float texture (light adds; 8-bit
 * canvas compositing clips, which was the fog), persistence is a per-frame
 * multiplicative decay of that texture, and a tonemap pass converts energy to
 * phosphor colour - saturating through the core hue toward bloom-white the
 * way real phosphor does. Halation is a second, wider Gaussian component of
 * the same beam rather than a blur of the accumulated image.
 *
 * Confined on purpose: this file draws beam light and nothing else. The
 * trigger, the measurements, the graticule, the readouts and every control
 * are untouched by it, and the Canvas2D path remains as automatic fallback
 * when a GL context is unavailable or lost.
 */

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // quad corner in (along, side) unit space
layout(location=1) in vec4 aSeg;      // per-instance: x0, y0, x1, y1 (pixels)
uniform vec2 uViewport;
uniform float uReach;                 // quad half-width in pixels (~3.5 sigma)
out vec2 vLocal;                      // (px, py): along/perpendicular, pixels
out float vLen;
void main() {
  vec2 a = aSeg.xy;
  vec2 b = aSeg.zw;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  // Corner space: aCorner.x in [0,1] along the segment (extended by uReach on
  // both ends for the caps), aCorner.y in [-1,1] across it.
  float along = mix(-uReach, len + uReach, aCorner.x);
  vec2 pos = a + dir * along + nrm * (aCorner.y * uReach);
  vLocal = vec2(along, aCorner.y * uReach);
  vLen = len;
  vec2 clip = (pos / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
uniform float uSigma;
uniform float uGain;
out vec4 outColor;

// Abramowitz & Stegun 7.1.26, max error ~1.5e-7: plenty under 8 bpc output
// and invisible at half-float accumulation.
float erf_approx(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}

void main() {
  float s2 = uSigma * 1.41421356;
  float l = max(vLen, 0.001);
  float along = erf_approx(vLocal.x / s2) - erf_approx((vLocal.x - vLen) / s2);
  float across = exp(-vLocal.y * vLocal.y / (2.0 * uSigma * uSigma));
  float e = uGain * across * along / (2.0 * l);
  outColor = vec4(e, 0.0, 0.0, 1.0);
}`

/** Fullscreen pass: next = prev * decay. */
const DECAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrev;
uniform float uDecay;
out vec4 outColor;
void main() { outColor = texture(uPrev, vUv) * uDecay; }`

/**
 * Energy to phosphor light. Brightness saturates softly (1 - e^-kE), and the
 * hue desaturates from the core colour toward bloom as energy climbs, which
 * is what a saturating phosphor does and what makes intensity read as
 * intensity rather than as opacity.
 */
const TONE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAccum;
uniform vec3 uCore;
uniform vec3 uBloom;
uniform float uExposure;
out vec4 outColor;
void main() {
  float e = texture(uAccum, vUv).r;
  float b = 1.0 - exp(-uExposure * e);
  float w = 1.0 - exp(-0.35 * uExposure * e);
  vec3 c = mix(uCore, uBloom, w * w) * b;
  outColor = vec4(c, b);
}`

const QUAD_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

interface Pass {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

export interface BeamParams {
  /** Beam core sigma in device pixels. */
  sigma: number
  /** Total energy per segment (all segments span equal time). */
  gain: number
  /** 0..1: weight of the wide halo component. */
  halation: number
  /** Per-frame multiplicative decay of the accumulated image. */
  decay: number
  core: [number, number, number]
  bloom: [number, number, number]
  exposure: number
}

export class BeamGL {
  private gl: WebGL2RenderingContext | null = null
  readonly canvas: HTMLCanvasElement
  private beam: Pass | null = null
  private decayPass: Pass | null = null
  private tone: Pass | null = null
  private quadBuf: WebGLBuffer | null = null
  private cornerBuf: WebGLBuffer | null = null
  private segBuf: WebGLBuffer | null = null
  private segData = new Float32Array(0)
  private tex: [WebGLTexture | null, WebGLTexture | null] = [null, null]
  private fb: [WebGLFramebuffer | null, WebGLFramebuffer | null] = [null, null]
  private page = 0
  private w = 0
  private h = 0
  private lost = false

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      this.gl = null // rebuilt lazily on next use
    })
  }

  /** True when the GPU path can be used this frame. */
  get available(): boolean {
    if (this.lost) return false
    if (this.gl) return true
    return this.init()
  }

  private init(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
    })
    if (!gl) return false
    // Half-float accumulation is the point: light must add without clipping.
    if (!gl.getExtension('EXT_color_buffer_float')) return false
    this.gl = gl

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed')
      }
      return sh
    }
    const link = (vs: string, fs: string, names: string[]): Pass => {
      const program = gl.createProgram()!
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vs))
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
      }
      const uniforms: Pass['uniforms'] = {}
      for (const n of names) uniforms[n] = gl.getUniformLocation(program, n)
      return { program, uniforms }
    }

    try {
      this.beam = link(VERT, FRAG, ['uViewport', 'uReach', 'uSigma', 'uGain'])
      this.decayPass = link(QUAD_VERT, DECAY_FRAG, ['uPrev', 'uDecay'])
      this.tone = link(QUAD_VERT, TONE_FRAG, ['uAccum', 'uCore', 'uBloom', 'uExposure'])
    } catch {
      this.gl = null
      return false
    }

    this.quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    this.cornerBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW)

    this.segBuf = gl.createBuffer()
    return true
  }

  resize(w: number, h: number) {
    this.w = w
    this.h = h
    this.canvas.width = w
    this.canvas.height = h
    // Lazy init means resize can arrive before the context exists; targets
    // are (re)created here when it does, and on first render otherwise.
    if (this.gl) this.createTargets()
  }

  private createTargets() {
    const gl = this.gl
    if (!gl || !this.w || !this.h) return
    const w = this.w
    const h = this.h
    for (let i = 0; i < 2; i++) {
      gl.deleteTexture(this.tex[i])
      gl.deleteFramebuffer(this.fb[i])
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const f = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.tex[i] = t
      this.fb[i] = f
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.targetsReady = true
  }

  private targetsReady = false

  clear() {
    const gl = this.gl
    if (!gl) return
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[i])
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * One frame: decay history, add this frame's segments, tonemap to the
   * canvas. Returns false if GL is gone and the caller should fall back.
   */
  render(xs: Float32Array, ys: Float32Array, count: number, p: BeamParams): boolean {
    if (!this.available) return false
    const gl = this.gl!
    if (this.w === 0 || this.h === 0) return false
    // The context may have initialized after the first resize; the render
    // targets are created on whichever side happens second.
    if (!this.targetsReady) this.createTargets()
    if (!this.targetsReady) return false

    const segments = Math.max(0, count - 1)
    if (this.segData.length < segments * 4) {
      this.segData = new Float32Array(Math.max(segments * 4, 4096))
    }
    for (let i = 0; i < segments; i++) {
      const o = i * 4
      this.segData[o] = xs[i]
      this.segData[o + 1] = ys[i]
      this.segData[o + 2] = xs[i + 1]
      this.segData[o + 3] = ys[i + 1]
    }

    const prev = this.page
    const next = 1 - this.page
    this.page = next

    gl.viewport(0, 0, this.w, this.h)

    // 1. next = prev * decay
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[next])
    gl.disable(gl.BLEND)
    gl.useProgram(this.decayPass!.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[prev])
    gl.uniform1i(this.decayPass!.uniforms.uPrev, 0)
    gl.uniform1f(this.decayPass!.uniforms.uDecay, p.decay)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // 2. Beam segments, additive. Core pass plus an optional wide halo pass:
    // halation as a property of the beam, not a blur of history.
    if (segments > 0) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(this.beam!.program)
      gl.uniform2f(this.beam!.uniforms.uViewport, this.w, this.h)

      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf)
      gl.bufferData(gl.ARRAY_BUFFER, this.segData.subarray(0, segments * 4), gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(1, 1)

      const passes: [number, number][] = [[p.sigma, p.gain * (1 - p.halation * 0.5)]]
      if (p.halation > 0.01) passes.push([p.sigma * 4, p.gain * p.halation * 0.5])
      for (const [sigma, gain] of passes) {
        gl.uniform1f(this.beam!.uniforms.uSigma, sigma)
        gl.uniform1f(this.beam!.uniforms.uGain, gain)
        gl.uniform1f(this.beam!.uniforms.uReach, sigma * 3.5)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segments)
      }
      // Fully unwind the instanced attribute: leaving it enabled makes the
      // following fullscreen draws read out of bounds, and WebGL rejects
      // those draws silently - the whole pipeline goes dark.
      gl.vertexAttribDivisor(1, 0)
      gl.disableVertexAttribArray(1)
    }

    // 3. Tonemap accumulated energy to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.w, this.h)
    gl.disable(gl.BLEND)
    gl.useProgram(this.tone!.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[next])
    gl.uniform1i(this.tone!.uniforms.uAccum, 0)
    gl.uniform3f(this.tone!.uniforms.uCore, p.core[0], p.core[1], p.core[2])
    gl.uniform3f(this.tone!.uniforms.uBloom, p.bloom[0], p.bloom[1], p.bloom[2])
    gl.uniform1f(this.tone!.uniforms.uExposure, p.exposure)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    return true
  }

  dispose() {
    const gl = this.gl
    if (gl) {
      for (let i = 0; i < 2; i++) {
        gl.deleteTexture(this.tex[i])
        gl.deleteFramebuffer(this.fb[i])
      }
    }
    this.gl = null
  }
}
