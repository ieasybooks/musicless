// Toolbar popup: the disclosure until the user turns nomusic on, then the one
// setting.
import { localizePage } from "./i18n.js";
import { DEFAULTS } from "./settings.js";

localizePage();
const $ = (id) => document.getElementById(id);

// Before: the disclosure, the privacy policy and "Turn on"; after: the
// setting and help.
function show(consented) {
  for (const id of ["consent", "privacy", "accept"]) $(id).hidden = consented;
  for (const id of ["settings", "help"]) $(id).hidden = !consented;
}

// `consented` stays false until the user turns nomusic on, here or on the first-run page.
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
