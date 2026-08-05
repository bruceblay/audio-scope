import { formatHz, formatSeconds } from '../lib/dsp'
import {
  type DisplayStyle,
  TIME_PER_DIV,
  VOLTS_PER_DIV,
  type Channel,
  type ScopeReadout,
  type ScopeSettings,
  type TriggerMode,
  type TriggerSlope,
} from '../modes/scope/settings'
import { BW_OPTIONS } from '../modes/scope/bandwidth'
import { Group, Readout, Row, Segmented, Slider, Stepper } from '../ui/controls'
import { phosphor, type PhosphorId } from '../ui/tokens'

export function ScopeReadouts({
  readout,
  settings,
  dim,
}: {
  readout: ScopeReadout
  settings: ScopeSettings
  dim: boolean
}) {
  const isXY = settings.channel === 'xy'
  return (
    <>
      <Readout label="Vpp" value={`${readout.vpp.toFixed(3)} FS`} dim={dim} />
      <Readout label="Vrms" value={`${readout.vrms.toFixed(3)} FS`} dim={dim} />
      <Readout label="dBFS" value={readout.dbfs.toFixed(1)} dim={dim} />
      {isXY ? (
        <Readout label="Corr" value={readout.correlation.toFixed(2)} dim={dim} />
      ) : (
        <>
          <Readout label="Freq" value={formatHz(readout.hz)} dim={dim || !readout.triggered} />
          <Readout
            label="Period"
            value={readout.period > 0 ? formatSeconds(readout.period) : '--'}
            dim={dim || !readout.triggered}
          />
          <Readout
            label="Duty"
            value={readout.duty > 0 ? `${(readout.duty * 100).toFixed(1)}%` : '--'}
            dim={dim || !readout.triggered}
          />
        </>
      )}
    </>
  )
}

export function ScopePanel({
  settings,
  patch,
}: {
  settings: ScopeSettings
  patch: (next: Partial<ScopeSettings>) => void
}) {
  const isDots = settings.displayStyle === 'dots'
  const isXY = settings.channel === 'xy'
  return (
    <>
      <Group title="Vertical">
        <Row label="Channel">
          <Segmented<Channel>
            label="Channel"
            value={settings.channel}
            onChange={(channel) => patch({ channel })}
            options={[
              { value: 'sum', label: 'L+R' },
              { value: 'left', label: 'L' },
              { value: 'right', label: 'R' },
              { value: 'xy', label: 'X-Y' },
            ]}
          />
        </Row>
        <Row label="Volts / div">
          <Stepper
            label="Volts per division"
            options={VOLTS_PER_DIV}
            value={settings.voltsPerDiv}
            format={(v) => (v < 1 ? `${(v * 1000).toFixed(0)} mFS` : `${v.toFixed(0)} FS`)}
            onChange={(voltsPerDiv) => patch({ voltsPerDiv })}
          />
        </Row>
        {/* The BW LIMIT button. Off preserves the scribble, which is part of
            the instrument's character; each step down cleans it honestly, in
            hertz, and steadies the trigger with it. */}
        <Row label="BW limit">
          <Stepper
            label="Bandwidth limit"
            options={BW_OPTIONS}
            value={settings.bandwidth as (typeof BW_OPTIONS)[number]}
            format={(v) => (v === 0 ? 'Full' : v >= 1000 ? `${v / 1000} kHz` : `${v} Hz`)}
            onChange={(bandwidth) => patch({ bandwidth })}
          />
        </Row>
        {!isXY && (
          <Row label="Position">
            <Slider
              label="Vertical position"
              value={settings.positionY}
              min={-3}
              max={3}
              step={0.1}
              onChange={(positionY) => patch({ positionY })}
            />
          </Row>
        )}
      </Group>

      {isXY && (
        <Group title="Beam">
          {/* Exposure is the X-Y equivalent of a time base. The full record is
              85 ms at 48 kHz, which drawn all at once reads as lag and scribble.
              Shorter is more current and cleaner; persistence supplies the tail. */}
          <Row label="Smoothing">
            <Slider
              label="Smoothing"
              value={settings.xySmoothing}
              min={0}
              max={1}
              step={0.05}
              onChange={(xySmoothing) => patch({ xySmoothing })}
            />
          </Row>
        </Group>
      )}

      {!isXY && (
        <Group title="Horizontal">
          <Row label="Time / div">
            <Stepper
              label="Time per division"
              options={TIME_PER_DIV}
              value={settings.timePerDiv}
              format={formatSeconds}
              onChange={(timePerDiv) => patch({ timePerDiv })}
            />
          </Row>
          <Row label="Trigger pos">
            <Slider
              label="Trigger position"
              value={settings.positionX}
              min={0.05}
              max={0.95}
              step={0.05}
              onChange={(positionX) => patch({ positionX })}
            />
          </Row>
        </Group>
      )}

      {!isXY && (
        <Group title="Trigger">
          <Row label="Mode">
            <Segmented<TriggerMode>
              label="Trigger mode"
              value={settings.triggerMode}
              onChange={(triggerMode) => patch({ triggerMode })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'normal', label: 'Norm' },
                { value: 'free', label: 'Free' },
              ]}
            />
          </Row>
          <Row label="Slope">
            <Segmented<TriggerSlope>
              label="Trigger slope"
              value={settings.triggerSlope}
              onChange={(triggerSlope) => patch({ triggerSlope })}
              options={[
                { value: 'rising', label: '↗' },
                { value: 'falling', label: '↘' },
                { value: 'either', label: '↕' },
              ]}
            />
          </Row>
          <Row label="Level">
            <Segmented<'auto' | 'manual'>
              label="Trigger level source"
              value={settings.triggerAuto ? 'auto' : 'manual'}
              onChange={(v) => patch({ triggerAuto: v === 'auto' })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'manual', label: 'Set' },
              ]}
            />
          </Row>
          {!settings.triggerAuto && (
            <Row label="Level FS">
              <Slider
                label="Trigger level"
                value={settings.triggerLevel}
                min={-1}
                max={1}
                step={0.005}
                onChange={(triggerLevel) => patch({ triggerLevel })}
              />
            </Row>
          )}
          <Row label="Noise rej">
            <Slider
              label="Trigger hysteresis"
              value={settings.hysteresis}
              min={0}
              max={0.4}
              step={0.01}
              onChange={(hysteresis) => patch({ hysteresis })}
            />
          </Row>
        </Group>
      )}

      <Group title="Display">
        {/* Two display disciplines, one instrument: the beam-and-phosphor CRT,
            or the same trace drawn the way a terminal draws it. */}
        <Row label="Style">
          <Segmented<DisplayStyle>
            label="Display style"
            value={settings.displayStyle}
            onChange={(displayStyle) => patch({ displayStyle })}
            options={[
              { value: 'crt', label: 'CRT' },
              { value: 'dots', label: 'Dots' },
            ]}
          />
        </Row>
        <Row label="Phosphor">
          <Segmented<PhosphorId>
            label="Phosphor"
            value={settings.phosphor}
            onChange={(p) => patch({ phosphor: p })}
            options={(Object.keys(phosphor) as PhosphorId[]).map((id) => ({
              value: id,
              label: phosphor[id].label.split(' ')[1],
            }))}
          />
        </Row>
        <Row label="Persistence">
          <Slider
            label="Persistence"
            value={settings.persistence}
            min={0}
            max={2}
            step={0.05}
            onChange={(persistence) => patch({ persistence })}
          />
        </Row>
        {/* FOCUS on a real front panel. Higher is a tighter spot. */}
        {/* Beam optics: CRT-only. The lattice has no beam to focus and no
            phosphor image to diffuse. */}
        {!isDots && (
          <>
        <Row label="Focus">
          <Slider
            label="Focus"
            value={settings.beamFocus}
            min={0}
            max={1}
            step={0.05}
            onChange={(beamFocus) => patch({ beamFocus })}
          />
        </Row>
        {/* Fuses the slightly-different passes persistence stacks up, which is
            what the scribble is. Smoothing and BW limit act within one pass
            and cannot reach it. */}
        <Row label="Halation">
          <Slider
            label="Halation"
            value={settings.halation}
            min={0}
            max={1}
            step={0.05}
            onChange={(halation) => patch({ halation })}
          />
        </Row>
          </>
        )}
        <Row label="Intensity">
          <Slider
            label="Intensity"
            value={settings.intensity}
            min={0.1}
            max={2}
            step={0.05}
            onChange={(intensity) => patch({ intensity })}
          />
        </Row>
        <Row label="Graticule">
          <Slider
            label="Graticule brightness"
            value={settings.graticuleBrightness}
            min={0}
            max={2}
            step={0.1}
            onChange={(graticuleBrightness) => patch({ graticuleBrightness })}
          />
        </Row>
      </Group>
    </>
  )
}
