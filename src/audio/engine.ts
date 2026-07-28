/**
 * AudioEngine - owns the AudioContext, the capture graph, and every measurement
 * the render modes consume. Modes never touch Web Audio directly.
 *
 * See docs/03-audio-engine.md for the graph diagram and the measurement details.
 *
 * Two rules govern this file:
 *   1. Zero allocation in the frame path. Every buffer is created in the
 *      constructor and filled by readFrame().
 *   2. attach() always detaches first. A stream left over from a previous
 *      capture blocks getUserMedia and the failure is silent - browser-fx
 *      learned that one in production.
 */

import { clamp, follow, linearToDb } from '../lib/dsp'
import { Meters } from './meters'
import { PitchDetector } from './pitch'
import { BAND_COUNT, FFT_SIZE, TIME_SIZE, type AudioFrame, type Pitch } from './types'

/** Below this RMS the frame reports `silent`. About -66 dBFS. */
const SILENCE_RMS = 0.0005

export class AudioEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private splitter: ChannelSplitterNode | null = null
  private analyserL: AnalyserNode | null = null
  private analyserR: AnalyserNode | null = null
  private analyserFFT: AnalyserNode | null = null
  private analyserShort: AnalyserNode | null = null
  private outputGain: GainNode | null = null

  private readonly detector = new PitchDetector()
  private readonly meters = new Meters()

  // --- Reused frame buffers ------------------------------------------------
  private readonly timeL = new Float32Array(TIME_SIZE)
  private readonly timeR = new Float32Array(TIME_SIZE)
  private readonly timeMono = new Float32Array(TIME_SIZE)
  private readonly spectrum = new Float32Array(FFT_SIZE / 2)
  private shortSize = 2048
  private shortSpectrum = new Float32Array(1024)
  private readonly bands = new Float32Array(BAND_COUNT)
  private readonly bandEdges = new Int32Array(BAND_COUNT + 1)

  private readonly pitch: Pitch = {
    hz: 0,
    confidence: 0,
    note: '--',
    cents: 0,
    midi: 0,
    fold: 0,
  }

  private readonly frame: AudioFrame = {
    time: 0,
    dt: 0,
    sampleRate: 48000,
    timeL: this.timeL,
    timeR: this.timeR,
    timeMono: this.timeMono,
    spectrum: this.spectrum,
    spectrumShort: this.shortSpectrum,
    bands: this.bands,
    rms: 0,
    peak: 0,
    crest: 0,
    correlation: 0,
    level: 0,
    onset: 0,
    pitch: this.pitch,
    silent: true,
    rmsL: 0,
    rmsR: 0,
    peakL: 0,
    peakR: 0,
    meters: this.meters.state,
  }

  // --- Follower state -----------------------------------------------------
  private levelState = 0
  private slowLevel = 0
  private onsetState = 0
  private lastTime = 0

  constructor() {
    // Log-spaced band edges, browser-fx's scheme: narrow low bands, wide high
    // bands, which is how pitch actually maps to frequency.
    const bins = this.spectrum.length
    for (let b = 0; b <= BAND_COUNT; b++) {
      this.bandEdges[b] = Math.min(bins - 1, Math.floor(Math.pow(bins, b / BAND_COUNT)))
    }
  }

  get isAttached() {
    return this.stream !== null
  }

  /**
   * The most recent frame, without advancing anything.
   *
   * For readers that draw on their own loop, like the meter strip. Calling
   * readFrame() from a second loop would step every follower and the frame delta
   * twice per frame, running the meter ballistics at double rate.
   */
  get lastFrame(): AudioFrame {
    return this.frame
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000
  }

  /**
   * Route a captured stream into the graph. Playback to ctx.destination is
   * mandatory: tabCapture *redirects* the tab's audio, so without this the tab
   * goes silent.
   */
  async attach(stream: MediaStream) {
    this.detach()

    // The context is created once and reused across attach cycles. One context
    // per capture leaks them, and Chrome caps how many a page may have.
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const ctx = this.ctx

    this.stream = stream
    this.source = ctx.createMediaStreamSource(stream)

    this.outputGain = ctx.createGain()
    this.outputGain.gain.value = 1
    this.source.connect(this.outputGain)
    this.outputGain.connect(ctx.destination)

    // AnalyserNode downmixes to mono, so stereo work needs the split. X-Y mode
    // depends on having L and R as independent signals.
    this.splitter = ctx.createChannelSplitter(2)
    this.source.connect(this.splitter)

    this.analyserL = makeAnalyser(ctx, TIME_SIZE)
    this.analyserR = makeAnalyser(ctx, TIME_SIZE)
    this.splitter.connect(this.analyserL, 0)
    this.splitter.connect(this.analyserR, 1)

    this.analyserFFT = makeAnalyser(ctx, FFT_SIZE)
    this.source.connect(this.analyserFFT)

    this.analyserShort = makeAnalyser(ctx, this.shortSize)
    this.source.connect(this.analyserShort)

    this.frame.sampleRate = ctx.sampleRate
    this.lastTime = 0
    this.detector.reset()
  }

  /**
   * Tear down, in this order: stop the tracks first so playback returns to the
   * tab immediately, then unwire the graph. Idempotent - every teardown path in
   * docs/01-architecture.md#teardown calls this.
   */
  detach() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    for (const node of [
      this.source,
      this.splitter,
      this.analyserL,
      this.analyserR,
      this.analyserFFT,
      this.analyserShort,
      this.outputGain,
    ]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected. Nothing to do and nothing worth reporting.
      }
    }
    this.source = null
    this.splitter = null
    this.analyserL = null
    this.analyserR = null
    this.analyserFFT = null
    this.analyserShort = null
    this.outputGain = null

    this.levelState = 0
    this.slowLevel = 0
    this.onsetState = 0
    this.detector.reset()
    this.meters.reset()
    this.resetFrame()
  }

  /** Permanently release the AudioContext. Call only when the document unloads. */
  async dispose() {
    this.detach()
    if (this.ctx) {
      const ctx = this.ctx
      this.ctx = null
      try {
        await ctx.close()
      } catch {
        // A context that is already closed throws. Harmless.
      }
    }
  }

  /**
   * Resize the analyzer's own analyser.
   *
   * Directly trades latency against low-frequency detail: 1024 points is a 21 ms
   * window with 47 Hz bins, 32768 is 683 ms with 1.5 Hz bins. Cheap to change,
   * so it is a user control.
   *
   * 32768 is AnalyserNode's documented maximum; anything above it throws.
   */
  setShortFftSize(size: number) {
    const clamped = Math.max(256, Math.min(32768, 2 ** Math.round(Math.log2(size))))
    if (clamped === this.shortSize) return
    this.shortSize = clamped
    this.shortSpectrum = new Float32Array(clamped / 2)
    this.frame.spectrumShort = this.shortSpectrum
    if (this.analyserShort) this.analyserShort.fftSize = clamped
  }

  setMonitorGain(value: number) {
    if (!this.outputGain || !this.ctx) return
    // Ramp rather than jump; a step on a gain node is an audible click.
    this.outputGain.gain.setTargetAtTime(clamp(value, 0, 2), this.ctx.currentTime, 0.02)
  }

  /**
   * Read one frame of measurements. Returns the same object every call with its
   * buffers refilled - do not retain it across frames.
   */
  readFrame(now: number): AudioFrame {
    const f = this.frame
    f.time = now
    // A tab switch or a long GC pause can produce a huge delta; clamping keeps
    // frame-rate-independent decays from jumping.
    f.dt = this.lastTime === 0 ? 1 / 60 : clamp((now - this.lastTime) / 1000, 0, 0.1)
    this.lastTime = now

    if (!this.analyserL || !this.analyserR || !this.analyserFFT) {
      this.resetFrame()
      return f
    }

    this.analyserL.getFloatTimeDomainData(this.timeL)
    this.analyserR.getFloatTimeDomainData(this.timeR)
    this.analyserFFT.getFloatFrequencyData(this.spectrum)
    this.analyserShort?.getFloatFrequencyData(this.shortSpectrum)

    // Single pass over the record for the mono mix and every time-domain
    // statistic. Measure once, share widely.
    const L = this.timeL
    const R = this.timeR
    const M = this.timeMono
    let sumSq = 0
    let peak = 0
    let sumLR = 0
    let sumLL = 0
    let sumRR = 0
    let peakL = 0
    let peakR = 0
    for (let i = 0; i < TIME_SIZE; i++) {
      const l = L[i]
      const r = R[i]
      const m = (l + r) * 0.5
      M[i] = m
      sumSq += m * m
      const a = m < 0 ? -m : m
      if (a > peak) peak = a
      const al = l < 0 ? -l : l
      const ar = r < 0 ? -r : r
      if (al > peakL) peakL = al
      if (ar > peakR) peakR = ar
      sumLR += l * r
      // sumLL and sumRR are the correlation denominators and the per-channel
      // mean square at the same time, so the meters cost nothing extra here.
      sumLL += l * l
      sumRR += r * r
    }

    const rms = Math.sqrt(sumSq / TIME_SIZE)
    f.rms = rms
    f.peak = peak
    f.crest = rms > 1e-7 ? linearToDb(peak / rms) : 0
    const denom = Math.sqrt(sumLL * sumRR)
    f.correlation = denom > 1e-9 ? clamp(sumLR / denom, -1, 1) : 0
    f.silent = rms < SILENCE_RMS

    f.rmsL = Math.sqrt(sumLL / TIME_SIZE)
    f.rmsR = Math.sqrt(sumRR / TIME_SIZE)
    f.peakL = peakL
    f.peakR = peakR
    this.meters.update(f.rmsL, f.rmsR, peakL, peakR, f.dt)

    // Perceptual level: fast attack, slow release. browser-fx's technique, and
    // the reason its visualizer feels responsive without flickering.
    this.levelState = follow(this.levelState, clamp(rms * 3, 0, 1), 0.55, 0.1)
    f.level = this.levelState

    // Onset by self-comparison: energy jumping above its own recent average
    // reads as a transient. Cheap, no spectral flux needed.
    this.slowLevel += (this.levelState - this.slowLevel) * 0.02
    const onsetRaw = clamp((this.levelState - this.slowLevel * 1.05) * 4, 0, 1)
    this.onsetState = Math.max(onsetRaw, this.onsetState - f.dt * 3)
    f.onset = this.onsetState

    this.computeBands()
    this.detector.detect(this.spectrum, f.sampleRate, rms, this.pitch)

    return f
  }

  private computeBands() {
    const spec = this.spectrum
    for (let b = 0; b < BAND_COUNT; b++) {
      const start = this.bandEdges[b]
      const end = Math.max(start + 1, this.bandEdges[b + 1])
      let sum = 0
      for (let i = start; i < end; i++) sum += spec[i]
      const avgDb = sum / (end - start)
      // Map -90..-10 dBFS onto 0..1. That window is where music actually lives;
      // the full -100..0 range wastes most of the display on inaudible detail.
      this.bands[b] = clamp((avgDb + 90) / 80, 0, 1)
    }
  }

  private resetFrame() {
    const f = this.frame
    this.timeL.fill(0)
    this.timeR.fill(0)
    this.timeMono.fill(0)
    this.spectrum.fill(-100)
    this.shortSpectrum.fill(-100)
    this.bands.fill(0)
    f.rms = 0
    f.peak = 0
    f.crest = 0
    f.correlation = 0
    f.level = 0
    f.onset = 0
    f.silent = true
    f.rmsL = 0
    f.rmsR = 0
    f.peakL = 0
    f.peakR = 0
    this.pitch.hz = 0
    this.pitch.confidence = 0
    this.pitch.note = '--'
    this.pitch.cents = 0
    this.pitch.midi = 0
    this.pitch.fold = 0
  }
}

function makeAnalyser(ctx: AudioContext, fftSize: number): AnalyserNode {
  const a = ctx.createAnalyser()
  a.fftSize = fftSize
  // No analyser-internal smoothing. Every bit of smoothing in this app happens
  // in our own code where it is visible and tunable. Hidden smoothing is a
  // low-pass filter that lies to the oscilloscope.
  a.smoothingTimeConstant = 0
  a.minDecibels = -100
  a.maxDecibels = 0
  return a
}
