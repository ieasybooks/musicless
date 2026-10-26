// Toolbar popup: the disclosure until the user turns nomusic on, then the
// automatic-removal setting.
import { localizePage } from "./i18n.js";
import { DEFAULTS } from "./settings.js";

localizePage();
const $ = (id) => document.getElementById(id);
$("version").textContent = `v${chrome.runtime.getManifest().version}`;

function show(consented) {
  $("consent").hidden = consented;
  $("settings").hidden = !consented;
}

// `consented` stays false until the user turns nomusic on, here or on the welcome page.
chrome.storage.sync.get(DEFAULTS).then((stored) => {
  $("autoStart").checked = stored.autoStart;
  show(stored.consented);
});
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  $("done").hidden = false;
  show(true);
  $("autoStart").focus();
});
$("autoStart").addEventListener("change", () => {
  chrome.storage.sync.set({ autoStart: $("autoStart").checked });
});
