// Toolbar popup: the one setting's row. Until the user turns nomusic on, the
// row carries the disclosure and the switch, turned on, is the consent.
import { localizePage } from "./i18n.js";
import { DEFAULTS } from "./settings.js";

localizePage();
const $ = (id) => document.getElementById(id);
let consented = false;

function show() {
  $("consent").hidden = consented;
  $("autoStart").checked = consented && settings.autoStart;
}

// `consented` stays false until the user turns nomusic on, here or on the first-run page.
let settings = { ...DEFAULTS };
chrome.storage.sync.get(DEFAULTS).then((stored) => {
  settings = stored;
  consented = stored.consented;
  show();
});
$("autoStart").addEventListener("change", async () => {
  if (!consented) {
    // Turned on under the disclosure: the user's consent, and removal on every video.
    consented = true;
    settings.autoStart = true;
    await chrome.storage.sync.set({ consented: true, autoStart: true });
    show();
    $("done").hidden = false;
    return;
  }
  settings.autoStart = $("autoStart").checked;
  chrome.storage.sync.set({ autoStart: settings.autoStart });
});
