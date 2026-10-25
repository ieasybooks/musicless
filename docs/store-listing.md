# Store listing (Chrome Web Store)

Paste the blocks below into the dashboard. The Arabic locale is
[store-listing.ar.md](store-listing.ar.md). It needs a native review before
submission. Edge Add-ons can use the same public text. Images are in
`docs/store/`. Recapture them before upload. The files there still show an
older button.

Do not submit until the release zip matches this page: English and Arabic UI,
the first-run **Turn on nomusic** choice, no debug recorder, and the button
labels named below.

## Listing

**Name** (same in both locales; 7 of 75 characters):

```text
nomusic
```

**Summary** (110 of 132 characters; the manifest `description` is this string):

```text
Reduce background music and keep voices. For use with YouTube™. Audio is processed locally and never uploaded.
```

**Language:** English (`default_locale: en`), plus Arabic (`ar`) from the
packaged catalogs. Arabic is a language, not a region limit.

**Category:** Accessibility, if that choice is in the live dashboard. The
reason is assistive listening, not a medical or hearing-restoration claim. If
the live list has no accessibility category, use the applicable Tools
category. This is a recommendation, not a category Google requires by name.

**Detailed description:**

```text
nomusic reduces background music while keeping the voices: speech and singing. Compatible with YouTube™. It is made for people who want to avoid music for religious or personal reasons, and anyone who prefers voices with less background music.

How it works
• Audio separation runs on your computer using a bundled, open-source model. No account or backend service is needed.
• After you choose Turn on nomusic, automatic removal is on by default. Turn it off in the toolbar if you prefer to start per video.
• The video may pause briefly at the start or after a seek while clean audio is prepared. The button says Removing music… while that happens.
• Click Music removed on the player to hear the original sound, and click Remove music to turn removal back on. Before the first-run choice, the button says Set up nomusic.

Playback controls
Volume, mute, seeking, fullscreen, and speed changes are supported. nomusic also works with supported Shorts, live streams, and embedded players on computers.

Privacy
nomusic reads audio that the site's own player has already loaded and processes it in browser memory only for music removal. Audio is never uploaded, shared, or saved as a file. It does not offer media downloads, recording, or audio export. The developer receives no audio, browsing history, or usage analytics. The automatic-removal setting, and whether you have turned nomusic on, are stored with Chrome's extension storage and may sync between your devices through Chrome Sync.

Limits to know
• Some music may remain, especially quiet background music under speech. Voices can sound less bright. This is not a guarantee of music-free playback.
• Processing uses one CPU thread and roughly 450–500 MB of memory; performance varies by computer and video.
• Copy-protected videos cannot be processed. When removal fails, the button says Music not removed. The video pauses and the original stays silent until you choose Try again or Play with music. Some failures ask you to Reload page instead. If the browser is waiting for a click before it plays sound, the button says Click to start the sound.
• Live streams may pause repeatedly at the live edge; playing a little behind it can help.
• This extension supports the listed site's desktop players, not phone browsers or other video services.

Free and open source. Code and help: https://github.com/IbraheemTuffaha/nomusic
Privacy policy: https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/privacy.md

nomusic is an independent project and is not affiliated with or endorsed by YouTube or Google. YouTube is a trademark of Google LLC. Use of this trademark is subject to Google Permissions.
```

The player labels in that text are: Remove music, Removing music…, Music
removed, Click to start the sound, Music not removed, Set up nomusic. The
recovery panel offers Try again (or Reload page) and Play with music.

## Links and distribution

| Field | Value |
| --- | --- |
| Homepage | `https://github.com/IbraheemTuffaha/nomusic` after `main` is this extension |
| Support | `https://github.com/IbraheemTuffaha/nomusic/issues` |
| Official / verified site | Leave empty unless you verify a domain you control. Do not verify `github.com`. |
| Privacy policy | `https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/privacy.md` only after that URL shows this policy while signed out |
| Price | Free. No in-app purchases. |
| Visibility | Public |
| Regions | All regions, unless you have a restriction |
| Mature content | Off for the prepared general-audience images |
| Promo video and marquee | Leave empty for 1.0.0 |
| Percentage rollout | Not available for a first release |
| After approval | Deferred publishing: uncheck automatic publication, then publish within 30 days |

**Non-trader or trader** is your decision from your own circumstances. A free
personal project is often a non-trader. A free extension that is part of a
business can still be a trader. Do not guess this in the form.

## Privacy practices

**Single purpose:**

```text
Reduce background music during YouTube video playback while preserving voices, by separating the audio already loaded by the player locally in browser memory and playing the voices in sync with the original video.
```

**`storage`:**

```text
Stores the automatic music-removal preference and whether the user has acknowledged the first-run local-audio disclosure (Turn on nomusic). These settings let nomusic start consistently and avoid repeating the disclosure. Both may sync between the user's own devices through Chrome Sync. No audio, video, browsing-history log, or analytics is stored in extension storage.
```

Re-read this against the keys the extension actually writes. If the
acknowledgement is not synced, say where it is stored.

**Host access**, if the dashboard has one box. The three origins come from
`content_scripts.matches`. There is no `host_permissions` array.

```text
Static content scripts run only on https://www.youtube.com/*, https://m.youtube.com/*, and https://www.youtube-nocookie.com/*. They access the encoded audio that the page's existing player supplies to MediaSource/SourceBuffer, pass it to packaged extension workers for local separation, silence the original track while enabled, play the separated voices in sync, and display the nomusic control and recovery messages. document_start is needed to observe audio supplied when the player starts. Matching frames are included for embedded players. No access to unrelated sites or the embedding parent page is requested. No video/audio download, upload, or export is provided.
```

If the dashboard has one box per host:

| Host | Justification |
| --- | --- |
| `https://www.youtube.com/*` | Access the standard website's player audio already loaded into MediaSource, separate it locally, synchronize voice playback, and show the on/off and recovery controls. |
| `https://m.youtube.com/*` | Provide the same local playback separation and controls when a supported desktop browser is using the mobile website. This is website compatibility, not a claim that Chrome extensions run on phones. |
| `https://www.youtube-nocookie.com/*` | Provide the same local playback separation and controls inside privacy-enhanced embedded players whose frame origin is www.youtube-nocookie.com. |

There is no `tabs`, `activeTab`, `scripting`, `downloads`, `tabCapture`,
`offscreen`, `webRequest`, microphone, or history permission. Do not add one
to match a guessed form.

**Remote code:** No, I am not using remote code.

```text
All executable code and model files are included in the submitted package. nomusic bundles ONNX Runtime Web 1.30.0: vendor/ort.wasm.min.mjs, vendor/ort-wasm-simd-threaded.mjs, and vendor/ort-wasm-simd-threaded.wasm (14,239,897 bytes). It also bundles model/spleeter-2stems.onnx (39,364,028 bytes), an offline Spleeter 2-stem graph with fp16 weight storage.

model.js imports the packaged ORT module, sets ort.env.wasm.wasmPaths to the packaged vendor directory, sets numThreads = 1 and proxy = false, and loads the model from the extension's own URL. The word "threaded" in the upstream WASM filename does not mean that nomusic enables multiple inference threads.

The extension_pages CSP allows 'wasm-unsafe-eval' solely to compile and instantiate this bundled WebAssembly runtime. It does not allow JavaScript 'unsafe-eval' or remote script origins. There is no CDN import, fetched executable code, remote model/configuration interpreter, or backend inference service.

The vendor JavaScript is the normal upstream minified distribution, not an obfuscated application payload. Our application logic is supplied as readable modules. Dependency versions, pinned download checksums, model conversion steps, and license notices are documented in the project and package. Build-time downloads happen before packaging, not on the user's machine at runtime.
```

If "No" disables the explanation box, put that text in the reviewer notes.
The byte counts above are from `./setup.sh` on this tree. Check them again
on the zip you upload if the model or the runtime pin changes. Packaged WASM
is not remote code.

**Data usage.** Check **Website content** only. The form's examples include
sounds and videos. Audio is processed locally and is not sent off the
computer. Uncheck personally identifiable information, health, financial,
authentication, personal communications, location, web history, and user
activity.

```text
Website audio is processed only in browser memory to remove background music during playback. Audio is not uploaded, shared, saved as a file, used for training, or received by the developer. No viewing-history log or analytics is maintained. Chrome may sync the automatic-removal setting and the first-run acknowledgement between the user's own devices; the developer does not receive them. Please see the linked privacy policy for the local processing and storage details.
```

**Certifications.** Check all three, only if they are true of this package:

1. I do not sell user data to third parties.
2. I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
3. I do not use or transfer user data to determine creditworthiness or for lending purposes.

Read each live tooltip before you certify.

**Reviewer notes**, including the test steps. Permission explanations above
may stay in English. Describe only behavior the zip actually has.

```text
Purpose: local background-music reduction during playback, keeping speech and singing. No nomusic account, payment, backend, microphone permission, media downloads, or export is needed.

1. Install the submitted package on a desktop Chrome version supported by the manifest. Before the first-run choice, the player button says Set up nomusic and opens the welcome page. nomusic does not process audio until you choose Turn on nomusic. Reload website tabs that were open before installation.
2. Open a normal, non-copy-protected YouTube video with speech over background music. A public video works; no YouTube login is required for ordinary public playback. Leave the video unmuted. The first audio may take a few seconds to prepare; the video pauses during preparation. The button says Removing music… while it prepares.
3. The player's Music removed control indicates separation is enabled. Listen for reduced instruments with retained speech and singing. Some music leakage is expected and is disclosed. Click that control to hear the original, then click Remove music to turn removal back on.
4. Try volume, mute, a seek, and a speed change. Check an embedded player as well. In the toolbar popup, turn automatic removal off, open another supported video, and click Remove music on its player.
5. If processing fails or the content is copy-protected, the button says Music not removed. The video remains paused and the original track stays silent until the user chooses Try again or Play with music. Some failures show Reload page instead of Try again. This is deliberate fail-closed behavior. DRM is not bypassed. A live stream at the live edge can pause repeatedly; test slightly behind the edge.
6. Choose an Arabic browser UI locale and verify the localized controls, welcome page, and right-to-left layout. English and Arabic have identical features and privacy behavior.

Media handling: nomusic does not issue requests to fetch media from YouTube or a third-party service. The normal website player makes its own streaming requests. The extension copies audio bytes that the player supplies to MediaSource/SourceBuffer, uses them temporarily in RAM for separation, and replaces the sound heard during the same player session with the separated voices. It does not save, download, export, redistribute, or provide later offline access to that media. Ads continue through the site's player; nomusic is not an ad blocker.

Runtime: the package includes ONNX Runtime Web 1.30.0, its approximately 14 MB WASM binary, and an approximately 37.5 MiB ONNX model. All inference runs locally on one CPU thread. The extension-origin frame and workers need the documented wasm-unsafe-eval CSP to instantiate the packaged WASM. No remote executable code is loaded. The source, pinned setup, and third-party license notices explain the included vendor files.

web_accessible_resources exposes the packaged content-script module dependencies, the player-control image, and separator.html only to the same three supported website origins. The model and runtime are loaded from the extension origin, not from a CDN.
```

Add a stable public video URL you have permission to use, and one alternate,
if you have them. Do not invent a URL and do not ask the reviewer to sign in
to your account.

## Images

Recapture before upload. Show the real extension on a real YouTube player,
with public-domain or owned footage (for example a NASA narration with
music). No × on the button. No "100% music-free" claim.

| File | What to show |
| --- | --- |
| `1-removes-music.png` | Headline: "Reduce background music. Keep the voices." Include "Some music may remain." |
| `2-never-plays-music.png` | "If it can't remove the music, you decide what plays." Show Try again (or Reload page) and Play with music, readable at store size. |
| `3-one-setting.png` | "Automatic removal. Audio stays on your computer." |
| `4-welcome.png` | The **Turn on nomusic** disclosure, or "Start automatically or turn it on per video." Text must stay readable at 640×400. |
| `promo-tile-440x280.png` | 440×280. Prefer the icon and the name nomusic, without an English-only slogan. A slogan on this tile cannot be translated. If you keep words, use "Less background music. Clearer voices." |
| Store icon | Own 128×128 PNG. Artwork near 96×96 centered on a transparent 128×128 canvas. |

Screenshots are 1280×800, one to five of them. Arabic screenshots go with the
Arabic locale. The promo tile is global.

## What nomusic does not do

nomusic processes audio already loaded by the site's own player in memory and
plays separated voices during the same video session. It does not download or
save media, provide audio export or offline access, or bypass copy protection.
"On your computer" means the separation needs no backend. YouTube still
delivers the video.
