# nomusic

<p align="center">
  <img src="assets/logo.png" alt="nomusic" width="180" />
</p>

nomusic removes the background music from YouTube videos and keeps the voices.
It is a browser extension that does all of its work on your own computer, on
one processor core: nothing is uploaded, there is no account, and it collects
no data. It is made for people who want to avoid music for religious or
personal reasons.

nomusic keeps voices, speech and singing, and removes the instruments. It uses
Spleeter, an open-source separation model by Deezer. Some music can remain,
most often quiet music under speech.

## Install

nomusic works in Chrome, Edge, Brave and other Chromium browsers on a computer
(version 111 or newer).

1. Download `nomusic-<version>.zip` from the releases and unzip it.
2. Open `chrome://extensions` (in Edge, `edge://extensions`) and turn on
   **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. Reload any YouTube tabs that were already open.

## Use

Play any YouTube video: nomusic removes the music by itself. At the start, and
after jumping to a part that has not loaded yet, the video pauses for a moment
(about 2 to 4 seconds on a typical laptop) while nomusic prepares the audio.

- The **nomusic on** button in the corner of the video turns nomusic off for
  that video, so you hear the original, and on again.
- The nomusic button in the browser toolbar has the setting **Remove music
  automatically**. When it is off, click **nomusic** on a video to start.
- Volume, mute, speed changes (with the voice's pitch kept), seeking,
  fullscreen, Shorts, live streams, ads and embedded YouTube players all work.

If nomusic can't remove the music from a video, the video stays paused and
silent, and nomusic shows what happened, with **Retry** and **Return to
original**. This happens with copy-protected videos (such as rented movies),
in tabs opened before nomusic was installed or updated (reload the page), and
if something goes wrong.

## What to expect

- **Quality:** voices are kept and instruments removed, but some music can
  remain, and the voice loses some brightness (sound above 11 kHz is removed).
- **Speed:** each 12 seconds of audio takes about 2.5 seconds of one processor
  core on a mid-range laptop, so nomusic keeps well ahead of playback.
- **Memory:** about 450 MB while it is working, shared by all tabs. It is
  released a few minutes after the last video is paused or closed.
- **Limits:** YouTube only, on computers (phone browsers do not run
  extensions). A live stream watched right at its live point keeps pausing;
  a little behind it plays smoothly.

## Privacy

nomusic makes no network requests. It reads the audio YouTube's own player
has already loaded, separates it in the browser and plays the result. Nothing
is stored beyond memory, and no data is collected. It asks for one permission,
`storage`, to remember the toolbar setting, and runs only on YouTube's sites.
See the [privacy policy](docs/privacy.md).

## How it works

A script in the page keeps a copy of the audio YouTube's player hands to the
browser (usually minutes ahead of the playhead). A hidden extension frame
decodes it and runs Spleeter on ONNX Runtime Web (WebAssembly, one thread)
in 11.8-second windows, and the separated voices play in sync with the video
while the original track is silenced. See [how it works](docs/how-it-works.md).

## Development

```sh
./setup.sh          # builds the model and the runtime (needs curl, tar, python3)
./setup.sh --dev    # also installs the test tools (npm, a Python venv)
```

Then load the `extension` folder as an unpacked extension. The model and the
runtime are built from pinned, checksum-verified downloads and are not
committed.

- [Testing](docs/testing.md): unit tests, browser tests on local pages and on
  YouTube, memory, other browsers.
- [Releasing](docs/release.md): the checklist, `scripts/package.sh` (builds
  `dist/nomusic-<version>.zip`) and the [store listing](docs/store-listing.md).

## License

MIT, see [LICENSE](LICENSE). Third-party components and their licenses are
listed in [extension/THIRD_PARTY_NOTICES.txt](extension/THIRD_PARTY_NOTICES.txt):
the Spleeter model (Deezer, MIT), ONNX Runtime Web (Microsoft, MIT) and
SoundTouchJS (MPL-2.0).
