# nomusic

<p align="center">
  <img src="assets/logo.png" alt="nomusic" width="180" />
</p>

nomusic removes the background music from YouTube videos and keeps the voices:
speech and singing. It is a browser extension. Separation runs on your
computer. It is made for people who want to avoid music for religious or
personal reasons, and for anyone who wants speech with less music.

Some music can remain, most often quiet music under speech. nomusic uses
Spleeter, an open-source separation model by Deezer.

## Install

nomusic works in Chrome, Edge, Brave and other Chromium browsers on a computer
(version 111 or newer). It does not run in phone browsers.

### Chrome Web Store

When the listing is public, install nomusic from the Chrome Web Store. There
is no listing URL yet. This page will gain one after the listing is live.

### A GitHub Release

1. Download `nomusic-<version>.zip` and `SHA256SUMS` from the
   [releases](https://github.com/IbraheemTuffaha/nomusic/releases) into the
   same folder.
2. Check the file, then the attestation:

   ```sh
   sha256sum -c SHA256SUMS
   gh attestation verify nomusic-<version>.zip --repo IbraheemTuffaha/nomusic
   ```

   On macOS, `shasum -a 256 -c SHA256SUMS` checks the checksum file.
3. Unzip it. Open `chrome://extensions` (in Edge, `edge://extensions`), turn
   on **Developer mode**, click **Load unpacked**, and choose the unzipped
   folder.
4. Reload any YouTube tabs that were already open.
5. The first time, choose **Turn on nomusic** on the welcome page (the toolbar
   popup offers the same choice). Until you do, nomusic does not remove music.
   The button on the player says **Set up nomusic** and opens that page.

## Use

Play a supported YouTube video. After you turn nomusic on, it removes the
music by itself. At the start, and after a jump to a part that has not loaded
yet, the video pauses for a moment (about 2 to 4 seconds on a typical laptop)
while nomusic prepares the audio. The button says **Removing music…** during
that pause.

The button on the player:

| What it says | What it means |
| --- | --- |
| Remove music | nomusic is off for this video. Click to remove the music. |
| Removing music… | The processed audio is not ready yet. The video is paused. |
| Music removed | The music is removed. Click to hear the original. |
| Click to start the sound | The browser is waiting for a click before it plays sound. |
| Music not removed | nomusic could not remove the music. Click to choose. |
| Set up nomusic | You have not chosen **Turn on nomusic** yet. |

When the music cannot be removed, the video stays
paused and silent until you choose **Try again** or **Play with music**. Some
failures ask you to **Reload page** instead (the extension was updated, or
this video was not captured). Copy-protected videos, such as rented movies,
take this path.

The toolbar has one setting, **Remove music from every video**. When it is
off, click **Remove music** on a video to start. Videos that are already
playing keep going until you click the button on them.

Volume, mute, speed changes (the voice keeps its pitch), seeking, fullscreen,
Shorts, live streams, ads and embedded YouTube players work.

## What to expect

- **Quality.** Voices are kept and instrument sounds removed, but some music
  can remain. The voice loses some brightness, because sound above 11 kHz is
  dropped. This is not a guarantee of music-free playback.
- **Speed.** Each 12 seconds of audio takes about 2.5 seconds of one processor
  core on a mid-range laptop, so nomusic stays ahead of playback.
- **Memory.** About 400 MB while it is working, shared by all tabs. It is
  released a few minutes after the last video is paused or closed.
- **Limits.** YouTube only, on computers. A live stream watched right at its
  live point keeps pausing. Watching a little behind it reduces the pauses.

## Privacy

nomusic processes the audio already loaded by the YouTube player on your
computer. Audio is used only to remove background music during playback. It
is not uploaded, shared, or saved as an audio file. The developer receives no
audio, browsing history, identifiers, or usage analytics. There is no account.

The automatic-removal setting, and whether you have chosen **Turn on
nomusic**, are stored in Chrome's extension storage and may sync between your
devices if Chrome Sync is enabled. See the [privacy policy](docs/privacy.md).

YouTube still loads the video through its own service.

## Development

```sh
./setup.sh          # builds the model and the runtime (needs curl, tar, python3)
./setup.sh --dev    # also installs the test tools (npm, a Python venv)
```

Then load the `extension` folder as an unpacked extension. The model and the
runtime are built from pinned, checksum-verified downloads and are not
committed. Do not commit `extension/model/` or `extension/vendor/`.

- [Testing](docs/testing.md)
- [Releasing](docs/release.md) and the [store listing](docs/store-listing.md)
- [How it works](docs/how-it-works.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE). Third-party notices are in
[extension/THIRD_PARTY_NOTICES.txt](extension/THIRD_PARTY_NOTICES.txt): the
Spleeter model (Deezer, MIT), ONNX Runtime Web (Microsoft, MIT) and
SoundTouchJS (MPL-2.0).

This repository used to contain a different program, a local backend that
downloaded video. That code remains on branch `backend` at tag `backend-final`.
Version 1.0.0 is the extension, and it does not use that backend.
