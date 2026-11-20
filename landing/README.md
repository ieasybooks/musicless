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
- The 37.5 MiB model comes from the existing `ieasybooks` R2 bucket via
  `https://files.ieasybooks.com/musicless/models/spleeter-2stems-<sha256>.onnx`.
  [audio/config.js](audio/config.js) pins the exact extension model hash. SHA-256
  is checked on both network and cached bytes. CacheStorage is best effort;
  eviction, disabled storage and corrupt cache entries trigger a fresh fetch.
- The dedicated worker reuses `extension/model.js`, `dsp.js`, and `grid.js`:
  single-thread ORT WASM, 44.1 kHz, the same STFT, normalization, masks and
  overlapping windows. Decoding is bounded to one ~12-second window plus
  resampling margins. Export is incremental; only compressed output is retained.
- Cancel terminates the worker, including child encoder workers and pending
  downloads. Completion also terminates it to release WASM memory. Preview and
  download use local Blob URLs, revoked on reset or leaving the page.
- Files and filenames are never sent over the network. Only static tools/model
  assets are fetched. A warm cache does not imply guaranteed offline availability.

## Model publishing

`./setup.sh` builds the pinned extension model. To publish it, provide a
Cloudflare API token through the environment, then run:

```sh
node tools/upload-model.mjs
```

The script verifies the local hash, uploads to the hashed object key with
`Cache-Control: public, max-age=31536000, immutable`, then downloads it to
verify its hash and CORS. It does not deploy the website. Never put tokens in
source files or command arguments.

The sibling infrastructure repository manages the bucket's GET/HEAD CORS and
the narrow `/musicless/models/` cache rule for `files.ieasybooks.com`. Model keys
must remain content-addressed. Update the pin and publish a new key when weights
change. Keep old model objects for already-open pages.

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
reference, native and WASM encoders, caching, retries, cancellation, validation,
capability gating and English/Arabic responsive layouts. Artifacts stay ignored
under `tests/.work/landing`. The site never needs this test environment.
Set `LANDING_LONG=1` to also process and verify a full 10-minute file.

## Deployment

On Cloudflare Pages, use the repository root as the build root,
`npm ci && npm run build:landing` as the build command, and `dist/landing` as the
output directory. On another static host, publish the contents of that
directory and serve `index.html` for `/`, `/en/`, and `/ar/`.
Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`. HTTPS is required
outside localhost. The build fetches the pinned ORT package with SHA-256
verification if `setup.sh` has not supplied it locally. It does not bundle the
model into Pages or need Python. No cross-origin isolation headers are required
for the single-thread runtime. License texts, upstream sources and codec build
instructions are published in `/licenses/THIRD_PARTY.md` and adjacent files.
