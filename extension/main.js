// Entry module: give every <video> on the page (including ones the site adds
// later) a Session, and a Button once it has a visible player to sit in. The
// session is attached as soon as the element appears, before it can play, so
// with automatic removal on no music is heard while the first audio is
// prepared.

import { Button } from "./button.js";
import { CaptureBus } from "./capture-bus.js";
import { Engine } from "./engine.js";
import { debugEnabled, Session } from "./session.js";
import { loadSettings, onSettingsChanged, settings } from "./settings.js";

const capture = new CaptureBus();
const engine = new Engine();
const controllers = new Map(); // video -> { session, button }

// The video's player: YouTube's player element, else the closest visible
// ancestor big enough to be one. Null when the video has no visible box (a
// torn-down player, a background tab).
function pickHost(video) {
  const box = video.getBoundingClientRect();
  if (box.width < 200 || box.height < 100) return null;
  const player = video.closest(".html5-video-player");
  if (player) {
    const rect = player.getBoundingClientRect();
    if (rect.width >= 240 && rect.height >= 135) return player;
  }
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
  // A new video in the same player: anchor again for its layout.
  if (session.sourceUrl !== controller.lastSource) {
    controller.lastSource = session.sourceUrl;
    if (controller.button) anchor(controller);
  }
  // A failure needs the recovery dialog even where no player is big enough for
  // the button (a small embed): nothing else tells the user what happened.
  if (!controller.button && session.failure) anchor(controller);
  if (!controller.button) return;
  controller.button.render();
  if (debugEnabled()) controller.button.el.dataset.nomusicDebug = JSON.stringify(session.snapshot());
}

// Does the video show at all? (A torn-down player or a hidden preview does not.)
function hasBox(video) {
  const box = video.getBoundingClientRect();
  return box.width >= 48 && box.height >= 48;
}

function anchor(controller) {
  const { video, session } = controller;
  const host = pickHost(video);
  if (!host) {
    if (session.failure && hasBox(video)) (controller.button ??= new Button(video, session)).float();
    else controller.button?.hide();
    return;
  }
  controller.button ??= new Button(video, session);
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
  // chance to release the model once nothing needs it, and say the consent
  // answer again: a page can post a false one, which must not last.
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleRefresh();
    }
    engine.tidy();
    capture.consent(consented);
  }, 1000);
  // Players appear and resize without DOM changes we can see (layout, CSS),
  // and YouTube rebuilds its controls (navigation, the miniplayer).
  setInterval(() => {
    for (const controller of controllers.values()) {
      const { button, video } = controller;
      if (!button || button.el.style.display === "none" || !button.placed(pickHost(video))) anchor(controller);
    }
  }, 2000);
}

// Consent (the welcome page, the popup) starts or stops everything. Turning
// automatic removal on applies at once to videos the user has not turned off
// themselves; turning it off never interrupts a video already on.
let consented = null;
function applyConsent() {
  if (settings.consented === consented) return;
  consented = settings.consented;
  capture.consent(consented);
  for (const { session } of controllers.values()) session.consentChanged();
}

onSettingsChanged(() => {
  applyConsent();
  if (!settings.autoStart) return;
  for (const { session } of controllers.values()) {
    if (!session.on && !session.userChoice && session.sourceUrl) session.turnOn();
  }
});

loadSettings().finally(() => {
  applyConsent();
  start();
});
