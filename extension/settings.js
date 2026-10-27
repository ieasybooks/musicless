// User settings, mirrored from chrome.storage.sync (the popup writes them).

export const DEFAULTS = Object.freeze({
  // Remove music from every video as soon as it starts. When off, the user
  // clicks the Musicless button on a video to start.
  autoStart: true,
  // The user turned Musicless on after reading what it does (the welcome page or
  // the popup). Until then, and on each page until this is known there, it
  // keeps no audio: capture.js keeps only format headers.
  consented: false,
});

export const settings = { ...DEFAULTS };
const listeners = new Set();

export async function loadSettings() {
  try {
    Object.assign(settings, await chrome.storage.sync.get(DEFAULTS));
  } catch {
    // Storage unavailable (e.g. the extension was just updated): keep the defaults.
  }
  return settings;
}

export function onSettingsChanged(listener) {
  listeners.add(listener);
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let changed = false;
    for (const key of Object.keys(DEFAULTS)) {
      if (!(key in changes)) continue;
      settings[key] = changes[key].newValue ?? DEFAULTS[key];
      changed = true;
    }
    if (changed) for (const listener of listeners) listener(settings);
  });
} catch {
  // No storage events in this context.
}
