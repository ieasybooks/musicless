// First-run page: the disclosure and the one choice that turns nomusic on,
// then what to expect, where the control is, and the one thing left to do.
import { localizePage, localizeWithGlyph } from "./i18n.js";

localizePage();
localizeWithGlyph(document.getElementById("doneControl"), "done_control", { on: true });
const $ = (id) => document.getElementById(id);

function show(consented) {
  $("setup").classList.toggle("off", consented);
  $("done").classList.toggle("off", !consented);
}

chrome.storage.sync.get({ consented: false }).then(({ consented }) => show(consented));
// Turned on in the popup meanwhile.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "consented" in changes) show(changes.consented.newValue === true);
});
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  show(true);
  $("doneHeading").focus();
});
