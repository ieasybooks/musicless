<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/musicless-logo-paper.svg">
    <img src="assets/brand/musicless-logo-ink.svg" alt="Musicless" width="320">
  </picture>
</h1>

<p align="center"><b>Removes most of the music. Keeps the voices.</b></p>

Musicless is a free browser extension that removes most of the background
music from YouTube videos while keeping speech and singing. Turn it on once,
then watch as usual.

It’s for anyone who wants to watch with less music, whether for religious
reasons or personal preference. Some music can remain, especially quiet
background music behind speech. Everything runs on your computer.

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
5. The first time, choose **Turn on Musicless** on the page that opens (or in the
   toolbar popup, under the same words). Until you do, Musicless does not remove
   music; its button on the player opens that page.

## Using Musicless

- **Start watching.** Choose **Turn on Musicless** after installation, then open YouTube.
  If YouTube was already open, reload that page. You can also turn Musicless
  on from its icon in the browser toolbar.
- **Give it a few seconds.** Musicless removes music automatically. A video
  usually takes 2 to 4 seconds to start on a typical laptop. You’ll see the
  loading spinner and **Removing music** while you wait. Jumping ahead in a
  video may cause another short pause.
- **Restore original sound.** Click the crossed-out music note in the video.
  Its tooltip says **Restore original sound**. Click it again to **Remove music**.
  The button is next to captions on a regular YouTube video, and among the
  top buttons on Shorts and supported embedded videos.
- **Choose videos yourself.** Open Musicless from the browser toolbar and
  turn off **Remove music by default**. Then click the music note on any
  video where you want to remove the music. The default applies to every video you open;
  changing it leaves the current video alone. Player-button choices last only
  for that video.
- **If a play button appears in the middle**, click it to start the sound.
- **If music removal fails**, the video pauses and stays silent. Choose
  **Try again** or **Reload page** when offered, or choose **Play original sound**
  to continue with the unprocessed audio, including any music. Copy-protected videos, such as rentals, can
  only play with their music.

Volume, mute, fullscreen and playback speed work as usual. You can jump to
another part of the video, watch Shorts or live streams, and use supported
YouTube videos on other websites. Musicless does not block ads.

Something not working? [Report a problem](https://github.com/IbraheemTuffaha/musicless/issues/new?template=bug.yml).
Help in Arabic: [استخدام Musicless](docs/help.ar.md).

## What to expect

- **Some music may remain.** Quiet background music behind speech is
  particularly difficult to remove. Voices can also sound a little duller.
  Musicless cannot guarantee completely music-free playback.
- **It uses your computer.** Music removal uses your processor and about
  400 MB of memory, shared across tabs. Slower computers may need more time.
  The memory is freed a few minutes after the last video is paused or closed.
- **Live streams may pause.** Watching a little behind the live broadcast
  reduces the pauses.
- **YouTube on a computer only.** Phone browsers and other video services
  are not supported.

## Privacy

Musicless processes the audio already loaded by the YouTube player on your
computer. Audio is used only to remove background music during playback. It
is not uploaded, shared, or saved as an audio file. The developer receives no
audio, browsing history, identifiers, or usage analytics. There is no account.

The automatic-removal setting, and whether you have chosen **Turn on Musicless**, are
stored in Chrome's extension storage and may sync between your devices if
Chrome Sync is enabled. See the [privacy policy](docs/privacy.md).

YouTube still loads the video through its own service.

## Development

```sh
./setup.sh          # builds the content script, model and runtime (Node.js/npm, curl, tar, python3)
./setup.sh --dev    # also installs the test tools (npm, a Python venv)
```

Then load the `extension` folder as an unpacked extension. The model and the
runtime are built from pinned, checksum-verified downloads and are not
committed. Do not commit `extension/model/` or `extension/vendor/`.

After editing the content-script modules, run `npm run build` before reloading
the extension. Packaging rebuilds the content script automatically.

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
