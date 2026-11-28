// One AudioContext for every video on the page. Browsers create it suspended
// until the page may play sound (a user gesture, or the site's autoplay
// allowance); it is resumed on the next gesture or playback.

let context = null;
const graphs = new WeakMap(); // media element -> its routing, which cannot be undone
const safariGraphs = new Set(); // Safari routed graphs, rebound if AudioContext is refreshed
let safariNeedsRefresh = false;
let visibilityWatched = false;

export const IN_FIREFOX = chrome.runtime.getURL("").startsWith("moz-extension:");
export const IN_SAFARI = chrome.runtime.getURL("").startsWith("safari-web-extension:");

// Firefox stops a copy of Musicless that is removed or updated without a word
// to it, while what it set up in the page plays on (docs/how-it-works.md,
// Browser quirks). So in Firefox all of a routed video's sound passes a gain,
// its leash, that closes LEASH_SECONDS ahead unless the running copy renews
// it. Each copy leaves the leash on the video in the page's world, where the
// next copy finds it, routes the video too, and closes that leash at once,
// and where the page's capture script sees which videos Musicless routed.
const LEASH_SECONDS = 3;
const FADE_SECONDS = 0.05;
const LEASH_KEY = "musiclessLeash"; // capture.js reads it too

function ensureAudioSession() {
  // On iOS Safari, keep Web Audio playing even when the hardware silent
  // switch is on or the video element is momentarily held.
  if (typeof navigator !== "undefined" && "audioSession" in navigator) {
    try {
      navigator.audioSession.type = "playback";
    } catch {
      // Ignore if the browser disallows changing the audio session type.
    }
  }
}

function attachSafariListeners(ctx) {
  ctx.addEventListener?.("statechange", () => {
    if (ctx.state === "interrupted") safariNeedsRefresh = true;
  });
  if (!visibilityWatched && typeof document !== "undefined") {
    visibilityWatched = true;
    document.addEventListener?.("visibilitychange", () => {
      if (document.hidden) safariNeedsRefresh = true;
    });
  }
}

export function audioContext() {
  if (!context) {
    ensureAudioSession();
    context = new AudioContext({ latencyHint: "playback" });
    if (IN_SAFARI) attachSafariListeners(context);
    for (const type of ["pointerdown", "keydown", "touchend"]) {
      window.addEventListener(type, resumeAudio, { capture: true, passive: true });
    }
  }
  return context;
}

// On iOS Safari, switching away to another tab that plays audio can leave this
// tab's AudioContext interrupted or silently detached from CoreAudio even after
// resume(). Because Safari skips createMediaElementSource(), we can close the
// stale AudioContext and rebind every routed video's output gain to a fresh one.
export function refreshSafariAudio() {
  if (!IN_SAFARI || !context) return context;
  ensureAudioSession();
  const previous = context;
  const next = new AudioContext({ latencyHint: "playback" });
  context = next;
  safariNeedsRefresh = false;
  attachSafariListeners(next);
  for (const entry of safariGraphs) {
    if (entry.video.isConnected === false) {
      safariGraphs.delete(entry);
      continue;
    }
    const { graph } = entry;
    const level = graph.output?.gain?.value ?? 1;
    const output = next.createGain();
    output.gain.value = level;
    output.connect(next.destination);
    graph.ctx = next;
    graph.output = output;
  }
  previous.close?.().catch?.(() => {});
  next.resume?.().catch?.(() => {});
  return next;
}

// Logical user mute state: in Safari, native video.muted stays true while
// Musicless silences original audio, so intent.js mirrors the user's mute state
// to dataset.musiclessUserMuted.
export function isMuted(video) {
  if (IN_SAFARI && video.dataset?.musiclessUserMuted !== undefined) {
    return video.dataset.musiclessUserMuted === "1";
  }
  return video.muted;
}

// Suspended (no gesture yet) or interrupted (another app took the audio device).
export function resumeAudio() {
  if (!context) return;
  if (IN_SAFARI) {
    ensureAudioSession();
    if (safariNeedsRefresh || context.state === "interrupted") {
      refreshSafariAudio();
      return;
    }
  }
  if (context.state === "suspended" || context.state === "interrupted") context.resume().catch(() => {});
}

// Route a media element through Web Audio: its own track goes through
// `original` (muted to silence it) and separated audio plays through `output`.
// The page's volume and mute still apply to the element; `output` follows them.
//
// In Safari, WebKit's MediaSource / ManagedMediaSource pipeline ignores
// createMediaElementSource(), so we skip it and silence the element natively
// through intent.js's shadowed `muted` property instead.
export function routeElement(video) {
  let graph = graphs.get(video);
  if (!graph) {
    const ctx = audioContext();
    if (IN_SAFARI) {
      const output = ctx.createGain();
      output.connect(ctx.destination);
      let gainValue = 1;
      const original = {
        gain: {
          get value() { return gainValue; },
          set value(next) {
            gainValue = Number(next);
            if (video.dataset) {
              if (gainValue === 0) video.dataset.musiclessNativeSilence = "1";
              else delete video.dataset.musiclessNativeSilence;
            }
            video.dispatchEvent?.(new Event("musicless:native-silence", { bubbles: true }));
          },
        },
      };
      graph = { ctx, element: null, original, output, leash: null };
      graphs.set(video, graph);
      safariGraphs.add({ video, graph });
      return graph;
    }
    const element = ctx.createMediaElementSource(video);
    const original = ctx.createGain();
    const output = ctx.createGain();
    const leash = IN_FIREFOX ? ctx.createGain() : null;
    leash?.connect(ctx.destination);
    const out = leash ?? ctx.destination;
    element.connect(original).connect(out);
    output.connect(out);
    graph = { ctx, element, original, output, leash };
    graphs.set(video, graph);
    if (IN_FIREFOX) {
      renewLeash(graph);
      leaveLeash(video, leash);
      // Timers run seldom in a background tab: playing must not wait for one.
      video.addEventListener("play", () => renewLeash(graph));
      // Once a playing video is routed, Firefox plays its own sound about
      // 130 ms ahead of its picture until the next seek, as heard after Restore
      // original sound. A seek to where it already is keeps the two together.
      if (!video.paused && !video.seeking && video.currentTime > 0) video.currentTime = video.currentTime;
    }
  }
  return graph;
}

// Firefox: route a video an earlier copy of Musicless routed, so its sound
// carries on through this copy, and close that copy's leash. Its own sound
// plays until Musicless is turned on for it.
export function adopt(video) {
  const earlier = !graphs.has(video) && leashLeftOn(video);
  if (!earlier) return;
  try {
    routeElement(video);
  } catch {
    return; // Nothing else can carry its sound: the earlier copy's plays until its leash closes.
  }
  try {
    closeLeashIn(earlier, 0, earlier.gain.value);
  } catch {
    // It closes by itself within LEASH_SECONDS.
  }
}

// Firefox: renew the leash of each video this copy routed, whether or not
// Musicless is on for it.
export function renewLeashes() {
  for (const video of document.querySelectorAll("video")) {
    const graph = graphs.get(video);
    if (graph) renewLeash(graph);
  }
}

const renewLeash = (graph) => closeLeashIn(graph.leash, LEASH_SECONDS);

// The leash stays at `level` for `seconds` more, then fades out.
function closeLeashIn(leash, seconds, level = 1) {
  const { gain, context } = leash;
  const now = context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(level, now);
  gain.setValueAtTime(level, now + seconds);
  gain.linearRampToValueAtTime(0, now + seconds + FADE_SECONDS);
}

function leaveLeash(video, leash) {
  try {
    Object.defineProperty(video.wrappedJSObject, LEASH_KEY, { value: leash, configurable: true });
  } catch {
    // A later copy then leaves the video alone: it falls silent once this copy
    // stops, until Musicless is turned on for it.
  }
}

// The leash an earlier copy left on the video, or null. Read as the browser's
// own GainNode, so nothing the page put there runs.
function leashLeftOn(video) {
  if (!IN_FIREFOX) return null;
  try {
    const value = Object.getOwnPropertyDescriptor(video.wrappedJSObject, LEASH_KEY)?.value;
    const leash = value && XPCNativeWrapper(value);
    return leash instanceof GainNode ? leash : null;
  } catch {
    return null;
  }
}
