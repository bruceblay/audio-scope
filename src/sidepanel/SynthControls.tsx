import type { ArpMode, SynthSettings, Waveform } from '../audio/synth'
import { Group, Row, Segmented, Stepper } from '../ui/controls'
import { Knob } from '../ui/Knob'

/**
 * Cutoff is stored in Hz but driven logarithmically. A linear cutoff slider
 * spends most of its travel above 10 kHz, where nothing happens, and crosses the
 * entire useful range in the first centimetre.
 */
const HZ_MIN = 60
const HZ_MAX = 16000
const toSlider = (hz: number) => Math.log(hz / HZ_MIN) / Math.log(HZ_MAX / HZ_MIN)
const fromSlider = (t: number) => HZ_MIN * Math.pow(HZ_MAX / HZ_MIN, t)

const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`)

const secs = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`)

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
    <>
      <Group title="Synth">
        <Row label="Enable">
          <Segmented<'on' | 'off'>
            label="Synth"
            value={settings.enabled ? 'on' : 'off'}
            onChange={(v) => patch({ enabled: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>

        {settings.enabled && (
          <>
            <Row label="Wave">
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
            </Row>
            <Row label="Octave">
              <Stepper
                label="Octave"
                options={[1, 2, 3, 4, 5, 6] as const}
                value={octave as 1 | 2 | 3 | 4 | 5 | 6}
                format={(v) => `C${v}`}
                onChange={onOctave}
              />
            </Row>
            <div className="knobs">
              {/* Two oscillators a few cents apart. At zero they sum to one
                  waveform, which is the setting to measure with. */}
              <Knob
                label="Detune"
                value={settings.detune}
                min={0}
                max={40}
                step={1}
                reset={12}
                format={(v) => `${Math.round(v)}\u00a2`}
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
            </div>
          </>
        )}
      </Group>

      {settings.enabled && (
        <>
          <Group title="Filter">
            <div className="knobs">
              <Knob
                label="Cutoff"
                value={toSlider(settings.cutoff)}
                min={0}
                max={1}
                step={0.004}
                reset={toSlider(2200)}
                format={(t) => formatHz(fromSlider(t))}
                onChange={(t) => patch({ cutoff: Math.round(fromSlider(t)) })}
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
              {/* How far the envelope opens the filter above cutoff. This is
                  what gives a note a shape rather than only a volume. */}
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
            </div>
          </Group>

          <Group title="Envelope">
            <div className="knobs">
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
            </div>
          </Group>

          <Group title="Arpeggiator">
            <Row label="Run">
              <Segmented<'on' | 'off'>
                label="Arpeggiator"
                value={settings.arpOn ? 'on' : 'off'}
                onChange={(v) => patch({ arpOn: v === 'on' })}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </Row>
            {settings.arpOn && (
              <>
                <Row label="Mode">
                  <Segmented<ArpMode>
                    label="Arpeggiator mode"
                    value={settings.arpMode}
                    onChange={(arpMode) => patch({ arpMode })}
                    options={[
                      { value: 'up', label: '\u2191' },
                      { value: 'down', label: '\u2193' },
                      { value: 'updown', label: '\u2195' },
                      { value: 'random', label: '?' },
                    ]}
                  />
                </Row>
                {/* Latch keeps notes in the pattern after release, so a chord
                    can be built up one key at a time and left running. */}
                <Row label="Latch">
                  <Segmented<'on' | 'off'>
                    label="Latch"
                    value={settings.arpLatch ? 'on' : 'off'}
                    onChange={(v) => patch({ arpLatch: v === 'on' })}
                    options={[
                      { value: 'on', label: 'On' },
                      { value: 'off', label: 'Off' },
                    ]}
                  />
                </Row>
                <div className="knobs">
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
                </div>
              </>
            )}
          </Group>
        </>
      )}
    </>
  )
}
