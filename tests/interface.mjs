// Deterministic extension-page and player UI regressions in a real browser
// (Chrome, or Firefox with FIREFOX and FIREFOX_AR: see harness.mjs).
// Uses the local synthetic media for return-to-video; no live YouTube required.
// Usage: MEDIA_SET=synth node interface.mjs [media dir]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bringToFront, closes, emulateMedia, extensionUrl, frameState, gotoExtensionPage, launch, newPage, Report, setSettings, sleep, until, waitFor,
  waitForExtensionPage, WORK,
} from "./harness.mjs";
import { serve } from "./serve.mjs";

const report = new Report(process.env.REPORT ?? "interface");
const server = await serve(process.argv[2] ?? `${WORK}/media`, Number(process.env.PORT ?? 0));
const origin = `http://127.0.0.1:${server.address().port}`;
const playerURL = `${origin}/player.html?media=${process.env.MEDIA_SET ?? "synth"}&variant=webm-opus&muted=1&autoplay=1`;
const { browser, extensionId } = await launch({ consented: false });

async function step(name, fn) {
  try { report.record(name, true, await fn()); }
  catch (error) { report.record(name, false, { error: error.message.slice(0, 600) }); }
}

async function back(welcome) {
  // The browser can close setup before replying to mouse-up: what counts is that it closes.
  welcome.click("#back").catch(() => {});
  if (!(await closes(welcome, 10000))) throw new Error("Back did not close setup");
}

// The first-run page the extension opens after `action` (a click on its button).
async function welcomeAfter(action) {
  const tabs = await browser.pages();
  await action();
  return waitForExtensionPage(browser, extensionUrl(extensionId, "welcome.html"), { timeout: 15000, except: tabs });
}

async function fromVideo(check) {
  await setSettings(browser, extensionId, { consented: false });
  const page = await newPage(browser);
  let welcome;
  try {
    await page.goto(playerURL);
    await bringToFront(page);
    await page.waitForFunction(() => window.playerReady && document.querySelector("video").currentTime > 1);
    welcome = await welcomeAfter(() => page.click(".musicless-btn"));
    await welcome.waitForSelector("#accept", { visible: true });
    return await check(page, welcome);
  } catch (error) {
    const state = await page.evaluate(() => {
      const video = document.querySelector("video");
      return { url: location.href, ready: window.playerReady, paused: video?.paused, time: video?.currentTime, mediaError: video?.error?.message };
    }).catch(() => null);
    throw new Error(`${error.message}; ${JSON.stringify(state)}; ${page.logs.filter(line => line.startsWith("[pageerror]")).join("; ")}`);
  } finally {
    if (welcome && !welcome.isClosed()) await welcome.close().catch(() => {});
    await page.close();
  }
}

// The real Button module, with only its Session supplied as a UI fixture.
// Browser focus, keyboard/pointer events, DOM moves and styles remain real.
async function playerUI(page, shorts = false) {
  await gotoExtensionPage(page, extensionId, "separator.html");
  await bringToFront(page);
  await page.evaluate(async shorts => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "content.css";
    const loaded = new Promise(resolve => { css.onload = resolve; }); document.head.append(css); await loaded;
    const { Button } = await import(chrome.runtime.getURL("button.js"));
    const { createFailure } = await import(chrome.runtime.getURL("failures.js"));
    document.body.replaceChildren();
    const input = Object.assign(document.createElement("input"), { id: "comment", placeholder: "Comment outside the player" });
    const next = Object.assign(document.createElement("button"), { id: "next", textContent: "Next page control" });
    const root = document.createElement(shorts ? "ytd-reel-video-renderer" : "div");
    const host = document.createElement("div"); host.className = "html5-video-player";
    host.style.cssText = "position:relative;width:640px;height:360px;background:#222";
    const video = document.createElement("video"); host.append(video); root.append(host);
    if (shorts) {
      const top = document.createElement("ytd-shorts-player-controls"), row = document.createElement("div");
      row.id = "right-controls";
      row.append(Object.assign(document.createElement("button"), { textContent: "CC" }));
      top.append(row); root.append(top);
    }
    document.body.append(input, next, root);
    const session = { status: "off", on: false, sourceUrl: "blob:ui-fixture", failure: null };
    const control = new Button(video, session); control.position(host);
    window.ui = { session, control, host, createFailure };
  }, shorts);
}

try {
  await step("Back reloads a previously loaded muted video before missed capture is reported", () => fromVideo(async (page, welcome) => {
    await welcome.click("#accept");
    await welcome.waitForSelector("#back", { visible: true });
    // Firefox for Android exposes tabs but no windows API.
    await welcome.evaluate(() => Object.defineProperty(chrome, "windows", { value: undefined, configurable: true }));
    const before = await frameState(page);
    assert(!before.attached && !before.failure, "the muted video must not have reported missed capture yet");
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
    await back(welcome);
    await navigation;
    await page.waitForFunction(() => window.playerReady === true);
    await page.$eval("video", video => { video.muted = false; });
    const after = await waitFor(page, s => s.status === "failed" || (s.status === "on" && !s.holding), { label: "unmuted after Back" });
    assert.equal(after.status, "on"); assert(!after.failure);
    return { attachedBefore: before.attached, statusAfter: after.status, failureAfter: after.failure ?? null };
  }));

  for (const hostname of ["localhost", "127.0.0.1"]) {
    await step(`Back leaves a replacement document on ${hostname} untouched`, () => fromVideo(async (page, welcome) => {
      await page.evaluate(() => window.addEventListener("pageshow", event => { window.restoredFromCache = event.persisted; }));
      const replacement = new URL(playerURL); replacement.hostname = hostname; replacement.searchParams.set("replacement", "1");
      await page.goto(replacement.href);
      await bringToFront(page);
      await page.waitForFunction(() => window.playerReady === true);
      await page.evaluate(() => {
        const input = Object.assign(document.createElement("input"), { id: "draft", value: "Unsaved draft" });
        document.body.append(input);
      });
      let navigations = 0;
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
      await bringToFront(welcome);
      await welcome.click("#accept");
      await welcome.waitForSelector("#back", { visible: true });
      await back(welcome);
      await sleep(800);
      assert.equal(navigations, 0);
      assert.equal(await page.$eval("#draft", el => el.value), "Unsaved draft");
      await page.goBack({ waitUntil: "load" });
      await sleep(800);
      assert.equal(navigations, 1, "no reload should be left queued for the old document");
      return { replacementReloaded: false, draftPreserved: true, receiverInReplacement: hostname === "127.0.0.1",
        restoredFromCache: await page.evaluate(() => window.restoredFromCache === true), delayedReload: false };
    }));
  }

  await step("Back reloads the requesting embedded player without reloading its surrounding page", async () => {
    await setSettings(browser, extensionId, { consented: false });
    const page = await newPage(browser);
    let welcome;
    try {
      await page.setContent(`<input id="draft" value="Unsaved draft"><iframe width="800" height="600" src="${playerURL}"></iframe>`);
      const frame = await (await page.$("iframe")).contentFrame();
      await frame.waitForFunction(() => window.playerReady && document.querySelector("video").currentTime > 1);
      welcome = await welcomeAfter(() => frame.click(".musicless-btn"));
      await welcome.waitForSelector("#accept", { visible: true });
      await welcome.click("#accept");
      await welcome.waitForSelector("#back", { visible: true });
      const target = await welcome.evaluate(() => chrome.storage.session.get("videoTab").then(s => s.videoTab));
      assert(target.frameId > 0, "setup must remember the child frame");
      let outerNavigations = 0;
      page.on("framenavigated", f => { if (f === page.mainFrame()) outerNavigations++; });
      const navigation = frame.waitForNavigation({ waitUntil: "domcontentloaded" });
      await back(welcome);
      await navigation;
      await frame.waitForFunction(() => window.playerReady === true);
      assert.equal(outerNavigations, 0);
      assert.equal(await page.$eval("#draft", el => el.value), "Unsaved draft");
      return { embeddedFrameReloaded: true, outerNavigations, draftPreserved: true };
    } finally {
      if (welcome && !welcome.isClosed()) await welcome.close().catch(() => {});
      await page.close();
    }
  });

  const page = await newPage(browser);
  await step("recovery preserves Tab outside the dialog and cycles its own actions", async () => {
    await playerUI(page);
    await page.click("#comment");
    await page.type("#comment", "Writing a comment");
    await page.evaluate(() => {
      ui.session.status = "failed"; ui.session.failure = ui.createFailure("slow"); ui.control.render();
    });
    assert.equal(await page.evaluate(() => document.activeElement.id), "comment");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "next");
    await page.evaluate(() => ui.control.retryBtn.focus());
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "original");
    await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "retry");
    return { outsideFocus: "next", insideCycle: ["retry", "original", "retry"] };
  });

  await step("keyboard activation of recovery does not strand the player tooltip", async () => {
    await page.keyboard.press("Escape");
    await page.mouse.move(1, 1);
    await page.keyboard.press("Enter");
    const state = await page.evaluate(() => ({
      focusedAction: document.activeElement.dataset.action, recoveryVisible: !ui.control.recovery.hidden,
      buttonHovered: ui.control.el.matches(":hover"), tooltipHidden: ui.control.tip.hidden,
    }));
    assert(state.recoveryVisible && state.focusedAction === "retry" && !state.buttonHovered && state.tooltipHidden);
    return state;
  });

  for (const layout of ["watch", "ytd-reel-video-renderer", "ytd-reel-video-renderer-cow"]) {
    await step(`the toggle waits for the native controls on ${layout}, including a rebuild`, async () => {
      // Install the real content script on a local page, then navigate in-page
      // and add a video before either its YouTube wrapper or its controls.
      await page.goto(playerURL);
      await page.evaluate(layout => {
        history.replaceState(null, "", layout === "watch" ? "/watch?v=test" : "/shorts/test");
        const host = document.createElement("div"), video = document.createElement("video");
        host.id = "test-host";
        video.style.cssText = "width:640px;height:360px";
        host.append(video);
        document.body.replaceChildren(host);
      }, layout);
      await page.waitForSelector("#test-host .musicless-sr-only"); // Musicless has attached to the video
      assert.equal(await page.$(".musicless-btn"), null);
      await page.evaluate(layout => {
        const host = document.querySelector("#test-host");
        host.className = "html5-video-player";
        const wrapper = document.createElement(layout === "watch" ? "div" : layout);
        host.before(wrapper);
        wrapper.append(host);
        const controls = document.createElement(layout === "watch" ? "div" : "ytd-shorts-player-controls");
        (layout === "watch" ? host : wrapper).append(controls);
        controls.id = "late-controls";
      }, layout);
      const selector = (layout === "watch" ? ".ytp-right-controls" : "#right-controls") + " > .musicless-btn";
      const addRow = () => page.$eval("#late-controls", (controls, layout) => {
        const row = document.createElement("div");
        if (layout === "watch") row.className = "ytp-right-controls";
        else row.id = "right-controls";
        row.append(Object.assign(document.createElement("button"), { className: "ytp-subtitles-button", textContent: "CC" }));
        controls.append(row);
      }, layout);
      await addRow();
      await page.waitForSelector(selector, { visible: true });
      await page.$eval("#late-controls", controls => controls.replaceChildren());
      await sleep(2200); // keep the HUD absent through a layout poll
      assert.equal(await page.$(".musicless-btn"), null);
      await addRow();
      await page.waitForSelector(selector, { visible: true });
      const row = await page.$eval(selector, el => el.dataset.place);
      assert.equal(row, layout === "watch" ? "ytp" : "top");
      return { place: row };
    });
  }

  for (const [pagePath, player, controls] of [
    ["/watch?v=mobile", '<div id="player-container-id"></div>', '<ytm-watch-player-controls><div class="player-controls-top"></div></ytm-watch-player-controls>'],
    ["/shorts/mobile", "<shorts-video></shorts-video>", "<ytm-reel-player-overlay-renderer><reel-action-bar-view-model></reel-action-bar-view-model></ytm-reel-player-overlay-renderer>"],
  ]) {
    await step(`the mobile toggle follows its own controls on ${pagePath}`, async () => {
      await page.goto(playerURL);
      await page.evaluate((path, player, controls) => {
        history.replaceState(null, "", path);
        // Another overlay can stay mounted during navigation.
        document.body.innerHTML = '<aside>' + controls + '</aside>' + player;
        const active = document.body.lastElementChild;
        active.innerHTML = '<div id="movie_player" class="html5-video-player"><video width="384" height="216"></video></div>';
      }, pagePath, player, controls);
      await page.waitForSelector("#movie_player .musicless-sr-only");
      assert.equal(await page.$(".musicless-btn"), null);
      const addRow = () => page.$eval("#movie_player", (host, controls) => {
        host.insertAdjacentHTML("afterend", controls);
        const row = host.nextElementSibling.firstElementChild;
        row.innerHTML = '<button><span class="ytmClosedCaptioningButtonButton"></span></button>';
        row.classList.add("active-row");
      }, controls);
      await addRow();
      const note = '.active-row > .musicless-btn[data-place="top"]';
      await page.waitForSelector(note, { visible: true });
      await page.$eval(".active-row", row => row.parentElement.remove());
      await sleep(2200);
      assert.equal(await page.$(".musicless-btn"), null);
      await addRow();
      await page.waitForSelector(note, { visible: true });
      assert(await page.$eval(note, el => el === el.parentElement.firstElementChild));
    });
  }

  await step("a settled watch page picks up controls added late without moving the video", async () => {
    await page.goto(playerURL);
    await page.evaluate(() => {
      history.replaceState(null, "", "/watch?v=late-controls");
      document.body.innerHTML = '<div id="movie_player" class="html5-video-player"><video width="640" height="360"></video></div>';
      document.dispatchEvent(new Event("yt-navigate-finish"));
    });
    await page.waitForSelector("#movie_player .musicless-sr-only"); // the extension has found the video
    // Let both URL detection and the entire navigation refresh burst finish.
    // An eight-second corner fallback would also fail this assertion.
    await assert.rejects(page.waitForSelector("#movie_player .musicless-btn", { visible: true, timeout: 11000 }),
      { name: "TimeoutError" }, "the note appeared before the controls");
    await page.$eval("#movie_player", host => {
      host.insertAdjacentHTML("beforeend", '<div class="ytp-right-controls"><button class="ytp-subtitles-button">CC</button></div>');
    });
    const note = '#movie_player .ytp-right-controls > .musicless-btn[data-place="ytp"]';
    await page.waitForSelector(note, { visible: true, timeout: 6000 });
    assert(await page.$eval(note, el => el.nextElementSibling?.matches(".ytp-subtitles-button")));
    return { place: "ytp", beforeCaptions: true };
  });

  await step("repositioning an already-first Shorts button preserves focus and DOM order", async () => {
    await playerUI(page, true);
    const state = await page.evaluate(async () => {
      const row = document.querySelector("#right-controls"), records = [];
      ui.control.el.focus();
      const observer = new MutationObserver(list => records.push(...list)); observer.observe(row, { childList: true });
      ui.control.position(ui.host);
      await new Promise(resolve => setTimeout(resolve, 0)); observer.disconnect();
      return { focused: document.activeElement === ui.control.el, first: row.firstElementChild === ui.control.el, mutations: records.length };
    });
    assert(state.focused && state.first && state.mutations === 0);
    return state;
  });

  await step("the center Play button and action rail both receive taps on mobile Shorts", async () => {
    await playerUI(page);
    await page.evaluate(() => {
      const { control, session, host } = window.ui;
      const short = document.createElement("shorts-video");
      short.style.cssText = "display:block;position:relative;width:640px;height:360px";
      host.replaceWith(short);
      short.append(host);
      host.style.zIndex = "0";
      const overlay = document.createElement("ytm-reel-player-overlay-renderer");
      overlay.style.cssText = "position:absolute;inset:0;z-index:2";
      overlay.innerHTML = '<reel-action-bar-view-model><button id="like" style="position:absolute;right:8px;bottom:8px">Like</button></reel-action-bar-view-model>';
      short.append(overlay);
      session.status = "blocked";
      session.toggle = () => { window.ui.played = true; };
      document.querySelector("#like").onclick = () => { window.ui.liked = true; };
      control.position(host);
      control.render();
    });
    await page.click(".musicless-notice__disc");
    await page.click("#like");
    assert(await page.evaluate(() => window.ui.played && window.ui.liked));
  });

  await step("the mobile audio frame has a box without obscuring the page or taking taps", async () => {
    await playerUI(page);
    const state = await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.className = "musicless-engine";
      document.body.append(frame);
      const rect = frame.getBoundingClientRect();
      return { size: [rect.width, rect.height], opacity: getComputedStyle(frame).opacity,
        takesTaps: document.elementFromPoint(rect.left + 0.5, rect.top + 0.5) === frame };
    });
    assert.deepEqual(state, { size: [1, 1], opacity: "0", takesTaps: false });
    return state;
  });

  await step("the welcome instruction's glyph stays visible in forced colors", async () => {
    await setSettings(browser, extensionId, { consented: true });
    await gotoExtensionPage(page, extensionId, "welcome.html");
    await page.waitForSelector("#done .steps .glyph", { visible: true });
    await emulateMedia(page, { "forced-colors": "active" });
    try {
      const glyph = await page.$("#done .steps .glyph");
      const png = await glyph.screenshot({ type: "png" });
      writeFileSync(join(WORK, "forced-colors-glyph.png"), png);
      const differentPixels = await page.evaluate(async data => {
        const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data, bg = rgba.slice(0, 3);
        let count = 0;
        for (let i = 0; i < rgba.length; i += 4) if (Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i+1] - bg[1]) + Math.abs(rgba[i+2] - bg[2]) > 60) count++;
        return count;
      }, Buffer.from(png).toString("base64"));
      assert(differentPixels > 0, "the icon must contrast with its background");
      return { differentPixels };
    } finally { await emulateMedia(page, { "forced-colors": "" }); }
  });
  await step("player overrides reset on the next source and defaults leave the current video alone", async () => {
    await setSettings(browser, extensionId, { consented: true, autoStart: false });
    const videoPage = await newPage(browser);
    const next = async () => {
      await videoPage.evaluate(() => window.load("synth", "webm-opus", 200000, 1000));
      await videoPage.waitForFunction(() => window.playerReady === true);
    };
    try {
      await videoPage.goto(playerURL);
      await videoPage.waitForFunction(() => window.playerReady === true);
      await waitFor(videoPage, s => s.status === "off", { label: "default off" });
      await videoPage.click(".musicless-btn");
      await waitFor(videoPage, s => s.on, { label: "manual on" });
      await next();
      await waitFor(videoPage, s => s.status === "off", { label: "manual on resets" });
      await setSettings(browser, extensionId, { autoStart: true });
      await sleep(700);
      assert.equal((await frameState(videoPage)).status, "off");
      await next();
      await waitFor(videoPage, s => s.on, { label: "new default on" });
      await videoPage.click(".musicless-btn");
      await waitFor(videoPage, s => s.status === "off", { label: "manual off" });
      await next();
      await waitFor(videoPage, s => s.on, { label: "manual off resets" });
      await setSettings(browser, extensionId, { autoStart: false });
      await sleep(700);
      assert.equal((await frameState(videoPage)).on, true);
      await next();
      const state = await waitFor(videoPage, s => s.status === "off", { label: "new default off" });
      assert(!state.holding && !state.attached);
      return { manualOnReset: true, manualOffReset: true, currentVideoPreserved: true, nextVideoUsesDefault: true };
    } finally {
      await videoPage.close();
      await setSettings(browser, extensionId, { autoStart: true });
    }
  });

  for (const lang of ["en-US", "ar"]) {
    await step(`${lang} popup explains both defaults and the per-video choice`, async () => {
      const localized = await launch({ lang, consented: false, diagnostics: false });
      try {
        const popup = await localized.browser.newPage();
        const privacyUrl = `https://musicless.ieasybooks.com/${lang === "ar" ? "ar" : "en"}/privacy`;
        await popup.setViewport({ width: 720, height: 600 });
        await gotoExtensionPage(popup, localized.extensionId, "welcome.html");
        await popup.waitForSelector("#setup:not(.off)");
        assert.equal(await popup.$eval("#privacy", link => link.href), privacyUrl);
        await popup.evaluate(() => document.fonts.ready);
        assert(await popup.$eval("#setup h1", el => el.offsetHeight === parseFloat(getComputedStyle(el).lineHeight)),
          "the full setup title fits on one line");
        await popup.goto("about:blank");
        await popup.setViewport({ width: 320, height: 600, deviceScaleFactor: 2 });
        await gotoExtensionPage(popup, localized.extensionId, "popup.html");
        await popup.waitForSelector("#accept", { visible: true });
        assert.equal(await popup.$eval("#privacy", link => link.href), privacyUrl);
        const expectedAccept = await popup.evaluate(() => chrome.i18n.getMessage("consent_accept"));
        assert.equal(expectedAccept, lang === "ar" ? "تفعيل «بلا موسيقى»" : "Turn on Musicless");
        assert.equal(await popup.$eval("#accept", el => el.textContent), expectedAccept);
        await popup.click("#accept");
        await popup.waitForSelector("#settings:not([hidden])");
        assert(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "settings fit a narrow phone");
        await popup.goto("about:blank");
        await popup.setViewport({ width: 390, height: 600, deviceScaleFactor: 2 });
        await gotoExtensionPage(popup, localized.extensionId, "popup.html");
        await popup.waitForSelector("#settings:not([hidden])");
        for (const on of [true, false]) {
          if (!on) await popup.click("#autoStart");
          await until(popup, on => chrome.storage.sync.get("autoStart").then(s => s.autoStart === on), on, { label: "the setting" });
          const state = await popup.evaluate(on => {
            const hint = document.getElementById("oneVideo"), glyph = hint.querySelector(".glyph");
            const iconName = chrome.i18n.getMessage(on ? "control_on" : "control_name");
            const expected = chrome.i18n.getMessage(on ? "popup_default_on" : "popup_one_video").replace("{icon}", "");
            return { visible: !hint.hidden, text: hint.textContent, expected, icon: glyph?.getAttribute("aria-label"), iconName,
              crossed: glyph?.classList.contains("glyph-on"), described: document.getElementById("autoStart").getAttribute("aria-describedby"),
              overflow: document.documentElement.scrollWidth > innerWidth };
          }, on);
          assert(state.visible && !state.overflow);
          assert.equal(state.text, state.expected);
          assert(state.text.toLowerCase().includes(lang === "ar" ? "كل فيديو تفتحه" : "every video you open"));
          assert.equal(state.icon, state.iconName);
          assert.equal(state.crossed, on); assert.equal(state.described, "oneVideo");
          const [start, end, instruction, last] = await popup.$eval("#oneVideo", hint => {
            const first = hint.firstChild, last = hint.lastChild;
            const nextLine = first.data.indexOf("\n") + 1;
            const top = (node, i) => {
              const range = document.createRange();
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              return range.getBoundingClientRect().top;
            };
            return [top(first, 0), top(first, nextLine - 2), top(first, nextLine), top(last, last.length - 1)];
          });
          assert.equal(start, end, "the default fits on the first line");
          assert.equal(instruction, last, "the player instruction fits on the second line");
          assert(instruction > end);
          for (const scheme of ["light", "dark"]) {
            await emulateMedia(popup, { "prefers-color-scheme": scheme });
            await until(popup, ([scheme, lang]) => {
              const logo = document.querySelector(".popup-header img");
              return logo.complete && logo.currentSrc.endsWith(
                `musicless-logo-${lang === "ar" ? "ar-" : ""}${scheme === "dark" ? "paper" : "ink"}.svg`);
            }, [scheme, lang], { label: `the ${scheme} logo` });
            const header = await popup.evaluate(() => ({
              height: document.querySelector(".popup-header").getBoundingClientRect().height,
              logoHeight: document.querySelector(".popup-header img").getBoundingClientRect().height,
              logoLoaded: document.querySelector(".popup-header img").naturalWidth > 0,
              alt: document.querySelector(".popup-header img").alt,
              linked: !!document.querySelector(".popup-header a"),
            }));
            assert.equal(header.height, 50); assert(header.logoLoaded);
            // The Arabic logo is taller at the same scale: its letters reach further down.
            assert(Math.abs(header.logoHeight - (lang === "ar" ? 28.36 : 26)) < 0.02, `logo height ${header.logoHeight}`);
            assert.equal(header.alt, lang === "ar" ? "بلا موسيقى" : "Musicless"); assert(!header.linked);
            await popup.screenshot({ path: join(WORK, `${lang}-popup-${on ? "on" : "off"}-${scheme}.png`) });
          }
        }
        const welcome = await localized.browser.newPage();
        await welcome.setViewport({ width: 900, height: 750, deviceScaleFactor: 1 });
        await gotoExtensionPage(welcome, localized.extensionId, "welcome.html");
        await welcome.waitForSelector("#done:not(.off)");
        // Arabic titles are drawn in the bundled Alexandria; English never loads it.
        const titleFont = await welcome.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].map(face => `${face.family.replaceAll('"', "")} ${face.status}`);
        });
        assert.deepEqual(titleFont, [`Alexandria Arabic ${lang === "ar" ? "loaded" : "unloaded"}`]);
        const checkSteps = async on => {
          const state = await welcome.evaluate(on => ({
            titles: [...document.querySelectorAll(".steps strong")].map(el => el.textContent),
            expected: [on ? "done_step1_title" : "done_step1_off_title", "done_step2_title",
              on ? "done_step3_title" : "done_step3_off_title"].map(key => chrome.i18n.getMessage(key)),
            glyphStep: [...document.querySelectorAll(".steps li")].findIndex(el => el.querySelector(".glyph")),
            crossed: !!document.querySelector(".steps .glyph-on"),
            numbering: getComputedStyle(document.querySelector(".steps")).listStyleType,
            intact: document.querySelector(".brand").classList.contains("intact"),
            iconWidth: document.querySelector(".brand").getBoundingClientRect().width,
          }), on);
          assert.deepEqual(state.titles, state.expected);
          assert.equal(state.glyphStep, on ? 2 : 0); assert.equal(state.crossed, on);
          assert.equal(state.numbering, "decimal"); assert(!state.intact);
          assert.equal(state.iconWidth, 64);
        };
        await checkSteps(false);
        assert.equal(await welcome.evaluate(() => document.getAnimations().length), 0, "already-on pages must not animate");
        await setSettings(localized.browser, localized.extensionId, { autoStart: true });
        await welcome.waitForSelector("#step3Text .glyph-on");
        await checkSteps(true);
        for (const reduce of [false, true]) {
          await emulateMedia(welcome, { "prefers-reduced-motion": reduce ? "reduce" : "no-preference" });
          await popup.evaluate(() => chrome.storage.sync.set({ consented: false }));
          await welcome.waitForSelector(".brand.intact");
          assert.equal(await welcome.$eval(".whole-note", el => getComputedStyle(el).opacity), "1");
          if (reduce) await popup.evaluate(() => chrome.storage.sync.set({ consented: true }));
          else await welcome.click("#accept");
          await welcome.waitForSelector("#done:not(.off)");
          const motion = await welcome.evaluate(() => ({ count: document.getAnimations().length,
            topMoving: document.querySelector(".brand .top").getAnimations().some(a => a.effect.getTiming().duration === 560),
            focused: document.activeElement.id, intact: document.querySelector(".brand").classList.contains("intact") }));
          assert.equal(motion.focused, "doneHeading"); assert(!motion.intact);
          assert(reduce ? motion.count === 0 : motion.count > 0 && motion.topMoving, JSON.stringify(motion));
          await sleep(1000);
          assert.equal(await welcome.$eval(".whole-note", el => getComputedStyle(el).opacity), "0");
        }
        await gotoExtensionPage(welcome, localized.extensionId, "welcome.html"); // a reload
        await welcome.waitForSelector("#done:not(.off)");
        assert.equal(await welcome.evaluate(() => document.getAnimations().length), 0);
        for (const scheme of ["light", "dark"]) {
          await emulateMedia(welcome, { "prefers-color-scheme": scheme });
          await welcome.screenshot({ path: join(WORK, `${lang}-welcome-${scheme}.png`) });
        }
        return { lang, defaultsExplained: true, perVideoGlyphs: true, consentRequired: true, numberedSteps: true, snapAndReducedMotion: true };
      } finally { await localized.browser.close(); }
    });
  }

} finally {
  report.save();
  await browser.close();
  server.close();
}
const { failed, text } = report.summary();
console.log(`\n${text}`);
process.exitCode = failed ? 1 : 0;
