// Shared browser-test helpers: install the extension into a fresh Chrome
// profile, read the pill's state, record what actually played, and analyze it.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

export const WORK = process.env.NOMUSIC_TEST_DIR ?? "/home/ibraheem/nomusic-offline-test";
const EXTENSION = new URL("../extension/", import.meta.url).pathname;
const ANALYZE = new URL("./analyze.py", import.meta.url).pathname;
const PYTHON = process.env.NOMUSIC_PYTHON ?? "/tmp/browserbench/py.sh";

// The shipped manifest only matches YouTube; tests also allow the local server.
// Each launch gets its own copy, so parallel runs never see each other's edits.
function testExtension() {
  const dir = mkdtempSync(join(WORK, "extension-under-test-"));
  cpSync(EXTENSION, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const entry of [...manifest.content_scripts, ...manifest.web_accessible_resources]) {
    entry.matches.push("http://127.0.0.1/*");
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

export async function launch({ headless = true } = {}) {
  const profile = mkdtempSync(join(WORK, "profile-"));
  const executablePath = process.env.CHROME ?? "/usr/bin/google-chrome";
  // Portable test copies of other browsers (unpacked under WORK/browsers) cannot set
  // up Chrome's sandbox on this system; only the installed Chrome has its profile.
  const portable = executablePath.startsWith(join(WORK, "browsers"));
  const browser = await puppeteer.launch({
    executablePath,
    headless,
    pipe: true,
    enableExtensions: true,
    userDataDir: profile,
    args: [
      "--mute-audio", // the graph still runs; nothing comes out of the speakers
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--disable-features=Translate,MediaEngagementBypassAutoplayPolicies",
      "--window-size=1280,900",
      "--lang=en-US",
      ...(portable ? ["--no-sandbox"] : []),
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  const extension = testExtension();
  const extensionId = await browser.installExtension(extension);
  // Remove the throwaway profile and extension copy once the browser has exited.
  browser.process()?.once("exit", () => {
    rmSync(profile, { recursive: true, force: true });
    rmSync(extension, { recursive: true, force: true });
  });
  return { browser, extensionId };
}

export async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("nomusicDebug", "1"); } catch { /* opaque origins */ }
  });
  page.logs = [];
  page.on("console", (message) => page.logs.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => page.logs.push(`[pageerror] ${error.message}`));
  return page;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The pill that matters: the one already switched on, else the biggest visible video's.
const PICK_PILL = `(() => {
  const pills = [...document.querySelectorAll(".nomusic-offline-pill")];
  return pills.find((p) => p.dataset.status && p.dataset.status !== "off") ??
    pills.filter((p) => p.style.display !== "none").sort((a, b) => (+b.dataset.area || 0) - (+a.dataset.area || 0))[0] ?? null;
})()`;

export async function frameState(frame) {
  return frame.evaluate((pick) => {
    const pill = eval(pick);
    if (!pill) return null;
    return { label: pill.textContent, ...JSON.parse(pill.dataset.state || "{}") };
  }, PICK_PILL);
}

export async function waitFor(frame, predicate, { timeout = 60000, label = "condition" } = {}) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeout) {
    state = await frameState(frame).catch(() => null);
    if (state && predicate(state)) return state;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}; last state ${JSON.stringify(state)?.slice(0, 600)}`);
}

// A real click on the pill; if something on the page covers it (a site dialog),
// report what, then click it directly so the test can go on.
export async function clickPill(frame) {
  await frame.waitForSelector(".nomusic-offline-pill", { visible: true, timeout: 30000 });
  const pill = await frame.evaluateHandle((pick) => eval(pick), PICK_PILL);
  const before = await pill.evaluate((el) => el.dataset.status ?? "off");
  await pill.asElement().click();
  await sleep(800);
  const after = await pill.evaluate((el) => el.dataset.status ?? "off");
  if (after !== before) return null;
  const covered = await pill.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el ? null : `${top?.tagName?.toLowerCase()}.${[...(top?.classList ?? [])].join(".")}`;
  });
  await pill.evaluate((el) => el.click());
  return { covered_by: covered };
}

export const video = (frame, script, arg) => frame.evaluate(script, arg);

// Pull the recorder's last `seconds` of original and output audio from the page.
export async function dump(frame, seconds) {
  return frame.evaluate((seconds) => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onMessage = (event) => {
      if (event.data?.["nomusic-offline"] === "debug-reply" && event.data.id === id) {
        window.removeEventListener("message", onMessage);
        resolve(event.data.reply);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ "nomusic-offline": "debug", type: "dump", seconds, id }, "*");
  }), seconds);
}

// Sync, similarity and gap metrics for a recording (see analyze.py).
// With `source` (the page's media file), speed-independent checks against 1x Spleeter run too.
export function analyze(recording, name, { source } = {}) {
  const dir = join(WORK, "recordings");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, name);
  writeFileSync(`${base}.original.s16`, Buffer.from(recording.original, "base64"));
  writeFileSync(`${base}.output.s16`, Buffer.from(recording.output, "base64"));
  writeFileSync(`${base}.media.json`, JSON.stringify(recording.media ?? []));
  const args = [ANALYZE, base, String(recording.rate), ...(source ? ["--source", source] : [])];
  const out = execFileSync(PYTHON, args, { encoding: "utf8", maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split("\n").pop());
}

export function memoryOfChrome(browser) {
  const pid = browser.process()?.pid;
  if (!pid) return null;
  const tree = execFileSync("ps", ["-o", "pid=,ppid=,rss=,args=", "-A"], { encoding: "utf8" })
    .trim().split("\n").map((line) => {
      const [p, pp, rss, ...rest] = line.trim().split(/\s+/);
      return { pid: +p, ppid: +pp, rss: +rss, args: rest.join(" ") };
    });
  const ids = new Set([pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const proc of tree) if (ids.has(proc.ppid) && !ids.has(proc.pid)) { ids.add(proc.pid); grew = true; }
  }
  const procs = tree.filter((proc) => ids.has(proc.pid));
  return { total_mb: Math.round(procs.reduce((sum, proc) => sum + proc.rss, 0) / 1024) };
}

export class Report {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  record(scenario, ok, details) {
    const row = { scenario, ok, ...details };
    this.rows.push(row);
    console.log(`${ok ? "PASS" : "FAIL"} ${scenario} ${JSON.stringify(details)}`);
  }
  save() {
    mkdirSync(join(WORK, "results"), { recursive: true });
    writeFileSync(join(WORK, "results", `${this.name}.json`), JSON.stringify(this.rows, null, 1));
  }
}
