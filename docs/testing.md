# Testing

Set up once with `./setup.sh --dev`: it builds the model and the runtime and
bundles the content script with pinned build-only esbuild (`node_modules`) and
installs the test tools (`tests/node_modules`, `tests/.venv`). After editing the
extension sources, `npm run build` rebuilds `extension/content.bundle.js`;
packaging always rebuilds it too. Instrumented browser-test copies are rebuilt
after their test hooks are added. The browser
tests also need `ffmpeg` and a browser: a Chromium browser (Google Chrome by
default), or Firefox 153 or newer.

## Choosing checks

Run these commands from `tests/` after setup. `local.mjs` and `memory.mjs`
play the media set `MEDIA_SET` names under `.work/media`: `vlog` (a real clip)
by default, or `synth`, the generated set CI uses. `soak.mjs` plays `long`.
Build the sets as described below.

| Change | Checks |
| --- | --- |
| Any runtime or build change | `npm run unit` (includes parity and quality floors) |
| Capture, workers or playback | `MEDIA_SET=synth QUICK=1 node local.mjs` |
| Consent, settings, recovery, pages or player controls | `node interface.mjs` and QUICK |
| Release candidate | The browser tests and listening in step 1 of the [release guide](release.md) |
| YouTube markup or extension loading | `node controls.mjs` or `node loader.mjs`, plus local checks |
| Memory lifetime or buffer retention | `MEDIA_SET=synth node memory.mjs` and `node soak.mjs` |
| Firefox only (an update or removal, the leash) | `FIREFOX=<path> MEDIA_SET=synth QUICK=1 node local.mjs` |

`CHROME=/path/to/browser` selects Chrome, Edge, Brave or Chromium. Set
`MUSICLESS_NO_SANDBOX=1` for portable browsers or containers that cannot run
Chrome's sandbox. `FIREFOX=/path/to/firefox` runs the same suites in Firefox
(through WebDriver BiDi), installing the extension with Firefox's manifest
(`tools/firefox-manifest.mjs`, which packaging uses too). Firefox takes the
extension's language from its own, so the Arabic checks need an Arabic
Firefox: `FIREFOX_AR=/path/to/it`. A step a browser cannot run (Media Source
in a worker, in Firefox) is reported as skipped. In Firefox, Musicless's sound
may be 45 ms from the video's own sound rather than 30 ms, and vary by 45 ms
rather than 40 (see `LAG_LIMIT_MS` in `harness.mjs`). The YouTube suite
(`youtube.mjs`) lets it vary by 100 ms in Firefox, since Firefox's readings
there jump from run to run. `loader.mjs` checks warnings only Chrome gives, and
the store screenshots come from Chrome. For concurrent local runs, choose
separate `PORT` values and work folders; interface selects a free port by
default. The memory, soak, YouTube, controls and screenshot scripts currently
use fixed ports or live pages and should be run separately.

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
with hooks from `tests/diagnostics/instrument.mjs` added to its own copy
of the extension. `tests/diagnostics/recorder.js` records the page's audio and
Musicless's output on the same clock, through an AudioWorklet that says when
each block was rendered; the state hooks let tests inspect
Musicless's playback and workers. The release has neither. `analyze.py` then
checks sync (against Spleeter run offline),
dropouts and gaps (against 1x Spleeter of the exact source, at the media time
each block was heard) and output while the video is silent. Its offline
references are cached next to the media, keyed by the model and
`reference.py`, so the first run after either changes is slower.

It covers starting by itself, seeking, stalls, pausing (including during a
hold), speed changes, volume, fullscreen, the button, the next video in the
same player, three minutes of continuous play, preparing before play, muted
videos, the setting, the words of a video's first wait, consent through the
real controls (the first-run page by keyboard, the popup's button, the Arabic
page, and Back to the video from a video's button), failure recovery (Reload
page and Play original sound; only Play original sound where nothing
can help; a closed dialog coming back on play), two tabs sharing one model,
capture memory on a long stream, a paused video releasing the model, the
browser's real autoplay policy, and the extension being updated and then
removed while a video plays (Chrome fails closed; Firefox carries on with the
new copy, and reloads the page once Musicless is gone). In Firefox the update
is also tried with Musicless off for the video, with automatic removal off,
and while Musicless holds the video for the user. Each time, the stopped copy
must be silent within a second of the new one starting, and the new one must
carry the video's sound. Removal must also reload a page whose video
Musicless held for the user.

Other browsers: `CHROME=/path/to/browser QUICK=1 node local.mjs`. Portable
browser copies and CI containers need `MUSICLESS_NO_SANDBOX=1`. Browsers without
H.264 and AAC (open-source Chromium) get the VP9/Opus pages automatically.

Results go to `.work/results/<REPORT>.json` and recordings to
`.work/recordings/`; `MUSICLESS_TEST_DIR` moves the work folder,
`MUSICLESS_EXTENSION` tests another copy of the extension (such as an unzipped
release package) and `PORT` lets several browsers run side by side.

`soak.mjs [minutes]` plays a long stream (`LONG_SET`, built with
`build_media.py long`) and checks that Musicless's own memory stays flat and
sync holds. (The whole browser grows slowly while playing a long Media Source
stream, by about as much without Musicless: 61 MB with Musicless off against 80 MB
with it on over the same 12 minutes.)

## Local interface

```sh
node interface.mjs                  # optional argument: /path/to/test-media
```

Focused checks in a real browser, using local media and no live YouTube: returning
from setup while the video is muted, leaving replacement documents alone
(including after Back/Forward-cache restoration), reloading only the requesting
frame of an embedded player,
recovery-dialog keyboard focus, tooltip dismissal, stable Shorts button
placement and the inline glyph in forced-colors mode. The player UI checks
use the real Button module with a fixture Session; the return checks install
the extension and play synthetic media. The Session unit tests also cover
retrying a failure in place. `PORT` can select a local port; this suite chooses
a free one by default.

## YouTube

```sh
node loader.mjs
```

The uninstrumented package on a real YouTube page, before and after Developer
Mode reload and disable/re-enable: no extension-origin loader errors, actual
processed playback with the original muted, trusted button toggles, and
pitch-preserving 1.5x playback. DevTools reads Session snapshots from the
unminified bundle without adding production test hooks. This live check needs
working YouTube playback; it is separate from the deterministic CI suite.

```sh
node youtube.mjs
```

Live YouTube pages: a song, a tutorial (the button, seeks, fullscreen, the next
video through YouTube's own navigation), a vlog at 1.5x, a heavy song, the
live stream of a 24/7 news channel (the first of a few with a live stream that
plays here), Shorts, muted inline previews and an embedded player. Ads and bot
checks make this suite noisy: steps an ad interrupted are retried once. The
reopened tutorial and the live stream first wait out an ad; the seek steps and
the live stream fail if an ad plays while they listen.

Headless YouTube treats the browser as a bot, also without Musicless installed: it
stops serving a video about a minute into playback ("Something went wrong") and
never loads a new position after a seek. So each group of steps opens a fresh
page and seeks stay within the audio already loaded; the local suite covers
seeking into new audio and long sessions.

```sh
node controls.mjs
```

Where Musicless sits in YouTube's own player, which YouTube changes often: the
button joins the control bar before captions, the wait shows while the first
audio is prepared, a real click turns the music removal off and on again, the
tooltip sits above the bar, hides with fullscreen controls while the pointer
stays on the button, and returns with the controls. The button stays in the
bar when YouTube wraps its captions button, on Shorts it joins the
Short's own buttons, and in an embedded player it joins the top row of
buttons. Run it after YouTube changes its player. (The local test page has no
YouTube controls, so `local.mjs` covers the corner button instead.)

## Android playback

On a phone, open a YouTube video with sound on and test music removal at
1×, 1.5× and 2×. Listen for pauses and check that speech stays in sync.
Press Home once with the original audio and once with music removal on.
Let each Home trial run for at least a minute with DevTools disconnected.
Record how far the video advances and whether it pauses while Musicless
prepares audio. Audio already buffered before Home can hide a slowdown.
Also record whether playback resumes from the media notification if it stops. Also check the center Play control and the action
rail on a Short, and an embedded player on another site. Use a handset for
these checks because browser background policies and CPU speed affect the result.

An Android emulator can run the synthetic AAC and Opus players at the same
rates. The native decoder regression can also run in desktop Firefox:

```sh
FIREFOX=/path/to/firefox node native-audio.mjs
```

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

The browser's resident memory with Musicless off, while separating, and 45 s
after turning it off (the model is released 30 s after nothing needs it).

## CI

`.github/workflows/ci.yml` runs the setup and the unit tests, packages the
extension, and runs QUICK and interface on the unzipped package with synthetic media
in Chrome. Firefox also decodes mid-stream AAC and Opus packets and checks
their PCM length and placement across timestamp gaps. On a tag, `.github/workflows/release.yml` runs the
full local suite, interface and the memory check on the package before it is attested
(see [release.md](release.md)).
