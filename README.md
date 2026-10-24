# nomusic offline (prototype)

A self-contained Chromium extension that removes background music from YouTube
videos entirely on the user's computer: no backend, no downloads, no account.
It runs Spleeter 2-stem in the browser on one CPU thread.

## Install

```sh
./setup.sh   # fetches and builds the model (37.5 MiB) and ONNX Runtime Web
```

Then in Chrome, Edge, Brave or another Chromium browser open `chrome://extensions`,
turn on **Developer mode**, choose **Load unpacked** and pick `offline/extension`.
On a YouTube video, click the **nomusic** pill in the player's top-left corner.

The extension asks for no permissions beyond running on YouTube
(`www.youtube.com`, `m.youtube.com`, `www.youtube-nocookie.com` for embeds).
There is no service worker, popup, network access or storage.

## How it works

| Piece | Role |
| --- | --- |
| `capture.js` | Runs in the page before YouTube's player. Keeps a copy of the encoded audio the player appends to its Media Source buffers, usually well ahead of the playhead. |
| `content.js` | The pill, the Web Audio graph and playback. Routes the `<video>` through Web Audio to silence its track (the page's volume and mute keep working), schedules separated chunks on the video's clock, holds the video if separation falls behind, and follows source changes (next video, ads). |
| `separator.html/js` | A hidden extension frame. It hosts the worker in the extension's origin, where WebAssembly is allowed and the page cannot reach it. |
| `worker.js` | Demuxes (`demux.js`: WebM/Opus, fragmented MP4/AAC), decodes with WebCodecs, resamples to 44.1 kHz and runs the model. Then returns the vocals in back-to-back 11.9 s chunks, current chunk first. |
| `dsp.js` | STFT/iSTFT and resampling, matching the reference Python pipeline (54 dB agreement on loud passages). |
| `stretch.js`, `third_party/soundtouch` | Pitch-preserving time-stretch for speeds other than 1x (shared with the main extension). |
| `model/spleeter-2stems.onnx` | Built by `tools/build_model.py`: both Spleeter networks merged into one graph that outputs the vocal mask, with weights stored as fp16. |

## Tests

```sh
cd tests
python3 build_media.py <video file> <media dir>/vlog 240   # local test streams
node local.mjs <media dir>    # local Media Source pages: formats, seeks, speeds, stalls, ...
node youtube.mjs              # live YouTube pages in headless Chrome
node memory.mjs <media dir>   # memory cost
CHROME=/path/to/brave node local.mjs <media dir>   # any Chromium browser
```

Each test records the page's own audio and the extension's output on the same
clock, then `analyze.py` measures sync (cross-correlation against Spleeter run
offline), dropouts and output during silence. With the page's source file, it
also compares against 1x Spleeter read at the media time each output block was
heard, which holds at any playback speed.

## Known limits

- **Sources it can capture:** only Media Source players with Opus (WebM) or AAC (MP4) audio. A plain `<video src=file.mp4>` plays its original audio (the pill says so), and DRM-protected video cannot be captured.
- **Speed changes:** the voice is time-stretched by SoundTouch, not Chrome's own stretcher. At 1.5x the vocals are about 30 ms ahead of the picture, which is under the usual 45 ms noticeability threshold.
- **Fullscreen:** sites that make the `<video>` element itself fullscreen (rather than its container) hide the pill.
- **Startup and seek pause:** playback pauses for about 2.5 s while the first chunk is separated, both after switching nomusic on and after a seek into audio the player has not loaded yet.
- **Thin buffers:** each chunk needs audio up to its end, about 12 s past its start. If a site buffers less than that ahead, playback pauses briefly at chunk boundaries. YouTube normally buffers far more. A live stream watched right at the live edge (where only a few seconds are buffered) would keep pausing; a few tens of seconds behind it works (tested on a 24/7 stream).
- **AAC in open-source Chromium:** these builds have no AAC decoder. YouTube serves them Opus, which works; on AAC-only sites the pill falls back to the original audio and says why.
- **Headless test environment:** here, YouTube never loads a new position after a seek, even with no extension installed. YouTube seek tests therefore stay inside already-loaded audio, and seeking into new audio is covered by the local suite.
