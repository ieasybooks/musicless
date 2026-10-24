// Real-site suite: the shipped extension (YouTube matches only, plus the local
// embed page) in headless Chrome against live YouTube pages.
// Usage: node youtube.mjs
import { analyze, clickPill, dump, frameState, launch, newPage, Report, sleep, waitFor } from "./harness.mjs";
import { serve } from "./serve.mjs";

const report = new Report("youtube");
const PORT = 8812;
const server = await serve(process.env.NOMUSIC_TEST_DIR ?? "/home/ibraheem/nomusic-offline-test", PORT);
const { browser } = await launch();
const isOn = (s) => s.status === "on" && !s.holding;
const good = (a) => a.over_silence === 0 && ((a.windows === 0 && a.reference_db < -40 && a.output_db < -40) ||
  (a.windows > 0 && Math.abs(a.lag_ms) <= 30 && a.lag_spread_ms <= 40 && a.corr >= 0.8 && a.silent_gaps === 0 && a.dropouts === 0));

// A step an ad interrupted is retried once; the first attempt is kept in the report.
async function step(name, fn, { retry = false } = {}) {
  try {
    await fn();
  } catch (error) {
    report.record(name, false, { error: error.message.slice(0, 500) });
  }
  const last = report.rows[report.rows.length - 1];
  if (retry && last && !last.ok && last.ad_during) {
    last.scenario += " (ad interrupted, retried)";
    await step(name, fn);
  }
}

async function openWatch(id, start = 0) {
  const page = await newPage(browser);
  const agent = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
  await page.setUserAgent(agent);
  await page.goto(`https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`, { waitUntil: "domcontentloaded" });
  // Cookie consent (shown in some regions) and the bot check both block playback.
  if (page.url().includes("consent.")) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /reject all|accept all/i.test(b.textContent))?.click());
    await page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await page.waitForSelector("video", { timeout: 30000 });
  const blocked = await page.evaluate(() => /confirm you.?re not a bot|sign in to confirm/i.test(document.body.innerText));
  if (blocked) throw new Error("YouTube bot check blocked playback");
  await waitForPlaying(page);
  return page;
}

// Wait until the main video plays (skipping past ads would be up to YouTube).
// Waits for the main video; after `adPatience` ms an ad that is still playing is
// accepted (nomusic follows ads too, and headless ads here can run minutes).
async function waitForPlaying(page, timeout = 45000, adPatience = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    const state = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video && video.paused) video.play().catch(() => {});
      document.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern")?.click();
      return { t: video?.currentTime ?? 0, paused: video?.paused, ad: !!document.querySelector(".ad-showing") };
    });
    if (!state.paused && state.t > 0.5 && (!state.ad || Date.now() - started > adPatience)) return state;
    last = state;
    await sleep(500);
  }
  const blocked = await page.evaluate(() => /confirm you.?re not a bot|sign in to confirm/i.test(document.body.innerText));
  throw new Error(`video did not start playing: ${JSON.stringify({ ...last, blocked, url: page.url() })}`);
}

async function timeUntilOn(frame, label, timeout = 60000) {
  const started = Date.now();
  await sleep(300);
  const state = await waitFor(frame, (s) => isOn(s) || s.status === "error", { timeout, label });
  return { ms: Date.now() - started, state };
}

// Listen while sampling what the page is doing, so a failure says whether an
// ad, a stall or a different video was on screen.
async function listen(frame, name, seconds) {
  const timeline = [];
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    await sleep(500);
    timeline.push(await frame.evaluate(() => {
      const videos = [...document.querySelectorAll("video")];
      const main = videos.find((v) => v.closest("#movie_player")) ?? videos[0];
      const pill = document.querySelector('.nomusic-offline-pill[data-status]:not([data-status="off"])');
      return {
        t: +(main?.currentTime ?? -1).toFixed(1), paused: main?.paused, rs: main?.readyState, muted: main?.muted,
        videos: videos.length, ad: !!document.querySelector(".ad-showing"), nomusic: pill?.dataset.status ?? "off",
      };
    }).catch((error) => ({ error: error.message.slice(0, 80) })));
  }
  const a = analyze(await dump(frame, seconds - 1), name);
  a.ad_during = timeline.some((row) => row.ad);
  a.timeline = timeline.map((row) => row.error ?? `${row.t}${row.paused ? "p" : ""}${row.rs < 3 ? `r${row.rs}` : ""}${row.ad ? "A" : ""}${row.muted ? "m" : ""}${row.videos > 1 ? `v${row.videos}` : ""}:${row.nomusic[0]}`).join(" ");
  return a;
}

const capturedFormats = (frame) => frame.evaluate(() => performance.getEntriesByType("resource")
  .filter((entry) => /videoplayback/.test(entry.name))
  .map((entry) => new URL(entry.name).searchParams.get("mime")).filter(Boolean));

await step("SpongeBob theme: enable while playing", async () => {
  const page = await openWatch("r9L4AseD-aA");
  await clickPill(page);
  const { ms, state } = await timeUntilOn(page, "first audio");
  const a = await listen(page, "yt-spongebob", 25);
  const after = await frameState(page);
  report.record("SpongeBob theme: enable while playing", good(a), {
    first_audio_ms: ms, model_load_s: state.modelSeconds, holds: after.holds,
    chunk_ms: after.timings.map((t) => Math.round(t.total)), formats: [...new Set(await capturedFormats(page))], ...a,
  });
  await page.close();
}, { retry: true });

let tutorial;
await step("Tutorial: enable mid-video", async () => {
  tutorial = await openWatch("6mxjfDmxTTw", 60);
  await clickPill(tutorial);
  const { ms } = await timeUntilOn(tutorial, "first audio");
  const a = await listen(tutorial, "yt-tutorial", 20);
  report.record("Tutorial: enable mid-video", good(a), { first_audio_ms: ms, ...a });
});

// Headless YouTube here never loads a new position after a seek, even with no
// extension installed (checked separately), so seeks stay inside the audio the
// player already buffered; seeking into unloaded audio is covered by local.mjs.
const seekTo = (page, t) => page.evaluate((t) => document.getElementById("movie_player").seekTo(t, true), t);
const buffered = (page) => page.evaluate(() => {
  const v = document.querySelector("video");
  return { t: v.currentTime, ranges: [...Array(v.buffered.length).keys()].map((i) => [v.buffered.start(i), v.buffered.end(i)]) };
});

await step("Tutorial: seek ahead within loaded audio", async () => {
  const { t, ranges } = await buffered(tutorial);
  const end = ranges.find(([a, b]) => a <= t && t <= b)?.[1] ?? t;
  if (end - t < 20) throw new Error(`only ${Math.round(end - t)} s loaded ahead`);
  const target = Math.min(t + 15, end - 14);
  await seekTo(tutorial, target);
  const { ms } = await timeUntilOn(tutorial, "after seek");
  const a = await listen(tutorial, "yt-tutorial-seek", 12);
  report.record("Tutorial: seek ahead within loaded audio", good(a), { from: Math.round(t), to: Math.round(target), resume_ms: ms, ...a });
});

await step("Tutorial: seek back", async () => {
  const { t, ranges } = await buffered(tutorial);
  const start = ranges.find(([a, b]) => a <= t && t <= b)?.[0] ?? 0;
  // Far enough back that listening ends well before the loaded audio runs out.
  const target = Math.max(start + 1, t - 20);
  await seekTo(tutorial, target);
  const { ms } = await timeUntilOn(tutorial, "after seek back");
  const clock = await tutorial.evaluate(() => document.querySelector("video").currentTime);
  const a = await listen(tutorial, "yt-tutorial-back", 12);
  const after = await tutorial.evaluate(() => ({ t: document.querySelector("video").currentTime, readyState: document.querySelector("video").readyState }));
  report.record("Tutorial: seek back", good(a), { from: Math.round(t), to: Math.round(target), resume_ms: ms,
    clock_moved_s: +(after.t - clock).toFixed(1), ready_state: after.readyState, ...a });
});

await step("Tutorial: fullscreen keeps the button on the player", async () => {
  const cdp = await tutorial.createCDPSession();
  await cdp.send("Runtime.evaluate", { expression: "document.getElementById('movie_player').requestFullscreen()", userGesture: true, awaitPromise: true });
  await sleep(1500);
  const where = await tutorial.evaluate(() => {
    const pill = document.querySelector(".nomusic-offline-pill");
    return {
      fullscreen: !!document.fullscreenElement,
      inside: !!document.fullscreenElement?.contains(pill),
      visible: !!pill && getComputedStyle(pill).display !== "none",
      playing: !document.querySelector("video").paused,
    };
  });
  await tutorial.evaluate(() => document.exitFullscreen().catch(() => {}));
  await sleep(500);
  report.record("Tutorial: fullscreen keeps the button on the player", where.fullscreen && where.inside && where.visible, where);
});

await step("Tutorial: next video through YouTube's own navigation", async () => {
  const before = await frameState(tutorial);
  const href = await tutorial.evaluate(() => {
    const link = [...document.querySelectorAll('#secondary a[href^="/watch"], a[href^="/watch?v="]')]
      .find((a) => !a.href.includes("6mxjfDmxTTw") && a.offsetParent);
    link?.click();
    return link?.href ?? null;
  });
  if (!href) throw new Error("no recommended video link found");
  await sleep(3000);
  // A pre-roll ad may play first; nomusic follows it and then the video.
  const adSeen = await tutorial.evaluate(() => !!document.querySelector(".ad-showing"));
  await waitForPlaying(tutorial, 90000);
  const { ms, state } = await timeUntilOn(tutorial, "next video", 90000);
  const a = await listen(tutorial, "yt-next", 20);
  report.record("Tutorial: next video through YouTube's own navigation",
    state.streamId !== before.streamId && good(a),
    { ad_first: adSeen, to: href.replace("https://www.youtube.com", ""), url: tutorial.url().replace("https://www.youtube.com", ""), old_stream: before.streamId, new_stream: state.streamId, resume_ms: ms, ...a });
  await tutorial.close();
});

await step("Vlog: 1.5x speed, then pause and resume", async () => {
  const page = await openWatch("PJGCXc-ViNQ", 180);
  await clickPill(page);
  await timeUntilOn(page, "first audio");
  await page.evaluate(() => { document.querySelector("video").playbackRate = 1.5; });
  await sleep(1000);
  const fast = await listen(page, "yt-vlog-fast", 15);
  await page.evaluate(() => { const v = document.querySelector("video"); v.playbackRate = 1; v.pause(); });
  await sleep(3000);
  await page.evaluate(() => document.querySelector("video").play().catch(() => {}));
  const { ms } = await timeUntilOn(page, "resume");
  const resumed = await listen(page, "yt-vlog-resume", 12);
  // At 1.5x, Chrome and SoundTouch stretch differently: judge sync on loudness envelopes.
  // (The 10 ms gap detector is not used at 1.5x: its reference syllables are Chrome's stretch.)
  const fastOk = Math.abs(fast.env_lag_ms) <= 45 && fast.env_corr >= 0.75 && fast.over_silence === 0;
  report.record("Vlog: 1.5x speed, then pause and resume", fastOk && good(resumed), {
    fast_env_lag_ms: fast.env_lag_ms, fast_env_corr: fast.env_corr, fast_over_silence: fast.over_silence,
    resume_ms: ms, resume_lag_ms: resumed.lag_ms, resume_corr: resumed.corr, resume_gaps: resumed.silent_gaps,
    ad_during: fast.ad_during || resumed.ad_during, fast_timeline: fast.timeline, resume_timeline: resumed.timeline,
  });
  await page.close();
}, { retry: true });

await step("Heavy song: enable while playing", async () => {
  const page = await openWatch("5abamRO41fE", 40);
  await clickPill(page);
  const { ms } = await timeUntilOn(page, "first audio");
  const a = await listen(page, "yt-heavy", 20);
  report.record("Heavy song: enable while playing", Math.abs(a.lag_ms ?? 999) <= 30 && a.silent_gaps === 0,
    { first_audio_ms: ms, note: "few vocals: sync judged on lag only", ...a });
  await page.close();
}, { retry: true });

await step("Live stream (24/7 channel)", async () => {
  // A long-running live stream: large timestamps and an init segment with every fragment.
  const page = await openWatch("SkjgMm6xRbg");
  const live = await page.evaluate(() => !!document.querySelector(".ytp-live"));
  await clickPill(page);
  const { ms, state } = await timeUntilOn(page, "first audio", 90000);
  const a = await listen(page, "yt-live", 20);
  report.record("Live stream (24/7 channel)", good(a), {
    live, position_s: Math.round(state.currentTime), first_audio_ms: ms,
    frames: state.timings.map((t) => t.frames), ...a,
  });
  await page.close();
}, { retry: true });

await step("Embedded player on another site", async () => {
  const page = await newPage(browser);
  await page.goto(`http://127.0.0.1:${PORT}/embed.html`);
  const handle = await page.waitForSelector("iframe");
  const frame = await handle.contentFrame();
  await frame.waitForSelector("video", { timeout: 30000 });
  await frame.click(".ytp-large-play-button, .ytp-play-button").catch(() => {});
  await sleep(3000);
  await frame.evaluate(() => document.querySelector("video").play().catch(() => {}));
  await sleep(2000);
  await clickPill(frame);
  const { ms } = await timeUntilOn(frame, "embed on");
  const a = await listen(frame, "yt-embed", 20);
  report.record("Embedded player on another site", good(a), { first_audio_ms: ms, ...a });
  await page.close();
}, { retry: true });

report.save();
const failed = report.rows.filter((row) => !row.ok).length;
console.log(`\n${report.rows.length - failed}/${report.rows.length} passed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
