// Memory cost of the extension: resident memory of Chrome's processes before
// and while separating, split into the extension's own process and the rest.
// Usage: node memory.mjs [media dir]
import { execFileSync } from "node:child_process";
import { clickPill, launch, newPage, sleep, waitFor, WORK } from "./harness.mjs";
import { serve } from "./serve.mjs";

const server = await serve(process.argv[2] ?? `${WORK}/media`, 8818);
const { browser, extensionId } = await launch();

function processes() {
  const root = browser.process().pid;
  const rows = execFileSync("ps", ["-o", "pid=,ppid=,rss=,args=", "-A"], { encoding: "utf8" }).trim().split("\n")
    .map((line) => { const [pid, ppid, rss, ...args] = line.trim().split(/\s+/); return { pid: +pid, ppid: +ppid, mb: +rss / 1024, args: args.join(" ") }; });
  const ids = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); grew = true; }
  }
  const mine = rows.filter((row) => ids.has(row.pid));
  const extension = mine.filter((row) => row.args.includes("--extension-process"));
  return {
    total_mb: Math.round(mine.reduce((sum, row) => sum + row.mb, 0)),
    extension_process_mb: Math.round(extension.reduce((sum, row) => sum + row.mb, 0)),
  };
}

const page = await newPage(browser);
await page.goto("http://127.0.0.1:8818/player.html?media=vlog&variant=webm-opus");
await page.waitForFunction("window.playerReady === true", { timeout: 30000 });
await page.evaluate(() => document.querySelector("video").play());
await sleep(5000);
const idle = processes();
await clickPill(page);
await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000 });
const samples = [];
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  samples.push(processes());
}
const peak = (key) => Math.max(...samples.map((s) => s[key]));
await clickPill(page); // off: the separator frame and its worker are torn down
await sleep(8000);
const after = processes();
console.log(JSON.stringify({
  extension: extensionId,
  before: idle,
  while_separating_peak: { total_mb: peak("total_mb"), extension_process_mb: peak("extension_process_mb") },
  added_by_nomusic_mb: peak("total_mb") - idle.total_mb,
  after_turning_off: after,
}));
await browser.close();
server.close();
