# Changelog

All notable changes to the Musicless extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The keyboard shortcut Alt+Shift+M (Option+Shift+M on a Mac) removes or
  restores the music on the video you are watching, like the button on the
  player. The button's tooltip shows it. It does nothing while you type in a
  text box.

## [1.1.3] - 2026-11-24

### Added

- You can now remove background music from YouTube videos, Shorts and live
  streams in Firefox, Brave Nightly and Vivaldi on Android.

### Changed

- The English and Arabic store screenshots for setup and settings now use
  DejaVu Sans for their captions.
- The privacy policy link in setup now opens the Musicless website in your
  language, English or Arabic.

## [1.1.2] - 2026-11-21

### Fixed

- On YouTube videos and Shorts, the Musicless button waits for the player
  controls to appear. It now shows up in its usual row without first jumping
  from a corner or getting stuck there on some Shorts.

## [1.1.1] - 2026-11-18

### Fixed

- Live streams play with the music removed. Before, most live streams in
  Chrome, and some in Firefox, stayed paused at the start and then showed
  “Couldn’t remove the music”.

## [1.1.0] - 2026-11-15

### Added

- Firefox 153 or newer, on a computer. Each release has a Firefox zip,
  `musicless-<version>-firefox.zip`: the same files with Firefox's manifest.

### Changed

- The first-run disclosure and the privacy policy say that your browser may
  sync your settings, instead of naming Chrome Sync.
- The code, tests and documentation were reorganized. Nothing you see or hear
  changes.

### Fixed

- A speed change goes straight to the voice at its own pitch. Before, the
  voice was higher pitched for up to a second first.
- A settings change made while a page was first reading the settings is no
  longer lost.

## [1.0.0] - 2026-11-12

First release of the extension. The interface is in English and Arabic.

### Changed

- Renamed nomusic to Musicless before its first release, with a new logo, icons and colours.
- Bundled the content script so reloading the unpacked extension no longer
  produces extension-module origin errors on YouTube.

### Added

- A Chrome extension (Manifest V3) that removes background music from
  YouTube videos and keeps speech and singing, on the user's computer.
- English and Arabic, including right-to-left layout. In Arabic the extension
  is called «بلا موسيقى», with its own logo, and its pages' titles use the
  bundled Alexandria typeface.
- Spleeter 2-stem (Deezer) runs in the browser with ONNX Runtime Web, on one
  processor thread. Compared with Spleeter's own mask, Musicless removes more
  of the music under speech: the model sees every window at the same level,
  and its mask weighs the music estimate more.
- Works in Chrome, Edge, Brave, and other Chromium browsers, version 111
  or newer, on a computer.
- **Remove music by default** applies to every video you open without changing the
  current video. Player choices last for one video; the popup explains both
  defaults. Restoring the unprocessed audio is labelled **Restore original sound**.
- A first-run choice, **Turn on Musicless**, on a one-screen first-run page (or the
  popup's Turn on Musicless button), before a video is processed. After that, removal starts on its own.
  One toolbar setting turns that off.
- A button in YouTube's own control bar (the top row in embedded players): a
  note while the music plays, the note struck through while it is removed.
  While the first audio is prepared, YouTube's spinner shows in the middle of
  the video, with "Removing music" beneath it.
- When the music cannot be removed, the video stays paused and silent until
  you choose Try again or Play original sound. Some cases ask you to reload the
  page. While the browser does not let sound play yet, the video waits for a
  click instead of playing silently.
- Speed changes keep the voice's pitch. Seeking, volume, mute, fullscreen,
  Shorts, live streams, and embedded YouTube players work.
- No account and no analytics. Audio is processed on the computer and is
  not uploaded, shared, or saved. The toolbar setting and the first-run
  choice are stored in Chrome extension storage and may sync through
  Chrome Sync.

[1.1.3]: https://github.com/ieasybooks/musicless/releases/tag/v1.1.3
[1.1.2]: https://github.com/ieasybooks/musicless/releases/tag/v1.1.2
[1.1.1]: https://github.com/ieasybooks/musicless/releases/tag/v1.1.1
[1.1.0]: https://github.com/ieasybooks/musicless/releases/tag/v1.1.0
[1.0.0]: https://github.com/ieasybooks/musicless/releases/tag/v1.0.0
