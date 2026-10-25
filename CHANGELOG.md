# Changelog

All notable changes to the nomusic extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-25

First release of the extension. The interface is in English and Arabic.

This repository used to contain a different program, a local backend that
downloaded video. That code remains on branch `backend` at tag `backend-final`.
It is not a previous version of this extension.

### Added

- A Chrome extension (Manifest V3) that removes background music from
  YouTube videos and keeps speech and singing, on the user's computer.
- English and Arabic, including right-to-left layout.
- Spleeter 2-stem (Deezer) runs in the browser with ONNX Runtime Web, on one
  processor thread. Compared with Spleeter's own mask, nomusic removes more
  of the music under speech: the model sees every window at the same level,
  and its mask weighs the music estimate more.
- Works in Chrome, Edge, Brave, and other Chromium browsers, version 111
  or newer, on a computer.
- A first-run choice, **Turn on nomusic**, on the welcome page or the popup,
  before a video is processed. After that, removal starts on its own. One
  toolbar setting turns that off.
- The button on the player: Remove music, Removing music…, Music removed,
  Click to start the sound, Music not removed, and Set up nomusic before
  the first-run choice.
- When the music cannot be removed, the video stays paused and silent until
  you choose Try again or Play with music. Some cases ask you to reload the
  page. While the browser does not let sound play yet, the video waits for a
  click instead of playing silently.
- Speed changes keep the voice's pitch. Seeking, volume, mute, fullscreen,
  Shorts, live streams, and embedded YouTube players work.
- No account and no analytics. Audio is processed on the computer and is
  not uploaded, shared, or saved. The toolbar setting and the first-run
  choice are stored in Chrome extension storage and may sync through
  Chrome Sync.

[1.0.0]: https://github.com/IbraheemTuffaha/nomusic/releases/tag/v1.0.0
