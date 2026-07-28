import { formatHz } from '../lib/dsp'
import type { Surface } from '../modes/cymatics/plate'
import {
  GRAIN_COUNTS,
  type CymaticsReadout,
  type CymaticsSettings,
  type Grain,
  type Palette,
} from '../modes/cymatics/settings'
import { Group, Readout, Row, Segmented, Slider, Stepper } from '../ui/controls'

export function CymaticsReadouts({
  readout,
  dim,
}: {
  readout: CymaticsReadout
  dim: boolean
}) {
  // The pattern is only meaningful when the input is actually tonal, so the
  // readouts fade with confidence rather than lying at full strength.
  const unsure = dim || readout.confidence < 0.25
  return (
    <>
      <Readout
        label="Freq"
        value={readout.hz > 0 ? formatHz(readout.hz) : '--'}
        dim={dim}
      />
      <Readout
        label="Note"
        value={
          readout.hz > 0
            ? `${readout.note} ${readout.cents >= 0 ? '+' : ''}${readout.cents}¢`
            : '--'
        }
        dim={unsure}
      />
      <Readout label="Conf" value={readout.confidence.toFixed(2)} dim={dim} />
      <Readout
        label="Mode"
        value={readout.fold !== 0 ? `${readout.mode} ${readout.fold > 0 ? '+' : ''}${readout.fold}oct` : readout.mode}
        dim={unsure}
      />
      <Readout
        label="Tune"
        value={Math.abs(readout.detune) < 0.05 ? '0' : `${readout.detune > 0 ? '+' : ''}${readout.detune.toFixed(1)}st`}
        dim={unsure}
      />
      <Readout label="Settled" value={`${Math.round(readout.settled * 100)}%`} dim={dim} />
      <Readout label="Grains" value={readout.grains.toLocaleString()} dim={dim} />
    </>
  )
}

export function CymaticsPanel({
  settings,
  patch,
}: {
  settings: CymaticsSettings
  patch: (next: Partial<CymaticsSettings>) => void
}) {
  return (
    <>
      <Group title="Plate">
        <Row label="Surface">
          <Segmented<Surface>
            label="Surface"
            value={settings.surface}
            onChange={(surface) => patch({ surface })}
            options={[
              { value: 'plate', label: 'Chladni' },
              { value: 'drum', label: 'Drum' },
              { value: 'square', label: 'Square' },
            ]}
          />
        </Row>
        <Row label="Fundamental">
          <Slider
            label="Plate fundamental"
            value={settings.plateHz}
            min={40}
            max={400}
            step={5}
            onChange={(plateHz) => patch({ plateHz })}
          />
        </Row>
        {/* Q is material damping, and it is the most expressive control here:
            sharp snaps hard between patterns, broad sums many modes. */}
        <Row label={`Damping Q ${settings.q}`}>
          <Slider
            label="Damping"
            value={settings.q}
            min={10}
            max={1000}
            step={10}
            onChange={(q) => patch({ q })}
          />
        </Row>
      </Group>

      <Group title="Drive">
        {/* At radius 0 only the axially symmetric modes are excited, because
            every other mode has a node through the center. */}
        <Row label="Position">
          <Slider
            label="Drive radius"
            value={settings.driveRadius}
            min={0}
            max={0.95}
            step={0.01}
            onChange={(driveRadius) => patch({ driveRadius })}
          />
        </Row>
        <Row label="Angle">
          <Slider
            label="Drive angle"
            value={settings.driveAngle}
            min={0}
            max={6.28}
            step={0.05}
            onChange={(driveAngle) => patch({ driveAngle })}
          />
        </Row>
        {/* Without this the plate is usually driven between resonances, where a
            real plate barely responds and no pattern forms. See ExciteOptions.tune. */}
        <Row label="Auto-tune">
          <Segmented<'on' | 'off'>
            label="Auto-tune plate"
            value={settings.tune ? 'on' : 'off'}
            onChange={(v) => patch({ tune: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
        <Row label="Octave fold">
          <Segmented<'on' | 'off'>
            label="Octave fold"
            value={settings.fold ? 'on' : 'off'}
            onChange={(v) => patch({ fold: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Grains">
        <Row label="Collect at">
          <Segmented<Grain>
            label="Grain type"
            value={settings.grain}
            onChange={(grain) => patch({ grain })}
            options={[
              { value: 'sand', label: 'Nodes' },
              { value: 'powder', label: 'Antinodes' },
            ]}
          />
        </Row>
        <Row label="Count">
          <Stepper
            label="Grain count"
            options={GRAIN_COUNTS}
            value={settings.grainCount as (typeof GRAIN_COUNTS)[number]}
            format={(v) => v.toLocaleString()}
            onChange={(grainCount) => patch({ grainCount })}
          />
        </Row>
        <Row label="Palette">
          <Segmented<Palette>
            label="Palette"
            value={settings.palette}
            onChange={(palette) => patch({ palette })}
            options={[
              { value: 'slate', label: 'Slate' },
              { value: 'ink', label: 'Ink' },
            ]}
          />
        </Row>
        <Row label="Wave sheen">
          <Segmented<'on' | 'off'>
            label="Wave sheen"
            value={settings.sheen ? 'on' : 'off'}
            onChange={(v) => patch({ sheen: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
      </Group>
    </>
  )
}
