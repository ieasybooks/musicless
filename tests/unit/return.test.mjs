// Return-to-video coordination, without running audio or navigating a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flush, load, plain } from "./sandbox.mjs";

function returning(videos) {
  const events = [], scheduled = [];
  const { reloadPage } = load("navigation.js", {
    URL,
    location: {
      hostname: "www.youtube.com", pathname: "/watch", href: "https://www.youtube.com/watch?v=test",
      replace: (url) => events.push(["navigate", url]), reload: () => events.push(["reload"]),
    },
  });
  let receive;
  const { controllers } = load("main.js", {
    CaptureBus: class {}, Engine: class {}, reloadPage, onSettingsChanged() {},
    loadSettings: () => ({ finally() {} }), // do not start DOM scanning or the playback timers
    chrome: { runtime: { onMessage: { addListener: (handler) => { receive = handler; } } } },
    setTimeout: (fn) => scheduled.push(fn),
  }, { expose: ["controllers"] });
  for (const video of videos) controllers.set(video, { video, session: { failure: null, attached: false } });
  receive({ type: "reload" }, {}, (reply) => events.push(["reply", reply]));
  return { events, scheduled };
}

const video = (visible = true) => ({
  currentTime: 75.6, muted: true,
  getBoundingClientRect: () => ({ width: visible ? 640 : 0, height: visible ? 360 : 0 }),
});

test("Back queues a position-preserving reload before missed capture is discovered on a muted video", () => {
  const { events, scheduled } = returning([video()]);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(events, [["reply", true]], "the acknowledgment reaches setup before navigation");
  scheduled[0]();
  assert.deepEqual(events[1], ["navigate", "https://www.youtube.com/watch?v=test&t=75s"]);
});

test("Back ignores hidden players and does not claim a reload when no visible video remains", () => {
  for (const videos of [[], [video(false)]]) {
    const { events, scheduled } = returning(videos);
    assert.deepEqual(events, [["reply", false]]);
    assert.equal(scheduled.length, 0);
  }
  const { scheduled } = returning([video(false), video()]);
  assert.equal(scheduled.length, 1);
});

test("setup remembers the requesting frame and document as well as its tab", async () => {
  let receive, stored, active;
  load("background.js", {
    chrome: {
      runtime: {
        getURL: (file) => `chrome-extension://test/${file}`,
        onInstalled: { addListener() {} }, onMessage: { addListener: (fn) => { receive = fn; } },
      },
      storage: { session: { set: async (value) => { stored = plain(value); } } },
      tabs: { query: async () => [{ id: 99 }], update: async id => { active = id; } },
    },
  });
  receive({ type: "open-welcome" }, { tab: { id: 7 }, frameId: 12, documentId: "source-document" });
  await flush();
  assert.equal(active, 99, "reuse setup even when the Android windows API is absent");
  assert.deepEqual(stored, { videoTab: { id: 7, frameId: 12, documentId: "source-document" } });
});

test("welcome Back sends only documentId on Safari and both frameId and documentId elsewhere", async () => {
  for (const [base, expected] of [
    ["chrome-extension://test/", { frameId: 12, documentId: "doc-1" }],
    ["safari-web-extension://test/", { documentId: "doc-1" }],
  ]) {
    const sent = [];
    const clickHandlers = {};
    const el = (id) => ({
      id, hidden: false, textContent: "", href: "", classList: { toggle() {} },
      removeAttribute() {}, focus() {},
      addEventListener(type, fn) { if (type === "click") clickHandlers[id] = fn; },
    });
    const elements = new Map();
    const document = {
      getElementById: (id) => elements.get(id) ?? elements.set(id, el(id)).get(id),
      querySelector: () => el("q"),
    };
    load("welcome.js", {
      document,
      location: { href: "" },
      localizePage() {}, localizeWithGlyph() {}, t: (k) => k,
      loadSettings: async () => ({ consented: true, autoStart: true }),
      onSettingsChanged() {},
      chrome: {
        runtime: { getURL: (file) => base + file },
        storage: {
          session: { get: async () => ({ videoTab: { id: 7, frameId: 12, documentId: "doc-1" } }), remove() {} },
          onChanged: { addListener() {} },
        },
        tabs: {
          get: async () => ({ id: 7 }),
          update: async () => ({ id: 7, windowId: 1 }),
          getCurrent: async () => null,
          sendMessage: async (tabId, message, options) => { sent.push({ tabId, message: plain(message), options: plain(options) }); },
        },
      },
    });
    await flush();
    await clickHandlers.back();
    assert.deepEqual(sent, [{ tabId: 7, message: { type: "reload" }, options: expected }], base);
  }
});
