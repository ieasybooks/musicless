# Releasing

You publish. Nothing in this repository publishes itself except the draft a
tag opens, and that draft stays a draft until you publish it.

The zip you upload to a store is the zip from that draft. Do not upload a zip
you built on a laptop if it differs.

## 1. Listen and test

On Linux, before the tag:

1. **Version.** `extension/manifest.json` `version` is what the stores see.
   Choose the next version before testing; stores reject a version they have
   already accepted. The tag will be `v` followed by that version.
2. **Changelog and policy.** Move the changes for this version out of
   `Unreleased` into a dated changelog section. Leave released sections alone.
   The website's privacy policy, `/en/privacy` and `/ar/privacy` (text in
   `landing/pages.txt`, **Last updated** date in `landing/content.mjs`), is the
   source of truth. If it changed since the last release, update both
   languages of `extension/privacy.html` to match it in this release. Include
   those changes in the tested commit.
3. **Build.** `./setup.sh --dev`. It checks every download and the built
   model against the pinned SHA-256.
4. **Unit tests.** `cd tests && npm run unit`.
5. **Browser tests.** Build the media once, including a real clip as `vlog`
   (see [testing](testing.md)), then:
   - `node local.mjs` in Google Chrome (the full suite on the real clip, about 40 minutes);
   - `QUICK=1 CHROME=<path> node local.mjs` in Brave, Edge and Chromium;
   - `node interface.mjs` (the pages, the popup and the player's controls, in English and Arabic);
   - `node youtube.mjs` (live YouTube; retry a step an ad or bot check spoiled);
   - `node controls.mjs` (where the button sits in YouTube's own player);
   - `node memory.mjs`;
   - in Firefox (with `FIREFOX=<path>` and `FIREFOX_AR=<path to an Arabic Firefox>`),
     `QUICK=1 node local.mjs`, `node interface.mjs`, `node youtube.mjs` and
     `node controls.mjs`.

   Keep each run's report and explain any failure.
6. **Listen.** Load `extension/` and watch a few videos with speech over
   music, a song, a seek, a speed change and a live stream. The original is
   never heard while removal is on. The button sits in YouTube's control bar,
   left of captions: a plain note while the music plays ("Remove music"), the
   note struck through while it is removed ("Restore original sound"). The first
   seconds show YouTube's spinner in the middle of the video, with "Removing
   music" under it. On a Short the button sits with the Short's own buttons.
   The recovery dialog offers Try again (or Reload page) and Play original sound;
   a copy-protected video offers only Play original sound.
   The first run asks you to **Turn on Musicless** before it processes a video.
7. **Package check.** `./scripts/package.sh` writes `dist/musicless-<version>.zip`
   and `dist/musicless-<version>-firefox.zip`, the same files with Firefox's
   manifest. Unzip the first and run `MUSICLESS_EXTENSION=<folder> QUICK=1 node local.mjs`, then
   load that folder in a clean profile and play one video. Unzip the Firefox
   zip and run the same in Firefox (`FIREFOX=<path>`), and check it with
   Mozilla's linter, `npx addons-linter@10.15.0 dist/musicless-<version>-firefox.zip`
   (no errors). Then in Firefox: open `about:debugging`, choose **This
   Firefox**, **Load Temporary Add-on**, and the zip. Turn Musicless on and
   play a video with speech over music, a seek and a speed change, in English
   and in Arabic. The release zip
   has no debug recorder and no audio-export path. Confirm the unzipped tree
   before you tag. The workflow builds the zip you will actually upload. This
   local zip is only for the listen pass.
   Open **Privacy policy** from both the welcome page and the popup while
   offline: the bundled page must open in a new tab without turning Musicless
   on. Check both languages and light/dark appearance.

On macOS and on Windows, with the same unzipped release, before you publish
the store item:

- Choose **Turn on Musicless**, reload an open YouTube tab, and play a
  public video with speech over music.
- Seek, change speed, turn the player button off and on, and open the
  recovery dialog on a video it cannot process.
- Switch the browser language to Arabic and check right-to-left layout.
- The extension stays usable at about 400 MB of extra memory while it runs.

## 2. Push main

`main` must be the commit you tested, including the changelog and any policy
changes from step 1, on top of `origin/main`. Review the history being published as well
as the final files: deleting a file in a later commit does not remove its
earlier versions.

```sh
git switch main
git status --short                # must be empty
git fetch origin
git merge-base --is-ancestor origin/main main
git push origin main
```

Do not force-push `main`. If the push is rejected, `main` is not on top of
`origin/main`.

The stores link to the privacy policy on the website,
`https://musicless.ieasybooks.com/en/privacy`, which is the source of truth.
`docs/privacy.md` only points to it, and `extension/privacy.html` is updated
to match it with the next extension release.

## 3. Tag

Tag the tested commit you just pushed. It contains
`.github/workflows/release.yml`, and its manifest version must match the tag.
If the release contents change, rebuild and test that commit before tagging.

```sh
version=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
git tag -a "v$version" main -m "Musicless $version"
git push origin "v$version"
```

The Release workflow has two jobs. The first runs the unit tests, builds
both zips with `scripts/package.sh`, and tests the unzipped Chrome package:
the full local suite, interface checks and the memory check in Chrome.
The second, the only one that can write, builds the zips again without
the test tools, checks that they are the zips the first job built (same
SHA-256), writes `SHA256SUMS`, attests the zips and the checksum file, and
opens a draft GitHub Release. A tag whose name is not `v` plus the manifest version
fails.

## 4. Check the draft, then publish it

Download the draft's two zips, `SHA256SUMS`, and attestation file into one folder.

```sh
sha256sum -c SHA256SUMS
for zip in musicless-*.zip; do gh attestation verify "$zip" --repo ieasybooks/musicless; done
```

On macOS, `shasum -a 256 -c SHA256SUMS` checks the same file.

Unzip the download and confirm it is the build you listened to: model and
runtime present, English and Arabic catalogs present, no debug recorder.
Publish the draft only after that. The attested zips are the files you upload
below: `musicless-<version>.zip` to Chrome and Edge, and
`musicless-<version>-firefox.zip` to Firefox.

## 5. Chrome Web Store

Musicless is published by ieasybooks. Open
<https://chrome.google.com/webstore/devconsole/> with the ieasybooks
developer account and update the existing Musicless item. Confirm that
2-Step Verification is still on and the contact email is current.

Upload the verified release zip. Use the listing, Arabic locale, privacy,
and reviewer notes in [store-listing.md](store-listing.md) and
[store-listing.ar.md](store-listing.ar.md). Any changed Arabic wording needs
a native speaker's review before submission.

A GitHub Release does not update copies installed from the store. Each
store must receive the verified zip for the new version.

The images in `docs/store/` come from `tests/screenshots.mjs`. Remake them
after any change to the button, the pages or the strings:

```sh
cd tests
node screenshots.mjs            # Google Chrome; add CHROME=<path> for another browser
```

It installs the extension in a throwaway profile, opens live YouTube pages
(NASA Goddard's public-domain "Tour of the Moon in 4K"), the first-run page
and the popup, once in English and once in Arabic, and writes `en-1-…png` to
`en-4-…png` and `ar-1-…png` to `ar-4-…png`. The icons, `store-icon-128.png`
and the promo tile come from `node tools/icons.mjs` (from the repository
root) after any change to the mark.
A YouTube bot check or an ad can spoil a run; run it again. Portable browser
copies need `MUSICLESS_NO_SANDBOX=1`. Upload the English screenshots with the
English listing and the Arabic ones with the Arabic locale; the promo tile
and `store-icon-128.png` are global.

Submit for review and uncheck automatic publication. That holds the item for
you to publish. The hold ends 30 days after approval, and a late publish
needs another review. A first release cannot use a percentage rollout.

Most Chrome Web Store reviews finish within a few days, but some take a few
weeks. Allow time for questions or rejection fixes. If a submission remains
pending for more than three weeks, contact developer support. Use deferred
publishing if the release must wait for a chosen launch time.

When you publish, install from the store in a clean profile, choose **Turn
on Musicless**, and play one video. Put the store URL in the README's install
section, and in the repository homepage, only after the listing is live.

## 6. Firefox Add-ons

Open <https://addons.mozilla.org/developers/> with the ieasybooks Mozilla
account and upload the verified `musicless-<version>-firefox.zip` as a new
version of Musicless. Choose Firefox on the desktop only: Musicless does not
run on phones. Its add-on ID, `musicless@ieasybooks` in the Firefox manifest,
can never change.

Mozilla asks for the source of generated files, and `content.bundle.js` is
built. Upload the tag's source, `git archive --format=zip -o musicless-<version>-source.zip v<version>`,
and give this build note: "Run ./setup.sh (Node.js 24 with npm, curl, tar, Python 3), then
./scripts/package.sh; it writes dist/musicless-<version>-firefox.zip. The model
and ONNX Runtime files are downloaded and checked against the SHA-256 values in
tools/dependencies.json." Use the same name, summary, detailed description,
English screenshots, homepage, support link and privacy policy as for Chrome
([store listing](store-listing.md)); its privacy practices and reviewer notes
are written for Chrome's dashboard. The listing is in English only: Mozilla
offers no Arabic listing text. Listed versions go public when Mozilla approves
them, sometimes within minutes.

The first time only:

- Choose **Submit a New Add-on**, **On this site**, instead of a new version.
- On **Edit Product Page**, upload `docs/store/store-icon-128.png` as the
  listing's icon (Mozilla does not take it from the zip), and enter the Chrome
  listing's contact email as the support email: the privacy policy sends
  privacy questions to the email on the store listing.
- Once the listing is live, put its URL in the README's Firefox Add-ons section.

## 7. Edge Add-ons

Upload the Chrome zip, with the same listing text, to the Edge Add-ons
dashboard.

## 8. Repository settings

When setting up or reviewing the repository:

1. **Description.** "Removes the background music from YouTube videos and keeps the voices. A browser extension; everything runs on your computer."
2. **Topics.** `browser-extension`, `chrome-extension`, `firefox-addon`, `chromium`, `webextension`, `youtube`, `privacy`, `onnx`, `webassembly`.
3. **Homepage.** Empty until the Chrome Web Store listing is live, then that listing URL.
4. **Social preview.** Upload [store/github-social-1280x640.png](store/github-social-1280x640.png), the supplied 1280×640 image with the logo, tagline, quieter product description and faint stave with a gap.
5. **License.** Confirm the About box says MIT.
6. **Private vulnerability reporting.** Turn it on. [SECURITY.md](../SECURITY.md) points at that form.
7. **Dependabot.** Turn on alerts and security updates. `.github/dependabot.yml` covers Actions version updates only.
8. **Actions.** Workflow permissions: read repository contents. The Release workflow asks for write only in its release job, which runs no test tools.
9. **Branch protection on `main`.** Require a pull request, with 0 required approving reviews. Require the check `Unit and browser tests (Chrome)`. Block force pushes. Leave admin bypass on. Require signed commits only if you already sign every commit.
10. **Issues stay on. Discussions stay off.**

The issue forms use the labels `bug` and `enhancement`. Confirm those labels
exist.
