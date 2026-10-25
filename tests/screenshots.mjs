// Store images (docs/store/): four 1280x800 screenshots in English (en-*.png)
// and in Arabic (ar-*.png), plus the 440x280 promo tile. The button and the
// recovery panel are captured on a real YouTube watch page playing NASA
// Goddard's public-domain "Tour of the Moon in 4K"
// (https://www.youtube.com/watch?v=nr5Pj6GQL2o), cropped to the player; the
// other two show the extension's own welcome page and popup. The recovery
// panel comes from a throwaway copy of the extension patched to fail on
// purpose; the extension's source is not changed. The Arabic set uses the
// Arabic catalog (--lang=ar) on Arabic YouTube (hl=ar).
// Usage (from tests/): node screenshots.mjs [en] [ar] [--reframe]
// --reframe redoes only the frames and captions from the last captures (kept
// in the work folder), without opening YouTube again.
// CHROME, NOMUSIC_NO_SANDBOX and NOMUSIC_TEST_DIR work as in the other suites.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { chromePath, setSettings, sleep, WORK } from "./harness.mjs";

const OUT = new URL("../docs/store/", import.meta.url).pathname;
const EXTENSION = new URL("../extension/", import.meta.url).pathname;
const VIDEO = "nr5Pj6GQL2o"; // NASA Goddard, "Tour of the Moon in 4K": narration over music
const START = 20; // seconds in: past the title card
const LANGUAGES = {
  en: {
    lang: "en-US", dir: "ltr", query: "",
    captions: [
      "Removes most of the music. Keeps the voices.",
      "Turn it on once. Then it works by itself.",
      "If it can't remove the music, you choose what plays.",
      "One setting. Audio never leaves your computer.",
    ],
  },
  ar: {
    lang: "ar", dir: "rtl", query: "&hl=ar&persist_hl=1", // YouTube follows hl, not the browser language
    captions: [
      "يزيل معظم الموسيقى. ويُبقي الأصوات البشرية.",
      "شغّله مرة واحدة. بعد ذلك يعمل تلقائيًا.",
      "إذا لم يستطع إزالة الموسيقى، تختار أنت ما يُشغَّل.",
      "إعداد واحد. ولا يغادر الصوت حاسوبك أبدًا.",
    ],
  },
};
const FILES = ["1-music-removed", "2-turn-on-once", "3-you-choose", "4-one-setting"];
const chosen = process.argv.slice(2).filter((code) => code in LANGUAGES);
const languages = chosen.length ? chosen : Object.keys(LANGUAGES);
const reframe = process.argv.includes("--reframe");

mkdirSync(OUT, { recursive: true });
const RAW = join(WORK, "store-raw"); // the captures, kept for --reframe
mkdirSync(RAW, { recursive: true });
const raw = (code, i) => join(RAW, `${code}-${FILES[i]}.png`);
const temp = mkdtempSync(join(WORK, "screenshots-"));
process.once("exit", () => rmSync(temp, { recursive: true, force: true }));

// A throwaway copy of the extension. `failing` patches it so that the first
// separated chunk ends in nomusic's generic failure, which opens the recovery
// panel on a video nomusic could otherwise handle.
function extensionCopy({ failing = false } = {}) {
  const dir = mkdtempSync(join(temp, "extension-"));
  cpSync(EXTENSION, dir, { recursive: true, dereference: true }); // worktrees may link the built model and runtime
  if (failing) {
    const file = join(dir, "session.js");
    const source = readFileSync(file, "utf8");
    const patched = source.replace(/^( *)onEngine\(message\) \{\n/m,
      '$1onEngine(message) {\n$1  if (message.type === "chunk") return this.fail("error");\n');
    if (patched === source) throw new Error("session.js no longer declares onEngine(message): update the failure patch");
    writeFileSync(file, patched);
  }
  return dir;
}

// A browser in the language, with the extension (if given) turned on.
async function open(language, extension) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    pipe: true,
    enableExtensions: true,
    userDataDir: mkdtempSync(join(temp, "profile-")),
    args: [
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--disable-features=Translate,MediaEngagementBypassAutoplayPolicies",
      "--window-size=1280,900",
      `--lang=${language.lang}`,
      ...(process.env.NOMUSIC_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  if (!extension) return { browser };
  const extensionId = await browser.installExtension(extension);
  await sleep(500);
  for (const page of await browser.pages()) if (page.url().includes("welcome.html")) await page.close();
  await setSettings(browser, extensionId, { autoStart: true, consented: true });
  return { browser, extensionId };
}

// The watch page in a narrow window (one column, so the player is large next
// to the button) at twice the pixel density.
async function openWatch(browser, language) {
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 640, deviceScaleFactor: 2 });
  await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO}&t=${START}s${language.query}`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("consent.")) { // cookie consent, shown in some regions
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /reject all|accept all|رفض الكل|قبول الكل/i.test(b.textContent))?.click());
    await page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await page.waitForSelector("#movie_player video", { timeout: 30000 });
  if (await page.evaluate(() => /confirm you.?re not a bot|sign in to confirm/i.test(document.body.innerText))) {
    throw new Error("YouTube's bot check blocked playback; run again later");
  }
  return page;
}

// Wait until the button on the main video says `status` and no ad is showing.
async function waitForButton(page, status, timeout = 90000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await page.evaluate(() => {
      const video = document.querySelector("#movie_player video");
      if (video?.paused) video.play().catch(() => {}); // a nudge; a hold by nomusic keeps the video paused
      document.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern")?.click();
      const button = [...document.querySelectorAll(".nomusic-btn")].find((b) => b.style.display !== "none");
      return { status: button?.dataset.nomusicStatus ?? null, t: video?.currentTime ?? 0, ad: !!document.querySelector(".ad-showing") };
    });
    if (last.status === status && !last.ad && last.t > 1) return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for the button to say "${status}"; last ${JSON.stringify(last)}`);
}

// The player alone, with YouTube's controls showing (they hide a few seconds
// after the pointer rests).
async function shootPlayer(page, file) {
  const clip = await page.evaluate(() => {
    const { left, top, width, height } = document.querySelector("#movie_player").getBoundingClientRect();
    return { x: left, y: top, width, height };
  });
  await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
  await sleep(150);
  await page.mouse.move(clip.x + clip.width / 2 + 24, clip.y + clip.height / 2 + 12);
  await sleep(400);
  await page.screenshot({ path: file, clip });
}

// The welcome page before the first-run choice: the heading and the card.
async function shootWelcome(browser, extensionId, file) {
  await setSettings(browser, extensionId, { consented: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 720, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${extensionId}/welcome.html`);
  await page.waitForSelector("#consent:not([hidden])");
  await sleep(300);
  const clip = await page.evaluate(() => ({
    x: 0, y: 0, width: document.documentElement.clientWidth,
    height: Math.ceil(document.getElementById("consent").getBoundingClientRect().bottom + 28),
  }));
  await page.screenshot({ path: file, clip });
  await page.close();
  await setSettings(browser, extensionId, { consented: true });
}

// The toolbar popup, whole.
async function shootPopup(browser, extensionId, file) {
  const page = await browser.newPage();
  await page.setViewport({ width: 332, height: 720, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector("#settings:not([hidden])");
  await sleep(300);
  const box = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.body.scrollHeight }));
  await page.screenshot({ path: file, clip: { x: 0, y: 0, ...box } });
  await page.close();
}

const pngWidth = (file) => readFileSync(file).readUInt32BE(16);

// A capture framed on a dark canvas under its caption, at 1280x800. The
// caption must stay readable when the store scales the image to 640x400. The
// popup is shown at its captured size (twice its CSS size); the rest fills
// the space left.
async function showcase(browser, language, name, caption, image, { width } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const data = readFileSync(image).toString("base64");
  await page.setContent(`<!doctype html><html lang="${language.lang}" dir="${language.dir}"><body style="margin:0;box-sizing:border-box;width:1280px;height:800px;padding:34px 60px;background:#0d1015;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;font:700 44px/1.3 system-ui,sans-serif;color:#f3f4f7;text-align:center">
    <div style="flex:0 0 auto">${caption}</div>
    <div style="flex:0 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;width:100%">
      <img src="data:image/png;base64,${data}" style="${width ? `width:${width}px;` : "max-width:100%;"}max-height:100%;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.6)">
    </div></body></html>`);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await page.close();
}

// The promo tile: the logo and the name, nothing to translate.
async function shootTile(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
  const logo = readFileSync(new URL("../assets/logo.png", import.meta.url)).toString("base64");
  await page.setContent(`<!doctype html><html lang="en"><body style="margin:0;width:440px;height:280px;background:#0d1015;
    display:flex;align-items:center;justify-content:center;gap:24px;font:700 46px system-ui,sans-serif;color:#f3f4f7;letter-spacing:-0.02em">
    <img src="data:image/png;base64,${logo}" style="width:124px;height:124px"><div>nomusic</div></body></html>`);
  await page.screenshot({ path: `${OUT}promo-tile-440x280.png` });
  await page.close();
}

// The four framed images of a language from its captures.
async function frames(browser, code) {
  const language = LANGUAGES[code];
  for (const [i, file] of FILES.entries()) {
    const image = raw(code, i);
    if (!existsSync(image)) throw new Error(`no capture at ${image}: run without --reframe first`);
    await showcase(browser, language, `${code}-${file}`, language.captions[i], image, i === 3 ? { width: pngWidth(image) } : {});
  }
  console.log(`wrote ${OUT}${code}-*.png`);
}

if (reframe) {
  const { browser } = await open(LANGUAGES.en);
  try {
    for (const code of languages) await frames(browser, code);
    await shootTile(browser);
  } finally {
    await browser.close();
  }
} else {
  for (const code of languages) {
    const language = LANGUAGES[code];
    let { browser, extensionId } = await open(language, extensionCopy());
    try {
      await shootWelcome(browser, extensionId, raw(code, 1));
      await shootPopup(browser, extensionId, raw(code, 3));
      const page = await openWatch(browser, language);
      await waitForButton(page, "on");
      await sleep(2500); // a steady picture
      await shootPlayer(page, raw(code, 0));
      await page.close();
    } finally {
      await browser.close();
    }
    ({ browser, extensionId } = await open(language, extensionCopy({ failing: true })));
    try {
      const page = await openWatch(browser, language);
      await waitForButton(page, "failed");
      await page.evaluate(() => document.activeElement?.blur()); // the panel focused Try again
      await sleep(500);
      await shootPlayer(page, raw(code, 2));
      await page.close();
      await frames(browser, code);
      if (code === languages[0]) await shootTile(browser);
    } finally {
      await browser.close();
    }
  }
}
