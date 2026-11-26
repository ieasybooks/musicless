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
background music behind speech. Everything runs on your device.

Musicless was called nomusic before its first release.

## Install

Musicless works on a computer in Chrome, Edge, Brave and other Chromium
browsers (version 111 or newer), and in Firefox (version 153 or newer).
Musicless works in Firefox, Brave Nightly and Vivaldi on Android.

### Chrome Web Store

Install [Musicless from the Chrome Web Store](https://chromewebstore.google.com/detail/musicless/fllcnhpmoanojfbncfpdencchjlgphco),
then reload any YouTube tabs that were already open. The store keeps it up to
date. In Brave Nightly on Android, enable **Android extensions** at
`brave://flags/#brave-android-extensions` and relaunch. If the store offers
**Add to desktop**, request **Desktop site** for the store page to install it.

### Firefox Add-ons

Install [Musicless from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/musicless/)
on desktop or Android, then reload any open YouTube tabs.

### A GitHub Release

For Chrome, Edge, Brave and other Chromium browsers on desktop:

1. Download `musicless-<version>.zip` and `SHA256SUMS` from the
   [releases](https://github.com/ieasybooks/musicless/releases) into the
   same folder.
2. Check the file, then the attestation:

   ```sh
   sha256sum -c --ignore-missing SHA256SUMS
   gh attestation verify musicless-<version>.zip --repo ieasybooks/musicless
   ```

   On macOS, `shasum -a 256 -c --ignore-missing SHA256SUMS` checks the checksum file.
3. Unzip it. Open `chrome://extensions` (in Edge, `edge://extensions`), turn
   on **Developer mode**, click **Load unpacked**, and choose the unzipped
   folder.
4. Reload any YouTube tabs that were already open.
5. The first time, choose **Turn on Musicless** on the page that opens (or in the
   toolbar popup, under the same words). Until you do, Musicless does not remove
   music; its button on the player opens that page.

For a temporary install in desktop Firefox, download the release's
`musicless-<version>-firefox.zip`, open `about:debugging`, choose
**This Firefox**, then **Load Temporary Add-on**, and pick the zip. Firefox
removes it when it closes.

## Using Musicless

- **Start watching.** Choose **Turn on Musicless** after installation, then open YouTube.
  If YouTube was already open, reload that page. You can also turn Musicless
  on from your browser’s extensions menu.
- **Give it a moment.** Musicless removes music automatically. A video
  usually takes 1 to 2 seconds to start on a typical laptop. You’ll see the
  loading spinner and **Removing music** while you wait. Jumping ahead in a
  video may cause another short pause.
- **Restore original sound.** Select the crossed-out music note in the video.
  Its tooltip says **Restore original sound**. Select it again to **Remove music**.
  Look beside captions on regular videos, in the action row on Shorts (above Like
  on Android), or in the top row on supported embedded videos.
- **Choose videos yourself.** Open Musicless from your browser’s extensions
  menu. Turn off **Remove music by default**.
  Then select the music note on any video where you want to remove the music.
  Changing the default affects videos you open afterward. The player button
  changes only the current video.
- **If a play button appears in the middle**, press it to start the sound.
- **If music removal fails**, the video pauses and stays silent. Choose
  **Try again** or **Reload page** when offered, or choose **Play original sound**
  to continue with the unprocessed audio, including any music. Copy-protected videos, such as rentals, can
  only play with their music.

Volume, mute, fullscreen and playback speed work as usual. You can jump to
another part of the video, watch Shorts or live streams, and use supported
YouTube videos on other websites. Musicless does not block ads.

Something not working? [Report a problem](https://github.com/ieasybooks/musicless/issues/new?template=bug.yml).
Help in Arabic: [استخدام «بلا موسيقى»](docs/help.ar.md).

## What to expect

- **Some music may remain.** Quiet background music behind speech is
  particularly difficult to remove. Voices can also sound a little duller.
  Musicless cannot guarantee completely music-free playback.
- **It uses your device’s processor.** In our tests, music removal used up to
  about 400 MB of extra memory, shared across tabs. Slower devices may need
  more time. The memory is freed a few minutes after the last video is paused
  or closed.
- **Live streams may pause.** Watching a little behind the live broadcast
  reduces the pauses.
- **Watch YouTube in your browser.** If an Android link opens in the YouTube app,
  open the video in the browser where you installed Musicless.

## Privacy

Musicless processes the audio already loaded by the YouTube player on your
device. Audio is used only to remove background music during playback. It
is not uploaded, shared, or saved as an audio file. The developer receives no
audio, browsing history, identifiers, or usage analytics. There is no account.

The automatic-removal setting, and whether you have chosen **Turn on Musicless**, are
stored in your browser's extension storage and may sync between your devices
through your browser's sync. See the [privacy policy](https://musicless.ieasybooks.com/en/privacy).

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

- [Landing page: local preview](landing/README.md) and [automated Cloudflare deployment](docs/web-deployment.md)
- [Testing](docs/testing.md)
- [Releasing](docs/release.md) and the [store listing](docs/store-listing.md)
- [How it works](docs/how-it-works.md) and [where to make a change](docs/how-it-works.md#where-to-make-a-change)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE). Third-party notices are in
[extension/THIRD_PARTY_NOTICES.txt](extension/THIRD_PARTY_NOTICES.txt): the
Spleeter model (Deezer, MIT), ONNX Runtime Web (Microsoft, MIT),
SoundTouchJS (MPL-2.0) and the Alexandria typeface (OFL-1.1).
