// Shared browser-test helpers: install the extension into a fresh browser
// profile, read nomusic's state, record what actually played, and analyze it.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const TESTS = new URL(".", import.meta.url).pathname;
export const WORK = process.env.NOMUSIC_TEST_DIR ?? join(TESTS, ".work");
// NOMUSIC_EXTENSION tests another copy, e.g. an unzipped release package.
const EXTENSION = process.env.NOMUSIC_EXTENSION ?? new URL("../extension/", import.meta.url).pathname;
const ANALYZE = join(TESTS, "analyze.py");
export const PYTHON = process.env.NOMUSIC_PYTHON ?? join(TESTS, ".venv", "bin", "python");
const NS = "nomusic";
mkdirSync(WORK, { recursive: true });

// The shipped manifest only matches YouTube; tests also allow the local server.
// Each launch gets its own copy, so parallel runs never see each other's edits.
function testExtension() {
  const dir = mkdtempSync(join(WORK, "extension-under-test-"));
  cpSync(EXTENSION, dir, { recursive: true, dereference: true }); // worktrees may link the built model and runtime
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const entry of [...manifest.content_scripts, ...manifest.web_accessible_resources]) {
    entry.matches.push("http://127.0.0.1/*");
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No browser found: set CHROME to a Chrome, Edge, Brave or Chromium executable.");
}

// `autoplay: false` keeps the browser's real autoplay policy (sound needs a user gesture).
export async function launch({ headless = true, autoStart = true, autoplay = true } = {}) {
  const profile = mkdtempSync(join(WORK, "profile-"));
  const executablePath = chromePath();
  const browser = await puppeteer.launch({
    executablePath,
    headless,
    pipe: true,
    enableExtensions: true,
    userDataDir: profile,
    args: [
      "--mute-audio", // the graph still runs; nothing comes out of the speakers
      `--autoplay-policy=${autoplay ? "no-user-gesture-required" : "document-user-activation-required"}`,
      "--no-first-run",
      "--disable-features=Translate,MediaEngagementBypassAutoplayPolicies",
      "--window-size=1280,900",
      "--lang=en-US",
      // Portable browser copies (and CI containers) cannot set up the sandbox.
      ...(process.env.NOMUSIC_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  const extension = testExtension();
  const extensionId = await browser.installExtension(extension);
  // Remove the throwaway profile and extension copy once the browser has exited,
  // or when this script exits first (the browser is stopped then).
  const cleanup = () => {
    try { browser.process()?.kill("SIGKILL"); } catch { /* already gone */ }
    rmSync(profile, { recursive: true, force: true });
    rmSync(extension, { recursive: true, force: true });
  };
  browser.process()?.once("exit", cleanup);
  process.once("exit", cleanup);
  // The welcome page opens on install; tests do not need it.
  await sleep(500);
  for (const page of await browser.pages()) if (page.url().includes("welcome.html")) await page.close();
  if (!autoStart) await setAutoStart(browser, extensionId, false);
  return { browser, extensionId };
}

// Change the toolbar setting, as the popup does.
export async function setAutoStart(browser, extensionId, value) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate((value) => chrome.storage.sync.set({ autoStart: value }), value);
  const stored = await page.evaluate(() => chrome.storage.sync.get("autoStart"));
  await page.close();
  return stored.autoStart;
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

// Ask the page's nomusic content script (debug mode) for something.
export function debugRequest(frame, type, extra = {}) {
  return frame.evaluate(({ NS, type, extra }) => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => resolve(undefined), 3000);
    const onMessage = (event) => {
      if (event.data?.[NS] === "debug-reply" && event.data.id === id) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(event.data.reply);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ [NS]: "debug", type, id, ...extra }, "*");
  }), { NS, type, extra });
}

// The session that matters (working, else on, else the first), plus its button.
export async function frameState(frame) {
  const state = await debugRequest(frame, "state");
  if (!state) return null;
  const button = await frame.evaluate(() => {
    const el = [...document.querySelectorAll(".nomusic-btn")].find((b) => b.style.display !== "none");
    const panel = document.querySelector(".nomusic-recovery:not([hidden])");
    return {
      label: el?.querySelector(".nomusic-btn__label")?.textContent ?? null,
      buttonState: el?.dataset.state ?? null,
      panel: panel ? panel.querySelector(".nomusic-recovery__message")?.textContent : null,
    };
  });
  return { ...state, ...button };
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

// A real click on the visible nomusic button; if something on the page covers
// it (a site dialog), report what, then click it directly so the test goes on.
export async function clickButton(frame) {
  await frame.waitForSelector(".nomusic-btn", { visible: true, timeout: 30000 });
  const button = await frame.evaluateHandle(() =>
    [...document.querySelectorAll(".nomusic-btn")].find((b) => b.style.display !== "none"));
  const before = await button.evaluate((el) => el.dataset.nomusicStatus);
  await button.asElement().click();
  await sleep(800);
  const after = await button.evaluate((el) => el.dataset.nomusicStatus);
  if (after !== before) return null;
  const covered = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top) ? null : `${top?.tagName?.toLowerCase()}.${[...(top?.classList ?? [])].join(".")}`;
  });
  if (covered) await button.evaluate((el) => el.click());
  return { covered_by: covered };
}

// Choose an action in the recovery panel by its data-action ("retry" or
// "original"), with a real click: the panel ignores synthetic ones.
export async function chooseRecovery(frame, action) {
  const item = await frame.evaluateHandle((action) =>
    document.querySelector(`.nomusic-recovery:not([hidden]) .nomusic-menu__item[data-action="${action}"]`), action);
  if (!item.asElement()) throw new Error(`no "${action}" action in the recovery panel`);
  await item.asElement().click();
}

// Pull the recorder's last `seconds` of original and output audio from the page.
export const dump = (frame, seconds) => debugRequest(frame, "dump", { seconds });

// Sync, similarity and gap metrics for a recording (see analyze.py).
// With `source` (the page's media file), speed-independent checks against 1x Spleeter run too.
export function analyze(recording, name, { source } = {}) {
  if (!recording) throw new Error("no recording (is the session routed?)");
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

// Resident memory of the browser's process tree, and of its extension processes.
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
  const mb = (list) => Math.round(list.reduce((sum, proc) => sum + proc.rss, 0) / 1024);
  return { total_mb: mb(procs), extension_mb: mb(procs.filter((proc) => proc.args.includes("--extension-process"))) };
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
