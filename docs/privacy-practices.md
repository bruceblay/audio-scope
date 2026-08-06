PRIVACY PRACTICES TAB, IN THE DASHBOARD'S ORDER
Plain text. Copy each block between the ruled lines into its field.

========================================================================
activeTab JUSTIFICATION
========================================================================

Chrome's tabCapture API requires the activeTab grant, which is given when the user clicks the extension's toolbar button on a tab. The extension can only ever access tabs the user has explicitly invoked it on, and access ends when the tab navigates or closes.

========================================================================
REMOTE CODE USE
========================================================================

Select: "No, I am not using remote code."

If a justification box still requires text:

No remote code. All JavaScript is packaged inside the extension. There are no CDN scripts, no eval, no dynamically fetched code, and the extension makes no network requests of any kind.

========================================================================
sidePanel JUSTIFICATION
========================================================================

The extension's entire user interface (the oscilloscope screen, spectrum analyzer, and controls) lives in Chrome's side panel so it can be viewed alongside the tab whose audio is being visualized.

========================================================================
storage JUSTIFICATION
========================================================================

Stores the user's control settings and their saved visualization presets via chrome.storage.sync, so the instrument opens the way they left it. No audio, browsing history, or personal data is ever stored.

========================================================================
tabCapture JUSTIFICATION
========================================================================

Captures the audio stream of a tab so the extension can visualize it in real time as an oscilloscope trace and frequency spectrum. The audio passes through to the speakers unchanged. Capturing the tab is the only way to read its audio for analysis; nothing is recorded or transmitted.

========================================================================
SINGLE PURPOSE DESCRIPTION
========================================================================

Visualize the audio of a browser tab in real time as an oscilloscope, spectrum analyzer, and spectrogram.

========================================================================
DATA USAGE CERTIFICATION
========================================================================

In the data-collection disclosure table: check none of the categories. The extension collects no user data of any kind.

Then check the certification box ("I certify that my data usage complies with the Developer Program Policies"). This is accurate: no collection, no transmission, all processing local.
