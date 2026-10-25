# Releasing

1. **Version.** Bump `version` in `extension/manifest.json` (stores reject a
   version they have already seen).
2. **Build.** `./setup.sh --dev`. It verifies every download against its pinned
   SHA-256 and the built model against the tested one.
3. **Unit tests.** `cd tests && npm run unit`.
4. **Browser tests.** Build the media once (see [testing](testing.md)), then:
   - `node local.mjs` in Google Chrome (the full suite, about 40 minutes);
   - `QUICK=1 CHROME=<path> node local.mjs` in Brave, Edge and Chromium;
   - `node youtube.mjs` (live YouTube; retry a step an ad or bot check spoiled);
   - `node memory.mjs`.
5. **Listen.** Load `extension/` in your own browser profile and watch a few
   videos with speech over music, a song, a seek, a speed change and a live
   stream. Check that the original is never heard and that the button and the
   toolbar setting behave.
6. **Package.** `./scripts/package.sh` writes `dist/nomusic-<version>.zip`
   (reproducible: the same sources give the same SHA-256). Unzip it into an
   empty folder and run the quick suite against it
   (`NOMUSIC_EXTENSION=<folder> QUICK=1 node local.mjs`), then load that folder
   in a clean browser profile and play one video.
7. **Publish.** Upload the zip to the Chrome Web Store and Edge Add-ons
   dashboards with the texts and images in the [store listing](store-listing.md).
   Attach the zip and its SHA-256 to a GitHub release tagged `v<version>`.

Store review usually takes a few days. Installed copies update themselves
afterwards; pages that were open during an update show "nomusic was updated or
turned off. Reload the page to continue."
