// Live regression for Chrome's extension-module origin warnings after reload.
// Inspect the uninstrumented bundle through DevTools; no test hooks are shipped.
// Usage: node loader.mjs (MUSICLESS_EXTENSION can select an unzipped package).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, newPage, Report, sleep } from "./harness.mjs";

const report = new Report(process.env.REPORT ?? "loader");
const extension = process.env.MUSICLESS_EXTENSION ?? new URL("../extension/", import.meta.url).pathname;
const lineNumber = readFileSync(join(extension, "content.bundle.js"), "utf8").split("\n")
  .findIndex(line => line.includes("engine.tidy();"));
assert(lineNumber >= 0, "update the snapshot breakpoint for the content bundle");
const { browser, extensionId } = await launch({ diagnostics: false });
const errors = [];
let page;

async function step(name, fn) {
  try { report.record(name, true, await fn()); }
  catch (error) { report.record(name, false, { error: error.message }); }
}

async function open() {
  page = await newPage(browser);
  await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  const client = await page.createCDPSession();
  await client.send("Log.enable");
  client.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error" && (/musicless|chrome-extension:|Unsafe attempt/i.test(entry.text) ||
        entry.url?.startsWith(`chrome-extension://${extensionId}/`))) errors.push(entry);
  });
  await page.goto("https://www.youtube.com/watch?v=2reQut8WNGc&t=4s", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#movie_player .musicless-btn", { timeout: 30000 });
  await page.$eval("#movie_player video", video => { video.muted = false; video.play().catch(() => {}); });
}

async function snapshot() {
  const client = await page.createCDPSession();
  let breakpoint, timer;
  try {
    await client.send("Debugger.enable");
    const paused = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("snapshot breakpoint timed out")), 6000);
      client.once("Debugger.paused", resolve);
    });
    breakpoint = await client.send("Debugger.setBreakpointByUrl", {
      url: `chrome-extension://${extensionId}/content.bundle.js`, lineNumber,
    });
    const event = await paused;
    const result = await client.send("Debugger.evaluateOnCallFrame", {
      callFrameId: event.callFrames[0].callFrameId,
      expression: "[...controllers.values()].map(c => c.session.snapshot())", returnByValue: true,
    });
    assert(!result.exceptionDetails, "could not read the bundled Session");
    return result.result.value.find(state => state.attached) ?? result.result.value[0];
  } finally {
    clearTimeout(timer);
    if (breakpoint) await client.send("Debugger.removeBreakpoint", { breakpointId: breakpoint.breakpointId });
    await client.send("Debugger.resume").catch(() => {});
    await client.detach();
  }
}

async function processed() {
  const deadline = Date.now() + 60000;
  let last;
  while (Date.now() < deadline) {
    const state = await snapshot();
    assert(!state?.failure, JSON.stringify(state?.failure));
    if (state?.status === "on" && !state.holding && state.chunks.length && state.originalGain === 0 && state.outputGain > 0) {
      await sleep(3000);
      const later = await snapshot();
      assert(!later.failure, JSON.stringify(later.failure));
      last = { before: state, after: later };
      if (later.currentTime > state.currentTime + 1 && later.originalGain === 0 && later.outputGain > 0 && !later.holding) return later;
    }
    await sleep(500);
  }
  throw new Error(`processed playback did not advance: ${JSON.stringify(last)}`);
}

try {
  const manager = await browser.newPage();
  await manager.goto("chrome://extensions/");
  await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  await manager.waitForFunction(() => new Promise(resolve =>
    chrome.developerPrivate.getProfileConfiguration(profile => resolve(profile.inDeveloperMode))));
  const enabled = async () => {
    // reload() acknowledges before the extension has finished enabling again.
    await manager.waitForFunction(id => new Promise(resolve =>
      chrome.developerPrivate.getExtensionInfo(id, info => resolve(info?.state === "ENABLED"))),
    { timeout: 10000 }, extensionId);
  };
  await step("fresh install processes real YouTube audio", async () => { await open(); return processed(); });
  await step("Developer Mode reload still processes audio in a fresh tab", async () => {
    const error = await manager.evaluate(id => new Promise(resolve => chrome.developerPrivate.reload(id, {},
      () => resolve(chrome.runtime.lastError?.message ?? null))), extensionId);
    assert.equal(error, null); await enabled(); await open(); return processed();
  });
  await step("trusted clicks restore original sound and resume music removal", async () => {
    await page.bringToFront(); await page.hover("#movie_player"); await page.click(".musicless-btn");
    const original = await snapshot(); assert.equal(original.status, "off"); assert.equal(original.originalGain, 1);
    await page.hover("#movie_player"); await page.click(".musicless-btn");
    return processed();
  });
  await step("1.5x playback uses the bundled pitch-preserving stretcher", async () => {
    await page.$eval("#movie_player video", video => { video.playbackRate = 1.5; });
    await sleep(2000); const state = await processed(); assert(state.stretched.length > 0); return state;
  });
  await step("disable and re-enable still processes audio in a fresh tab", async () => {
    for (const value of [false, true]) {
      const error = await manager.evaluate(({ id, value }) => new Promise(resolve => chrome.management.setEnabled(id, value,
        () => resolve(chrome.runtime.lastError?.message ?? null))), { id: extensionId, value });
      assert.equal(error, null); await sleep(500);
    }
    await enabled(); await open(); return processed();
  });
  await step("no extension loader errors were emitted", async () => { assert.deepEqual(errors, []); return { errors }; });
} finally {
  report.save();
  await browser.close();
}
const failed = report.rows.filter(row => !row.ok).length;
console.log(`\n${report.rows.length - failed}/${report.rows.length} passed`);
process.exitCode = failed ? 1 : 0;
