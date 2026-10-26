# Testing

Set up once with `./setup.sh --dev`: it builds the model and the runtime and
installs the test tools (`tests/node_modules`, `tests/.venv`). The browser
tests also need `ffmpeg` and a Chromium browser (Google Chrome by default).

## Unit tests

```sh
cd tests && npm run unit
```

Node's test runner covers the window grid and crossfades, the STFT and the
resampler, the WebM and MP4 demuxers (including encrypted audio), the capture's
memory limits (the trimmed copy must still decode), the play/pause intent
bridge, and the separation as shipped: `model.js` on the bundled ONNX Runtime,
which must agree with `reference.py` (the same separation in Python) to 60 dB,
and must keep a synthetic voice (SDR of at least 14 dB) while removing music
heard on its own (to -60 dB or less). The second check catches what parity
cannot: a setting or a retrained model that moves both sides. Its limits are
this build's numbers less a margin; a change that misses them needs listening
before the limits move. The media fixtures in `tests/unit/fixtures` are
generated audio (`make-fixtures.sh`).

## Test media

```sh
cd tests
.venv/bin/python build_media.py synthetic .work/media/synth 240   # generated audio and video
.venv/bin/python build_media.py long .work/media/long 25          # a 25-minute stream
.venv/bin/python build_media.py <video file> .work/media/vlog 240 # optional: a real clip
```

Each set has WebM/Opus, WebM/VP9, MP4/AAC, muxed MP4, ClearKey-encrypted and
plain-file variants. `synthetic` needs no input: `synth.py` generates a
formant-synthesized voice over generated music, which Spleeter treats like a
real voice. Real clips make better listening tests but must not be committed.

## Browser tests on local pages

```sh
cd tests
MEDIA_SET=synth node local.mjs        # or vlog; QUICK=1 for a shorter run
```

`site/player.html` is a Media Source player shaped like YouTube's (segments
appended ahead of the playhead, abort and re-append on seek), with options to
mute, autoplay, hide its Media Source in another frame or a worker, and play
ClearKey-encrypted media. The suite installs the extension in a fresh profile
with diagnostics added to its own copy of the extension: a recorder of the
page's audio and nomusic's output on the same clock, and requests for nomusic's
state. The release has neither. `analyze.py` then checks sync (against Spleeter run offline),
dropouts and gaps (against 1x Spleeter of the exact source, at the media time
each block was heard) and output while the video is silent. Its offline
references are cached next to the media, keyed by the model and
`reference.py`, so the first run after either changes is slower.

It covers starting by itself, seeking, stalls, pausing (including during a
hold), speed changes, volume, fullscreen, the button, the next video in the
same player, three minutes of continuous play, preparing before play, muted
videos, the setting, every failure path (Try again or Reload page, and Play
with music), two tabs sharing one model, capture memory on a long stream, a
paused video releasing the model, the browser's real autoplay policy, and the
extension being removed while a video plays.

Other browsers: `CHROME=/path/to/browser QUICK=1 node local.mjs`. Portable
browser copies and CI containers need `NOMUSIC_NO_SANDBOX=1`. Browsers without
H.264 and AAC (open-source Chromium) get the VP9/Opus pages automatically.

Results go to `.work/results/<REPORT>.json` and recordings to
`.work/recordings/`; `NOMUSIC_TEST_DIR` moves the work folder,
`NOMUSIC_EXTENSION` tests another copy of the extension (such as an unzipped
release package) and `PORT` lets several browsers run side by side.

`soak.mjs [minutes]` plays a long stream (`LONG_SET`, built with
`build_media.py long`) and checks that nomusic's own memory stays flat and
sync holds. (The whole browser grows slowly while playing a long Media Source
stream, by about as much without nomusic: 61 MB with nomusic off against 80 MB
with it on over the same 12 minutes.)

## YouTube

```sh
node youtube.mjs
```

Live YouTube pages: a song, a tutorial (the button, seeks, fullscreen, the next
video through YouTube's own navigation), a vlog at 1.5x, a heavy song, a 24/7
live stream, Shorts, muted inline previews and an embedded player. Ads and bot
checks make this suite noisy: steps an ad interrupted are retried once.

Headless YouTube treats the browser as a bot, also without nomusic installed: it
stops serving a video about a minute into playback ("Something went wrong") and
never loads a new position after a seek. So each group of steps opens a fresh
page and seeks stay within the audio already loaded; the local suite covers
seeking into new audio and long sessions.

```sh
node controls.mjs
```

Where nomusic sits in YouTube's own player, which YouTube changes often: the
button joins the control bar before captions, the wait shows while the first
audio is prepared, a real click turns the music removal off and on again, the
tooltip sits above the bar, the button hides with YouTube's controls, it stays
in the bar when YouTube wraps its captions button, on Shorts it joins the
Short's own buttons, and in an embedded player it joins the top row of
buttons. Run it after YouTube changes its player. (The local test page has no
YouTube controls, so `local.mjs` covers the corner button instead.)

## Store images

```sh
node screenshots.mjs
```

The screenshots in `docs/store/`, in English and Arabic: the button and the
recovery dialog on a live YouTube watch page (a public-domain NASA video), the
first-run page and the popup. The dialog comes from a copy of the extension
that the script makes fail on purpose. The icons, the store icon and the promo
tile come from `node ../tools/icons.mjs`. See [release.md](release.md) for when
to remake them.

## Memory

```sh
node memory.mjs
```

The browser's resident memory with nomusic off, while separating, and 45 s
after turning it off (the model is released 30 s after nothing needs it).

## CI

`.github/workflows/ci.yml` runs the setup and the unit tests, packages the
extension, and runs the quick local suite on the unzipped package with the
synthetic media in Chrome. On a tag, `.github/workflows/release.yml` runs the
full local suite and the memory check on the package before it is attested
(see [release.md](release.md)).
