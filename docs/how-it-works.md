# How nomusic works

nomusic separates the voices from YouTube's audio in the browser, while the
video plays, and plays them in place of the original track.

```
 page world                     content script (isolated world)         extension frame (hidden)
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
| `capture.js` | Page world, before the site's scripts. Wraps `MediaSource`/`SourceBuffer` so it sees the encoded audio the player appends (Opus in WebM, AAC in MP4). Keeps at most 16 MiB of recent audio per stream, trimmed at segment boundaries with the format header kept, and frees a stream when its player detaches it. Nothing is downloaded. |
| `intent.js` | Page world. Reports the page's `play()`/`pause()` calls, so a pause the user makes while nomusic holds the video is not undone. |
| `content.js`, `main.js` | Load the content-script modules; give every `<video>` a `Session` as soon as it appears (before it can play) and a `Button` once it has a visible player. |
| `session.js` | One video's music removal: follows its source, routes its audio through Web Audio (original silenced, separated voices at the page's volume), asks the engine for chunks around the playhead, schedules them on the video's clock, holds the video when a chunk is missing, fails closed. |
| `button.js`, `content.css` | The button in the player and its recovery panel. |
| `engine.js` | The page's connection to the hidden frame; routes messages by stream; removes the frame 30 s after nothing uses it. |
| `separator.html/js` | The hidden frame, in the extension's own origin (WebAssembly allowed, out of the page's reach). Starts the tab worker and connects it to the shared model. |
| `tab-worker.js` | Per tab: demuxes (`demux.js`), decodes with WebCodecs, resamples to 44.1 kHz, computes the STFT (`dsp.js`), sends it to the model, synthesizes the voices and crossfades the window edges. Drops audio more than 15 minutes behind the playhead. |
| `model-worker.js`, `model.js` | One copy of the model for every tab (a shared worker; WebCodecs is not available there, which is why decoding stays per tab). A priority queue puts the chunk a playing video needs first. If shared workers are unavailable, a tab loads its own copy. |
| `grid.js` | The fixed window grid shared by both sides. |
| `stretch.js`, `third_party/soundtouch` | Pitch-preserving time-stretch for speeds other than 1x. |
| `popup.*`, `welcome.html`, `background.js`, `settings.js` | The toolbar setting, the welcome page, and storage for that setting and the first-run acknowledgement (**Turn on nomusic**). |

## Separation

Spleeter 2-stem (Deezer) is two U-Nets on the magnitude spectrogram (n_fft
4096, hop 1024, below 11 kHz): one estimates the voices, one the
accompaniment, and their ratio masks the mixture. `tools/build_model.py`
merges both networks into one graph that outputs the mask and stores the
weights at half precision (37.5 MiB).

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
SoundTouch keeping the pitch. Each playback run fades in over 10 ms and out
over a few milliseconds, so re-anchoring crossfades instead of clicking.

When the chunk the playhead needs is not ready, nomusic pauses the video
("holds" it) rather than let music play. It resumes once at least three
seconds are ready, so one hold does not run straight into the next. Audio is
prepared while a video is paused, so pressing play usually needs no hold.

## Failing closed

nomusic never plays the original track by itself once it is on. If it cannot
remove the music (copy-protected audio, audio it cannot capture, a codec the
browser cannot decode, a chunk stuck for 30 s, or the extension being updated
under an open page), the original stays silent, the video pauses, and the
button's panel offers **Try again** or **Play with music**. When the page
itself has to be reloaded, the panel offers **Reload page** instead of Try
again.

## Memory

The network needs about 500 MB of WebAssembly memory, which a WebAssembly
instance cannot give back: the memory is freed by ending the worker. So the
model lives in one shared worker for all tabs; a paused video lets go of it
after two minutes, and the frame (and with it the worker) is removed 30 s
after no video needs it. Captured audio is bounded per stream (16 MiB) and per
page (48 MiB).

## Browser quirks handled

- Moving a MessagePort to another process with megabytes of audio queued on
  it, or posting one cross-process message that transfers many buffers, hangs
  the page in Chrome. The engine queues messages until the worker holds its
  port, and captured audio is forwarded one entry per message.
- Media routed into an AudioContext that the browser keeps suspended (no user
  gesture yet) still plays, muted; nomusic resumes the context on the first
  click or key press.
- Routing a media element through Web Audio cannot be undone, and a
  cross-origin file routed that way would play silence, so only Media Source
  (blob:) sources are routed; anything else is held instead.
