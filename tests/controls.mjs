// Live check of how Musicless sits in YouTube's own player: the button joins
// the control bar before captions, shows the wait notice while the first
// audio is prepared, turns the music removal off and on with a real click, shows
// its tooltip, hides with YouTube's controls, and stays in the bar when YouTube
// wraps its captions button; on Shorts it joins the Short's own buttons; in an
// embedded player it joins the top row of buttons. YouTube changes its player
// often: run this when it does. Usage (from tests/): node controls.mjs
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
  const el = document.querySelector(".musicless-btn");
  if (!el) return null;
  const shownPart = (selector) => getComputedStyle(el.querySelector(selector)).display !== "none";
  const bar = el.closest(".ytp-chrome-bottom");
  return {
    status: el.dataset.musiclessStatus,
    place: el.dataset.place,
    inBar: !!el.closest(".ytp-right-controls"),
    beforeCaptions: !!el.nextElementSibling?.matches(".ytp-subtitles-button"),
    pressed: el.getAttribute("aria-pressed"),
    struck: shownPart(".musicless-glyph-struck"),
    plain: shownPart(".musicless-glyph-plain"),
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
  await page.waitForSelector("#movie_player .musicless-btn", { timeout: 30000 });
  const b = await button(page);
  report.record("the button joins YouTube's control bar, before captions", b.place === "ytp" && b.inBar && b.beforeCaptions, b);
});

await step("the notice says what happens while the first audio is prepared", async () => {
  let seen = null;
  const started = Date.now();
  while (Date.now() - started < 20000 && !seen) {
    seen = await page.evaluate(() => {
      const notice = document.querySelector("#movie_player .musicless-notice:not([hidden])");
      return notice ? { kind: notice.dataset.kind, text: notice.textContent, paused: document.querySelector("#movie_player video").paused } : null;
    });
    if (!seen) await sleep(100);
  }
  report.record("the notice says what happens while the first audio is prepared", seen?.kind === "status" && !!seen.text, seen ?? {});
});

await step("on: the note is struck through, the button pressed", async () => {
  await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "on" });
  await showControls();
  const b = await button(page);
  const notice = await page.evaluate(() => !!document.querySelector("#movie_player .musicless-notice:not([hidden])"));
  report.record("on: the note is struck through, the button pressed", b.pressed === "true" && b.struck && !b.plain && !notice, { ...b, notice_shown: notice });
});

await step("hovering shows the tooltip above the bar", async () => {
  await showControls();
  const box = await page.evaluate(() => { const r = document.querySelector(".musicless-btn").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top }; });
  await page.mouse.move(box.x, box.y, { steps: 3 });
  await sleep(300);
  const tip = await page.evaluate(() => {
    const t = document.querySelector(".musicless-tip:not([hidden])");
    const bar = document.querySelector(".ytp-chrome-bottom").getBoundingClientRect();
    return t ? { text: t.textContent, bottom: Math.round(t.getBoundingClientRect().bottom), barTop: Math.round(bar.top) } : null;
  });
  report.record("hovering shows the tooltip above the bar", !!tip?.text && tip.bottom <= tip.barTop, tip ?? {});
});

await step("a click turns it off for this video, another turns it back on", async () => {
  await showControls();
  await page.click(".musicless-btn");
  await sleep(1200);
  const off = { ...(await button(page)), ...(await frameState(page)) };
  await page.click(".musicless-btn");
  const on = await waitFor(page, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "back on" });
  const b = await button(page);
  report.record("a click turns it off for this video, another turns it back on",
    off.status === "off" && off.pressed === "false" && off.plain && off.originalGain === 1 && on.status === "on" && b.struck,
    { off: { status: off.status, pressed: off.pressed, plain: off.plain, original_gain: off.originalGain }, on: { status: on.status, struck: b.struck } });
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

// YouTube changes this markup often: a captions button wrapped in a container
// of its own must not take the button out of the bar (or out of the page).
await step("when YouTube wraps its captions button, the button stays in the bar", async () => {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  await page.evaluate(() => {
    const captions = document.querySelector("#movie_player .ytp-subtitles-button");
    const wrapper = document.createElement("div");
    wrapper.className = "musicless-test-wrapper";
    captions.before(wrapper);
    wrapper.append(captions);
    document.querySelector("#movie_player .musicless-btn").remove(); // as when YouTube rebuilds its controls
  });
  let b = null;
  const started = Date.now();
  while (Date.now() - started < 8000) {
    b = await page.evaluate(() => {
      const el = document.querySelector("#movie_player .musicless-btn");
      return el ? { place: el.dataset.place, beforeWrapper: !!el.nextElementSibling?.matches(".musicless-test-wrapper") } : null;
    });
    if (b?.place) break;
    await sleep(250);
  }
  page.off("pageerror", onError);
  await page.evaluate(() => {
    const wrapper = document.querySelector(".musicless-test-wrapper");
    wrapper?.before(...wrapper.childNodes);
    wrapper?.remove();
  });
  report.record("when YouTube wraps its captions button, the button stays in the bar",
    b?.place === "ytp" && b.beforeWrapper && !errors.some((message) => /insertBefore/.test(message)), { ...b, errors: errors.slice(0, 3) });
});

// Shorts have no control bar: the button joins the Short's own row at its
// top (captions, menu, fullscreen), shows and hides with it, and works.
await step("on Shorts the button joins the Short's own buttons, and shows and hides with them", async () => {
  const shorts = await newPage(browser);
  await shorts.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  await shorts.goto("https://www.youtube.com/shorts/", { waitUntil: "domcontentloaded" });
  await shorts.waitForSelector("#shorts-player video", { timeout: 30000 });
  await shorts.waitForSelector("#right-controls .musicless-btn", { timeout: 30000 });
  const look = () => shorts.evaluate(() => {
    const el = document.querySelector("#right-controls .musicless-btn");
    const overlay = el?.closest(".player-controls");
    return el && { place: el.dataset.place, status: el.dataset.musiclessStatus, overlay: overlay ? getComputedStyle(overlay).opacity : null };
  });
  const video = await shorts.evaluate(() => { const r = document.querySelector("#shorts-player video").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await shorts.mouse.move(video.x, video.y, { steps: 4 });
  await shorts.mouse.move(video.x + 12, video.y + 8, { steps: 3 });
  await sleep(500);
  const shownWithRow = await look();
  const box = await shorts.evaluate(() => { const r = document.querySelector("#right-controls .musicless-btn").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await shorts.mouse.move(box.x, box.y, { steps: 3 });
  const status = (await look()).status;
  await shorts.mouse.click(box.x, box.y); // a real click turns removal off (automatic mode) or on
  await sleep(1500);
  const clicked = await look();
  await shorts.mouse.move(2, 400, { steps: 3 });
  await sleep(3000);
  const hiddenWithRow = await look();
  report.record("on Shorts the button joins the Short's own buttons, and shows and hides with them",
    shownWithRow.place === "top" && shownWithRow.overlay === "1" && hiddenWithRow.overlay === "0" &&
      (status === "off" ? clicked.status !== "off" : clicked.status === "off"),
    { shown: shownWithRow, before_click: status, after_click: clicked.status, hidden: hiddenWithRow });
  await shorts.close();
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
  await frame.waitForSelector(".musicless-btn", { timeout: 30000 });
  await frame.click(".ytp-large-play-button, .ytp-play-button").catch(() => {});
  let where = null;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    where = await frame.evaluate(() => {
      const el = document.querySelector(".musicless-btn");
      return { place: el?.dataset.place, inTopRow: !!el?.closest(".player-controls-top-right"), status: el?.dataset.musiclessStatus };
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
