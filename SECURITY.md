# Security policy

## Reporting a vulnerability

Report security issues privately:

https://github.com/IbraheemTuffaha/nomusic/security/advisories/new

That form works once private vulnerability reporting is enabled for this
repository. Please do not open a public issue, and do not post a proof of
concept on the issue tracker.

There is no bug bounty.

## What to include

- The extension version (`chrome://extensions`) and whether it came from
  the Chrome Web Store or from a GitHub Release zip.
- Browser name and version, and the operating system.
- A YouTube URL, if a video is needed to see the problem.
- What an attacker can do, and what you have already tried.

Do not include browser account cookies, session tokens, or a recording
that shows a signed-in account you do not want to share.

## In scope

- The extension code in this repository, including the page-world scripts
  that run on YouTube (`capture.js`, `intent.js`).
- The build and packaging (`setup.sh`, `scripts/package.sh`, the release
  workflow) if a published zip does not match the attested release.
- Unexpected network requests. nomusic is not supposed to make any.

## Out of scope

- Separation quality: leftover music, dull voices, or a video nomusic
  refuses. Those are bugs. Use the bug report form.
- YouTube itself, browser bugs, and vulnerabilities in a dependency that
  nomusic does not ship. If ONNX Runtime or the Spleeter weights have
  their own advisory, you can still tell us if the published extension is
  affected.
