import type { ArpMode, SynthSettings, Waveform } from '../audio/synth'
import { Group, Row, Segmented, Slider, Stepper } from '../ui/controls'

const ARP_RATES = [2, 4, 6, 8, 12, 16] as const

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
            <Row label={`Octave ${octave}`}>
              <Stepper
                label="Octave"
                options={[1, 2, 3, 4, 5, 6] as const}
                value={octave as 1 | 2 | 3 | 4 | 5 | 6}
                format={(v) => `C${v}`}
                onChange={onOctave}
              />
            </Row>
            {/* Two oscillators a few cents apart. At zero they sum to one
                waveform, which is the setting to use when measuring. */}
            <Row label={`Detune ${settings.detune}¢`}>
              <Slider
                label="Detune"
                value={settings.detune}
                min={0}
                max={40}
                step={1}
                onChange={(detune) => patch({ detune })}
              />
            </Row>
            <Row label="Level">
              <Slider
                label="Level"
                value={settings.level}
                min={0}
                max={1}
                step={0.02}
                onChange={(level) => patch({ level })}
              />
            </Row>
          </>
        )}
      </Group>

      {settings.enabled && (
        <>
          <Group title="Filter">
            <Row label={`Cutoff ${formatHz(settings.cutoff)}`}>
              <Slider
                label="Cutoff"
                value={toSlider(settings.cutoff)}
                min={0}
                max={1}
                step={0.005}
                onChange={(t) => patch({ cutoff: Math.round(fromSlider(t)) })}
              />
            </Row>
            <Row label="Resonance">
              <Slider
                label="Resonance"
                value={settings.resonance}
                min={0.5}
                max={20}
                step={0.5}
                onChange={(resonance) => patch({ resonance })}
              />
            </Row>
            {/* How far the envelope opens the filter above cutoff. This is what
                gives a note a shape rather than only a volume. */}
            <Row label="Env amount">
              <Slider
                label="Envelope amount"
                value={settings.envAmount}
                min={0}
                max={5}
                step={0.1}
                onChange={(envAmount) => patch({ envAmount })}
              />
            </Row>
          </Group>

          <Group title="Envelope">
            <Row label="Attack">
              <Slider
                label="Attack"
                value={settings.attack}
                min={0.001}
                max={1.5}
                step={0.005}
                onChange={(attack) => patch({ attack })}
              />
            </Row>
            <Row label="Decay">
              <Slider
                label="Decay"
                value={settings.decay}
                min={0.01}
                max={2}
                step={0.01}
                onChange={(decay) => patch({ decay })}
              />
            </Row>
            <Row label="Sustain">
              <Slider
                label="Sustain"
                value={settings.sustain}
                min={0}
                max={1}
                step={0.02}
                onChange={(sustain) => patch({ sustain })}
              />
            </Row>
            <Row label="Release">
              <Slider
                label="Release"
                value={settings.release}
                min={0.01}
                max={3}
                step={0.01}
                onChange={(release) => patch({ release })}
              />
            </Row>
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
                <Row label="Rate">
                  <Stepper
                    label="Arpeggiator rate"
                    options={ARP_RATES}
                    value={settings.arpRate as (typeof ARP_RATES)[number]}
                    format={(v) => `${v}/s`}
                    onChange={(arpRate) => patch({ arpRate })}
                  />
                </Row>
                <Row label="Mode">
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
                </Row>
                <Row label="Octaves">
                  <Stepper
                    label="Arpeggiator octaves"
                    options={[1, 2, 3] as const}
                    value={settings.arpOctaves as 1 | 2 | 3}
                    format={(v) => `${v}`}
                    onChange={(arpOctaves) => patch({ arpOctaves })}
                  />
                </Row>
                {/* Latch keeps notes in the pattern after release, so a chord can
                    be built up one key at a time and then left running. */}
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
              </>
            )}
          </Group>
        </>
      )}
    </>
  )
}
