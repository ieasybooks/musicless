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
bridge, and parity between the browser pipeline and `reference.py` (the same
separation in Python). The media fixtures in `tests/unit/fixtures` are
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
with a debug flag that records the page's audio and nomusic's output on the
same clock. `analyze.py` then checks sync (against Spleeter run offline),
dropouts and gaps (against 1x Spleeter of the exact source, at the media time
each block was heard) and output while the video is silent.

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

## Memory

```sh
node memory.mjs
```

The browser's resident memory with nomusic off, while separating, and 45 s
after turning it off (the model is released 30 s after nothing needs it).

## CI

`.github/workflows/ci.yml` runs the setup, the unit tests and the quick local
suite on the synthetic media in Chrome, then packages the extension.
