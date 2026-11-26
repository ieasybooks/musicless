# Musicless landing page

The static site for `musicless.ieasybooks.com` has English and Arabic pages,
with tabs for the YouTube extension and local audio processing.

## Local preview

Run these commands from the repository root with Node.js 22 or newer.

```sh
npm ci
npm run build:landing
npm run preview:landing
```

Open `http://localhost:8840/`. It opens in Arabic when the browser's primary
language is Arabic and in English otherwise. Use `/en/` or `/ar/` to preview
a specific language. Set `PORT` to change the preview port.
Open `/en/#files` or `/ar/#files` to go straight to the audio tool.
No backend, R2 credentials, or local model build is needed to use the site.

## Editing the page

Edit the English and Arabic text, store links, and YouTube video IDs in
[content.mjs](content.mjs). Rebuild the site to see your changes.
The audio tool's copy and FAQ are in [audio/copy.js](audio/copy.js).

The About, Privacy policy, Terms of use and Contact & support pages
(`/en/about`, `/en/privacy`, `/en/terms`, `/en/support` and the same under
`/ar/`) are built from [pages.txt](pages.txt), the approved text, one block per
page and language: line 1 is the title, line 2 the lead paragraph, `## ` starts
a section heading and every other line is a paragraph. Links are
`[label](href)`, and `tab:privacy` links to the privacy policy in the same
language. The **Last updated** line of the privacy policy and terms is in
[content.mjs](content.mjs). Change their text only to an approved version, and
update `tests/fixtures/landing-pages.txt` to match: the landing tests compare
every page with it word for word.

Each page shows a local poster. Selecting it loads that language's launch video
in YouTube's privacy-enhanced player. The link below opens the video on YouTube.

## Audio processing

- MP3 → MP3; M4A containing AAC → M4A containing AAC-LC. Mono/stereo only,
  up to 10 minutes and 100 MiB, input sample rates 8–96 kHz. Output is 44.1 kHz,
  96 kbps mono or 192 kbps stereo. The model preserves speech and singing;
  separation may leave music or affect voice quality. Metadata/artwork are not copied.
- Capability detection runs in the worker: secure context, WebAssembly SIMD,
  WebCodecs audio decoding, and the actual file's decoder configuration. There
  is no browser-name allowlist. M4A with Apple Lossless, video, multitrack,
  protected/unreadable files and other formats receive an explanation.
- File selection inspects the container/codec/duration with MediaBunny. Submit
  checks the output settings, lazily registers the official MediaBunny MP3 or
  AAC WASM encoder when the native encoder is unavailable, and performs a real
  short decode/encode before downloading the model.
- The website has its own music-removal model, separate from the extension's
  Spleeter: a 47.3 MiB ONNX graph (12M float32 weights, band-split recurrent
  layers) that reads the full-band complex spectrum of a stereo window and
  returns that spectrum without the music. It comes from the existing
  `ieasybooks` R2 bucket via
  `https://files.ieasybooks.com/musicless/models/musicless-<sha256>.onnx`.
  [audio/config.js](audio/config.js) pins its hash and exact size. SHA-256 is
  checked on both network and cached bytes. CacheStorage is best effort;
  eviction, disabled storage and corrupt cache entries trigger a fresh fetch.
  Once a new model is cached, older ones are deleted from the cache.
- The dedicated worker runs it on single-thread ORT WASM with
  [audio/grid.js](audio/grid.js) and [audio/dsp.js](audio/dsp.js): 44.1 kHz,
  ~11.9-second windows on a fixed grid from the start of the file, a centred
  STFT (n_fft 4096, hop 1024, square-root Hann, all 2049 bins) at the audio's
  own level, and a 46 ms crossfade between windows. Mono files are separated as
  identical left and right channels. Each window takes about 3× the CPU time
  Spleeter needs (about 4 s on a mid-range desktop), so a 10-minute file takes
  a few minutes. The tool shows the time left after the first window and keeps
  the screen awake while it works (phones pause hidden pages). Decoding is
  bounded to one window plus resampling margins. Export is incremental; only
  compressed output is retained.
- A small music detector runs first on every window, and the model only runs
  where it is needed. Windows without music keep their decoded audio (at
  44.1 kHz) and go through the same crossfades and export, so a file without
  music, or with music only in an intro, an outro or a few short cues, can
  finish in a fraction of the time. The detector
  ([audio/engine/detector.onnx](audio/engine/detector.onnx), a 129K-parameter
  convolutional network of 506 KiB that ships with the site) reads 48 mel
  bands of the window's mid and side channels up to 8 kHz, computed from the
  spectrum the tool needs anyway, and scores every 0.19 s of the window; a
  score of 0 or more means music is likely, and the window is separated. It
  and the check below add about
  20 ms per window on an Apple M3, against 2.9 s for the model there, so a file
  with music throughout takes about 0.7% longer. It is trained to find music
  from about 30 dB below the speech up; [tools/detector.py](../tools/detector.py)
  rebuilds it and its docstring describes the data, the labels and the threshold.
- The threshold errs towards music: in evaluation (speakers and music not used
  in training) it flagged every window with music, down to beds 36 dB under
  the speech and 0.5 s cues, and also most windows of spoken-word recordings
  without music, especially reverberant ones. Those take as long as before; clean, dry recordings gain
  the most. The detector does not adapt its threshold to a file, since a
  window that looked like music in one part of a file says little about
  another. After the model separates a window, [audio/dsp.js](audio/dsp.js)
  measures what it removed (more than -40 dB of the window or -35 dB in any
  second means it changed the window). After a window the model changed, the
  next one is separated whatever its score, because music often fades out
  across windows. If the detector can't load or run, or returns anything but
  64 finite scores, every window is separated, as before. Only when the
  detector flagged no window, so the model never ran, does the result say it
  found no music.
- Multithreading would need cross-origin isolation headers, which would block
  the home page's YouTube player, and the model's recurrent layers gain little
  from more threads, so the tool stays single-threaded.
- Cancel terminates the worker, including child encoder workers and pending
  downloads. Completion also terminates it to release WASM memory. Preview and
  download use local Blob URLs, revoked on reset or leaving the page.
- Files and filenames are never sent over the network. Only static tools/model
  assets are fetched. A warm cache does not imply guaranteed offline availability.

## Model publishing

Pass the model file to the script and provide a Cloudflare API token that can
write the `ieasybooks` bucket through the environment. From the sibling
infrastructure repository, the vault supplies Terraform's token for one run:

```sh
mise run vault:run INFRASTRUCTURE_CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN -- \
  node ../musicless/tools/upload-model.mjs path/to/model.onnx
```

The script verifies the file against the pinned hash, uploads to the hashed object key with
`Cache-Control: public, max-age=31536000, immutable`, then downloads it to
verify its hash and CORS. It does not deploy the website. Never put tokens in
source files or command arguments.

The sibling infrastructure repository manages the bucket's GET/HEAD CORS and
the narrow `/musicless/models/` cache rule for `files.ieasybooks.com`. Model keys
must remain content-addressed. Update the pin and publish a new key when weights
change, before merging. The deployment checks the pinned model in R2 first. Keep
old model objects for already-open pages.

## Tests

After `./setup.sh --dev` and installing FFmpeg:

```sh
cd tests
npm run unit
cd ..
npm run test:landing
```

The landing suite builds and serves on port 8841 (override with
`LANDING_TEST_PORT`), launches Chrome (`CHROME` can override the executable),
and downloads the actual R2 model. Set `FIREFOX=/path/to/firefox` to run the same
suite in Firefox instead. It uses synthetic audio to check real MP3
and AAC M4A downloads, duration/channels, audio agreement with the Python
reference, the music detector (a voice-only file skips the model and says so;
in a file with music only at the end, only those windows use the model; the
browser and the reference give the detector the same input; a missing or
failing detector separates every window; and, in every half second up to
the end, before encoding, no music of a quiet bed, a short cue or music
starting just before a window is left in, compared with separating every
window: in the reference and, in Chrome, in the audio the browser encodes),
native and WASM
encoders, caching, retries, cancellation, validation,
capability gating and English/Arabic responsive layouts. It also checks the
About, Privacy policy, Terms of use and Contact & support pages against the
approved text, with their links, footer, sitemap entries and layout.
Artifacts stay ignored under `tests/.work/landing`. The site never needs this
test environment.
Set `LANDING_LONG=1` to also process and verify a full 10-minute file.

## Deployment

On Cloudflare Pages, use the repository root as the build root,
`npm ci && npm run build:landing` as the build command, and `dist/landing` as the
output directory. On another static host, publish the contents of that
directory and serve `index.html` for `/`, `/en/`, and `/ar/`, and
`en/privacy.html` and the other pages at `/en/privacy` and so on, without a
redirect.
Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`. HTTPS is required
outside localhost. The build fetches the pinned ORT package with SHA-256
verification if `setup.sh` has not supplied it locally. It bundles only the
small music detector, not the model, and does not need Python. No cross-origin isolation headers are required
for the single-thread runtime. License texts, upstream sources and codec build
instructions are published in `/licenses/THIRD_PARTY.md` and adjacent files.
