# Mode: Cymatics

A driven-plate simulation. Detected pitch excites the actual eigenmodes of a
vibrating surface, and sand grains migrate to the nodal lines the way they do on a
real Chladni plate. Play a sine sweep and the pattern snaps from one mode family
to the next exactly where the resonances are.

## A membrane is not a plate

The first implementation of this mode modelled a **drum head** and called it a
Chladni plate. They are different physical objects, and the patterns do not
resemble each other:

| | Membrane (drum head) | Plate (Chladni) |
| --- | --- | --- |
| Governing equation | wave, `∇²` | biharmonic, `∇⁴` |
| Restoring force | tension | flexural stiffness |
| Solutions | `J_m` only | `J_m` **and** `I_m` |
| Frequency | `f ∝ k` | `f ∝ k²` |
| Edge | fixed: a **node** | free: an **antinode** |
| Fundamental | (0,1) | (2,0), two nodal diameters |

The edge row is the one visible across a room. A fixed edge makes the rim a node,
so sand piles into a bright ring around the boundary. A real Chladni plate has a
free rim that moves more than almost anywhere else, so sand is thrown off it and
the edge stays clean. That single artifact was most of why the first version
looked wrong next to a video of a real plate.

The frequency row matters just as much but is less obvious: `f ∝ k²` rather than
`f ∝ k` means every note maps to a different pattern than it would on a membrane.

Both surfaces ship. `Chladni` is the free plate and the default; `Drum` is the
fixed membrane, which is not wrong, just a different instrument.

### Free circular plate (Chladni, default)

A stiff plate obeys the Kirchhoff-Love equation `D∇⁴w = ρhω²w`. Writing
`k⁴ = ρhω²/D`, that factors as

```
(∇² + k²)(∇² − k²) w = 0
```

so solutions carry **both** an oscillating and an exponential radial part:

```
w(r, θ) = [ J_m(kr) + C · I_m(kr) ] · cos(mθ)
```

`Y_m` and `K_m` are excluded because they blow up at the origin.

A free edge carries no radial moment and no Kelvin-Kirchhoff shear at `r = a`:

```
M_r = w_rr + ν·(w_r/r + w_θθ/r²)                          = 0
V_r = ∂/∂r(∇²w) + (1−ν)/r² · ∂²/∂θ²(w_r − w/r)            = 0
```

Substituting the solution and eliminating second derivatives through the Bessel
equations gives a 2×2 homogeneous system in `(A, B)`. Its determinant vanishing
is the frequency equation, solved numerically in `freeplate.ts`, and its null
vector gives `C`.

Frequencies then go as `λ²` where `λ = ka`. Verified against Leissa, *Vibration
of Plates* (NASA SP-160, 1969) at ν = 0.33, every value within 0.34%:

| Mode | λ² computed | λ² (Leissa) |
| --- | --- | --- |
| (2,0) | 5.262 | 5.253 |
| (0,1) | 9.069 | 9.084 |
| (3,0) | 12.244 | 12.23 |
| (1,1) | 20.513 | 20.52 |
| (4,0) | 21.527 | 21.6 |
| (2,1) | 35.243 | 35.25 |
| (0,2) | 38.507 | 38.55 |

Two consequences worth knowing:

- **The fundamental is (2,0)**, two nodal diameters. The `m = 0` and `m = 1`
  families have rigid-body modes at zero frequency (the plate translating and
  rocking), so their `n` counting starts at 1. The first thing a real plate does
  is the four-sector cross, and now so does ours.
- **The mode set spans 6.8 octaves** against the membrane's 3.6, because
  frequency is quadratic in `λ`. Far less octave folding is needed to cover the
  audible range.

### Circular membrane (the `Drum` surface)

The wave equation on a circular membrane of radius `R` with a fixed edge has
separable solutions:

```
u(r, θ, t) = J_m(k_mn · r) · cos(m·θ + φ) · cos(ω_mn · t)
```

- `J_m` is the Bessel function of the first kind, order `m`
- `m` = 0, 1, 2, … is the number of nodal **diameters**
- `n` = 1, 2, 3, … indexes the nodal **circles**
- The fixed edge requires `u(R) = 0`, so `J_m(k_mn·R) = 0`, giving
  `k_mn = α_mn / R` where `α_mn` is the n-th positive zero of `J_m`
- Resonant frequency: `f_mn = c·α_mn / (2π·R)`

So the mode spectrum is fixed by the Bessel zeros. Relative to the fundamental
`(0,1)`:

| Mode | α | f / f₀₁ |
| --- | --- | --- |
| (0,1) | 2.4048 | 1.000 |
| (1,1) | 3.8317 | 1.593 |
| (2,1) | 5.1356 | 2.136 |
| (0,2) | 5.5201 | 2.296 |
| (3,1) | 6.3802 | 2.653 |
| (1,2) | 7.0156 | 2.918 |

That is the real, inharmonic spectrum of a drum head, and it is why a timpani has
a pitch but a vague one. We hard-code the zero table for `m` = 0…8, `n` = 1…6
(54 modes, α from 2.4048 to 29.5457, spanning about 3.6 octaves).

This surface is correct physics for a drum head. It is simply not what a Chladni
plate does.

**Nodal set**: `n-1` interior circles at the radii where `J_m(k_mn·r) = 0`, plus
`m` diameters where `cos(m·θ + φ) = 0`. This is exactly what shows up in a
vibrating-water-dish video.

### Free square plate

The other classic Chladni geometry, and the one most demonstrations film. Solved
by single-term Rayleigh-Ritz on products of **free-free beam functions**,
`W(x,y) = X_i(x)·X_j(y)`, where

```
X_k(ξ) = cosh(βξ) + cos(βξ) − σ[sinh(βξ) + sin(βξ)],   cos β · cosh β = 1
```

plus the two rigid-body functions (translation and rotation), which carry no
bending energy alone but produce the cylindrical and twisting modes when paired
with a flexible function on the other axis.

Frequencies come from the plate Rayleigh quotient,

```
λ² = A_i + A_j + 2ν·B_i·B_j + 2(1−ν)·C_i·C_j
```

with `A = ∫X″²`, `B = ∫X″X`, `C = ∫X′²`, integrated numerically. Against Leissa's
free square plate at ν = 0.3 the first four modes land within 14%, high as a
single-term variational bound must be. The **shapes** satisfy the free-edge
conditions exactly, and the shapes are what the sand draws.

The fundamental is the `(1,1)` twisting saddle: rigid rotation about one axis
crossed with rotation about the other, nodal lines forming a cross through the
centre, no bending energy at all. `(i,j)` and `(j,i)` are exactly degenerate (35
such pairs), and their drive-weighted combinations produce the curved and diagonal
nodal lines of real Chladni figures rather than a plain rectangular grid.

> ⚠️ **`λ` conventions differ between the two solvers.** For the circular plate
> `λ = ka` is a wavenumber and `f ∝ λ²`. For the square, `λ = ωa²√(ρh/D)` is
> already proportional to frequency, so `f ∝ λ`. Squaring the square's `λ`
> produced mode frequencies up to 800 kHz.

### Why not a clamped square plate

The first version used the clamped solution:

```
u(x, y, t) = sin(n·π·x/L) · sin(m·π·y/L) · cos(ω_nm·t),    f_nm ∝ √(n² + m²)
```

The important physical detail: when `n ≠ m`, `f_nm = f_mn`. The modes are
**degenerate** - two different shapes at the identical frequency. And any linear
combination of degenerate eigenmodes is *also* an eigenmode at that frequency. So

```
sin(nπx)sin(mπy) ± sin(mπx)sin(nπy)
```

is a genuine eigenmode, and those `±` combinations are precisely what produce the
classic Chladni figures with their curved and crossing nodal lines. Which
combination a real plate settles into depends on where you drive it and on tiny
asymmetries.

Its four edges are nodes, so sand piles into a frame around the border that a
real plate never has - the same mistake as the fixed-edge membrane, in a different
geometry. It is not shipped.

The degeneracy argument below still holds, and carries over to the free-edge
basis: it is why the combinations matter.

This is worth stating because browser-fx's decorative visualizer uses that same
formula (`src/components/Visualizer.tsx`), but with `n` and `m` as **continuous**
values driven by bass and treble energy:

```ts
const n = 2 + bass * 3.5 + 0.4 * Math.sin(t * 0.25)
const m = 3 + high * 4 + 0.4 * Math.cos(t * 0.18)
```

Non-integer `n` and `m` do not satisfy the boundary condition, so those are not
modes of anything. It looks good and it was the right choice for a decorative
background, but it is the exact thing we are not doing here. Our `n` and `m` are
integers, selected by resonance against a real frequency estimate.

### Which modes are excited

A plate driven at frequency `ω` responds in every mode, with amplitude set by that
mode's resonance curve. Standard driven damped harmonic oscillator:

```
A_mn(ω) = 1 / √( (1 - (ω/ω_mn)²)² + (ω/(Q·ω_mn))² )
```

`Q` is the quality factor - how sharply tuned the surface is. Physically it is
material damping: a steel plate is `Q` ≈ 200-1000, a rubber membrane ≈ 10. It maps
to a knob labeled **Damping**, and it is the most expressive control in the mode:

- **High Q (sharp)**: one mode dominates. Crisp, geometric, snaps hard between
  patterns as pitch changes. Correct for metal.
- **Low Q (broad)**: many modes sum. Soft, complex, evolving. Correct for rubber,
  and much more forgiving with real music.

Modes are also excited unevenly by the driver's position. Driving at the center
only excites `m = 0` modes (the axially symmetric ones), because every other mode
has a node through the center. Driving off-center excites everything. This is real
and it is a control: **Drive point**, which multiplies each mode's amplitude by its
own shape value at the driver location, `|u_mn(r_d, θ_d)|`. That is the correct
coupling factor.

Total displacement is the superposition:

```
u(x, y, t) = Σ_mn  A_mn(ω) · coupling_mn · shape_mn(x, y) · cos(ω·t + phase_mn)
```

Note `cos(ω·t)` - all modes oscillate at the **drive** frequency in steady state,
not at their own resonant frequencies. That is a real property of driven systems
and it is often gotten wrong. The mode's own frequency only enters through the
amplitude and the phase lag.

## The modeling choices, stated plainly

### Auto-tune: the plate is sized so the note resonates

This one is not cosmetic, it is what makes the mode work at all on real audio.

A plate driven **between** two resonances barely responds, and every mode responds
about equally weakly, so their sum has no pattern. Measured on a square plate with
`f₀ = 110 Hz` driven at 328 Hz, whose nearest mode sits at 285 Hz: the "resonant"
mode led the far-off ones by only **3x**, and fourteen modes summed into visual
mush. Land exactly on the mode and it leads by **450x** and one mode survives.

That is honest physics, and it is why real demonstrations sweep the generator
until a figure appears rather than playing arbitrary notes.

So the plate's size is nudged until the incoming note *is* a resonance: the mode
whose frequency ratio is nearest in log-frequency is selected, and `f₀` is scaled
so that mode lands on the detected pitch. Mode shapes and the relative spectrum
stay exact - this is a real plate, just a slightly different sized one. The
retuning is shown in the readout in semitones, and it can be switched off.

### Octave folding

A real plate driven at 4 kHz has hundreds of nodal lines. On a 500-pixel canvas
that is a gray blur. So the driving frequency is **folded by octaves** into the
plate's displayable range before it drives the simulation.

Each mode's physics is exact. The mapping from audio frequency to drive frequency
is a deliberate, visible choice, and the readout says so:

```
    440 Hz  A4  +0¢
    →  mode (2,3)  ·  fold -1 oct  ·  Q 180
```

The plate's fundamental is a control (**Plate size**, expressed as its fundamental
frequency, default 110 Hz). Setting it and disabling folding gives literal
unmodified physics for anyone who wants that.

## Sand transport

The pattern is not drawn as a contour of `|u| ≈ 0`. It **emerges** from particles,
because that is the actual mechanism and because the emergence is most of the
beauty.

A grain on a vibrating surface experiences vertical acceleration
`a = ∂²u/∂t² = -ω²·u`. Where `|a| > g` the grain leaves the surface, and it lands
slightly displaced. Averaged over many bounces, the bias is down the gradient of
the local vibration amplitude, so grains random-walk away from antinodes and pile
up at nodes where `|u| ≈ 0` and they stop being thrown at all.

Per particle, per frame:

```ts
const env = amplitudeEnvelope(x, y)          // |u| ignoring the cos(ωt) factor
const grad = gradient(amplitudeEnvelope, x, y)

// Drift down the amplitude gradient: the averaged effect of biased bouncing
vx -= grad.x * driftStrength
vy -= grad.y * driftStrength

// Agitation: only airborne grains scatter, so jitter scales with local amplitude
const agitation = Math.max(0, env - liftoffThreshold)
vx += (rand() - 0.5) * agitation * scatter
vy += (rand() - 0.5) * agitation * scatter

// Friction. Grains at a node are not moving, and they stay put.
vx *= damping
vy *= damping
```

The `liftoffThreshold` is the `|a| > g` condition, and it is what makes the
settling look right: as the pattern resolves, particles at the nodes fall below
threshold and go completely still while everything else is still churning. That
transition is the moment the pattern "locks in," and it happens on its own.

Roughly 12,000 particles in flat `Float32Array`s, updated in a single loop with no
allocation. The amplitude envelope is evaluated into a grid LUT once per frame
(128×128) rather than per particle.

### Two details that are load-bearing, not polish

Both were found by running the simulation headlessly and counting, after 30,000
grains on screen produced about thirty visible marks while the settled readout
said 100%. They had collapsed onto isolated points. See `test/sand.test.ts`.

1. **The gradient must be bilinear, not nearest-cell.** A piecewise-constant force
   field has cells whose discrete gradient points inward on every side. Those act
   as point traps a grain can never leave. The analytic gradient of the bilinear
   patch costs four array reads and removes them entirely.

2. **Movement must be capped per frame.** Without a cap, grains crossed several
   cells per step, overshot the nodal line they were converging on, and were
   captured wherever they happened to land. The cap is 0.55 cells per frame.

The measurable form of "looks like a pattern" is coverage of the nodal core plus
the size of the worst pile. Correct behaviour covers a third to a half of the core
with no pile above ~1% of the population; the collapse covered a few percent with
piles of ~8%.

### Inverse Chladni patterns

With very fine powder in air, acoustic streaming dominates over bouncing and
particles collect at **antinodes** instead - the inverse figures, a real and
documented phenomenon. Flipping the sign of `driftStrength` gives it, and it is a
completely different and equally valid-looking image. Shipping it as a toggle
(**Grain: sand / powder**) because it is real, it is one line, and it doubles the
visual range.

## Honesty about non-tonal input

`pitch.confidence` from the audio engine ([03-audio-engine.md](03-audio-engine.md))
gates the whole thing. On a cymbal crash or a drum fill there is no dominant
frequency, so there is no correct pattern, and inventing one would be exactly the
fakery this mode exists to avoid.

Instead, low confidence crossfades toward a **broadband** state: excite modes
weighted by the actual measured spectral energy in each mode's frequency band
rather than by a single-frequency resonance curve. The result is a churning,
unresolved surface that never settles - which is what a real plate driven by noise
does. It is still correct, it just does not have a name.

## Rendering

The physics is the shape; the render makes it an object.

- **Surface**: a dark slate plate with a subtle radial sheen, faint machining
  grain, and a real edge - a rim highlight and a contact shadow so it reads as a
  disc sitting in space rather than a circle on a background.
- **Grains**: warm off-white (`#f2ece0`), 1-1.5 px, additive so piles brighten
  where they are dense. Density carries the whole image; no outline is drawn.
- **Wave sheen** at low opacity: the signed displacement tinting the plate cool
  where it is up and warm where it is down. Subtle - it should read as light on a
  moving surface, not as a heat map. This is what sells that the plate is actually
  vibrating between the grains.
- **Motion blur** on airborne grains only, via a short per-particle trail. Settled
  grains are razor sharp. The contrast between the two is the whole effect.
- **Vignette and a trace of film grain** to sit it in the panel.

Second palette (**Ink**): near-white plate, near-black grains. Reads like a
laboratory photograph. Costs nothing and looks completely different.

## Readouts

Everything the simulation is doing, visible:

```
FREQ    440.2 Hz     A4  +1¢
CONF    0.94
MODE    (2,3)        fold -1 oct
PLATE   circular     f₀ 110 Hz
Q       180
GRAINS  20,000       settled 71%
```

`settled 71%` - the fraction of particles below the liftoff threshold - turns out
to be the most satisfying number on screen. It rises as a pattern resolves and
collapses the instant the note changes.

## Controls

- **Surface** - circular membrane / square plate
- **Plate size** - fundamental frequency, 40-400 Hz
- **Damping (Q)** - 10 (rubber) to 1000 (steel)
- **Drive point** - radius and angle, with a center detent
- **Octave fold** - on / off
- **Grain** - sand (nodes) / powder (antinodes)
- **Grain count** - 5k / 20k / 60k
- **Palette** - slate / ink

## Bessel functions in JavaScript

There is no `Math.besselJ`. The approach:

`J_m(x)` is evaluated by the ascending power series

```
J_m(x) = Σ (-1)^k / (k! · (k+m)!) · (x/2)^(2k+m)
```

which converges in double precision for the `x ≤ 30` range our zero table
requires. Upward recurrence (`J_{m+1} = (2m/x)·J_m - J_{m-1}`) is **not** used: it
is numerically unstable when `m > x`, which is exactly the situation near the plate
center where `x = k·r` is small and `m` is large.

Cost is irrelevant because each mode's radial profile is evaluated **once** into a
256-entry LUT when the mode is first activated, then bilinearly sampled. The
per-frame cost is table lookups.

Zeros `α_mn` are a static table, carrying ten decimals. Six-decimal published
values turned out not to be enough: three of them (`J₇,₃`, `J₇,₄`, `J₈,₅`) are a
full unit off in the last place, which showed up as a Newton correction of
9.8e-7 where table precision predicts 5e-7. The table is Newton-refined against
the evaluator, and cross-checked against the published mode ratios (1.5934,
2.1355, 2.2954, 2.6531, 2.9173) so it is not self-certifying.
