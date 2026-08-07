# Audio Engine

`src/audio/` - capture, the node graph, and every measurement the modes consume.
Modes never touch Web Audio directly; they receive a frame of measurements.

## Node graph

```
MediaStreamAudioSourceNode (tab audio)
      |
      +--> outputGain --> ctx.destination          playback (mandatory)
      |
      +--> ChannelSplitterNode
      |         +-- ch0 --> analyserL   fftSize 4096   time domain
      |         +-- ch1 --> analyserR   fftSize 4096   time domain
      |
      +--> analyserFFT              fftSize 8192   frequency domain
```

Three analysers, not one, for concrete reasons:

- **`AnalyserNode` downmixes its input to mono.** X-Y / Lissajous mode needs L
  and R as independent signals, so the split is unavoidable.
- **Time domain and frequency domain want different window sizes.** The scope
  wants a short record for responsiveness and fast trigger re-acquisition.
  Pitch detection wants a long window for frequency resolution. At 48 kHz an
  8192-point FFT gives 5.86 Hz per bin, which is the floor of what is usable for
  low-register pitch even with interpolation. A 4096-point one gives 11.7 Hz,
  which is not.
- `smoothingTimeConstant` is set to `0` on all three. Every bit of smoothing in
  this app is done explicitly in our own code where we can see and tune it.
  Analyser-internal smoothing is a hidden low-pass that lies to the scope.

`outputGain` exists so the user can adjust monitor level without touching the
tab, and so we can fade rather than click on connect and disconnect.

## Frame model

The render loop calls `engine.readFrame()` once per animation frame. It returns a
single object of **reused typed arrays** - never freshly allocated, because
allocating 4 × 4096-element `Float32Array`s at 60 Hz is 4 MB/s of garbage and it
shows up as jank.

```ts
interface AudioFrame {
  // Raw
  timeL: Float32Array      // 4096, -1..1
  timeR: Float32Array      // 4096, -1..1
  timeMono: Float32Array   // 4096, (L+R)/2
  spectrum: Float32Array   // 4096 bins, dBFS (-100..0)
  sampleRate: number

  // Measured (see below)
  rms: number              // 0..1
  peak: number             // 0..1
  crest: number            // peak/rms, dB
  correlation: number      // -1..1, stereo correlation
  pitch: Pitch             // { hz, confidence, midi, note, cents }
  onset: number            // 0..1, transient envelope
  level: number            // 0..1, smoothed perceptual level
  bands: Float32Array      // 24 log-spaced band energies, 0..1
  silent: boolean          // below the noise gate
}
```

## Measurements

### Level, peak, crest

RMS over the mono record; peak as `max(abs())`. `crest = 20·log10(peak/rms)` is a
real and useful readout: it tells you how compressed the source is. A loudness-war
master sits near 8-10 dB, a live acoustic recording near 18-20 dB.

`level` is RMS run through an asymmetric follower (fast attack, slow release),
the technique from browser-fx's `Visualizer.tsx`:

```ts
const k60 = target > level ? 0.55 : 0.10
const k = 1 - (1 - k60) ** (dt * 60)
level += (target - level) * k
```

The coefficients retain the original response at 60 Hz and are normalized by
elapsed time, so a throttled or high-refresh panel does not change the meter.

### Onset detection

browser-fx's approach, kept because it is cheap and it works: compare the
instantaneous level to a slow-moving average of itself.

```ts
slowLevel += (level - slowLevel) * (1 - (1 - 0.02) ** (dt * 60))
const onsetRaw = clamp((level - slowLevel * 1.05) * 4, 0, 1)
onset = Math.max(onsetRaw, onset - dt * 3)     // fast decay envelope
```

An upgrade path exists (spectral flux: sum of positive bin-to-bin magnitude
change, which catches transients that do not raise broadband level, such as a
hi-hat under a bass note). Noted in [07-plan.md](07-plan.md), not needed at
launch.

### Stereo correlation

```
correlation = Σ(L·R) / sqrt(Σ(L²) · Σ(R²))
```

`+1` is mono, `0` is uncorrelated, `-1` is out of phase. It is a real broadcast
metering value, it drives the X-Y display's shape, and it lets us warn about
phase problems. Cheap: one pass over the record.

### Log-spaced bands

24 bands, boundaries at `binCount^(b/24)` - browser-fx's scheme
(`offscreen-effects.js:2927`), which correctly gives narrow low bands and wide
high bands. Used for the spectrum strip in the UI chrome, not for driving physics;
the modes use `pitch` and the raw record instead.

## Pitch detection

This is where "real, not just cool looking" is won or lost for cymatics mode. A
cymatic pattern is a function of *frequency*, so the frequency estimate has to be
right, including in the octave.

The pipeline, in `src/audio/pitch.ts`:

### 1. Noise gate

If `rms < 0.001` (about -60 dBFS), report `confidence: 0` and stop. Prevents the
detector from locking onto room noise or codec artifacts during silence.

### 2. Candidate gate

A candidate fundamental must itself be a real partial, no more than 25 dB below
the strongest one in the search range.

This gate is not optional. Without it, HPS reports `f/5` for a **pure sine**: the
subharmonic's product picks up the one real peak as its fifth harmonic and ties
the true answer *exactly*, and the tie breaks toward the lower bin. The test
harness caught this immediately (440 Hz sine reported as 87.9 Hz) and it is a
failure mode that would never show up on music, only on the exact test tones
someone would first point the extension at.

### 3. FFT peak with parabolic interpolation

Find the maximum bin `k` in the magnitude spectrum, then fit a parabola through
the three log-magnitude values `y(k-1), y(k), y(k+1)` to find the true peak
between bins:

```
δ = 0.5 · (y[k-1] - y[k+1]) / (y[k-1] - 2·y[k] + y[k+1])
f = (k + δ) · sampleRate / fftSize
```

Working in log magnitude (dB) rather than linear is deliberate: a Gaussian-ish
window's main lobe is close to parabolic in the log domain, so the interpolation
is much more accurate there. This takes an 8192-point FFT from ±5.9 Hz to roughly
±0.5 Hz on a clean tone, which is about 2 cents at A440. Good enough to name the
note.

### 4. Harmonic product spectrum for octave correctness

The raw peak is often a harmonic, not the fundamental. A sawtooth at 110 Hz can
easily peak at 220 or 330 Hz, and a note named an octave wrong produces a
completely wrong cymatic pattern.

HPS multiplies the spectrum by downsampled copies of itself:

```
HPS(f) = Π (r = 1..R) |X(r·f)|
```

The product is large only where *all* harmonics line up, which is the
fundamental. We use `R = 5`. Then a subharmonic check: if `HPS(f/2)` is within a
few dB of `HPS(f)`, prefer `f/2`, because HPS is biased slightly toward picking a
harmonic when the fundamental is weak.

**Harmonics are sampled as a max over a neighborhood, not at the exact bin.** A
real fundamental almost never lands on an integer bin, and the misalignment
compounds with `r`: at `r = 5` the true harmonic can be several bins from `k*5`.
Sampling exactly makes HPS prefer whichever candidate happens to be nearly
bin-aligned. The harness caught this too: a 220 Hz sawtooth was reported as
440 Hz purely because 440 sits closer to an integer bin than 220 does. The
neighborhood half-width is `max(1, round(r/2))`.

### 5. Confidence

```
confidence = clamp(peakProminence, 0, 1) · (1 - spectralFlatness) · gateFactor
```

- **Peak prominence**: the HPS peak's height above the median of the HPS, in dB,
  normalized. A single loud partial scores high; broadband noise scores near
  zero.
- **Spectral flatness**: geometric mean over arithmetic mean of the magnitude
  spectrum. Near `1` for white noise, near `0` for a pure tone. The `(1 - flatness)`
  factor is what makes cymatics mode correctly refuse to draw a specific pattern
  when the input is a cymbal crash or a drum fill.

Cymatics mode uses `confidence` to crossfade between a resolved mode pattern and
a diffuse turbulent state, so the display is honest about how tonal the input
actually is.

### 6. Temporal smoothing with jump detection

Frequency is smoothed with a one-pole filter, **except** when the new estimate
differs from the current one by more than a semitone and arrives with high
confidence. Then it snaps. This gives steady readouts on sustained notes and
still tracks a melody. Smoothing across a note change would slide through every
frequency in between, and in cymatics mode that means sliding through every mode
pattern in between - visible and wrong.

### Verified accuracy

`npm test` runs the real detector against generated signals, replicating how
`AnalyserNode` builds its spectrum (Blackman window, magnitude / fftSize, dB):

| Input | Result |
| --- | --- |
| Sines at 110 / 220 / 440 / 1000 / 2000 Hz | within 0.6 cents, confidence ~0.80 |
| Sawtooths at 110 / 220 / 440 Hz | octave-correct, confidence ~0.90 |
| Squares at 147 / 330 Hz | octave-correct |
| White noise | confidence 0.000 |
| Silence | gated, confidence 0.000 |
| 440 Hz / 261.6 Hz | named A4 +0c / C4 +0c |

### Why not autocorrelation / YIN

Autocorrelation and YIN are better than FFT peak picking for monophonic pitch,
especially in the low register. But the input here is arbitrary tab audio, mostly
polyphonic music, where no algorithm gives a "correct" single pitch. What we
actually need is "the frequency of the most dominant tonal component, with an
honest confidence," and spectral-domain HPS answers that question directly while
also giving us the spectrum we need anyway. If a "monophonic / instrument" mode
gets added later, YIN is the right addition there. Recorded in
[07-plan.md](07-plan.md).

## Note naming

`midi = 69 + 12·log2(hz/440)`, rounded for the name, with the remainder reported
as cents. Standard equal temperament, A440. A configurable reference pitch is a
Phase 4 item - it matters to anyone pointing this at Baroque tuning at A415.

## Performance rules

1. **Zero allocation in the frame path.** All buffers are allocated once in the
   engine constructor. `readFrame()` fills them.
2. **One analyser read per frame per analyser.** Measurements that need the same
   record share the single copy.
3. **Measure once, share widely.** The frame object is passed to whichever mode
   is active; unused fields cost nothing because they are computed in a single
   pass regardless.
4. The full `readFrame()` budget is ~0.5 ms, leaving the rest of the 16.6 ms
   frame to rendering.

## Upgrade path: AudioWorklet ring buffer

`AnalyserNode.getFloatTimeDomainData()` has two limits that matter for a
*serious* scope:

1. **No continuity guarantee.** Consecutive reads can overlap or skip samples
   depending on when the render loop lands relative to the audio thread. A real
   scope captures a contiguous record.
2. **Max `fftSize` is 32768**, about 0.68 s at 48 kHz. That caps the slowest
   usable time/div.

An `AudioWorkletNode` writing into a `SharedArrayBuffer` ring buffer fixes both:
gap-free samples, arbitrary record length, and per-channel access without a
splitter. It also enables true single-shot and normal trigger modes rather than
auto-trigger-within-a-record.

Deferred to Phase 3 because the analyser path is proven, simpler, and good enough
that the difference is invisible at the time bases people will actually use. The
`AudioEngine` interface is designed so the swap does not touch any mode code.
