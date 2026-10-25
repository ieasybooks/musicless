// Long session: plays the 25-minute stream with nomusic on and samples memory,
// drift, holds and resyncs every minute, then checks sync at the end. Memory
// must stay flat (bounded capture and worker buffers) and sync must not drift.
// Usage: node soak.mjs [minutes] [media dir]   (build_media.py long first)
import { analyze, dump, frameState, launch, memoryOfChrome, newPage, Report, sleep, waitFor, WORK } from "./harness.mjs";
import { serve } from "./serve.mjs";

const minutes = Number(process.argv[2] ?? 20);
const MEDIA = process.argv[3] ?? `${WORK}/media`;
const report = new Report(process.env.REPORT ?? "soak");
const server = await serve(MEDIA, 8820);
const { browser } = await launch();
const page = await newPage(browser);
const SET = process.env.LONG_SET ?? "long"; // build_media.py long <dir> [minutes]
await page.goto(`http://127.0.0.1:8820/player.html?media=${SET}&variant=webm-opus&ahead=120`);
await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
await page.evaluate(() => { document.querySelector("video").play().catch(() => {}); });
await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "on" });

const samples = [];
for (let minute = 1; minute <= minutes; minute++) {
  await sleep(60000);
  const s = await frameState(page);
  const capture = await page.evaluate(() => window.__nomusicCaptureDebug?.().reduce((sum, stream) => sum + stream.bytes, 0) ?? null);
  const drift = s.drift.slice(-40);
  samples.push({
    minute, position_s: Math.round(s.currentTime), status: s.status, holds: s.holds, resyncs: s.resyncs,
    max_drift_ms: Math.max(...drift.map(Math.abs)), capture_mb: capture === null ? null : +(capture / 2 ** 20).toFixed(1),
    worker_mb: s.worker ? +(s.worker.bytes / 2 ** 20).toFixed(1) : null, ...memoryOfChrome(browser),
  });
  console.log(JSON.stringify(samples.at(-1)));
}
const a = analyze(await dump(page, 25), "soak", { source: `${MEDIA}/${SET}/webm-opus/audio.webm` });
// nomusic's own memory must stay flat: its extension process, the captured copy
// (16 MiB at most) and the worker's audio (15 minutes behind the playhead at most).
// The whole browser also grows slowly while playing a long Media Source stream,
// by about as much without nomusic, so that is reported but not judged.
const first = samples[Math.min(2, samples.length - 1)];
const last = samples.at(-1);
const extensionGrowth = last.extension_mb - first.extension_mb;
report.record(`${minutes} minutes of continuous play`,
  extensionGrowth < 100 && last.capture_mb <= 16.5 && last.worker_mb <= 40 && last.holds <= 2 && last.status === "on" &&
    Math.abs(a.media_env_lag_ms) <= 30 && a.media_env_corr >= 0.8 && a.media_dropouts === 0,
  { extension_growth_after_minute_3_mb: extensionGrowth, browser_growth_after_minute_3_mb: last.total_mb - first.total_mb,
    holds: last.holds, resyncs: last.resyncs, samples, end: a });
report.save();
await browser.close();
server.close();
process.exit(report.rows.every((row) => row.ok) ? 0 : 1);
