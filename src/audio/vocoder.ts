/**
 * A channel vocoder: the tab's audio is the modulator, the synth is the
 * carrier.
 *
 * The easter egg only exists when both signals exist. The tab provides the
 * moving spectral shape (speech formants), the synth provides pitch and
 * timbre, and the classic robot-choir effect is the carrier wearing the
 * voice's envelope. It is the one deliberate exception to "audio passes
 * through untouched", which is why it is off by default, never restored as
 * on, and torn down the moment either signal goes away.
 *
 * The design is the canonical Web Audio channel vocoder, no worklet needed:
 * per band, the modulator runs through a bandpass into a rectifier
 * (a WaveShaper computing |x|) and a lowpass, producing the band's loudness
 * envelope as an audio-rate signal - which then drives the gain AudioParam of
 * the carrier's matching bandpass. Audio-rate param modulation is first-class
 * in Web Audio, so the whole machine is filters and gains.
 *
 * Sibilance: consonants are noise, not pitch, so a top band gates highpassed
 * white noise instead of the synth. Hardware vocoders (Sennheiser, EMS) did
 * exactly this, and it is what makes speech read as speech.
 */

/** Band count and range. 16 log-spaced bands, 80 Hz to 7.5 kHz, is the
 * classic hardware layout. */
const BANDS = 16
const LO_HZ = 80
const HI_HZ = 7500

/** Envelope follower cutoff: fast enough for articulation, slow enough not to
 * pass audio through the gain param. */
const ENV_HZ = 40

/** Envelope-to-gain makeup: rectified speech envelopes peak well under full
 * scale, so the band gains need a boost to bring the carrier through. */
const ENV_MAKEUP = 8

const SIBILANCE_HZ = 5000

interface Band {
  modIn: BiquadFilterNode
  carIn: BiquadFilterNode
  vca: GainNode
}

export class Vocoder {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private sibGain: GainNode | null = null
  private bands: Band[] = []
  private modBus: GainNode | null = null
  private carBus: GainNode | null = null
  private noise: AudioBufferSourceNode | null = null
  private sibVca: GainNode | null = null
  private modulator: AudioNode | null = null
  private carrier: AudioNode | null = null
  private live = false

  /**
   * Build the graph once and (re)wire the taps. The modulator is a new node
   * on every tab connect, so rewiring has to be cheap and repeatable; the
   * internal graph persists.
   */
  connect(ctx: AudioContext, modulator: AudioNode, carrier: AudioNode, destination: AudioNode) {
    if (!this.ctx) {
      this.ctx = ctx
      this.build(ctx)
      this.out!.connect(destination)
    }
    if (this.modulator !== modulator) {
      try {
        this.modulator?.disconnect(this.modBus!)
      } catch {
        // The old source is already gone.
      }
      this.modulator = modulator
      if (this.live) modulator.connect(this.modBus!)
    }
    if (this.carrier !== carrier) {
      try {
        this.carrier?.disconnect(this.carBus!)
      } catch {
        // As above.
      }
      this.carrier = carrier
      if (this.live) carrier.connect(this.carBus!)
    }
  }

  /** Engage: taps flow into the band machine. Idempotent. */
  enable() {
    if (this.live || !this.ctx) return
    this.live = true
    this.modulator?.connect(this.modBus!)
    this.carrier?.connect(this.carBus!)
  }

  /** Disengage completely: no taps in, so the graph goes silent and idle. */
  disable() {
    if (!this.live) return
    this.live = false
    try {
      this.modulator?.disconnect(this.modBus!)
    } catch {
      // Already disconnected.
    }
    try {
      this.carrier?.disconnect(this.carBus!)
    } catch {
      // Already disconnected.
    }
  }

  setWet(v: number) {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03)
  }

  setSibilance(v: number) {
    if (this.sibGain && this.ctx) this.sibGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03)
  }

  dispose() {
    this.disable()
    try {
      this.noise?.stop()
    } catch {
      // Never started or already stopped.
    }
    for (const node of [this.out, this.modBus, this.carBus, this.sibGain, this.sibVca]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.bands = []
    this.out = null
    this.modBus = null
    this.carBus = null
    this.sibGain = null
    this.sibVca = null
    this.noise = null
    this.modulator = null
    this.carrier = null
    this.ctx = null
  }

  private build(ctx: AudioContext) {
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.modBus = ctx.createGain()
    this.carBus = ctx.createGain()

    // |x| curve shared by every band's rectifier.
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      curve[i] = Math.abs((i / (curve.length - 1)) * 2 - 1)
    }

    // Constant Q sized so adjacent bands meet at their -3 dB points.
    const ratio = Math.pow(HI_HZ / LO_HZ, 1 / (BANDS - 1))
    const q = 1 / (Math.sqrt(ratio) - 1 / Math.sqrt(ratio))

    for (let b = 0; b < BANDS; b++) {
      const hz = LO_HZ * Math.pow(ratio, b)

      // Modulator side: two cascaded bandpasses for steeper skirts, then the
      // envelope follower.
      const m1 = bp(ctx, hz, q)
      const m2 = bp(ctx, hz, q)
      const rect = ctx.createWaveShaper()
      rect.curve = curve
      const env = ctx.createBiquadFilter()
      env.type = 'lowpass'
      env.frequency.value = ENV_HZ
      const makeup = ctx.createGain()
      makeup.gain.value = ENV_MAKEUP
      this.modBus.connect(m1)
      m1.connect(m2)
      m2.connect(rect)
      rect.connect(env)
      env.connect(makeup)

      // Carrier side: matching bandpasses into a VCA whose gain is the
      // envelope signal. Base gain zero: no envelope, no sound.
      const c1 = bp(ctx, hz, q)
      const c2 = bp(ctx, hz, q)
      const vca = ctx.createGain()
      vca.gain.value = 0
      makeup.connect(vca.gain)
      this.carBus.connect(c1)
      c1.connect(c2)
      c2.connect(vca)
      vca.connect(this.out)

      this.bands.push({ modIn: m1, carIn: c1, vca })
    }

    // Sibilance: the voice's top end gates noise, not the carrier.
    const sHp = ctx.createBiquadFilter()
    sHp.type = 'highpass'
    sHp.frequency.value = SIBILANCE_HZ
    const sRect = ctx.createWaveShaper()
    sRect.curve = curve
    const sEnv = ctx.createBiquadFilter()
    sEnv.type = 'lowpass'
    sEnv.frequency.value = ENV_HZ
    const sMakeup = ctx.createGain()
    sMakeup.gain.value = ENV_MAKEUP
    this.modBus.connect(sHp)
    sHp.connect(sRect)
    sRect.connect(sEnv)
    sEnv.connect(sMakeup)

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = ctx.createBufferSource()
    this.noise.buffer = noiseBuf
    this.noise.loop = true
    const nHp = ctx.createBiquadFilter()
    nHp.type = 'highpass'
    nHp.frequency.value = SIBILANCE_HZ
    this.sibVca = ctx.createGain()
    this.sibVca.gain.value = 0
    sMakeup.connect(this.sibVca.gain)
    this.sibGain = ctx.createGain()
    this.sibGain.gain.value = 0.6
    this.noise.connect(nHp)
    nHp.connect(this.sibVca)
    this.sibVca.connect(this.sibGain)
    this.sibGain.connect(this.out)
    this.noise.start()
  }
}

function bp(ctx: AudioContext, hz: number, q: number) {
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = hz
  f.Q.value = q
  return f
}
