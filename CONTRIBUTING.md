# Contributing

Thanks for looking. Musicless is a small extension. The useful contributions
are bug reports with a video URL, and small patches that keep the behavior
in the README.

## Bugs and ideas

Search the open issues first. Use the bug report form. It asks for the
browser and version, the operating system, the extension version, the
YouTube URL, and what you heard.

Security vulnerabilities go through the private channel in
[SECURITY.md](SECURITY.md). A public issue is the wrong place for those.

## Build

You need Node.js/npm, `curl`, `tar`, and `python3`. Browser tests also need `ffmpeg`
and Google Chrome, Edge, Brave, another Chromium browser, or Firefox 153 or newer.

```sh
git clone https://github.com/ieasybooks/musicless
cd musicless
./setup.sh --dev
```

`./setup.sh` downloads the Spleeter export and ONNX Runtime Web, checks
their SHA-256, and writes `extension/model/` and `extension/vendor/`.
Those directories are not in git. Do not commit them.

Load the `extension` folder at `chrome://extensions` with Developer mode
on, then choose Load unpacked. Reload any YouTube tab that was already open.
Firefox needs its own manifest: run `./scripts/package.sh`, open
`about:debugging`, choose **This Firefox**, **Load Temporary Add-on**, and
`dist/musicless-<version>-firefox.zip`.

The first time, choose **Turn on Musicless** on the welcome page. Until you
do, Musicless does not remove music.

## Tests

Use the [test selection guide](docs/testing.md#choosing-checks) for the checks
that cover your change and the commands to run them. It includes setup for
local media, browser selection, package testing and live YouTube checks.

The [change map](docs/how-it-works.md#where-to-make-a-change) identifies the
module that owns each behavior. After editing content-script modules, run
`npm run build` before reloading the unpacked extension.

## Pull requests

Target `main`. Say what changed and how you tested it. If you changed the
button, the popup, or the welcome page, add a screenshot.

By sending a patch you agree that it is licensed under the MIT license in
[LICENSE](LICENSE), the same as the rest of the project.

## What we will probably not merge

A backend, an account, analytics, more site permissions, or a different
separation model. The extension runs on YouTube, on the user's device.
Audio is processed there and is not uploaded.
