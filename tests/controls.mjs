// Live check of how nomusic sits in YouTube's own player: the button joins
// the control bar before captions, shows the wait chip while the first audio
// is prepared, turns the music removal off and on with a real click, shows
// its tooltip, and hides with YouTube's controls; in an embedded player it
// joins the top row of buttons. YouTube changes its player often: run this
// when it does. Usage (from tests/): node controls.mjs
import { frameState, launch, newPage, Report, sleep, waitFor, WORK } from "./harness.mjs";
import { serve } from "./serve.mjs";

const report = new Report(process.env.REPORT ?? "controls");
const PORT = 8813;
const server = await serve(WORK, PORT);
const { browser } = await launch();
const VIDEO = "nr5Pj6GQL2o"; // NASA Goddard, "Tour of the Moon in 4K": narration over music

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    report.record(name, false, { error: error.message.slice(0, 400) });
  }
}

// The button's place and look, read from the page.
const button = (frame) => frame.evaluate(() => {
  const el = document.querySelector(".nomusic-btn");
  if (!el) return null;
  const shownPart = (selector) => getComputedStyle(el.querySelector(selector)).display !== "none";
  const bar = el.closest(".ytp-chrome-bottom");
  return {
    status: el.dataset.nomusicStatus,
    place: el.dataset.place,
    inBar: !!el.closest(".ytp-right-controls"),
    beforeCaptions: !!el.nextElementSibling?.matches(".ytp-subtitles-button"),
    pressed: el.getAttribute("aria-pressed"),
    filled: shownPart(".nomusic-glyph-filled"),
    outlined: shownPart(".nomusic-glyph-outlined"),
    barOpacity: bar ? getComputedStyle(bar).opacity : null,
    autohide: !!el.closest(".ytp-autohide"),
  };
});

const page = await newPage(browser);
await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
const player = () => page.evaluate(() => {
  const r = document.querySelector("#movie_player").getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});
const showControls = async () => {
  const r = await player();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 4 });
  await page.mouse.move(r.x + r.width / 2 + 20, r.y + r.height / 2 + 10, { steps: 4 });
  await sleep(300);
};

await step("the button joins YouTube's control bar, before captions", async () => {
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO}&t=20s`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("consent.")) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /reject all|accept all/i.test(b.textContent))?.click());
    await page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await page.waitForSelector("#movie_player .nomusic-btn", { timeout: 30000 });
  const b = await button(page);
  report.record("the button joins YouTube's control bar, before captions", b.place === "ytp" && b.inBar && b.beforeCaptions, b);
});

await step("the chip says what happens while the first audio is prepared", async () => {
  let seen = null;
  const started = Date.now();
  while (Date.now() - started < 20000 && !seen) {
    seen = await page.evaluate(() => {
      const chip = document.querySelector("#movie_player .nomusic-notice:not([hidden])");
      return chip ? { kind: chip.dataset.kind, text: chip.textContent, paused: document.querySelector("#movie_player video").paused } : null;
    });
    if (!seen) await sleep(100);
  }
  report.record("the chip says what happens while the first audio is prepared", seen?.kind === "status" && !!seen.text, seen ?? {});
});

await step("on: the glyph is filled, the button pressed", async () => {
  await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "on" });
  await showControls();
  const b = await button(page);
  const chip = await page.evaluate(() => !!document.querySelector("#movie_player .nomusic-notice:not([hidden])"));
  report.record("on: the glyph is filled, the button pressed", b.pressed === "true" && b.filled && !b.outlined && !chip, { ...b, chip_shown: chip });
});

await step("hovering shows the tooltip above the bar", async () => {
  await showControls();
  const box = await page.evaluate(() => { const r = document.querySelector(".nomusic-btn").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top }; });
  await page.mouse.move(box.x, box.y, { steps: 3 });
  await sleep(300);
  const tip = await page.evaluate(() => {
    const t = document.querySelector(".nomusic-tip:not([hidden])");
    const bar = document.querySelector(".ytp-chrome-bottom").getBoundingClientRect();
    return t ? { text: t.textContent, bottom: Math.round(t.getBoundingClientRect().bottom), barTop: Math.round(bar.top) } : null;
  });
  report.record("hovering shows the tooltip above the bar", !!tip?.text && tip.bottom <= tip.barTop, tip ?? {});
});

await step("a click turns it off for this video, another turns it back on", async () => {
  await showControls();
  await page.click(".nomusic-btn");
  await sleep(1200);
  const off = { ...(await button(page)), ...(await frameState(page)) };
  await page.click(".nomusic-btn");
  const on = await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "back on" });
  const b = await button(page);
  report.record("a click turns it off for this video, another turns it back on",
    off.status === "off" && off.pressed === "false" && off.outlined && off.originalGain === 1 && on.status === "on" && b.filled,
    { off: { status: off.status, pressed: off.pressed, outlined: off.outlined, original_gain: off.originalGain }, on: { status: on.status, filled: b.filled } });
});

await step("it hides with YouTube's controls", async () => {
  await page.mouse.move(2, 2);
  let b = null;
  const started = Date.now();
  while (Date.now() - started < 12000) {
    b = await button(page);
    if (b.autohide && b.barOpacity === "0") break;
    await sleep(250);
  }
  report.record("it hides with YouTube's controls", b.autohide && b.barOpacity === "0", b);
});

await step("in an embedded player it joins the top row of buttons", async () => {
  const embed = await newPage(browser);
  await embed.goto(`http://127.0.0.1:${PORT}/embed.html`);
  const frame = await (async () => {
    for (let i = 0; i < 60; i++) {
      const f = embed.frames().find((candidate) => candidate.url().includes("/embed/"));
      if (f) return f;
      await sleep(250);
    }
    throw new Error("no embed frame");
  })();
  await frame.waitForSelector(".nomusic-btn", { timeout: 30000 });
  await frame.click(".ytp-large-play-button, .ytp-play-button").catch(() => {});
  let where = null;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    where = await frame.evaluate(() => {
      const el = document.querySelector(".nomusic-btn");
      return { place: el?.dataset.place, inTopRow: !!el?.closest(".player-controls-top-right"), status: el?.dataset.nomusicStatus };
    });
    if (where.place === "top" || where.place === "ytp") break;
    await sleep(500);
  }
  report.record("in an embedded player it joins the top row of buttons", where.place === "top" ? where.inTopRow : where.place === "ytp", where);
  await embed.close();
});

report.save();
const failed = report.rows.filter((row) => !row.ok).length;
console.log(`\n${report.rows.length - failed}/${report.rows.length} passed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
