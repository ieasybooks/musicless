// Memory cost of the extension: resident memory of the browser's processes
// with Musicless off, while separating, and after turning it off again (the
// model is released 30 s after nothing needs it).
// Usage: node memory.mjs [media dir]   (MEDIA_SET=vlog|synth)
import { clickButton, launch, memoryOfChrome, newPage, Report, sleep, waitFor, WORK } from "./harness.mjs";
import { serve } from "./serve.mjs";

const SET = process.env.MEDIA_SET ?? "vlog";
const report = new Report(process.env.REPORT ?? "memory");
const server = await serve(process.argv[2] ?? `${WORK}/media`, 8818);
const { browser } = await launch({ autoStart: false });

const page = await newPage(browser);
await page.goto(`http://127.0.0.1:8818/player.html?media=${SET}&variant=webm-opus`);
await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
await page.evaluate(() => { document.querySelector("video").play().catch(() => {}); });
await sleep(8000);
const off = memoryOfChrome(browser);

await clickButton(page);
await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "on" });
const samples = [];
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  samples.push(memoryOfChrome(browser));
}
const peak = (key) => Math.max(...samples.map((s) => s[key]));
const on = { total_mb: peak("total_mb"), extension_mb: peak("extension_mb") };

await clickButton(page); // off: 30 s later the engine frame and its workers go
await sleep(45000);
const after = memoryOfChrome(browser);
const engineFrames = await page.evaluate(() => document.querySelectorAll('iframe[src*="separator.html"]').length);

const added = on.total_mb - off.total_mb;
report.record("memory while separating", added <= 700, { off, on, added_by_musicless_mb: added });
report.record("memory is released after turning off", engineFrames === 0 && after.total_mb - off.total_mb <= 150,
  { after, left_over_mb: after.total_mb - off.total_mb, engine_frames: engineFrames });
report.save();
await browser.close();
server.close();
process.exit(report.rows.every((row) => row.ok) ? 0 : 1);
