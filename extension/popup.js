// Toolbar popup: the one setting's row, with "Turn on" and the disclosure in
// it until the user turns nomusic on.
import { localizePage } from "./i18n.js";
import { DEFAULTS } from "./settings.js";

localizePage();
const $ = (id) => document.getElementById(id);

// Before: the disclosure, the privacy policy and "Turn on"; after: the
// setting and help.
function show(consented) {
  $("consent").hidden = consented;
  $("settings").hidden = !consented;
}

// The line under the switch says what to do while it is off; while it is on,
// the name says it all.
const hint = () => { $("autoStartHint").hidden = $("autoStart").checked; };

// `consented` stays false until the user turns nomusic on, here or on the first-run page.
chrome.storage.sync.get(DEFAULTS).then((stored) => {
  $("autoStart").checked = stored.autoStart;
  hint();
  show(stored.consented);
});
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  $("done").hidden = false;
  show(true);
  $("autoStart").focus();
});
$("autoStart").addEventListener("change", () => {
  hint();
  chrome.storage.sync.set({ autoStart: $("autoStart").checked });
});
