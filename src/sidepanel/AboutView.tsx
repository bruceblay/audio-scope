/**
 * About / help, following browser-fx's pattern: a circular `i` in the header
 * swaps the whole panel for this, and the ✕ swaps it back.
 *
 * Written as instructions rather than marketing. The things a user cannot work
 * out by poking at it are the capture-rights rule and what the trigger is for,
 * so those get the most room.
 */
import { CloseGlyph } from '../ui/glyphs'

export function AboutView({ onClose }: { onClose: () => void }) {
  return (
    <div className="app">
      <div className="tabs">
        <span className="about-title">About Audio Scope</span>
        <button
          type="button"
          className="info-btn"
          aria-label="Close about"
          onClick={onClose}
        >
          <CloseGlyph />
        </button>
      </div>
      <div className="seam" />

      <div className="about">
        <p>
          <strong>Audio Scope</strong> is a real oscilloscope and spectrum analyzer for
          whatever a browser tab is playing. Audio passes through untouched — nothing is
          added to it and nothing leaves your machine.
        </p>

        <h4>getting started</h4>
        <ol>
          <li>
            Open the tab you want to watch, then click the <strong>Audio Scope</strong> icon
            in the toolbar. That click is what grants permission to read the tab, so it has
            to happen on the tab itself.
          </li>
          <li>
            Press <strong>Connect</strong>. The tab keeps playing exactly as before.
          </li>
          <li>
            Press <strong>Disconnect</strong>, or just close the panel, to hand the audio
            back.
          </li>
        </ol>
        <p className="about-note">
          When you move to a new tab, the panel follows and reconnects by itself wherever
          Chrome allows. When Chrome wants a fresh click first, the panel says so — press
          the toolbar button (or Alt+A) and it takes it from there. Chrome withdraws capture rights
          whenever a tab navigates, and no extension can renew them without that click.
        </p>

        <h4>oscilloscope</h4>
        <p>
          <strong>L+R</strong>, <strong>L</strong> and <strong>R</strong> give the ordinary
          sweep, voltage against time, and L+R is the default. The <strong>trigger</strong> is
          what holds a repeating waveform still instead of letting it slide. Leave it on Auto
          and it finds the level itself.
        </p>
        <p>
          <strong>X-Y</strong> plots left against right. It is a goniometer: mono content
          collapses onto the rising diagonal, out-of-phase content swings to the falling one,
          and wide stereo opens into a shape. Oscilloscope music is composed for this display
          and draws pictures in it.
        </p>
        <ul>
          <li>
            <strong>Time / div</strong> and <strong>Volts / div</strong> scale the sweep, in
            the 1-2-5 steps a bench scope uses. The screen is ruled 10 × 8.
          </li>
          <li>
            In X-Y the beam streams: every sample is drawn exactly once as it arrives, as
            on a real tube. <strong>Persistence</strong> decides how long it stays.
          </li>
          <li>
            <strong>Style</strong> switches the display discipline: CRT is the beam and
            phosphor; Dots draws the same trace as a terminal would: a dithered dot grid
            with a lazy refresh.
          </li>
          <li>
            <strong>BW limit</strong> is the bench scope's noise button: a lowpass on the
            vertical channel, in hertz. It removes fuzz within the trace and steadies the
            trigger.
          </li>
          <li>
            <strong>Halation</strong> fuses the overlapping passes the phosphor holds, the way
            a real tube's glow does. If the trace looks scribbled over itself, raise it; at
            zero every pass stays razor sharp.
          </li>
          <li>
            <strong>Persistence</strong> is phosphor afterglow. <strong>Focus</strong> is
            beam width, <strong>Intensity</strong> is brightness — two separate knobs, as on
            the real thing.
          </li>
        </ul>

        <h4>analyzer</h4>
        <ul>
          <li>
            <strong>Spectrum</strong> is level against frequency. <strong>Waterfall</strong>
            is the same thing over time, with colour for level.
          </li>
          <li>
            <strong>Tilt</strong> is the one to understand. Music roughly follows pink noise,
            which falls 3 dB per octave, so an untilted display always slopes downhill and
            the top end looks empty. At 3 dB/oct pink reads flat, which is what you judge
            balance against.
          </li>
          <li>
            <strong>Style</strong> works here too: Dots redraws the curve as points, the bars
            as blocks, and the waterfall as a dithered character grid.
          </li>
          <li>
            <strong>Window</strong> trades latency against low-end detail: 21 ms feels
            immediate but cannot resolve much under 100 Hz, while 683 ms separates individual
            bass partials and visibly lags.
          </li>
          <li>
            <strong>Smoothing</strong> is in octave fractions, so it smooths proportionally
            rather than by a fixed number of hertz.
          </li>
        </ul>

        <h4>presets</h4>
        <p>
          The disk icon in the header saves and recalls complete setups. Factory presets
          cover the classics (oscilloscope music, spectrogram art, a stock bench scope),
          and saving never overwrites: your presets are yours until you update or delete
          them.
        </p>

        <h4>panel</h4>
        <p>
          <strong>Studio</strong> is the dark panel. <strong>Bench</strong> is a light one
          modelled on a Tektronix 2236, the analog scope from their 2200 series. The screen
          stays dark in both, because that is what makes a trace read.
        </p>

        <h4>privacy</h4>
        <p>
          Audio Scope makes no network requests of any kind. Nothing is recorded, uploaded or
          analysed anywhere but on this machine, and the only thing stored is your control
          settings.
        </p>
      </div>
    </div>
  )
}
