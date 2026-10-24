// Entry module: give every <video> on the page (including ones the site adds
// later) a Session, and a Button once it has a visible player to sit in. The
// session is attached as soon as the element appears, before it can play, so
// with automatic removal on no music is heard while the first audio is
// prepared. Discovery and anchoring are adapted from the main nomusic extension.

import { Button } from "./button.js";
import { CaptureBus } from "./capture-bus.js";
import { Engine } from "./engine.js";
import { debugEnabled, Session } from "./session.js";
import { loadSettings, onSettingsChanged, settings } from "./settings.js";

const NS = "nomusic";
const capture = new CaptureBus();
const engine = new Engine();
const controllers = new Map(); // video -> { session, button }

// The closest visible ancestor big enough to be the video's player, or null
// when the video has no visible box (a torn-down player, a background tab).
function pickHost(video) {
  const box = video.getBoundingClientRect();
  if (box.width < 200 || box.height < 100) return null;
  let node = video.parentElement;
  while (node && node !== document.body) {
    const rect = node.getBoundingClientRect();
    if (rect.width >= 240 && rect.height >= 135) return node;
    node = node.parentElement;
  }
  return null;
}

function render(controller) {
  const { session } = controller;
  if (!controller.button) {
    controller.lastSource = session.sourceUrl;
    return;
  }
  // A new video in the same player brings a dismissed button back.
  if (session.sourceUrl !== controller.lastSource) {
    controller.lastSource = session.sourceUrl;
    controller.button.reset();
    anchor(controller);
  }
  controller.button.render();
  if (debugEnabled()) controller.button.el.dataset.nomusicDebug = JSON.stringify(session.snapshot());
}

function anchor(controller) {
  const host = pickHost(controller.video);
  if (!host) {
    controller.button?.hide();
    return;
  }
  controller.button ??= new Button(controller.video, controller.session);
  // The host can lose its positioning around fullscreen and navigation, which
  // would let the button escape to a window-sized ancestor.
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  controller.button.position(host);
  controller.button.render();
}

function attach(video) {
  if (controllers.has(video)) return;
  const controller = { video, session: null, button: null, lastSource: null };
  controllers.set(video, controller);
  // The session reports changes from its constructor on, before this assignment.
  controller.session = new Session(video, {
    capture,
    engine,
    onChange: (session) => {
      controller.session = session;
      render(controller);
    },
  });
  anchor(controller);
}

function forget(video) {
  const controller = controllers.get(video);
  if (!controller) return;
  controllers.delete(video);
  controller.session.dispose();
  controller.button?.destroy();
}

function scan(root) {
  if (root.tagName === "VIDEO") attach(root);
  root.querySelectorAll?.("video").forEach(attach);
}

// Re-attach and re-anchor every video for the current layout.
function refresh() {
  scan(document);
  for (const controller of controllers.values()) {
    if (!controller.video.isConnected) forget(controller.video);
    else anchor(controller);
  }
}

// A route change or layout shift usually lands a beat before the new player has
// a size, so refresh in a short burst. Overlapping bursts coalesce.
let refreshTimers = [];
function scheduleRefresh() {
  for (const timer of refreshTimers) clearTimeout(timer);
  refreshTimers = [0, 150, 400, 800, 1500, 2500].map((delay) => setTimeout(refresh, delay));
}

function start() {
  scan(document);
  new MutationObserver((mutations) => {
    let removed = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.nodeType === 1) scan(node);
      for (const node of mutation.removedNodes) {
        if (node.nodeType === 1 && (node.tagName === "VIDEO" || node.querySelector?.("video"))) removed = true;
      }
    }
    // A removal may be a player moving (e.g. into the miniplayer): re-anchor.
    if (removed) scheduleRefresh();
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("fullscreenchange", refresh, true);
  document.addEventListener("yt-navigate-finish", scheduleRefresh, true);
  let lastUrl = location.href;
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 250);
  });
  // SPA navigation without an event: poll the URL. Also give the engine a
  // chance to release the model once nothing needs it.
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleRefresh();
    }
    engine.tidy();
  }, 1000);
  // Players appear and resize without DOM changes we can see (layout, CSS).
  setInterval(() => {
    for (const controller of controllers.values()) if (!controller.button || controller.button.el.style.display === "none") anchor(controller);
  }, 2000);
}

// Turning automatic removal on applies at once to videos the user has not
// turned off themselves; turning it off never interrupts a video already on.
onSettingsChanged(() => {
  if (!settings.autoStart) return;
  for (const { session } of controllers.values()) {
    if (!session.on && !session.userChoice && session.sourceUrl) session.turnOn();
  }
});

// Test diagnostics (localStorage.nomusicDebug = "1"): state and recordings.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.[NS] !== "debug" || !debugEnabled()) return;
  const sessions = [...controllers.values()].map((controller) => controller.session);
  const session = sessions.find((s) => s.attached) ?? sessions.find((s) => s.on) ?? sessions[0];
  let reply = null;
  if (event.data.type === "dump") reply = session?.recorder?.dump(event.data.seconds ?? 20) ?? null;
  else if (event.data.type === "state") reply = session ? session.snapshot() : null;
  else if (event.data.type === "sessions") reply = sessions.map((s) => s.snapshot());
  window.postMessage({ [NS]: "debug-reply", id: event.data.id, reply }, "*");
});

loadSettings().finally(start);
