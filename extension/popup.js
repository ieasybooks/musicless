// Toolbar popup: the automatic-removal setting.
import { DEFAULTS } from "./settings.js";

const autoStart = document.getElementById("autoStart");
document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

chrome.storage.sync.get(DEFAULTS).then((stored) => {
  autoStart.checked = stored.autoStart;
});
autoStart.addEventListener("change", () => {
  chrome.storage.sync.set({ autoStart: autoStart.checked });
});
