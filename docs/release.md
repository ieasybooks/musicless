# Releasing

You publish. Nothing in this repository publishes itself except the draft a
tag opens, and that draft stays a draft until you publish it.

The zip you upload to a store is the zip from that draft. Do not upload a zip
you built on a laptop if it differs.

## 1. Listen and test

On Linux, before the tag:

1. **Version.** `extension/manifest.json` `version` is what the stores see.
   They reject a version they have already accepted. For this first package
   that version is `1.0.0`, and the tag is `v1.0.0`.
2. **Dates.** If you tag on a later day, set the `## [1.0.0]` date in
   `CHANGELOG.md` and **Last updated** in `docs/privacy.md` (English and
   Arabic) to that day.
3. **Build.** `./setup.sh --dev`. It checks every download and the built
   model against the pinned SHA-256.
4. **Unit tests.** `cd tests && npm run unit`.
5. **Browser tests.** Build the media once (see [testing](testing.md)), then:
   - `node local.mjs` in Google Chrome (the full suite, about 40 minutes);
   - `QUICK=1 CHROME=<path> node local.mjs` in Brave, Edge and Chromium;
   - `node youtube.mjs` (live YouTube; retry a step an ad or bot check spoiled);
   - `node memory.mjs`.
6. **Listen.** Load `extension/` and watch a few videos with speech over
   music, a song, a seek, a speed change and a live stream. The original is
   never heard while removal is on. The button uses: Remove music, Removing
   music…, Music removed, Click to start the sound, Music not removed, Set up
   nomusic. The recovery panel offers Try again (or Reload page) and Play with
   music. There is no × on the button. The first run asks you to **Turn on
   nomusic** before it processes a video.
7. **Package check.** `./scripts/package.sh` writes `dist/nomusic-<version>.zip`.
   Unzip it and run `NOMUSIC_EXTENSION=<folder> QUICK=1 node local.mjs`, then
   load that folder in a clean profile and play one video. The release zip
   has no debug recorder and no audio-export path. Confirm the unzipped tree
   before you tag. The workflow builds the zip you will actually upload. This
   local zip is only for the listen pass.

On macOS and on Windows, with the same unzipped release, before you publish
the store item:

- Choose **Turn on nomusic**, reload an open YouTube tab, and play a
  public video with speech over music.
- Seek, change speed, turn the player button off and on, and open the
  recovery panel on a video it cannot process.
- Switch the browser language to Arabic and check right-to-left layout.
- The extension stays usable at about 450 MB of extra memory while it runs.

## 2. Keep the old backend, then move main

`main` on GitHub is still the old backend. On 25 October 2026 that commit was
`89006dce37924c3674c2d3d26caa25379dc163c4`. If `git rev-parse origin/main`
prints something else, stop and see whether another backend commit landed.

These commands push. Run them yourself.

```sh
git fetch origin
git rev-parse origin/main
git branch backend origin/main
git tag backend-final origin/main
git push origin refs/heads/backend
git push origin refs/tags/backend-final
```

Rebase the extension branch onto that commit so `main` can move forward
without a force push. The extension history and `origin/main` split at
`1152cb1`.

```sh
git checkout release/v1
git rebase origin/main
git push origin release/v1:main
```

Do not force-push `main`. If the push is rejected, the rebase is not on top
of `origin/main`.

After this, `https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/privacy.md`
must show the privacy policy while you are signed out. That URL is the one
you put in the store.

## 3. Tag

Tag the commit you just pushed. It must contain `.github/workflows/release.yml`,
and `manifest.json` must say `1.0.0`.

```sh
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

The Release workflow runs setup and the same tests as CI, builds
`dist/nomusic-<version>.zip` with `scripts/package.sh`, writes `SHA256SUMS`,
attests the zip and the checksum file, and opens a draft GitHub Release. A
tag whose name is not `v` plus the manifest version fails. A tag on the old
backend history does not run this workflow.

## 4. Check the draft, then publish it

Download the draft's zip, `SHA256SUMS`, and attestation file into one folder.

```sh
sha256sum -c SHA256SUMS
gh attestation verify nomusic-1.0.0.zip --repo IbraheemTuffaha/nomusic
```

On macOS, `shasum -a 256 -c SHA256SUMS` checks the same file.

Unzip the download and confirm it is the build you listened to: model and
runtime present, English and Arabic catalogs present, no debug recorder.
Publish the draft only after that. The attested zip is the file you upload
below.

## 5. Chrome Web Store

Open <https://chrome.google.com/webstore/devconsole/> with the account you
will publish from. Register, pay the fee, accept the terms, verify the
contact email, and turn on 2-Step Verification yourself. Complete whatever
identity check the account asks for.

Upload the zip from the draft. Fill the listing, the Arabic locale, privacy,
and reviewer notes from [store-listing.md](store-listing.md) and
[store-listing.ar.md](store-listing.ar.md). The Arabic page needs a native
review first. Screenshots need a recapture first. The current files in
`docs/store/` still show the old button.

Submit for review and uncheck automatic publication. That holds the item for
you to publish. The hold ends 30 days after approval, and a late publish
needs another review. A first release cannot use a percentage rollout.

Most Chrome Web Store reviews finish within a few days, but some take a few
weeks. Allow time for questions or rejection fixes. If a submission remains
pending for more than three weeks, contact developer support. Use deferred
publishing if the release must wait for a chosen launch time.

When you publish, install from the store in a clean profile, choose **Turn
on nomusic**, and play one video. Put the store URL in the README's install
section, and in the repository homepage, only after the listing is live.

## 6. Edge Add-ons

Upload that same zip, with the same listing text, to the Edge Add-ons
dashboard.

## 7. Repository settings

After `main` is the extension, and before you announce it:

1. **Description.** "Removes the background music from YouTube videos and keeps the voices. A Chrome extension; everything runs on your computer."
2. **Topics.** `browser-extension`, `chrome-extension`, `chromium`, `webextension`, `youtube`, `privacy`, `onnx`, `webassembly`.
3. **Homepage.** Empty until the Chrome Web Store listing is live, then that listing URL.
4. **Social preview.** A PNG, JPG, or GIF under 1 MB, ideally 1280×640. The store tile is 440×280, so use a different image. A workable line is "YouTube, without the music".
5. **License.** Confirm the About box says MIT.
6. **Private vulnerability reporting.** Turn it on. [SECURITY.md](../SECURITY.md) points at that form.
7. **Dependabot.** Turn on alerts and security updates. `.github/dependabot.yml` covers Actions version updates only.
8. **Actions.** Workflow permissions: read repository contents. The Release workflow asks for write on its own job.
9. **Branch protection on `main`.** Require a pull request, with 0 required approving reviews. Require the check `Unit and browser tests (Chrome)`. Block force pushes. Leave admin bypass on. Require signed commits only if you already sign every commit.
10. **Issues stay on. Discussions stay off.**

The issue forms use the labels `bug` and `enhancement`. Confirm those labels
exist.

## 8. The next update

Raise `version`, update the changelog, tag `v` plus that version, and upload
the new draft zip to the existing store item. A GitHub Release does not
update copies installed from the store.
