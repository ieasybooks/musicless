# Contributing

Thanks for looking. nomusic is a small extension. The useful contributions
are bug reports with a video URL, and small patches that keep the behavior
in the README.

## Bugs and ideas

Search the open issues first. Use the bug report form. It asks for the
browser and version, the operating system, the extension version, the
YouTube URL, and what you heard.

Security vulnerabilities go through the private channel in
[SECURITY.md](SECURITY.md). A public issue is the wrong place for those.

## Build

You need `curl`, `tar`, and `python3`. Browser tests also need `ffmpeg`
and Google Chrome, Edge, Brave, or another Chromium browser.

```sh
git clone https://github.com/IbraheemTuffaha/nomusic
cd nomusic
./setup.sh --dev
```

`./setup.sh` downloads the Spleeter export and ONNX Runtime Web, checks
their SHA-256, and writes `extension/model/` and `extension/vendor/`.
Those directories are not in git. Do not commit them.

Load the `extension` folder at `chrome://extensions` with Developer mode
on, then choose Load unpacked. Reload any YouTube tab that was already open.

The first time, choose **Turn on nomusic** on the welcome page. Until you
do, nomusic does not remove music.

## Tests

[docs/testing.md](docs/testing.md) is the full guide.

```sh
cd tests && npm run unit
```

The browser suites need the media built once, as that document describes.
`QUICK=1 node local.mjs` is the short local run. CI runs that run.

## Pull requests

Target `main`. Say what changed and how you tested it. If you changed the
button, the popup, or the welcome page, add a screenshot.

By sending a patch you agree that it is licensed under the MIT license in
[LICENSE](LICENSE), the same as the rest of the project.

## What we will probably not merge

A backend, an account, analytics, more site permissions, or a different
separation model. The extension runs on YouTube, on the user's computer.
Audio is processed there and is not uploaded.
