// Local end-to-end suite: the extension in headless Chrome against Media
// Source test pages served from 127.0.0.1 (see build_media.py, serve.mjs).
// Usage: node local.mjs [media dir]
import { analyze, clickPill, dump, frameState, launch, memoryOfChrome, newPage, Report, sleep, waitFor, WORK } from "./harness.mjs";
import { serve } from "./serve.mjs";

const MEDIA = process.argv[2] ?? `${WORK}/media`;
// QUICK=1: the WebM/Opus page only, without the three-minute run (for other browsers).
const QUICK = process.env.QUICK === "1";
const NAME = process.env.REPORT ?? "local";
const PORT = 8811;
const report = new Report(NAME);
const server = await serve(MEDIA, PORT);
const { browser } = await launch();

const play = (page) => page.evaluate(() => document.querySelector("video").play());
const set = (page, prop, value) => page.evaluate((p, v) => { document.querySelector("video")[p] = v; }, prop, value);
const seek = (page, t) => page.evaluate((t) => { document.querySelector("video").currentTime = t; }, t);
const isOn = (s) => s.status === "on" && !s.holding;

async function open(media, variant) {
  const page = await newPage(browser);
  await page.goto(`http://127.0.0.1:${PORT}/player.html?media=${media}&variant=${variant}`);
  await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
  await play(page);
  await sleep(1500);
  return page;
}

// Time from an action until separated audio is playing again.
async function timeUntilOn(page, label, timeout = 60000) {
  const started = Date.now();
  await sleep(300);
  const state = await waitFor(page, (s) => isOn(s) || s.status === "error", { timeout, label });
  return { ms: Date.now() - started, state };
}

// Recordings on the vlog page are also checked against 1x Spleeter of its source file.
let source = null;
async function listen(page, name, seconds) {
  await sleep(seconds * 1000);
  return analyze(await dump(page, seconds - 1), name, { source });
}

// Sync and dropouts look right if the output follows the offline reference closely.
// A stretch with no voice in the reference is fine as long as the output is quiet too.
// Dropouts are judged against 1x Spleeter of the source when it is known: it uses the
// extension's own block alignment, and Spleeter's output shifts with block alignment.
// With the source known, similarity is judged against it too (same block alignment).
const good = (a) => (a.over_silence ?? 0) === 0 && ((a.windows === 0 && a.reference_db < -40 && a.output_db < -40) ||
  (a.windows > 0 && Math.abs(a.lag_ms) <= 30 && a.lag_spread_ms <= 40 && a.silent_gaps === 0 &&
    (a.media_env_corr !== undefined ? a.media_env_corr >= 0.8 && Math.abs(a.media_env_lag_ms) <= 30 : a.corr >= 0.8))) &&
  (a.media_dropouts ?? a.dropouts) === 0;

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    report.record(name, false, { error: error.message.slice(0, 500) });
  }
}

// Browsers without H.264 video (open-source Chromium) get the VP9 pages, as YouTube serves them.
const probe = await browser.newPage();
const h264 = await probe.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001e"'));
await probe.close();
const VARIANTS = process.env.VARIANTS?.split(",") ??
  (!h264 ? ["webm-vp9"] : QUICK ? ["webm-opus"] : ["webm-opus", "mp4-aac"]);
console.log(`browser ${await browser.version()}, H.264 ${h264 ? "yes" : "no"}, pages ${VARIANTS.join(", ")}`);
for (const variant of VARIANTS) {
  const page = await open("vlog", variant);
  const tag = `vlog/${variant}`;
  // The exact audio this page plays (its concatenated segments), for the 1x reference.
  source = `${MEDIA}/vlog/${variant}/audio.${variant.startsWith("webm") ? "webm" : "mp4"}`;

  await step(`${tag} enable while playing`, async () => {
    await clickPill(page);
    const { ms, state } = await timeUntilOn(page, "first audio");
    const a = await listen(page, `${variant}-enable`, 25);
    const timing = state.timings[0];
    report.record(`${tag} enable while playing`, state.status === "on" && good(a), {
      first_audio_ms: ms, model_load_s: state.modelSeconds, first_chunk_ms: Math.round(timing?.total ?? -1), ...a,
    });
  });

  await step(`${tag} chunk speed`, async () => {
    const state = await frameState(page);
    const steady = state.timings.slice(1);
    const avg = (key) => Math.round(steady.reduce((sum, t) => sum + t[key], 0) / steady.length);
    const total = avg("total");
    report.record(`${tag} chunk speed`, total < 11888 / 2, {
      chunks: steady.length, decode_ms: avg("decode"), stft_ms: avg("stft"), model_ms: avg("model"),
      istft_ms: avg("istft"), total_ms: total, x_realtime: +(11888 / total).toFixed(1),
      drift_samples_ms: state.drift.slice(-30),
    });
  });

  await step(`${tag} seek forward into new audio`, async () => {
    await seek(page, 150);
    const { ms, state } = await timeUntilOn(page, "after seek forward");
    const a = await listen(page, `${variant}-seek-fwd`, 15);
    report.record(`${tag} seek forward into new audio`, good(a), { resume_ms: ms, holds: state.holds, ...a });
  });

  await step(`${tag} seek back`, async () => {
    await seek(page, 25);
    const { ms } = await timeUntilOn(page, "after seek back");
    const a = await listen(page, `${variant}-seek-back`, 15);
    report.record(`${tag} seek back`, good(a), { resume_ms: ms, ...a });
  });

  await step(`${tag} network stall mid-play`, async () => {
    const before = await frameState(page);
    await page.evaluate(() => window.stall(4000));
    await sleep(500);
    const a = await listen(page, `${variant}-stall`, 12);
    const state = await frameState(page);
    // Silent while the video is frozen, then back in sync once it plays again.
    report.record(`${tag} network stall mid-play`, a.over_silence === 0 && state.status === "on" && good(a),
      { over_silence: a.over_silence, holds: state.holds - before.holds, lag_ms: a.lag_ms, corr: a.corr, media_dropouts: a.media_dropouts, original_db: a.original_db });
  });

  await step(`${tag} pause and resume`, async () => {
    await page.evaluate(() => document.querySelector("video").pause());
    await sleep(3000);
    const paused = await frameState(page);
    await play(page);
    const { ms } = await timeUntilOn(page, "after resume");
    const a = await listen(page, `${variant}-resume`, 12);
    report.record(`${tag} pause and resume`, good(a) && paused.status !== "error", { resume_ms: ms, ...a });
  });

  for (const rate of [1.5, 2]) {
    await step(`${tag} ${rate}x speed`, async () => {
      await set(page, "playbackRate", rate);
      await sleep(1500);
      const a = await listen(page, `${variant}-rate-${rate}`, 14);
      // Judged on loudness envelopes against 1x Spleeter of the source, read at the media
      // time each output block was heard (Chrome and SoundTouch stretch differently, and
      // Spleeter on Chrome's stretched audio disagrees with 1x Spleeter in places).
      report.record(`${tag} ${rate}x speed`,
        // Dropouts come from the 1x reference too: the gap detector's reference is
        // Chrome's stretch, whose syllable timing differs from SoundTouch's by ~10 ms.
        Math.abs(a.media_env_lag_ms) <= 45 && a.media_env_corr >= 0.75 && a.media_dropouts === 0 && a.over_silence === 0,
        { media_env_lag_ms: a.media_env_lag_ms, media_env_corr: a.media_env_corr, media_dropouts: a.media_dropouts,
          env_corr_vs_chrome_stretch: a.env_corr, over_silence: a.over_silence });
    });
  }
  await set(page, "playbackRate", 1);

  await step(`${tag} volume and mute follow the page`, async () => {
    await set(page, "volume", 0.3);
    await sleep(400);
    const lowered = (await frameState(page)).outputGain;
    await set(page, "muted", true);
    await sleep(400);
    const muted = (await frameState(page)).outputGain;
    await set(page, "muted", false);
    await set(page, "volume", 1);
    await sleep(400);
    const restored = (await frameState(page)).outputGain;
    report.record(`${tag} volume and mute follow the page`,
      Math.abs(lowered - 0.3) < 1e-6 && muted === 0 && restored === 1, { lowered, muted, restored });
  });

  await step(`${tag} fullscreen keeps the button on the video`, async () => {
    const cdp = await page.createCDPSession();
    await cdp.send("Runtime.evaluate", { expression: "document.querySelector('video').parentElement.requestFullscreen()", userGesture: true, awaitPromise: true });
    await sleep(1500);
    const where = await page.evaluate(() => {
      const pill = document.querySelector(".nomusic-offline-pill");
      return { fullscreen: !!document.fullscreenElement, inside: !!document.fullscreenElement?.contains(pill), visible: getComputedStyle(pill).display !== "none" };
    });
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    await sleep(500);
    report.record(`${tag} fullscreen keeps the button on the video`, where.fullscreen && where.inside && where.visible, where);
  });

  await step(`${tag} turn off restores original`, async () => {
    await clickPill(page);
    await sleep(1500);
    const state = await frameState(page);
    const playing = await page.evaluate(() => !document.querySelector("video").paused);
    report.record(`${tag} turn off restores original`, state.status === "off" && state.originalGain === 1 && playing,
      { status: state.status, original_gain: state.originalGain, playing });
  });

  await step(`${tag} turn back on`, async () => {
    await clickPill(page);
    const { ms, state } = await timeUntilOn(page, "re-enable");
    const a = await listen(page, `${variant}-reenable`, 12);
    report.record(`${tag} turn back on`, good(a), { first_audio_ms: ms, model_load_s: state.modelSeconds, ...a });
  });

  if (variant !== "mp4-aac") {
    const next = h264 ? "mp4-aac" : variant;
    await step(`${tag} next video in the same player`, async () => {
      const before = (await frameState(page)).streamId;
      // An empty source for a second in between, like an ad handing over to the video.
      await page.evaluate((next) => window.load("vlog", next, 200000, 1000), next);
      source = `${MEDIA}/vlog/${next}/audio.${next.startsWith("webm") ? "webm" : "mp4"}`;
      await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
      await play(page);
      const { ms, state } = await timeUntilOn(page, "next video");
      const a = await listen(page, "next-video", 20);
      report.record(`${tag} next video in the same player`, state.streamId !== before && good(a),
        { old_stream: before, new_stream: state.streamId, resume_ms: ms, ...a });
    });

    if (!QUICK) await step(`${tag} three minutes of continuous play (drift)`, async () => {
      await page.evaluate((v) => window.load("vlog", v), variant);
      await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
      await play(page);
      await timeUntilOn(page, "long play start");
      const start = await frameState(page);
      await sleep(150000);
      source = `${MEDIA}/vlog/${variant}/audio.webm`;
      const a = analyze(await dump(page, 30), "long-play", { source });
      const state = await frameState(page);
      state.holds -= start.holds;
      state.resyncs -= start.resyncs;
      report.record(`${tag} three minutes of continuous play (drift)`, good(a) && state.holds <= 2, {
        position_s: Math.round(state.currentTime), holds: state.holds, resyncs: state.resyncs, ...a,
        chrome_memory: memoryOfChrome(browser),
      });
    });
  }
  await page.close();
}

await step(`nomusic on before pressing play (from 0:00, ${VARIANTS[0]})`, async () => {
  // Audio often starts a few ms after 0 (muxing offsets); the first chunk must still start.
  const page = await newPage(browser);
  await page.goto(`http://127.0.0.1:${PORT}/player.html?media=vlog&variant=${VARIANTS[0]}`);
  await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
  await clickPill(page);
  await sleep(1500);
  await play(page);
  source = `${MEDIA}/vlog/${VARIANTS[0]}/audio.${VARIANTS[0].startsWith("webm") ? "webm" : "mp4"}`;
  const { ms } = await timeUntilOn(page, "first audio from 0:00");
  const a = await listen(page, "from-zero", 15);
  report.record(`nomusic on before pressing play (from 0:00, ${VARIANTS[0]})`, good(a), { first_audio_ms: ms, ...a });
  await page.close();
});

if (h264) await step("muxed fMP4 appended in 200 KB slices", async () => {
  source = `${MEDIA}/vlog/muxed/audio.mp4`;
  const page = await open("vlog", "muxed");
  await clickPill(page);
  const { ms } = await timeUntilOn(page, "muxed on");
  const a = await listen(page, "muxed", 25);
  report.record("muxed fMP4 appended in 200 KB slices", good(a), { first_audio_ms: ms, ...a });
  await page.close();
});

if (!QUICK && h264) await step("muxed fMP4 with a 43.5 ms timestamp gap (known edge case)", async () => {
  source = `${MEDIA}/vlog/muxed-gap/audio.mp4`;
  const page = await open("vlog", "muxed-gap");
  await clickPill(page);
  await timeUntilOn(page, "muxed-gap on");
  const a = await listen(page, "muxed-gap", 25);
  // Expected: in sync until the gap's effect shows, then 43.5 ms late against Chrome's playback.
  report.record("muxed fMP4 with a 43.5 ms timestamp gap (known edge case)", a.corr >= 0.8 && a.lag_ms <= 50,
    { note: "informational: the file's first AAC packet claims 2943 samples", ...a });
  await page.close();
});

if (h264) await step("muxed fMP4 appended in 7 KB slices", async () => {
  const page = await newPage(browser);
  source = `${MEDIA}/vlog/muxed/audio.mp4`;
  await page.goto(`http://127.0.0.1:${PORT}/player.html?media=vlog&variant=muxed&slice=7001`);
  await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
  await play(page);
  await sleep(1000);
  await clickPill(page);
  const { ms } = await timeUntilOn(page, "small slices on");
  const a = await listen(page, "muxed-small", 20);
  report.record("muxed fMP4 appended in 7 KB slices", good(a), { first_audio_ms: ms, ...a });
  await page.close();
});

if (h264) await step("plain MP4 file (not capturable)", async () => {
  const page = await open("soft", "progressive");
  await clickPill(page);
  await sleep(4000);
  const state = await frameState(page);
  const playing = await page.evaluate(() => !document.querySelector("video").paused);
  report.record("plain MP4 file (not capturable)", state.status === "original" && state.originalGain === 1 && playing,
    { status: state.status, label: state.label, playing });
  await page.close();
});

report.save();
const failed = report.rows.filter((row) => !row.ok).length;
console.log(`\n${report.rows.length - failed}/${report.rows.length} passed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
