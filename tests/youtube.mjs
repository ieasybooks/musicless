// Real-site suite: the shipped extension (YouTube matches only, plus the local
// embed page) in a headless Chromium browser against live YouTube pages.
// nomusic starts by itself (the default setting); no step clicks to enable it.
// Usage: node youtube.mjs
import {
  analyze, clickButton, debugRequest, dump, frameState, launch, newPage, Report, sleep, waitFor, WORK,
} from "./harness.mjs";
import { serve } from "./serve.mjs";

const report = new Report(process.env.REPORT ?? "youtube");
const PORT = 8812;
const server = await serve(WORK, PORT);
const { browser } = await launch();
const isOn = (s) => s.status === "on" && !s.holding;
const good = (a) => a.over_silence === 0 && ((a.windows === 0 && a.reference_db < -40 && a.output_db < -40) ||
  (a.windows > 0 && Math.abs(a.lag_ms) <= 30 && a.lag_spread_ms <= 40 && a.corr >= 0.8 && a.silent_gaps === 0 && a.dropouts === 0));

// A step an ad interrupted is retried once. The first attempt stays in the
// report, marked as retried; only the retry counts.
async function step(name, fn, { retry = false } = {}) {
  try {
    await fn();
  } catch (error) {
    report.record(name, false, { error: error.message.slice(0, 500) });
  }
  const last = report.rows[report.rows.length - 1];
  if (retry && last && !last.ok && last.ad_during) {
    last.scenario += " (ad interrupted, retried)";
    last.retried = true;
    await step(name, fn);
  }
}

async function openPage(url) {
  const page = await newPage(browser);
  const agent = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
  await page.setUserAgent(agent);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Cookie consent (shown in some regions) blocks the page.
  if (page.url().includes("consent.")) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /reject all|accept all/i.test(b.textContent))?.click());
    await page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
  return page;
}

async function openWatch(id, start = 0) {
  const page = await openPage(`https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`);
  await page.waitForSelector("video", { timeout: 30000 });
  const blocked = await page.evaluate(() => /confirm you.?re not a bot|sign in to confirm/i.test(document.body.innerText));
  if (blocked) throw new Error("YouTube bot check blocked playback");
  const first = await waitFor(page, (s) => s.status !== "off", { timeout: 20000, label: "nomusic starting" });
  await waitForPlaying(page);
  return { page, first };
}

// Wait until the main video plays; after `adPatience` ms an ad that is still
// playing is accepted (nomusic removes music from ads too).
async function waitForPlaying(page, timeout = 60000, adPatience = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    const state = await page.evaluate(() => {
      const video = document.querySelector("#movie_player video") ?? document.querySelector("video");
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
  const state = await waitFor(frame, (s) => isOn(s) || s.status === "failed", { timeout, label });
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
      const main = videos.find((v) => v.closest("#movie_player, #shorts-player")) ?? videos[0];
      const button = [...document.querySelectorAll(".nomusic-btn")].find((b) => b.style.display !== "none");
      return {
        t: +(main?.currentTime ?? -1).toFixed(1), paused: main?.paused, rs: main?.readyState, muted: main?.muted,
        videos: videos.length, ad: !!document.querySelector(".ad-showing"), nomusic: button?.dataset.nomusicStatus ?? "-",
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

await step("SpongeBob theme: starts by itself, original never heard", async () => {
  const { page, first } = await openWatch("r9L4AseD-aA");
  const { ms, state } = await timeUntilOn(page, "first audio");
  const a = await listen(page, "yt-spongebob", 25);
  const after = await frameState(page);
  report.record("SpongeBob theme: starts by itself, original never heard", first.originalGain === 0 && good(a), {
    first_audio_ms: ms, original_gain_at_start: first.originalGain, model_load_s: state.model?.seconds,
    holds: after.holds, chunk_ms: after.timings.map((t) => Math.round(t.total)),
    formats: [...new Set(await capturedFormats(page))], ...a,
  });
  await page.close();
}, { retry: true });

let tutorial;
await step("Tutorial: starts by itself mid-video (&t=60)", async () => {
  ({ page: tutorial } = await openWatch("6mxjfDmxTTw", 60));
  const { ms } = await timeUntilOn(tutorial, "first audio");
  const a = await listen(tutorial, "yt-tutorial", 20);
  report.record("Tutorial: starts by itself mid-video (&t=60)", good(a), { first_audio_ms: ms, ...a });
});

await step("Tutorial: the button turns it off and on again", async () => {
  const click = await clickButton(tutorial);
  await sleep(1500);
  const off = await frameState(tutorial);
  const playing = await tutorial.evaluate(() => !document.querySelector("#movie_player video").paused);
  await clickButton(tutorial);
  const { ms } = await timeUntilOn(tutorial, "back on");
  const a = await listen(tutorial, "yt-tutorial-reon", 12);
  report.record("Tutorial: the button turns it off and on again",
    off.status === "off" && off.originalGain === 1 && playing && good(a),
    { status_off: off.status, original_gain_off: off.originalGain, playing_while_off: playing, back_on_ms: ms, ...click, ...a });
});

// Headless YouTube stops serving a video about a minute into playback ("Something
// went wrong", also without nomusic), and never loads a new position after a seek.
// So the steps below use a fresh page and stay inside the audio the player already
// buffered; seeking into unloaded audio is covered by local.mjs.
await step("Tutorial: reopened for the next steps", async () => {
  await tutorial?.close();
  ({ page: tutorial } = await openWatch("6mxjfDmxTTw", 60));
  const { ms } = await timeUntilOn(tutorial, "first audio");
  report.record("Tutorial: reopened for the next steps", true, { first_audio_ms: ms });
});

const seekTo = (page, t) => page.evaluate((t) => document.getElementById("movie_player").seekTo(t, true), t);
const buffered = (page) => page.evaluate(() => {
  const v = document.querySelector("#movie_player video");
  return { t: v.currentTime, ranges: [...Array(v.buffered.length).keys()].map((i) => [v.buffered.start(i), v.buffered.end(i)]) };
});

await step("Tutorial: seek ahead within loaded audio", async () => {
  // Give the player a few seconds to load enough ahead.
  let t, ranges, end;
  for (let tries = 0; tries < 10; tries++) {
    ({ t, ranges } = await buffered(tutorial));
    end = ranges.find(([a, b]) => a <= t && t <= b)?.[1] ?? t;
    if (end - t >= 20) break;
    await sleep(1000);
  }
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
  const target = Math.max(start + 1, t - 20);
  await seekTo(tutorial, target);
  const { ms } = await timeUntilOn(tutorial, "after seek back");
  const a = await listen(tutorial, "yt-tutorial-back", 12);
  report.record("Tutorial: seek back", good(a), { from: Math.round(t), to: Math.round(target), resume_ms: ms, ...a });
});

await step("Tutorial: fullscreen keeps the button on the player", async () => {
  const cdp = await tutorial.createCDPSession();
  await cdp.send("Runtime.evaluate", { expression: "document.getElementById('movie_player').requestFullscreen()", userGesture: true, awaitPromise: true });
  await sleep(1500);
  const where = await tutorial.evaluate(() => {
    const button = [...document.querySelectorAll(".nomusic-btn")].find((b) => b.style.display !== "none");
    return {
      fullscreen: !!document.fullscreenElement,
      inside: !!document.fullscreenElement?.contains(button),
      visible: !!button && getComputedStyle(button).display !== "none",
      playing: !document.querySelector("#movie_player video").paused,
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
  // Listen to the video itself, not the hand-over from a long ad.
  await tutorial.waitForFunction(() => !document.querySelector(".ad-showing"), { timeout: 120000 }).catch(() => {});
  const { ms, state } = await timeUntilOn(tutorial, "next video", 90000);
  const a = await listen(tutorial, "yt-next", 20);
  report.record("Tutorial: next video through YouTube's own navigation",
    state.streamId !== before.streamId && good(a),
    { ad_first: adSeen, to: href.replace("https://www.youtube.com", ""), old_stream: before.streamId, new_stream: state.streamId, resume_ms: ms, ...a });
  await tutorial.close();
});

await step("Vlog: 1.5x speed, then pause and resume", async () => {
  const { page } = await openWatch("PJGCXc-ViNQ", 180);
  await timeUntilOn(page, "first audio");
  await page.evaluate(() => { document.querySelector("#movie_player video").playbackRate = 1.5; });
  await sleep(1000);
  const fast = await listen(page, "yt-vlog-fast", 15);
  await page.evaluate(() => { const v = document.querySelector("#movie_player video"); v.playbackRate = 1; v.pause(); });
  await sleep(3000);
  await page.evaluate(() => document.querySelector("#movie_player video").play().catch(() => {}));
  const { ms } = await timeUntilOn(page, "resume");
  const resumed = await listen(page, "yt-vlog-resume", 12);
  // At 1.5x, Chrome and SoundTouch stretch differently: judge sync on loudness envelopes.
  const fastOk = Math.abs(fast.env_lag_ms) <= 45 && fast.env_corr >= 0.75 && fast.over_silence === 0;
  report.record("Vlog: 1.5x speed, then pause and resume", fastOk && good(resumed), {
    fast_env_lag_ms: fast.env_lag_ms, fast_env_corr: fast.env_corr, fast_over_silence: fast.over_silence,
    resume_ms: ms, resume_lag_ms: resumed.lag_ms, resume_corr: resumed.corr, resume_gaps: resumed.silent_gaps,
    ad_during: fast.ad_during || resumed.ad_during, fast_timeline: fast.timeline, resume_timeline: resumed.timeline,
  });
  await page.close();
}, { retry: true });

await step("Heavy song: starts by itself", async () => {
  const { page } = await openWatch("5abamRO41fE", 40);
  const { ms } = await timeUntilOn(page, "first audio");
  const a = await listen(page, "yt-heavy", 20);
  report.record("Heavy song: starts by itself", Math.abs(a.lag_ms ?? 999) <= 30 && a.silent_gaps === 0,
    { first_audio_ms: ms, note: "few vocals: sync judged on lag only", ...a });
  await page.close();
}, { retry: true });

await step("Live stream (24/7 channel)", async () => {
  // A long-running live stream: large timestamps and an init segment with every fragment.
  const { page } = await openWatch("SkjgMm6xRbg");
  const live = await page.evaluate(() => !!document.querySelector(".ytp-live"));
  const { ms, state } = await timeUntilOn(page, "first audio", 90000);
  const a = await listen(page, "yt-live", 20);
  report.record("Live stream (24/7 channel)", good(a), {
    live, position_s: Math.round(state.currentTime), first_audio_ms: ms, frames: state.timings.map((t) => t.frames), ...a,
  });
  await page.close();
}, { retry: true });

await step("Shorts", async () => {
  const page = await openPage("https://www.youtube.com/shorts");
  await page.waitForSelector("#shorts-player video, ytd-reel-video-renderer video", { timeout: 30000 });
  await page.waitForFunction(() => /\/shorts\/.+/.test(location.pathname), { timeout: 30000 });
  await page.evaluate(() => {
    const video = document.querySelector("#shorts-player video") ?? document.querySelector("video");
    video.muted = false; // the Shorts feed may start muted
    video.play().catch(() => {});
  });
  const { ms, state } = await timeUntilOn(page, "short on", 60000);
  const a = await listen(page, "yt-shorts", 12);
  report.record("Shorts", state.status === "on" && good(a), { url: page.url().replace("https://www.youtube.com", ""), first_audio_ms: ms, ...a });
  await page.close();
}, { retry: true });

await step("Inline previews: muted, left alone", async () => {
  // Hovering a result plays a muted inline preview (a fresh profile's home feed is empty).
  const page = await openPage("https://www.youtube.com/results?search_query=piano+tutorial");
  await page.waitForSelector("ytd-video-renderer a#thumbnail", { timeout: 30000 });
  const target = await page.evaluate(() => {
    const thumb = [...document.querySelectorAll("ytd-video-renderer a#thumbnail")].find((a) => a.getBoundingClientRect().height > 50);
    thumb.scrollIntoView({ block: "center" });
    const r = thumb.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await sleep(6000);
  const preview = await page.evaluate(() => {
    const v = [...document.querySelectorAll("video")].find((video) => !video.paused && video.currentTime > 0);
    return v ? { muted: v.muted, t: +v.currentTime.toFixed(1) } : null;
  });
  const sessions = (await debugRequest(page, "sessions")) ?? [];
  const frames = await page.evaluate(() => document.querySelectorAll('iframe[src*="separator.html"]').length);
  report.record("Inline previews: muted, left alone",
    !!preview && preview.muted && frames === 0 && sessions.every((s) => !s.attached),
    { preview, sessions: sessions.length, attached: sessions.filter((s) => s.attached).length, engine_frames: frames });
  await page.close();
});

await step("Embedded player on another site", async () => {
  const page = await newPage(browser);
  await page.goto(`http://127.0.0.1:${PORT}/embed.html`);
  const handle = await page.waitForSelector("iframe");
  const frame = await handle.contentFrame();
  await frame.waitForSelector("video", { timeout: 30000 });
  await frame.click(".ytp-large-play-button, .ytp-play-button").catch(() => {});
  await sleep(3000);
  await frame.evaluate(() => document.querySelector("video").play().catch(() => {}));
  const { ms } = await timeUntilOn(frame, "embed on");
  const a = await listen(frame, "yt-embed", 20);
  report.record("Embedded player on another site", good(a), { first_audio_ms: ms, ...a });
  await page.close();
}, { retry: true });

report.save();
const counted = report.rows.filter((row) => !row.retried);
const failed = counted.filter((row) => !row.ok).length;
console.log(`\n${counted.length - failed}/${counted.length} passed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
