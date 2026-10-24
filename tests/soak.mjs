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
await page.goto("http://127.0.0.1:8820/player.html?media=long&variant=webm-opus&ahead=120");
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
const a = analyze(await dump(page, 25), "soak", { source: `${MEDIA}/long/webm-opus/audio.webm` });
const first = samples[Math.min(2, samples.length - 1)];
const last = samples.at(-1);
const growth = last.total_mb - first.total_mb;
report.record(`${minutes} minutes of continuous play`,
  growth < 150 && last.holds <= 2 && last.status === "on" && Math.abs(a.media_env_lag_ms) <= 30 && a.media_env_corr >= 0.8 && a.media_dropouts === 0,
  { memory_growth_after_minute_3_mb: growth, holds: last.holds, resyncs: last.resyncs, samples, end: a });
report.save();
await browser.close();
server.close();
process.exit(report.rows.every((row) => row.ok) ? 0 : 1);
