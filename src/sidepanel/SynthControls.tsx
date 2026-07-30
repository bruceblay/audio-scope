import type { ReactNode } from 'react'
import type { ArpMode, SynthSettings, Waveform } from '../audio/synth'
import { Segmented, Stepper } from '../ui/controls'
import { Knob } from '../ui/Knob'

/**
 * The synth panel does not use the Row/Group layout the rest of the rail uses,
 * on purpose.
 *
 * A settings list puts one control per full-width row with its label pinned to
 * the far left and the control to the far right, which leaves a wide empty gap
 * between a control and its own name, and a section holding three knobs still
 * eats the full width of the panel. That reads fine for eight scope settings and
 * badly for twenty-five synth parameters.
 *
 * A front panel groups controls into banks instead: the caption sits directly
 * above the things it names, and banks are only as wide as their contents so
 * several share a row. Nothing here is beholden to the scope's controls, because
 * an instrument is a different object from a settings screen.
 */

/**
 * Cutoff is stored in Hz but driven logarithmically. A linear cutoff knob spends
 * most of its travel above 10 kHz, where nothing happens, and crosses the entire
 * useful range in the first few degrees.
 */
const HZ_MIN = 60
const HZ_MAX = 16000
const toKnob = (hz: number) => Math.log(hz / HZ_MIN) / Math.log(HZ_MAX / HZ_MIN)
const fromKnob = (t: number) => HZ_MIN * Math.pow(HZ_MAX / HZ_MIN, t)

const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`)
const secs = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`)

/** A captioned cluster of controls, sized to its contents so banks share a row. */
function Bank({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="bank" aria-label={name}>
      <span className="bank-cap">{name}</span>
      <div className="bank-row">{children}</div>
    </section>
  )
}

/**
 * A switch with its caption directly above it. Knobs already name themselves
 * under the dial; this gives switches the same treatment so a bank reads as one
 * kind of thing rather than two.
 */
function Cell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="bank-sub">
      <span className="bank-cap">{name}</span>
      {children}
    </div>
  )
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Segmented<'on' | 'off'>
      label={label}
      value={on ? 'on' : 'off'}
      onChange={(v) => onChange(v === 'on')}
      options={[
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ]}
    />
  )
}

export function SynthPanel({
  settings,
  patch,
  octave,
  onOctave,
}: {
  settings: SynthSettings
  patch: (next: Partial<SynthSettings>) => void
  octave: number
  onOctave: (v: number) => void
}) {
  return (
    <section className="group synth">
      <div className="synth-head">
        <span className="legend group-title">Synth</span>
        <Toggle label="Synth" on={settings.enabled} onChange={(enabled) => patch({ enabled })} />
      </div>

      {settings.enabled && (
        <div className="banks">
          <Bank name="Osc">
            <Cell name="Wave">
              <Segmented<Waveform>
                label="Waveform"
                value={settings.waveform}
                onChange={(waveform) => patch({ waveform })}
                options={[
                  { value: 'sine', label: 'Sin' },
                  { value: 'triangle', label: 'Tri' },
                  { value: 'sawtooth', label: 'Saw' },
                  { value: 'square', label: 'Sqr' },
                ]}
              />
            </Cell>
            <Cell name="Oct">
              <Stepper
                label="Octave"
                options={[1, 2, 3, 4, 5, 6] as const}
                value={octave as 1 | 2 | 3 | 4 | 5 | 6}
                format={(v) => `C${v}`}
                onChange={onOctave}
              />
            </Cell>
            {/* Two oscillators a few cents apart. At zero they sum to one
                waveform, which is the setting to measure with. */}
            <Knob
              label="Detune"
              value={settings.detune}
              min={0}
              max={40}
              step={1}
              reset={12}
              format={(v) => `${Math.round(v)}¢`}
              onChange={(detune) => patch({ detune })}
            />
            <Knob
              label="Level"
              value={settings.level}
              min={0}
              max={1}
              step={0.01}
              reset={0.5}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(level) => patch({ level })}
            />
          </Bank>

          <Bank name="Filter">
            <Knob
              label="Cutoff"
              value={toKnob(settings.cutoff)}
              min={0}
              max={1}
              step={0.004}
              reset={toKnob(2200)}
              format={(t) => formatHz(fromKnob(t))}
              onChange={(t) => patch({ cutoff: Math.round(fromKnob(t)) })}
            />
            <Knob
              label="Res"
              value={settings.resonance}
              min={0.5}
              max={20}
              step={0.5}
              reset={6}
              format={(v) => v.toFixed(1)}
              onChange={(resonance) => patch({ resonance })}
            />
            {/* How far the envelope opens the filter above cutoff. This is what
                gives a note a shape rather than only a volume. */}
            <Knob
              label="Env"
              value={settings.envAmount}
              min={0}
              max={5}
              step={0.1}
              reset={1.8}
              format={(v) => `${v.toFixed(1)}oct`}
              onChange={(envAmount) => patch({ envAmount })}
            />
          </Bank>

          <Bank name="Envelope">
            <Knob
              label="Att"
              value={settings.attack}
              min={0.001}
              max={1.5}
              step={0.002}
              reset={0.01}
              format={secs}
              onChange={(attack) => patch({ attack })}
            />
            <Knob
              label="Dec"
              value={settings.decay}
              min={0.01}
              max={2}
              step={0.01}
              reset={0.18}
              format={secs}
              onChange={(decay) => patch({ decay })}
            />
            <Knob
              label="Sus"
              value={settings.sustain}
              min={0}
              max={1}
              step={0.01}
              reset={0.55}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(sustain) => patch({ sustain })}
            />
            <Knob
              label="Rel"
              value={settings.release}
              min={0.01}
              max={3}
              step={0.01}
              reset={0.25}
              format={secs}
              onChange={(release) => patch({ release })}
            />
          </Bank>

          <Bank name="Arp">
            <Cell name="Run">
              <Toggle
                label="Arpeggiator"
                on={settings.arpOn}
                onChange={(arpOn) => patch({ arpOn })}
              />
            </Cell>
            {settings.arpOn && (
              <>
                <Cell name="Mode">
                  <Segmented<ArpMode>
                    label="Arpeggiator mode"
                    value={settings.arpMode}
                    onChange={(arpMode) => patch({ arpMode })}
                    options={[
                      { value: 'up', label: '↑' },
                      { value: 'down', label: '↓' },
                      { value: 'updown', label: '↕' },
                      { value: 'random', label: '?' },
                    ]}
                  />
                </Cell>
                <Knob
                  label="Rate"
                  value={settings.arpRate}
                  min={1}
                  max={20}
                  step={1}
                  reset={8}
                  format={(v) => `${Math.round(v)}/s`}
                  onChange={(arpRate) => patch({ arpRate })}
                />
                <Knob
                  label="Range"
                  value={settings.arpOctaves}
                  min={1}
                  max={3}
                  step={1}
                  reset={1}
                  format={(v) => `${Math.round(v)}oct`}
                  onChange={(arpOctaves) => patch({ arpOctaves })}
                />
                {/* Latch keeps notes in the pattern after release, so a chord can
                    be built up one key at a time and left running. */}
                <Cell name="Latch">
                  <Toggle
                    label="Latch"
                    on={settings.arpLatch}
                    onChange={(arpLatch) => patch({ arpLatch })}
                  />
                </Cell>
              </>
            )}
          </Bank>
        </div>
      )}
    </section>
  )
}
