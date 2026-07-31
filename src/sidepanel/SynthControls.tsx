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
 * A non-knob control with its name below it, exactly where a knob puts its name.
 * The first pass captioned switches above and knobs below, which meant the eye
 * had to change direction for every other control. Hardware silkscreens the name
 * under everything; so does this.
 */
function Cell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="cell">
      {children}
      <span className="cell-label">{name}</span>
      {/* A blank value line. Knobs are three lines tall - dial, name, value -
          and cells were two, so bottom-aligning rows put cell names on the
          knobs' value line, one row too low. The blank line makes both controls
          the same shape, which pins every name to the same row by construction
          rather than by arithmetic that breaks when a control's height changes. */}
      <span className="knob-value">{'\u00A0'}</span>
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
  sectionRef,
}: {
  settings: SynthSettings
  patch: (next: Partial<SynthSettings>) => void
  octave: number
  onOctave: (v: number) => void
  /** So the app can scroll the section into view when the synth turns on. */
  sectionRef?: React.Ref<HTMLElement>
}) {
  return (
    <section className="group synth" ref={sectionRef}>
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
            <Cell name="Octave">
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
              label="Attack"
              value={settings.attack}
              min={0.001}
              max={1.5}
              step={0.002}
              reset={0.01}
              format={secs}
              onChange={(attack) => patch({ attack })}
            />
            <Knob
              label="Decay"
              value={settings.decay}
              min={0.01}
              max={2}
              step={0.01}
              reset={0.18}
              format={secs}
              onChange={(decay) => patch({ decay })}
            />
            <Knob
              label="Sustain"
              value={settings.sustain}
              min={0}
              max={1}
              step={0.01}
              reset={0.55}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(sustain) => patch({ sustain })}
            />
            <Knob
              label="Release"
              value={settings.release}
              min={0.01}
              max={3}
              step={0.01}
              reset={0.25}
              format={secs}
              onChange={(release) => patch({ release })}
            />
          </Bank>

          {/* Output volume is not an oscillator parameter; it closes the audio
              chain: osc, filter, envelope, out. */}
          <Bank name="Out">
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

          {/* After the audio chain, not inside it. The arpeggiator is a
              performance control, so it sits last - nearest the keyboard it
              drives. Ordering it after Out also means a wrap can never leave
              the single-knob Out bank alone on a line: anything that pushes
              Out down brings Arp down with it. */
          }
          <Bank name="Arp">
            <Cell name="Run">
              <Toggle
                label="Arpeggiator"
                on={settings.arpOn}
                onChange={(arpOn) => patch({ arpOn })}
              />
            </Cell>
            {/* Off does not unmount the section: the controls stay in place and
                go inert, like a hardware panel whose arp is disengaged. Removing
                them made the bank collapse to a lone Run switch stranded in a
                full-width band, and read as controls being deleted. */}
            <div className="arp-rest" inert={!settings.arpOn}>
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
                  label="Octaves"
                  value={settings.arpOctaves}
                  min={1}
                  max={3}
                  step={1}
                  reset={1}
                  format={(v) => `${Math.round(v)}`}
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
            </div>
          </Bank>
        </div>
      )}
    </section>
  )
}
