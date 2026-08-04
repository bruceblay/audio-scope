CHROME WEB STORE CONTENT FOR AUDIO SCOPE
Every block below is plain text. Copy between the ruled lines straight into
the matching dashboard field.

========================================================================
SHORT DESCRIPTION  (123/132 characters)
========================================================================

A real oscilloscope for any tab: triggered CRT trace, X-Y stereo field, spectrum analyzer, waterfall, and a built-in synth.

========================================================================
DETAILED DESCRIPTION
========================================================================

Audio Scope is a real oscilloscope and spectrum analyzer for whatever a browser tab is playing. Audio passes through untouched: nothing is added to it, and nothing ever leaves your machine.

The visualizations are real, not decorative. The trigger, the measurements, the frequency analysis: all of it is the actual signal processing a bench instrument does, verified against synthetic test signals. If the readout says 440 Hz, it is 440 Hz.

OSCILLOSCOPE
• Triggered sweep with sub-sample edge interpolation, so a steady waveform stands still
• X-Y (goniometer) mode: mono collapses to a diagonal, stereo opens into a shape. Oscilloscope music draws pictures in it
• Calibrated time base and volts-per-division in the 1-2-5 steps a real scope uses
• Beam physics: brightness follows dwell time, phosphor persistence decays like a tube, halation fuses the trace
• Three phosphors (green, long-persistence blue, amber), bandwidth limit, and live measurements: Vpp, Vrms, dBFS, frequency, period, duty cycle

ANALYZER
• Spectrum curve or third-octave bars with peak hold and pink-noise tilt for judging tonal balance
• Waterfall spectrogram with a perceptually uniform color ramp
• Log frequency axis, fractional-octave smoothing, selectable analysis window from snappy to bass-resolving

DOTS MODE
Every view can also render as a dithered dot grid, the way a terminal plotter draws: quantized brightness, chunky cells, a lazy refresh. Same signal, same measurements, retro display.

BUILT-IN SYNTH
A two-oscillator synth with filter, envelopes, delay, reverb, and an arpeggiator, played from your computer keyboard. It exists so you always have a known signal to explore: hold a note and watch the exact waveform and spectrum it produces.

PRESETS
Factory scenes for oscilloscope music, spectrogram art, a stock bench scope and more, plus your own, saved and synced.

PRIVACY
Audio Scope makes no network requests of any kind. No analytics, no accounts, no servers. Audio is analyzed on your machine and nowhere else; the only thing stored is your settings.

HOW IT WORKS
Click the Audio Scope button in your toolbar on the tab you want to watch (Chrome requires this click to share a tab's audio, the same permission model as screen sharing). The panel opens alongside your browsing and reconnects on its own as you move around. Press Alt+A as a shortcut for the same thing.

========================================================================
CATEGORY
========================================================================

Primary: Tools
(Entertainment also fits; Tools matches "instrument" better.)

========================================================================
SINGLE-PURPOSE DESCRIPTION
========================================================================

Visualize the audio of a browser tab in real time as an oscilloscope, spectrum analyzer, and spectrogram.

========================================================================
PERMISSION JUSTIFICATION: tabCapture
========================================================================

Captures the audio stream of a tab so the extension can visualize it as an oscilloscope trace and spectrum. The audio passes through to the speakers unchanged; capture is the only way to read a tab's audio for analysis.

========================================================================
PERMISSION JUSTIFICATION: activeTab
========================================================================

Chrome's tabCapture API requires the activeTab grant, given when the user clicks the extension's toolbar button on a tab. The extension can only ever access tabs the user has explicitly invoked it on.

========================================================================
PERMISSION JUSTIFICATION: sidePanel
========================================================================

The extension's entire interface, the oscilloscope screen, analyzer, and controls, lives in Chrome's side panel so it can be watched alongside the tab that is playing.

========================================================================
PERMISSION JUSTIFICATION: storage
========================================================================

Saves the user's control settings and their saved presets (chrome.storage.sync), so the instrument opens the way they left it. No audio and no browsing data is ever stored.

========================================================================
DATA USAGE DISCLOSURES (privacy tab)
========================================================================

Does not collect any user data: check no categories.
No remote code: all code is packaged in the extension. No CDNs, no eval, no external requests of any kind.

========================================================================
STORE LISTING METADATA
========================================================================

Developer name: Bruce Blay
Support email: bruceblay@gmail.com

========================================================================
RELEASE CHECKLIST (not for the store; for us)
========================================================================

1. npm run package  ->  audio-scope-v<version>.zip (manifest at zip root)
2. Screenshots: 1280x800 PNG, at least one. Suggested set: CRT scope on
   music, X-Y figure, analyzer curve, waterfall, Text mode, synth panel.
3. Small promo tile 440x280 (optional but recommended).
4. Bump version in public/manifest.json for every upload; the store rejects
   a re-used version number.
