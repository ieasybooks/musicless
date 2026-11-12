# Changelog

All notable changes to the Musicless extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[1.0.0]: https://github.com/ieasybooks/musicless/releases/tag/v1.0.0
