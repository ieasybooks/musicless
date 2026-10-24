# Store listing (Chrome Web Store, Edge Add-ons)

Text and answers for the store dashboards. Images are in `docs/store/`
(regenerate with `node tests/screenshots.mjs`).

## Listing

**Name:** nomusic

**Summary** (132 characters at most):
Removes the background music from YouTube videos and keeps the voices. Runs on your computer; nothing is uploaded.

**Category:** Accessibility

**Language:** English

**Description:**

nomusic removes the background music from YouTube videos while they play, and
keeps the voices: speech and singing. It is made for people who want to avoid
music for religious or personal reasons.

Everything happens on your own computer, on one processor core. nomusic has no
account, no servers and no tracking, and it never uploads anything.

How to use it
• Play any YouTube video: nomusic removes the music by itself. The video pauses
  for a moment at the start while the first part is prepared.
• Click "nomusic on" on the video to hear the original audio, and again to
  remove the music.
• Turn automatic removal off in the toolbar if you prefer to start it yourself.

Works with
• Speed changes (the voice keeps its pitch), seeking, volume and mute,
  fullscreen, Shorts, live streams and embedded YouTube players.

Good to know
• nomusic uses Spleeter, an open-source separation model by Deezer. Voices are
  kept and instruments removed, but some music can remain, most often quiet
  music under speech.
• While it works, nomusic uses about 450 MB of memory, shared by all tabs.
• Copy-protected videos (such as rented movies) cannot be processed: nomusic
  keeps them paused and silent and lets you choose to play the original.
• nomusic runs only on YouTube, on computers.

Open source (MIT): https://github.com/IbraheemTuffaha/nomusic

## Privacy practices

**Single purpose:** Remove the background music from YouTube videos while they
play, keeping the voices, by separating the audio on the user's computer.

**Permission justifications**
- `storage`: Remembers one setting, whether nomusic starts automatically on
  every video.
- Host access (content scripts on youtube.com, m.youtube.com,
  youtube-nocookie.com): Reads the audio the YouTube player has loaded in the
  page, separates it locally and plays the voices; shows the nomusic button on
  videos. nomusic runs on no other site.

**Remote code:** No. All code, the model and the WebAssembly runtime are in the
package.

**Data usage:** nomusic does not collect or transmit any user data (none of the
categories apply). It does not sell data, use it for unrelated purposes, or use
it for creditworthiness.

**Privacy policy URL:** the published `docs/privacy.md`
(https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/privacy.md).

## Notes for the reviewer

nomusic wraps the page's `MediaSource`/`SourceBuffer` methods (in
`capture.js`) to read the audio the page's own player appends, in memory only.
It downloads nothing, stores nothing and plays the video in YouTube's own
player; ads play as usual. The separation model runs in a hidden extension
frame on ONNX Runtime Web (WebAssembly), which is why the extension pages
allow `wasm-unsafe-eval`.
