<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/musicless-logo-paper.svg">
    <img src="assets/brand/musicless-logo-ink.svg" alt="Musicless" width="320">
  </picture>
</h1>

Musicless removes the background music from YouTube videos and keeps the voices:
speech and singing. It is a browser extension. Separation runs on your
computer. It is made for people who want to avoid music for religious or
personal reasons, and for anyone who wants speech with less music.

Some music can remain, most often quiet music under speech. Musicless uses
Spleeter, an open-source separation model by Deezer.

Musicless was called nomusic before its first release.

## Install

Musicless works in Chrome, Edge, Brave and other Chromium browsers on a computer
(version 111 or newer). It does not run in phone browsers.

### Chrome Web Store

When the listing is public, install Musicless from the Chrome Web Store. There
is no listing URL yet. This page will gain one after the listing is live.

### A GitHub Release

1. Download `musicless-<version>.zip` and `SHA256SUMS` from the
   [releases](https://github.com/IbraheemTuffaha/musicless/releases) into the
   same folder.
2. Check the file, then the attestation:

   ```sh
   sha256sum -c SHA256SUMS
   gh attestation verify musicless-<version>.zip --repo IbraheemTuffaha/musicless
   ```

   On macOS, `shasum -a 256 -c SHA256SUMS` checks the checksum file.
3. Unzip it. Open `chrome://extensions` (in Edge, `edge://extensions`), turn
   on **Developer mode**, click **Load unpacked**, and choose the unzipped
   folder.
4. Reload any YouTube tabs that were already open.
5. The first time, choose **Turn on** on the page that opens (or in the
   toolbar popup, under the same words). Until you do, Musicless does not remove
   music; its button on the player opens that page.

## Using Musicless

- **Turn it on once.** Choose **Turn on** on the page that opens after you
  install it, or in the toolbar popup. Reload YouTube tabs that were already
  open.
- **Then just play videos.** Musicless removes the music by itself. Each video
  waits a few seconds as it starts (about 2 to 4 on a typical laptop), with
  YouTube's spinner and **Removing music** under it. A jump to a part that has
  not loaded yet can wait again.
- **One video with its music.** Use Musicless's button in the player's control
  bar, left of captions (in embedded players, in the top row): a music note,
  struck through while the music is removed. Its tooltip says what a click
  does. Click it again to remove the music again.
- **Choosing videos yourself.** In the toolbar popup, turn off **Remove music
  from every video**. Then use the player button on the videos you choose.
- **On Shorts**, the button sits with the Short's own buttons, at its top.
- **A play button in the middle** of the video means the browser needs a
  click before it plays sound. Click it.
- **When the music can't be removed**, the video stays paused and silent, and
  a dialog says why: choose **Try again** (or **Reload page**), or **Play with
  music**. Copy-protected videos, such as rented movies, can only play with
  their music. A video that was already playing when you turned Musicless on
  needs a reload.

Volume, mute, speed changes (the voice keeps its pitch), seeking, fullscreen,
live streams, ads and embedded YouTube players work.

Something not working? [Report a problem](https://github.com/IbraheemTuffaha/musicless/issues/new?template=bug.yml).
Help in Arabic: [استخدام Musicless](docs/help.ar.md).

## What to expect

- **Quality.** Voices are kept and instrument sounds removed, but some music
  can remain. The voice loses some brightness, because sound above 11 kHz is
  dropped. This is not a guarantee of music-free playback.
- **Speed.** Each 12 seconds of audio takes about 2.5 seconds of one processor
  core on a mid-range laptop, so Musicless stays ahead of playback.
- **Memory.** About 400 MB while it is working, shared by all tabs. It is
  released a few minutes after the last video is paused or closed.
- **Limits.** YouTube only, on computers. A live stream watched right at its
  live point keeps pausing. Watching a little behind it reduces the pauses.

## Privacy

Musicless processes the audio already loaded by the YouTube player on your
computer. Audio is used only to remove background music during playback. It
is not uploaded, shared, or saved as an audio file. The developer receives no
audio, browsing history, identifiers, or usage analytics. There is no account.

The automatic-removal setting, and whether you have chosen **Turn on**, are
stored in Chrome's extension storage and may sync between your devices if
Chrome Sync is enabled. See the [privacy policy](docs/privacy.md).

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
