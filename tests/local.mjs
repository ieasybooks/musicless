// Local end-to-end suite: the extension in a headless Chromium browser against
// Media Source test pages served from 127.0.0.1 (see build_media.py, serve.mjs).
//
// Usage: node local.mjs [media dir]
//   MEDIA_SET=vlog|synth  which media set under the media dir to play (default vlog)
//   QUICK=1               the WebM/Opus page only, without the long-running scenarios
//   CHROME=/path/to/browser, REPORT=name, VARIANTS=webm-opus,mp4-aac
import {
  analyze, chooseRecovery, clickButton, debugRequest, dump, frameState, launch, memoryOfChrome, newPage, Report, setAutoStart,
  setSettings, sleep, waitFor, WORK,
} from "./harness.mjs";
import { existsSync, readFileSync } from "node:fs";
import { serve } from "./serve.mjs";

const MEDIA = process.argv[2] ?? `${WORK}/media`;
const SET = process.env.MEDIA_SET ?? "vlog";
const QUICK = process.env.QUICK === "1";
const report = new Report(process.env.REPORT ?? "local");
const ARABIC = JSON.parse(readFileSync(new URL("../extension/_locales/ar/messages.json", import.meta.url), "utf8"));
const PORT = Number(process.env.PORT ?? 8811);
const server = await serve(MEDIA, PORT);
const { browser, extensionId } = await launch();

// Starts playback without waiting for it (a held or buffering video may take a while).
const play = (page) => page.evaluate(() => { document.querySelector("video").play().catch(() => {}); });
const pause = (page) => page.evaluate(() => document.querySelector("video").pause());
const set = (page, prop, value) => page.evaluate((p, v) => { document.querySelector("video")[p] = v; }, prop, value);
const seek = (page, t) => page.evaluate((t) => { document.querySelector("video").currentTime = t; }, t);
const videoState = (page) => page.evaluate(() => {
  const v = document.querySelector("video");
  return { paused: v.paused, time: v.currentTime, muted: v.muted };
});
const isOn = (s) => s.status === "on" && !s.holding;
const engineFrames = (page) => page.evaluate(() => document.querySelectorAll('iframe[src*="separator.html"]').length);
const audioFile = (variant) => `${MEDIA}/${SET}/${variant}/audio.${variant.startsWith("webm") ? "webm" : "mp4"}`;

async function open(variant, query = "") {
  const page = await newPage(browser);
  await page.goto(`http://127.0.0.1:${PORT}/player.html?media=${SET}&variant=${variant}${query}`);
  await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
  return page;
}

// Time from an action until separated audio is playing again.
async function timeUntilOn(page, label, timeout = 60000) {
  const started = Date.now();
  await sleep(300);
  const state = await waitFor(page, (s) => isOn(s) || s.status === "failed", { timeout, label });
  return { ms: Date.now() - started, state };
}

// Playing with the next chunk ready too: a measurement that starts now is not
// cut by a hold still to come from the step before (a worker that cannot keep
// up still shows, as holds and gaps while it listens).
const settled = (page, label) => waitFor(page, (s) => (isOn(s) && s.ahead >= 12) || s.status === "failed", { timeout: 60000, label });

// Recordings are also checked against 1x Spleeter of the page's exact audio.
let source = null;
async function listen(page, name, seconds) {
  await sleep(seconds * 1000);
  return analyze(await dump(page, seconds - 1), name, { source });
}

// Sync and dropouts look right if the output follows the offline reference closely.
// A stretch with no voice in the reference is fine as long as the output is quiet too.
// With the source known, similarity, dropouts and gaps are judged against 1x Spleeter
// of it at media time (the extension's own windows; Spleeter's output depends on
// where its windows fall, so a reference cut from the recording disagrees in places).
const good = (a) => (a.over_silence ?? 0) === 0 && ((a.windows === 0 && a.reference_db < -40 && a.output_db < -40) ||
  (a.windows > 0 && Math.abs(a.lag_ms) <= 30 && a.lag_spread_ms <= 40 && (a.media_silent_gaps ?? a.silent_gaps) === 0 &&
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
console.log(`browser ${await browser.version()}, H.264 ${h264 ? "yes" : "no"}, media ${SET}, pages ${VARIANTS.join(", ")}`);

let memoryOneTab = null;
for (const variant of VARIANTS) {
  const tag = `${SET}/${variant}`;
  source = audioFile(variant);
  const page = await open(variant);

  await step(`${tag} starts automatically, original never heard`, async () => {
    await play(page);
    const first = await frameState(page);
    const { ms, state } = await timeUntilOn(page, "first audio");
    const a = await listen(page, `${variant}-start`, 25);
    memoryOneTab ??= memoryOfChrome(browser);
    const timing = state.timings[0];
    report.record(`${tag} starts automatically, original never heard`,
      first.originalGain === 0 && state.status === "on" && state.buttonState === "active" && good(a), {
        first_audio_ms: ms, original_gain_at_start: first.originalGain, model_load_s: state.model?.seconds,
        first_chunk_ms: Math.round(timing?.total ?? -1), ...a,
      });
  });

  await step(`${tag} chunk speed`, async () => {
    const state = await frameState(page);
    const steady = state.timings.slice(1);
    const avg = (key) => Math.round(steady.reduce((sum, t) => sum + t[key], 0) / steady.length);
    const total = avg("total");
    report.record(`${tag} chunk speed`, total < 11842 / 2, {
      chunks: steady.length, decode_ms: avg("decode"), stft_ms: avg("stft"), model_ms: avg("model"),
      istft_ms: avg("istft"), total_ms: total, x_realtime: +(11842 / total).toFixed(1),
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
    // Where every media set has voice (vlog has a music-only stretch near 105 s).
    await seek(page, 25);
    await settled(page, "settled before the stall");
    const before = await frameState(page);
    await page.evaluate(() => window.stall(4000));
    await sleep(500);
    const a = await listen(page, `${variant}-stall`, 12);
    const state = await frameState(page);
    // Silent while the video is frozen, then back in sync once it plays again.
    report.record(`${tag} network stall mid-play`, a.over_silence === 0 && state.status === "on" && good(a),
      { over_silence: a.over_silence, holds: state.holds - before.holds, lag_ms: a.lag_ms, lag_spread_ms: a.lag_spread_ms, corr: a.corr,
        media_env_corr: a.media_env_corr, media_dropouts: a.media_dropouts, media_silent_gaps: a.media_silent_gaps });
  });

  await step(`${tag} pause and resume`, async () => {
    await pause(page);
    await sleep(3000);
    const paused = await frameState(page);
    await play(page);
    const { ms } = await timeUntilOn(page, "after resume");
    const a = await listen(page, `${variant}-resume`, 12);
    report.record(`${tag} pause and resume`, good(a) && paused.status === "on", { resume_ms: ms, ...a });
  });

  await step(`${tag} pausing while Musicless holds the video is respected`, async () => {
    // Far back: those chunks were dropped long ago, so Musicless holds the video to redo one.
    await seek(page, 10);
    await waitFor(page, (s) => s.holding, { timeout: 5000, label: "hold" });
    await pause(page); // the user pauses during the hold (no pause event fires)
    await waitFor(page, (s) => s.chunks.includes(0), { timeout: 30000, label: "chunk ready" });
    await sleep(1500);
    const after = await videoState(page);
    const state = await frameState(page);
    await play(page);
    const { ms } = await timeUntilOn(page, "play after hold");
    report.record(`${tag} pausing while Musicless holds the video is respected`, after.paused && !state.holding && state.status === "on",
      { stayed_paused: after.paused, holding: state.holding, resume_ms: ms });
  });

  for (const rate of [1.5, 2]) {
    await step(`${tag} ${rate}x speed`, async () => {
      await set(page, "playbackRate", rate);
      await settled(page, `${rate}x with the next chunk ready`);
      const before = await frameState(page);
      await sleep(1500);
      const a = await listen(page, `${variant}-rate-${rate}`, 14);
      const after = await frameState(page);
      // Judged on loudness envelopes against 1x Spleeter of the source, read at the media
      // time each output block was heard (Chrome and SoundTouch stretch differently).
      report.record(`${tag} ${rate}x speed`,
        Math.abs(a.media_env_lag_ms) <= 45 && a.media_env_corr >= 0.75 && a.media_dropouts === 0 && a.over_silence === 0,
        { media_env_lag_ms: a.media_env_lag_ms, media_env_corr: a.media_env_corr, media_dropouts: a.media_dropouts,
          env_corr_vs_chrome_stretch: a.env_corr, over_silence: a.over_silence, holds: after.holds - before.holds,
          position_s: Math.round(after.currentTime) });
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
    await cdp.send("Runtime.evaluate", { expression: "document.querySelector('.player').requestFullscreen()", userGesture: true, awaitPromise: true });
    await sleep(1500);
    const where = await page.evaluate(() => {
      const button = document.querySelector(".musicless-btn");
      return { fullscreen: !!document.fullscreenElement, inside: !!document.fullscreenElement?.contains(button), visible: getComputedStyle(button).display !== "none" };
    });
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    await sleep(500);
    report.record(`${tag} fullscreen keeps the button on the video`, where.fullscreen && where.inside && where.visible, where);
  });

  await step(`${tag} the auto-hidden button lets clicks through to the video`, async () => {
    await settled(page, "on before the controls hide"); // working states stay visible by design
    // As in YouTube's player while its controls are hidden (".ytp-autohide").
    const hidden = await page.evaluate(async () => {
      const button = document.querySelector(".musicless-btn");
      const box = button.getBoundingClientRect();
      const at = () => button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      const host = button.parentElement;
      host.classList.add("ytp-autohide");
      await new Promise((resolve) => setTimeout(resolve, 400)); // its fade
      const style = getComputedStyle(button);
      const result = { status: button.dataset.musiclessStatus, opacity: style.opacity, pointer_events: style.pointerEvents, target_is_button: at() };
      host.classList.remove("ytp-autohide");
      result.target_when_shown = at();
      return result;
    });
    report.record(`${tag} the auto-hidden button lets clicks through to the video`,
      hidden.status === "on" && hidden.opacity === "0" && hidden.pointer_events === "none" && !hidden.target_is_button && hidden.target_when_shown, hidden);
  });

  await step(`${tag} turn off restores the original`, async () => {
    const click = await clickButton(page);
    await sleep(1000);
    const state = await frameState(page);
    const { paused } = await videoState(page);
    report.record(`${tag} turn off restores the original`,
      state.status === "off" && state.originalGain === 1 && !paused && state.buttonState === "idle",
      { status: state.status, original_gain: state.originalGain, playing: !paused, label: state.label, ...click });
  });

  await step(`${tag} turn back on`, async () => {
    await clickButton(page);
    const { ms, state } = await timeUntilOn(page, "re-enable");
    const before = await settled(page, "re-enabled with the next chunk ready");
    const a = await listen(page, `${variant}-reenable`, 12);
    const after = await frameState(page);
    report.record(`${tag} turn back on`, good(a) && state.originalGain === 0, { first_audio_ms: ms, holds: after.holds - before.holds, ...a });
  });

  // The page switches to another audio track (another language): the voice follows it.
  // At 25 s, where both tracks have voice for the next half minute (vlog has
  // stretches of music alone, e.g. 105-114 s, where a recording proves nothing).
  const other = SET === "vlog" ? "synth" : "vlog";
  if (existsSync(`${MEDIA}/${other}/${variant}/player.json`)) await step(`${tag} another audio track: the voice follows it`, async () => {
    await seek(page, 25);
    await settled(page, "at 25 s with the next chunk ready");
    await page.evaluate((other) => window.switchAudio(other), other);
    source = `${MEDIA}/${other}/${variant}/audio.${variant.startsWith("webm") ? "webm" : "mp4"}`;
    await sleep(6000);
    const { ms } = await timeUntilOn(page, "after the switch");
    const before = await settled(page, "the other track with the next chunk ready");
    const a = await listen(page, `${variant}-other-track`, 12);
    const after = await frameState(page);
    report.record(`${tag} another audio track: the voice follows it`, good(a), { settle_ms: 6000 + ms, holds: after.holds - before.holds, ...a });
    source = audioFile(variant);
  });

  await step(`${tag} forged consent and unsubscribe messages do not stop the playing video`, async () => {
    const { streamId } = await frameState(page);
    // A page script posts Musicless's own control messages: no consent, and no
    // subscription. The playing video goes on, and the real answer is restored.
    // (Other forgeries can fail a video closed, by design: see how-it-works.)
    await page.evaluate((streamId) => {
      for (const message of [{ type: "consent", consented: false }, { type: "unsubscribe", streamId }]) window.postMessage({ musicless: "control", ...message }, "*");
    }, streamId);
    await sleep(2000);
    const state = await frameState(page);
    const stream = (await page.evaluate(() => window.__musiclessCaptureDebug())).find((s) => s.id === streamId);
    report.record(`${tag} forged consent and unsubscribe messages do not stop the playing video`,
      state.status === "on" && !state.failure && stream?.subscribed === true && stream?.consented === true,
      { status: state.status, failure: state.failure?.reason ?? null, still_subscribed: stream?.subscribed, consent_restored: stream?.consented });
  });

  if (variant !== "mp4-aac") {
    const next = h264 ? "mp4-aac" : variant;
    await step(`${tag} next video in the same player`, async () => {
      const before = (await frameState(page)).streamId;
      // An empty source for a second in between, like an ad handing over to the video.
      await page.evaluate((media, next) => window.load(media, next, 200000, 1000), SET, next);
      source = audioFile(next);
      await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
      await play(page);
      const { ms, state } = await timeUntilOn(page, "next video");
      const a = await listen(page, "next-video", 20);
      report.record(`${tag} next video in the same player`, state.streamId !== before && good(a),
        { old_stream: before, new_stream: state.streamId, resume_ms: ms, ...a });
    });

    if (!QUICK) await step(`${tag} three minutes of continuous play (drift)`, async () => {
      await page.evaluate((media, v) => window.load(media, v), SET, variant);
      source = audioFile(variant);
      await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
      await play(page);
      await timeUntilOn(page, "long play start");
      const start = await frameState(page);
      await sleep(150000);
      const a = analyze(await dump(page, 30), "long-play", { source });
      const state = await frameState(page);
      report.record(`${tag} three minutes of continuous play (drift)`, good(a) && state.holds - start.holds <= 2, {
        position_s: Math.round(state.currentTime), holds: state.holds - start.holds, resyncs: state.resyncs - start.resyncs, ...a,
        chrome_memory: memoryOfChrome(browser),
      });
    });
  }
  await page.close();
}

const BASE = VARIANTS[0];

await step("prepares the audio before play is pressed", async () => {
  source = audioFile(BASE);
  const page = await open(BASE);
  await waitFor(page, (s) => s.chunks.includes(0), { timeout: 30000, label: "first chunk while paused" });
  const started = Date.now();
  await play(page);
  const { state } = await timeUntilOn(page, "first audio after play");
  const ms = Date.now() - started;
  const a = await listen(page, "prepared", 15);
  report.record("prepares the audio before play is pressed", ms < 1500 && good(a), { play_to_audio_ms: ms, holds: state.holds, ...a });
  await page.close();
});

await step("muted videos are left alone until unmuted", async () => {
  source = audioFile(BASE);
  const page = await open(BASE, "&muted=1");
  await play(page);
  await sleep(4000);
  const muted = await frameState(page);
  const frames = await engineFrames(page);
  await set(page, "muted", false);
  const { ms, state } = await timeUntilOn(page, "unmuted");
  const a = await listen(page, "unmuted", 12);
  report.record("muted videos are left alone until unmuted",
    !muted.attached && frames === 0 && muted.originalGain === 0 && state.status === "on" && good(a),
    { attached_while_muted: muted.attached, engine_frames_while_muted: frames, unmute_to_audio_ms: ms, ...a });
  await page.close();
});

await step("with automatic removal off, the button starts it", async () => {
  await setAutoStart(browser, extensionId, false);
  source = audioFile(BASE);
  const page = await open(BASE).catch(async (error) => {
    await setAutoStart(browser, extensionId, true);
    throw error;
  });
  await play(page);
  await sleep(3000);
  const before = await frameState(page);
  const { paused } = await videoState(page);
  await clickButton(page);
  const { ms } = await timeUntilOn(page, "started by click");
  const a = await listen(page, "manual-start", 12);
  report.record("with automatic removal off, the button starts it",
    before.status === "off" && before.buttonState === "idle" && !paused && good(a),
    { status_before: before.status, original_gain_before: before.originalGain, click_to_audio_ms: ms, ...a });
  await page.close();
});

await step("turning automatic removal on applies to the open video", async () => {
  source = audioFile(BASE);
  await setAutoStart(browser, extensionId, false);
  const page = await open(BASE);
  await play(page);
  await sleep(2000);
  const before = (await frameState(page)).status;
  await setAutoStart(browser, extensionId, true);
  const { ms, state } = await timeUntilOn(page, "auto-start switched on");
  report.record("turning automatic removal on applies to the open video", before === "off" && state.status === "on",
    { status_before: before, setting_to_audio_ms: ms });
  await page.close();
});

// A video's first wait says why at once, under the spinner (later waits, after
// a seek, only if they last); the local page has no YouTube spinner, so ours.
await step("a video's first wait says why at once", async () => {
  const page = await open(BASE);
  await play(page);
  let notice = null;
  const started = Date.now();
  while (!notice && Date.now() - started < 15000) {
    notice = await page.evaluate(() => {
      const n = document.querySelector(".musicless-notice:not([hidden])");
      return n ? { words: n.dataset.words, ours: n.dataset.theirs === "false", text: n.querySelector(".musicless-notice__text").textContent } : null;
    });
    if (!notice) await sleep(50);
  }
  report.record("a video's first wait says why at once", notice?.words === "true" && notice.ours && !!notice.text, notice ?? {});
  await page.close();
});

await step("nothing is read before consent; consenting starts the next video", async () => {
  await setSettings(browser, extensionId, { consented: false }); // no control turns it off again
  try {
    const page = await open(BASE);
    await play(page);
    await sleep(4000);
    const before = await frameState(page);
    const captured = await page.evaluate(() => window.__musiclessCaptureDebug());
    const frames = await engineFrames(page);
    const { paused, time } = await videoState(page);
    // On the first-run page the user first leaves without choosing (there is
    // no "Not now": closing the page is the no), then comes back and chooses
    // Turn on with the keyboard.
    const consented = async () => {
      const probe = await browser.newPage();
      await probe.goto(`chrome-extension://${extensionId}/popup.html`);
      const stored = await probe.evaluate(() => chrome.storage.sync.get("consented"));
      await probe.close();
      return stored.consented === true;
    };
    const first = await browser.newPage();
    await first.goto(`chrome-extension://${extensionId}/welcome.html`);
    await first.waitForSelector("#accept", { visible: true });
    await first.close();
    const leftOff = !(await consented()) && (await frameState(page)).status === "setup";
    const welcome = await browser.newPage();
    await welcome.goto(`chrome-extension://${extensionId}/welcome.html`);
    await welcome.waitForSelector("#accept", { visible: true });
    await welcome.focus("#accept");
    await welcome.keyboard.press("Enter");
    const started = Date.now();
    await welcome.waitForFunction(() => chrome.storage.sync.get("consented").then((stored) => stored.consented === true), { timeout: 5000 });
    const turnedOn = await welcome.evaluate(() =>
      !document.querySelector("#done").classList.contains("off") && document.activeElement?.id === "doneHeading");
    await welcome.close();
    const failed = await waitFor(page, (s) => s.status === "failed", { timeout: 10000, label: "the video that played before" });
    const failMs = Date.now() - started;
    // Not a failure to the user: Musicless is on, and a reload will do.
    const dialog = await page.evaluate(() => {
      const panel = document.querySelector(".musicless-dialog:not([hidden])");
      const main = panel?.querySelector(".musicless-dialog__action--main");
      return { title: panel?.querySelector(".musicless-dialog__title").textContent, main: main?.textContent, focused: document.activeElement === main };
    });
    // The next video in the player is read from its start.
    await page.evaluate((media, v) => window.load(media, v, 200000, 1000), SET, BASE);
    source = audioFile(BASE);
    await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
    await play(page);
    const { ms, state } = await timeUntilOn(page, "the next video");
    const a = await listen(page, "after-consent", 12);
    const media = captured.reduce((sum, stream) => sum + stream.media, 0);
    report.record("nothing is read before consent; consenting starts the next video",
      before.status === "setup" && before.originalGain === null && !before.attached && frames === 0 && !paused && time > 2 &&
        media === 0 && captured.some((stream) => stream.missed) && leftOff && turnedOn &&
        failed.failure.reason === "missed" && failMs < 5000 &&
        dialog.title === "Musicless is on" && dialog.main === "Reload page" && dialog.focused && state.status === "on" && good(a),
      { status_before: before.status, routed_before: before.originalGain !== null, engine_frames_before: frames, played_before: !paused,
        audio_kept_before: media, left_without_choosing_kept_it_off: leftOff, turned_on_by_keyboard: turnedOn, missed_ms: failMs,
        dialog, next_video_audio_ms: ms, ...a });
    await page.close();
  } finally {
    await setSettings(browser, extensionId, { consented: true });
  }
});

await step("the popup asks before Musicless is on, and its button turns it on", async () => {
  await setSettings(browser, extensionId, { consented: false });
  try {
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector("#accept", { visible: true });
    const asks = await popup.$eval("#settings", (section) => section.hidden);
    await popup.click("#accept");
    await popup.waitForFunction(() => chrome.storage.sync.get("consented").then((stored) => stored.consented === true), { timeout: 5000 });
    const shown = await popup.$eval("#settings", (section) => !section.hidden);
    const focus = await popup.evaluate(() => document.activeElement?.id ?? null);
    await popup.close();
    report.record("the popup asks before Musicless is on, and its button turns it on", asks && shown && focus === "autoStart",
      { settings_hidden_before: asks, settings_shown_after: shown, focus_after: focus });
  } finally {
    await setSettings(browser, extensionId, { consented: true });
  }
});

await step("in Arabic the welcome page reads right to left, and turns Musicless on", async () => {
  const arabic = await launch({ lang: "ar", consented: false });
  try {
    const welcome = await arabic.browser.newPage();
    await welcome.goto(`chrome-extension://${arabic.extensionId}/welcome.html`);
    await welcome.waitForSelector("#accept", { visible: true });
    const page = await welcome.evaluate(() => ({
      lang: document.documentElement.lang, dir: document.documentElement.dir, accept: document.querySelector("#accept").textContent,
    }));
    await welcome.focus("#accept");
    await welcome.keyboard.press("Space");
    await welcome.waitForFunction(() => chrome.storage.sync.get("consented").then((stored) => stored.consented === true), { timeout: 5000 });
    report.record("in Arabic the welcome page reads right to left, and turns Musicless on",
      page.lang === "ar" && page.dir === "rtl" && page.accept === ARABIC.consent_accept.message, page);
  } finally {
    await arabic.browser.close();
  }
});

// Turned on from a video's own button: the first-run page ends with Back to
// the video, which reloads that tab where it was and closes itself.
await step("turned on from a video's button, the first-run page goes back to it", async () => {
  await setSettings(browser, extensionId, { consented: false }); // no control turns it off again
  try {
    const page = await open(BASE);
    await play(page);
    await sleep(3000);
    const opened = browser.waitForTarget((target) => target.type() === "page" && target.url().includes("welcome.html"), { timeout: 15000 });
    await clickButton(page);
    const welcome = await (await opened).page();
    await welcome.waitForSelector("#accept", { visible: true, timeout: 10000 });
    await welcome.click("#accept");
    await welcome.waitForSelector("#back", { visible: true, timeout: 5000 });
    const instead = await welcome.evaluate(() => document.querySelector("#open").hidden);
    await page.evaluate(() => { window.notReloaded = true; });
    const reloaded = page.waitForNavigation({ timeout: 15000 }).then(() => true, () => false);
    const closed = new Promise((resolve) => {
      welcome.once("close", () => resolve(true));
      setTimeout(() => resolve(false), 8000);
    });
    await welcome.click("#back");
    const back = { open_youtube_hidden: instead, reloaded: await reloaded, page_closed: await closed };
    await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
    const fresh = await page.evaluate(() => window.notReloaded !== true);
    await play(page);
    const { ms, state } = await timeUntilOn(page, "the video it went back to");
    report.record("turned on from a video's button, the first-run page goes back to it",
      back.open_youtube_hidden && back.reloaded && back.page_closed && fresh && state.status === "on",
      { ...back, fresh_page: fresh, status_after: state.status, failure: state.failure?.reason ?? null, audio_ms: ms });
    await page.close();
  } finally {
    await setSettings(browser, extensionId, { consented: true });
  }
});

await step("the release build has no diagnostics, and a page cannot start its worker", async () => {
  const release = await launch({ diagnostics: false });
  try {
    const page = await newPage(release.browser);
    await page.goto(`http://127.0.0.1:${PORT}/player.html?media=${SET}&variant=${BASE}`);
    await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
    await play(page);
    await page.waitForFunction('document.querySelector(".musicless-btn")?.dataset.musiclessStatus === "on"', { timeout: 60000 });
    const state = await debugRequest(page, "state");
    const exposed = await page.evaluate(() => ({
      capture: typeof window.__musiclessCaptureDebug,
      dataset: [...document.querySelectorAll(".musicless-btn")].some((button) => "musiclessDebug" in button.dataset),
    }));
    // A page script loads Musicless's hidden frame itself and hands it ports.
    const answered = await page.evaluate((id) => new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.src = `chrome-extension://${id}/separator.html`;
      frame.onload = () => {
        for (const message of [{ type: "musicless-port" }, { type: "musicless-port", token: "a guess" }]) {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve(true);
          frame.contentWindow.postMessage(message, "*", [channel.port2]);
        }
      };
      document.body.append(frame);
      setTimeout(() => resolve(false), 5000);
    }), release.extensionId);
    report.record("the release build has no diagnostics, and a page cannot start its worker",
      state === undefined && exposed.capture === "undefined" && !exposed.dataset && !answered,
      { debug_reply: state ?? null, capture_inspector: exposed.capture, debug_dataset: exposed.dataset, page_started_worker: answered });
  } finally {
    await release.browser.close();
  }
});

// Videos Musicless cannot process stay silent and paused until the user chooses.
async function failsClosed(name, query, variant, expectReason) {
  await step(name, async () => {
    const page = await open(variant, query);
    await play(page);
    const state = await waitFor(page, (s) => s.status === "failed", { timeout: 20000, label: "failure" });
    await sleep(1500);
    const held = await videoState(page);
    await chooseRecovery(page, "original");
    await sleep(2500);
    const after = await frameState(page);
    const resumed = await videoState(page);
    report.record(name,
      state.failure.reason === expectReason && held.paused && !!state.panel && after.status === "off" && !resumed.paused &&
        (after.originalGain === null || after.originalGain === 1),
      { reason: state.failure.reason, message: state.panel, paused_while_failed: held.paused, plays_after_choice: !resumed.paused });
    await page.close();
  });
}
if (h264) await failsClosed("plain MP4 file: fails closed until the user chooses", "", "progressive", "source");
await failsClosed("copy-protected (ClearKey) audio: fails closed", "", "drm", "protected");
await failsClosed("Media Source hidden in another frame: fails closed", "&realm=frame", BASE, "uncaptured");
await failsClosed("Media Source in a worker (srcObject): fails closed", "&worker=1", BASE, "source");

// The dialog closed without a choice (Escape, or a click beside it): the
// video stays held, and each later play attempt brings the choice back, even
// though the user's intent to play never changed. Meanwhile the button shows
// the plain note with its dot, not the struck note of removal at work.
await step("a closed failure dialog comes back on play", async () => {
  const page = await open(BASE, "&worker=1");
  await play(page);
  await waitFor(page, (s) => s.status === "failed", { timeout: 20000, label: "failure" });
  await sleep(800);
  const shown = () => page.evaluate(() => !!document.querySelector(".musicless-dialog:not([hidden])"));
  const glyph = () => page.evaluate(() => {
    const el = [...document.querySelectorAll(".musicless-btn")].find((b) => b.style.display !== "none");
    const visible = (selector) => getComputedStyle(el.querySelector(selector)).display !== "none";
    return { plain: visible(".musicless-glyph-plain"), struck: visible(".musicless-glyph-struck"), dot: visible(".musicless-glyph-dot") };
  });
  const opened = await shown();
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Escape");
  await sleep(300);
  const afterEscape = await shown();
  const stood = await videoState(page);
  await play(page);
  await sleep(1000);
  const backAfterPlay = await shown();
  const held = await videoState(page);
  const beside = await page.evaluate(() => { const r = document.querySelector(".musicless-scrim").getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; });
  await page.mouse.click(beside.x, beside.y); // a real click on the video beside the dialog
  await sleep(300);
  const afterScrim = await shown();
  await play(page);
  await sleep(500);
  const backAgain = await shown();
  const icon = await glyph();
  report.record("a closed failure dialog comes back on play",
    opened && !afterEscape && backAfterPlay && held.paused && held.time === stood.time && !afterScrim && backAgain &&
      icon.plain && icon.dot && !icon.struck,
    { opened, after_escape: afterEscape, back_after_play: backAfterPlay, paused_while_held: held.paused, moved_s: held.time - stood.time,
      after_scrim: afterScrim, back_again: backAgain, glyph: icon });
  await page.close();
});

// Trying again in place (a slow computer, an error) is covered by the unit tests.
await step("a failure nothing can help offers only the music, and a stray key does not start it", async () => {
  const page = await open("drm");
  await play(page);
  await waitFor(page, (s) => s.status === "failed", { timeout: 20000, label: "failure" });
  await sleep(500);
  const dialog = await page.evaluate(() => {
    const panel = document.querySelector(".musicless-dialog:not([hidden])");
    const shown = [...panel.querySelectorAll(".musicless-dialog__action")].filter((action) => action.getClientRects().length);
    return { actions: shown.map((action) => action.dataset.action), main: panel.querySelector(".musicless-dialog__action--main")?.dataset.action,
      dialog_focused: document.activeElement === panel };
  });
  const before = await videoState(page);
  await page.keyboard.press("Space"); // meant for the video
  await page.keyboard.press("Enter");
  await sleep(1000);
  const after = await videoState(page);
  const state = await frameState(page);
  report.record("a failure nothing can help offers only the music, and a stray key does not start it",
    dialog.actions.join() === "original" && dialog.main === "original" && dialog.dialog_focused &&
      after.paused && after.time === before.time && state.status === "failed",
    { ...dialog, paused_after_keys: after.paused, moved_s: after.time - before.time, status: state.status });
  await page.close();
});

await step("Retry reloads the page when only a reload can help (uncaptured)", async () => {
  const page = await open(BASE, "&realm=frame");
  await play(page);
  await waitFor(page, (s) => s.status === "failed", { timeout: 20000, label: "failure" });
  const reloaded = page.waitForNavigation({ timeout: 15000 });
  await chooseRecovery(page, "retry");
  await reloaded;
  await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
  await play(page);
  const again = await waitFor(page, (s) => s.status === "failed", { timeout: 20000, label: "failure after the reload" });
  report.record("Retry reloads the page when only a reload can help (uncaptured)", again.failure.reason === "uncaptured",
    { reloaded: true, reason_after_reload: again.failure.reason });
  await page.close();
});

await step("two tabs share one model", async () => {
  source = audioFile(BASE);
  const first = await open(BASE);
  await play(first);
  await timeUntilOn(first, "first tab");
  const second = await open(BASE);
  await seek(second, 60);
  await play(second);
  const { ms, state } = await timeUntilOn(second, "second tab");
  // A video still buffering after the seek is not held yet, and shows "on" before its audio.
  await settled(second, "second tab with the next chunk ready");
  await sleep(8000);
  const memory = memoryOfChrome(browser);
  const a1 = analyze(await dump(first, 7), "tab-1", { source });
  const a2 = analyze(await dump(second, 7), "tab-2", { source });
  // One shared worker holds the model for both tabs.
  const models = browser.targets().filter((target) => target.type() === "shared_worker" && target.url().endsWith("/model-worker.js")).length;
  report.record("two tabs share one model", models === 1 && state.model && good(a1) && good(a2) &&
    (!memoryOneTab || memory.extension_mb - memoryOneTab.extension_mb < 250), {
    model_workers: models, second_tab_audio_ms: ms, memory_one_tab: memoryOneTab, memory_two_tabs: memory,
    tab1_media_env_corr: a1.media_env_corr, tab2_media_env_corr: a2.media_env_corr,
  });
  await first.close();
  await second.close();
});

await step("capture keeps only recent audio (25-minute stream)", async () => {
  await setAutoStart(browser, extensionId, false);
  try {
  const page = await newPage(browser);
  await page.goto(`http://127.0.0.1:${PORT}/player.html?media=long&variant=webm-opus&ahead=120`);
  await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
  // Watching with Musicless off: jumping through the stream appends ~2 minutes each time.
  for (let t = 60; t <= 1380; t += 120) {
    await seek(page, t);
    await sleep(900);
  }
  await play(page);
  await sleep(2000);
  const captured = await page.evaluate(() => window.__musiclessCaptureDebug());
  const stream = captured.find((s) => s.buffers.length);
  await clickButton(page);
  source = `${MEDIA}/long/webm-opus/audio.webm`;
  const { ms } = await timeUntilOn(page, "turned on late in the stream");
  const a = await listen(page, "long-stream", 12);
  report.record("capture keeps only recent audio (25-minute stream)",
    stream.bytes <= 16 * 2 ** 20 && stream.dropped && good(a),
    { captured_mb: +(stream.bytes / 2 ** 20).toFixed(1), trimmed: stream.dropped, entries: stream.stored, turn_on_to_audio_ms: ms, ...a });
  await page.close();
  } finally {
    await setAutoStart(browser, extensionId, true);
  }
});

if (!QUICK) await step("a paused video lets the model go, then resumes", async () => {
  source = audioFile(BASE);
  const page = await open(BASE);
  await play(page);
  await timeUntilOn(page, "start");
  await sleep(5000);
  const active = memoryOfChrome(browser);
  await pause(page);
  await sleep(160000); // two minutes until the session sleeps, then 30 s until the engine goes
  const asleep = await frameState(page);
  const frames = await engineFrames(page);
  const idle = memoryOfChrome(browser);
  await play(page);
  const { ms } = await timeUntilOn(page, "after sleep");
  const a = await listen(page, "after-sleep", 12);
  report.record("a paused video lets the model go, then resumes",
    !asleep.attached && frames === 0 && idle.extension_mb < active.extension_mb - 250 && good(a),
    { attached_while_asleep: asleep.attached, engine_frames: frames, memory_active: active, memory_idle: idle, resume_ms: ms, ...a });
  await page.close();
});

if (h264) await step("muxed fMP4 appended in 200 KB slices", async () => {
  source = `${MEDIA}/${SET}/muxed/audio.mp4`;
  const page = await open("muxed");
  await play(page);
  const { ms } = await timeUntilOn(page, "muxed on");
  const a = await listen(page, "muxed", 25);
  report.record("muxed fMP4 appended in 200 KB slices", good(a), { first_audio_ms: ms, ...a });
  await page.close();
});

if (h264) await step("muxed fMP4 appended in 7 KB slices", async () => {
  source = `${MEDIA}/${SET}/muxed/audio.mp4`;
  const page = await open("muxed", "&slice=7001");
  await play(page);
  const { ms } = await timeUntilOn(page, "small slices on");
  const a = await listen(page, "muxed-small", 20);
  report.record("muxed fMP4 appended in 7 KB slices", good(a), { first_audio_ms: ms, ...a });
  await page.close();
});

if (!QUICK && h264) await step("muxed fMP4 with a 43.5 ms timestamp gap (known edge case)", async () => {
  source = `${MEDIA}/${SET}/muxed-gap/audio.mp4`;
  const page = await open("muxed-gap");
  await play(page);
  await timeUntilOn(page, "muxed-gap on");
  const a = await listen(page, "muxed-gap", 25);
  // Expected: in sync until the gap's effect shows, then 43.5 ms late against Chrome's playback.
  report.record("muxed fMP4 with a 43.5 ms timestamp gap (known edge case)", a.corr >= 0.7 && a.lag_ms >= -5 && a.lag_ms <= 50,
    { note: "informational: the file's first AAC packet claims 2943 samples", ...a });
  await page.close();
});

await step("page autoplays before any click (the browser's own autoplay policy)", async () => {
  // A separate browser that enforces the real policy: sound needs a user gesture.
  const strict = await launch({ autoplay: false });
  try {
    const page = await newPage(strict.browser);
    const cdp = await page.createCDPSession();
    // Reads state without granting the page user activation (Puppeteer's evaluate would).
    const read = async (expression) => (await cdp.send("Runtime.evaluate", { expression, userGesture: false, returnByValue: true })).result.value;
    const state = () => read(`(() => { const v = document.querySelector("video"); const b = document.querySelector(".musicless-btn");
      const d = b?.dataset.musiclessDebug ? JSON.parse(b.dataset.musiclessDebug) : {};
      return { t: v.currentTime, paused: v.paused, context: d.context, attached: d.attached, status: d.status }; })()`);
    source = audioFile(BASE);
    await page.goto(`http://127.0.0.1:${PORT}/player.html?media=${SET}&variant=${BASE}&autoplay=1&muted=1`);
    await sleep(2000);
    const early = await state();
    await sleep(3000);
    const muted = await state();
    await page.mouse.click(100, 560); // the user clicks the page, then unmutes
    await read(`document.querySelector("video").muted = false; 1`);
    const { ms } = await timeUntilOn(page, "unmuted after a click");
    const a = await listen(page, "strict-autoplay", 12);
    report.record("page autoplays before any click (the browser's own autoplay policy)",
      muted.t > early.t && !muted.paused && muted.context === "suspended" && !muted.attached && good(a),
      { muted_playing: !muted.paused && muted.t > early.t, context_before_click: muted.context, attached_before_click: muted.attached,
        click_to_audio_ms: ms, ...a });
  } finally {
    await strict.browser.close();
  }
});

// Last: removes the extension from this browser.
await step("extension removed while playing: fails closed", async () => {
  const page = await open(BASE);
  await play(page);
  await timeUntilOn(page, "start");
  await browser.uninstallExtension(extensionId);
  await sleep(2000);
  const held = await videoState(page);
  const panel = await page.evaluate(() => document.querySelector(".musicless-dialog:not([hidden]) .musicless-dialog__message")?.textContent ?? null);
  await chooseRecovery(page, "original");
  await sleep(1500);
  const resumed = await videoState(page);
  report.record("extension removed while playing: fails closed", held.paused && !!panel && !resumed.paused,
    { paused: held.paused, message: panel, plays_after_choice: !resumed.paused });
  await page.close();
});

report.save();
const failed = report.rows.filter((row) => !row.ok).length;
console.log(`\n${report.rows.length - failed}/${report.rows.length} passed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
