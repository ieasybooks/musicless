# How Musicless works

Musicless separates the voices from YouTube's audio in the browser, while the
video plays, and plays them in place of the original track.

```
 page world                     content script (isolated world)         extension frame (invisible)
 ──────────                     ───────────────────────────────         ────────────────────────
 YouTube's player                main.js: a Session + Button per <video>
   │ appendBuffer(audio) ──▶ capture.js ──postMessage──▶ capture-bus.js
   │                              keeps recent audio          │
   │                                                          ▼
 <video> ──Web Audio──▶ original ×0              session.js ──port──▶ tab-worker.js ──port──▶ model-worker.js
                        voices   ×volume ◀── chunks ───────────────── demux, decode,        (shared by all tabs)
                                                                       resample, STFT        Spleeter on
                                                                       iSTFT, crossfade ◀─── ONNX Runtime Web
```

## The pieces

| File | Role |
| --- | --- |
| `capture.js` | Page world, before the site's scripts. Wraps `MediaSource`/`SourceBuffer` so it sees the encoded audio the player appends (Opus in WebM, AAC in MP4), and the ranges it removes or replaces (such as another audio track). Every wrapper calls the browser's own method first and records only what the browser accepted, so Musicless can never break the player. Keeps at most 16 MiB of recent audio per stream and 48 MiB per page, trimmed at segment boundaries with the format header kept, and frees a stream when its player detaches it. Until the user has turned Musicless on, it keeps only format headers. Nothing is downloaded. |
| `intent.js` | Page world. Reports the page's `play()`/`pause()` calls, so a pause the user makes while Musicless holds the video is not undone. |
| `content.js`, `main.js` | Built into the classic content script `content.bundle.js` by pinned, build-only esbuild. Chrome loads it directly, avoiding cross-origin module requests that can log origin errors on YouTube after an extension reload. Give every `<video>` a `Session` as soon as it appears (before it can play) and a `Button` once it has a visible player. `capture-bus.js` checks every message from the page world before anything acts on it. |
| `session.js` | One video's music removal: follows its source, routes its audio through Web Audio (original silenced, separated voices at the page's volume), asks the engine for chunks around the playhead, schedules them on the video's clock, holds the video when a chunk is missing, fails closed. |
| `audio.js`, `playback-intent.js` | The page's one AudioContext and each video's routing; in Firefox, the leash and taking a video over from an earlier copy (Browser quirks). The user's play or pause, kept apart from Musicless's holds. |
| `button.js`, `content.css`, `i18n.js` | What Musicless shows on a video, in English or Arabic (`_locales/`): a button in YouTube's own control bar (or the embedded player's top row, or a Short's own row of buttons; a small corner button where a player has none), a spinner in the middle of the video while the first audio is prepared, a play button when the browser waits for a click, and the recovery dialog. It shows and hides with YouTube's controls, and ignores clicks a page script fakes. Alt+Shift+M (`main.js`) does what a click on the visible video's button does, except while the user types. |
| `engine.js` | The page's connection to the hidden frame; routes messages by stream; notices a frame or worker that has gone away and starts a new one; removes the frame 30 s after nothing uses it. |
| `separator.html/js` | A transparent 1×1 frame that ignores pointer events, in the extension's own origin (WebAssembly allowed, out of the page's reach). It accepts one connection, and only with a random token that page scripts cannot read: the background script (a service worker in Chrome, an event page in Firefox) makes it once, and the content script sends it only to the extension's own origin, fixed when the frame is created. Then it starts the tab worker and connects it to the shared model. |
| `tab-worker.js` | Per tab: demuxes (`demux.js`), decodes with WebCodecs (or Web Audio in the extension frame when the worker lacks `AudioDecoder`), resamples to 44.1 kHz, computes the STFT (`dsp.js`), sends it to the model, synthesizes the voices and crossfades the window edges. Keeps at most 64 MiB of audio per video and nothing more than 15 minutes behind the playhead, and separates again whatever the player replaced. |
| `model-client.js` | Per-tab connection to the shared model: readiness, request IDs, deadlines and heartbeat. Reports failures back to the tab worker without depending on its stream or scheduling state. |
| `model-worker.js`, `model.js` | One copy of the model for every tab (a shared worker; WebCodecs is not available there, which is why decoding stays per tab). A priority queue puts the chunk a playing video needs first. |
| `failures.js`, `navigation.js` | Failure messages and recovery actions in one policy; position-preserving page reloads shared by recovery and Back to the video. |
| `player-glyph.js` | Geometry shared by the player button and the static glyph generator in `tools/icons.mjs`. |
| `grid.js` | The model's numbers and the fixed window grid, shared by both sides (`tests/reference.py` mirrors them). |
| `stretch.js`, `third_party/soundtouch` | Pitch-preserving time-stretch for speeds other than 1x, made a slice at a time from where playback is. |
| `popup.*`, `welcome.*`, `background.js`, `settings.js` | The toolbar popup, the first-run page, and the stored values: the automatic-removal setting and whether the user chose **Turn on Musicless** (`chrome.storage.sync`), the frame's token (`chrome.storage.local`), and the tab/frame/document identifiers for **Back to the video**, cleared on return or browser-session end (`chrome.storage.session`). |

## Where to make a change

| Behavior | Owner and boundary |
| --- | --- |
| Keep or reject encoded page audio | `capture.js` owns capture; `capture-bus.js` validates its untrusted messages. Worker parsing starts in `demux.js`. |
| Play, pause, seek or change speed | `session.js` owns the video lifecycle; `playback-intent.js` distinguishes the user's choice from a processing hold. |
| Choose recovery actions or messages | Add the reason's policy in `failures.js`; Session executes its action and Button renders it. Catalog wording remains in `_locales/`. |
| Read settings or react to consent | `settings.js` starts its storage mirror on `loadSettings()`. `main.js` passes that mirror into each Session. Defaults apply to each new source. |
| Change worker availability handling | `engine.js` owns the page/frame connection; `model-client.js` owns the tab/shared-worker connection. Their timeouts cover different boundaries. |
| Change the separation | `grid.js`, `dsp.js`, `model.js` and `tools/build_model.py`, checked independently against `tests/reference.py` and fixed quality floors. |
| Change build inputs | `tools/dependencies.json` holds verified download/model pins; `tools/model-requirements.txt` constrains both the model build and test NumPy. |
| Add test recording or introspection | `tests/diagnostics/`; the harness instruments a disposable extension copy. Nothing there is packaged. |
| Carry on when Firefox updates or removes Musicless | `audio.js` (the leash and taking a video over), `main.js` (the earlier copy's leftovers, saying it runs), `playback-intent.js` (the hold mark) and `capture.js` (the reload). See Browser quirks. |

Keep page-world capture separate from privileged extension code. The classic
content bundle and worker modules have different loading and security rules.
Use the [test selection guide](testing.md#choosing-checks) to check the boundary
you changed.

## Separation

Spleeter 2-stem (Deezer) is two U-Nets on the magnitude spectrogram (n_fft
4096, hop 1024, below 11 kHz): one estimates the voices (v), one the
accompaniment (a), and a mask built from the two is applied to the mixture.
`tools/build_model.py` merges both networks into one graph that outputs the
mask and stores the weights at half precision (37.5 MiB).

Two changes to Spleeter's defaults remove more of the music that plays under
speech, the case where it leaks most:

- The mask is `v / (v + 2a)` instead of Spleeter's `v² / (v² + a²)`.
- The network's masks depend on how loud its input is, so every window is
  shown to it at the same level (-24 dBFS RMS). The mask is still applied to
  the audio as it is, so the output level follows the video.

On an evaluation set of English and Arabic speech over 42 Creative Commons
background tracks, plus song excerpts, measured at typical YouTube loudness,
music under speech is reduced by 1.2 to 2 dB more than with Spleeter's own
mask, and PESQ (a speech-quality score) rises by about 0.2 at every music
level. Music on its own is reduced by about 43 dB on average. In songs, 3 dB
more of the accompaniment is removed and the singing loses a little fidelity.

Spleeter reads 512 frames (11.9 s) at a time and is not shift-invariant: the
same audio cut at a different place separates differently. So windows sit on
a fixed grid from media time 0, and every seek or restart separates exactly
the same windows again. Neighbouring windows overlap by two hops (46 ms) and
crossfade, because independently separated windows disagree at their edges
(without the crossfade, every seam clicked). Each window takes about 2.5 s of
one core on a mid-range laptop (1.7 s of it in the network), about five times
faster than playback.

## Playback

Separated chunks are scheduled with Web Audio against an anchor (an audio
clock time and the video's media time at that moment). The video's clock is
checked four times a second: drift beyond 45 ms re-anchors at once, and a
steady offset beyond 15 ms for two seconds re-anchors too (at most every 20 s;
an anchor taken just before the audio device restarts can be a little early).
A clock that stops (stall, buffering) stops the voices, a paused or reset video
never has audio scheduled, and a rate change re-anchors at the new speed with
SoundTouch keeping the pitch. The stretched voice is made from where playback
is, in slices of about 0.4 s from one continuous stretch: the first 0.75 s at
once, so a speed change goes straight to the voice at its own pitch, then up
to 2.5 s ahead, a little each tick. Neighbouring slices share
6 ms, crossfaded, so they join without a seam. Each playback run fades
in over 10 ms and out over a few milliseconds, so re-anchoring crossfades
instead of clicking.

When the chunk the playhead needs is not ready, Musicless pauses the video
("holds" it) rather than let music play. It resumes once at least three
seconds are ready, so one hold does not run straight into the next. Audio is
prepared while a video is paused, so pressing play usually needs no hold. The
video is also held while the browser keeps Musicless's sound from playing (no
click on the page yet, or the audio device was taken away), until a click lets
it play.

Chunks are separated in order of distance from each video's playhead, so the
chunk a playing video needs comes before look-ahead work in any tab.

## Before Musicless is turned on

On install, the first-run page explains what Musicless does with
audio and asks the user to choose **Turn on Musicless** (the toolbar popup shows the
same words and the same button). Until then Musicless reads no audio: capture
keeps only format headers, no session routes or separates anything, and the
button on the player ("Turn on Musicless", the note with a small dot) opens the
first-run page. Opened that way, the page ends with **Back to the video**: the
background script kept the tab, frame and document that asked. The page focuses
that tab and reloads where the video is, including when muted, only if the
original document is still active in that frame. If the tab has navigated
elsewhere, the new page is left alone.
Neither focusing the tab nor messaging that document needs an extra permission.
A video whose audio went by before Musicless was turned on is not
shown as a failure: its dialog says "Musicless is on" and offers **Reload page**.

After consent, **Remove music by default** is on. The setting applies when a
new video source loads, including in the same player. Changing it leaves the
current video alone. The player button changes only that video, and the next
one starts with the saved default.

## Failing closed

Musicless never plays the original track by itself once it is on. If it cannot
remove the music (copy-protected audio, audio it cannot capture, a codec the
browser cannot decode, a chunk stuck for 30 s, sound that still cannot start
after a click, or, in Chrome, the extension being updated under an open
page; see Browser quirks for Firefox), the
original stays silent, the video pauses, and a dialog in the middle of the
player offers **Try again** or **Play original sound**. When only a reload can help
(the extension was updated, the audio went by before it could be captured, the
engine could not start again, or the sound cannot start), it offers **Reload
page** instead; on a watch page the reload keeps the position. When nothing can
help (copy-protected audio, a format Musicless cannot read, a player whose sound
it cannot reach), it offers only **Play original sound**, and the dialog itself
takes focus so that a stray Space does not start the music. Escape or a click
beside the dialog closes it; the next play attempt brings it back.

If the hidden frame or its workers stop answering, the engine is started
again once; if that fails too, the video fails closed as above. Chunks the
page kept through a pause or an engine restart carry a fingerprint of the
audio they were made from; the new worker checks it against what it has
before they play (the video holds meanwhile), so a chunk made from audio the
player has since replaced is separated again.

## Memory

While it works, Musicless adds about 400 MB to the browser (measured with
tests/memory.mjs in Chrome 156 on Linux). The network's share is about
240 MiB of WebAssembly memory; ONNX Runtime's parallel execution mode, used
with one thread, plans its buffers in 48 MiB less than the default mode and
gives identical masks. A WebAssembly instance cannot give memory back: the memory
is freed by ending the worker. So the model lives in one shared worker for all
tabs; a paused video lets go of it after two minutes, and the frame (and with
it the worker) is removed 30 s after no video needs it, which returns the
memory (tests/memory.mjs checks both). Captured audio is bounded per stream
(16 MiB) and per page (48 MiB), and the worker keeps at most 64 MiB of encoded
audio per video.

## Browser quirks handled

- Moving a MessagePort to another process with megabytes of audio queued on
  it, or posting one cross-process message that transfers many buffers, hangs
  the page in Chrome. The engine queues messages until the worker holds its
  port, and captured audio is forwarded one entry per message.
- Media routed into an AudioContext that the browser keeps suspended (no user
  gesture yet) would play on, silent. Musicless holds the video instead and
  resumes the context on the first click or key press.
- A MessagePort to a worker that has died never reports it, so the engine
  pings a quiet worker and treats no answer within 15 s as a lost engine.
- In Firefox, once a playing video is routed through Web Audio, the video's
  own sound plays about 130 ms ahead of its picture until the next seek.
  Musicless's audio follows the picture, but the original sound comes back
  after Restore original sound, so in Firefox routing a playing video seeks it
  to where it already is (`audio.js`).
- Once an audio buffer plays, Firefox detaches the arrays `getChannelData`
  gave for it (Web Audio's "acquire the content"; Chrome does not). The
  stretch takes its own copy of a chunk with `copyFromChannel` (`stretch.js`).
- When Musicless is removed or updated, Chrome leaves the running content
  script in place without its extension: it notices and fails closed (above).
  Firefox stops it without a word, while what it set up in the page goes on:
  the audio it queued (up to half a minute) and its routing of each video,
  through which alone the video is heard, its own sound included. So in
  Firefox:
  - All of a routed video's sound, its own and Musicless's, passes a gain,
    its leash, that closes 3 s ahead unless the running copy renews it
    (`audio.js`), so a stopped copy falls silent. The running copy renews it
    every second for each video it routed, and when a video plays.
  - Firefox adds the new copy to pages already open (Chrome only to new ones).
    It first removes what the stopped copy left in the page (`main.js`,
    `button.js`). Each copy leaves its leash on the video, in the page's
    world, for the next: the new copy routes each video it finds one on, so
    the video's sound carries on through it whether or not Musicless is on
    for it, and closes that leash at once. Otherwise both would be heard
    until it closed, the stopped copy's queued voice running ahead while the
    new copy holds the video to start. A video the stopped copy held for the
    user is marked (`playback-intent.js`), and the new copy plays it once
    its voice is ready.
    It works with the capture script the stopped copy left in the page (its
    own stands down), so the messages between the two, the leash's name and
    the hold mark must stay compatible from one version to the next.
  - The content script says from its start, and every second, that it runs.
    The page-world capture script lives on: after 5 of its own seconds
    without that, it keeps no more audio, and once a video Musicless routed
    (one with a leash) plays, or one Musicless held for the user waits to,
    it reloads the page there (`capture.js`), and the video has its own sound
    again. After an update the new copy says it, so nothing reloads.
- Routing a media element through Web Audio cannot be undone, and a
  cross-origin file routed that way would play silence, so only Media Source
  (blob:) sources are routed; anything else is held instead.

## Messages

| Between | Channel | Messages | Checked by |
| --- | --- | --- | --- |
| Content script → `capture.js` | `window.postMessage`, `musicless: "control"` | `hello` (announce your streams), `consent` (whether audio may be kept), `subscribe` (replay a stream's audio, then send its appends as they come), and in Firefox `alive` (this copy runs) | `capture.js` reads only these four; a page can post them too |
| `capture.js` → content script | `window.postMessage`, `musicless: "capture"` | `stream` (an id and its `blob:` URL), `closed`, `replay` (the audio kept so far, and whether some went by unkept), `event` (one new entry) | `capture-bus.js`: shapes, types, finite numbers, sizes |
| `intent.js` → content script | a `musicless:playback-intent` event on the `<video>` | the page's own `play()` or `pause()` | `playback-intent.js`: a boolean, nothing else |
| Content script → service worker | `chrome.runtime.sendMessage` | `engine-token`, `open-welcome` | Only the extension's own scripts can send these |
| First-run page → originating document | `chrome.tabs.sendMessage`, scoped by frame and document IDs | `reload` | The content script queues a position-preserving reload for its visible video and acknowledges whether it was scheduled; a missing receiver never triggers a tab-wide reload |
| Content script → hidden frame | `postMessage` to the extension's origin, with a port | `musicless-port` (the token) | `separator.js`: the token, one connection |
| Hidden frame → tab worker | `Worker.postMessage` | `port` (the content script's port and one to the model), `shared-model-failed` | — |
| Tab worker → extension frame | Worker message with a reply port | `decode-audio` (a complete in-memory audio file) when WebCodecs is unavailable in the worker | Only the frame’s own worker supplies the request and receives the decoded PCM |
| Content script ⇄ tab worker | the handed-over port | to the worker: `stream`, `drop`, `entries`, `replayed`, `want`, `stats`, `ping`; from it: `connected`, `model`, `chunk`, `checked`, `changed`, `unsupported`, `error`, `stats`, `pong` | Nothing more: only the content script holds this port |
| Tab worker ⇄ model worker | a port the frame hands over (`client`) | to the model: `load`, `run`, `ping`; from it: `ready`, `failed`, `result`, `error`, `pong` | Nothing more: both ends are the extension's |
| Test copy only | `window.postMessage`, `musicless: "debug"` | `state`, `sessions`, `dump`, answered with `debug-reply` | Added by `tests/harness.mjs`; not in the release |

## Security

`capture.js` and `intent.js` run in the page's own JavaScript world, so the
page can see and imitate their messages, and Musicless cannot tell its own from
the page's. It treats everything from that world as untrusted: messages are
checked for shape and size before anything acts on them, and the in-player
controls ignore clicks a script fakes. The most a page can do with forged
messages is make a video fail closed, for example by saying its stream closed.
In Firefox it can also make the capture script reload the page, or not reload
it once Musicless is gone (`alive`), which the page can do itself. It cannot
make the music play while Musicless is on (the original track is silenced in
the content script's world, which the page cannot reach), get around the
separation, or reach the hidden frame and its workers (see the token above).
In Firefox the page can also reach the leash Musicless leaves on each video it
routes, and the mark on a video it holds (Browser quirks): with them it can at
most silence that video, or play it.

The extension makes no network requests, has no remote code, and asks for one
permission (`storage`) plus access to YouTube's pages. The release cannot
record or export audio. The test harness adds the recorder and state hooks
from `tests/diagnostics/` only to its own copy of the extension, with a key
in that copy's manifest.
