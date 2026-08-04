import { formatHz } from '../lib/dsp'
import {
  BANDS_PER_OCTAVE,
  FFT_SIZES,
  MAX_HZ_OPTIONS,
  MIN_HZ_OPTIONS,
  SCROLL_RATES,
  SMOOTH_OCTAVES,
  SLOPES,
  type AnalyzerReadout,
  type AnalyzerSettings,
  type AnalyzerView,
  type ColorMap,
} from '../modes/analyzer/settings'
import { Group, Readout, Row, Segmented, Slider, Stepper } from '../ui/controls'

export function AnalyzerReadouts({
  readout,
  dim,
  spectrogram,
}: {
  readout: AnalyzerReadout
  dim: boolean
  spectrogram: boolean
}) {
  return (
    <>
      <Readout label="Peak" value={formatHz(readout.peakHz)} dim={dim} />
      <Readout label="Peak dB" value={readout.peakDb.toFixed(1)} dim={dim} />
      <Readout label="Centroid" value={formatHz(readout.centroidHz)} dim={dim} />
      <Readout label="RMS" value={`${readout.rmsDb.toFixed(1)} dB`} dim={dim} />
      {spectrogram && (
        <Readout label="Span" value={`${readout.spanSec.toFixed(1)} s`} dim={dim} />
      )}
    </>
  )
}

export function AnalyzerPanel({
  settings,
  patch,
}: {
  settings: AnalyzerSettings
  patch: (next: Partial<AnalyzerSettings>) => void
}) {
  const isSpectrogram = settings.view === 'spectrogram'
  return (
    <>
      <Group title="Analyzer">
        <Row label="View">
          <Segmented<AnalyzerView>
            label="View"
            value={settings.view}
            onChange={(view) => patch({ view })}
            options={[
              { value: 'spectrum', label: 'Spectrum' },
              { value: 'spectrogram', label: 'Waterfall' },
            ]}
          />
        </Row>
        {/* Pink noise falls at 3 dB/octave and most music approximates it, so an
            untilted display always slopes down and the top end looks empty.
            Tilting makes pink read flat, which is what you judge balance against. */}
        <Row label="Tilt">
          <Stepper
            label="Display tilt"
            options={SLOPES}
            value={settings.slope as (typeof SLOPES)[number]}
            format={(v) => (v === 0 ? 'Flat' : `${v} dB/oct`)}
            onChange={(slope) => patch({ slope })}
          />
        </Row>
        {/* Straight trade of latency against low-end detail: 8192 points is a
            171 ms window and visibly lags the audio, 1024 is 21 ms but its bins
            are 47 Hz wide. */}
        <Row label="Window">
          <Stepper
            label="Analysis window"
            options={FFT_SIZES}
            value={settings.fftSize as (typeof FFT_SIZES)[number]}
            format={(v) => `${((v / 48000) * 1000).toFixed(0)} ms`}
            onChange={(fftSize) => patch({ fftSize })}
          />
        </Row>
        {/* Averaging smooths the spectrum's release. A waterfall column is a
            single moment by definition, so the control does not apply there and
            is not shown rather than shown doing nothing. */}
        {!isSpectrogram && (
          <Row label="Averaging">
            <Slider
              label="Averaging"
              value={settings.averaging}
              min={0}
              max={0.95}
              step={0.05}
              onChange={(averaging) => patch({ averaging })}
            />
          </Row>
        )}
        {isSpectrogram && (
          <Row label="Scroll">
            <Stepper
              label="Scroll rate"
              options={SCROLL_RATES}
              value={settings.scrollRate as (typeof SCROLL_RATES)[number]}
              format={(v) => `${v}/s`}
              onChange={(scrollRate) => patch({ scrollRate })}
            />
          </Row>
        )}
      </Group>

      <Group title="Display">
        {/* Same two disciplines as the scope: the continuous instrument, or
            the character grid. One switch for both analyzer views. */}
        <Row label="Style">
          <Segmented<'crt' | 'dots'>
            label="Display style"
            value={settings.displayStyle}
            onChange={(displayStyle) => patch({ displayStyle })}
            options={[
              { value: 'crt', label: 'CRT' },
              { value: 'dots', label: 'Dots' },
            ]}
          />
        </Row>
        {isSpectrogram ? (
          <Row label="Colour">
            <Segmented<ColorMap>
              label="Colour map"
              value={settings.map}
              onChange={(map) => patch({ map })}
              options={[
                { value: 'phosphor', label: 'Tube' },
                { value: 'magma', label: 'Magma' },
              ]}
            />
          </Row>
        ) : (
          <>
            <Row label="Shape">
              <Segmented<'curve' | 'bars'>
                label="Shape"
                value={settings.bars ? 'bars' : 'curve'}
                onChange={(v) => patch({ bars: v === 'bars' })}
                options={[
                  { value: 'curve', label: 'Curve' },
                  { value: 'bars', label: 'Bars' },
                ]}
              />
            </Row>
            {settings.bars && (
              <Row label="Bands">
                <Stepper
                  label="Bands per octave"
                  options={BANDS_PER_OCTAVE}
                  value={settings.bandsPerOctave as (typeof BANDS_PER_OCTAVE)[number]}
                  format={(v) => (v === 1 ? 'Octave' : `1/${v} oct`)}
                  onChange={(bandsPerOctave) => patch({ bandsPerOctave })}
                />
              </Row>
            )}
            {/* Constant-Q: smooths proportionally to frequency, so it stays
                light where the ear resolves finely. Bars skip it because banding
                already does the same job. */}
            {!settings.bars && (
              <Row label="Smoothing">
                <Stepper
                  label="Curve smoothing"
                  options={SMOOTH_OCTAVES}
                  value={settings.smoothOctave as (typeof SMOOTH_OCTAVES)[number]}
                  format={(v) => (v === 0 ? 'Off' : `1/${v} oct`)}
                  onChange={(smoothOctave) => patch({ smoothOctave })}
                />
              </Row>
            )}
            <Row label="Peak hold">
              <Segmented<'on' | 'off'>
                label="Peak hold"
                value={settings.peakHold ? 'on' : 'off'}
                onChange={(v) => patch({ peakHold: v === 'on' })}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </Row>
            {settings.peakHold && (
              <Row label="Hold fall">
                <Slider
                  label="Peak decay"
                  value={settings.peakDecay}
                  min={3}
                  max={60}
                  step={3}
                  onChange={(peakDecay) => patch({ peakDecay })}
                />
              </Row>
            )}
          </>
        )}
      </Group>

      <Group title="Range">
        <Row label="Floor">
          <Slider
            label="Floor dB"
            value={settings.floorDb}
            min={-120}
            max={-40}
            step={6}
            onChange={(floorDb) => patch({ floorDb })}
          />
        </Row>
        <Row label="Ceiling">
          <Slider
            label="Ceiling dB"
            value={settings.ceilDb}
            min={-36}
            max={0}
            step={6}
            onChange={(ceilDb) => patch({ ceilDb })}
          />
        </Row>
        <Row label="Low Hz">
          <Stepper
            label="Lowest frequency"
            options={MIN_HZ_OPTIONS}
            value={settings.minHz as (typeof MIN_HZ_OPTIONS)[number]}
            format={(v) => `${v} Hz`}
            onChange={(minHz) => patch({ minHz })}
          />
        </Row>
        {/* Capped below Nyquist at render time, so a 24 kHz setting simply shows
            everything the sample rate has. */}
        <Row label="High Hz">
          <Stepper
            label="Highest frequency"
            options={MAX_HZ_OPTIONS}
            value={settings.maxHz as (typeof MAX_HZ_OPTIONS)[number]}
            format={(v) => `${v / 1000} kHz`}
            onChange={(maxHz) => patch({ maxHz })}
          />
        </Row>
      </Group>
    </>
  )
}
