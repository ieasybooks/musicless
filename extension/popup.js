// Toolbar popup: the disclosure and "Turn on" until the user turns nomusic on,
// then the one setting.
import { localizePage, localizeWithGlyph, t } from "./i18n.js";
import { DEFAULTS } from "./settings.js";

const $ = (id) => document.getElementById(id);
localizePage();
localizeWithGlyph($("oneVideo"), "popup_one_video");
$("help").href = t("link_help_url");

function show(consented) {
  $("consent").hidden = consented;
  $("settings").hidden = !consented;
}

// While removal is not automatic, one line says how to remove the music from
// one video; the switch is described by it only while it shows.
function hint() {
  const off = !$("autoStart").checked;
  $("oneVideo").hidden = !off;
  if (off) $("autoStart").setAttribute("aria-describedby", "oneVideo");
  else $("autoStart").removeAttribute("aria-describedby");
}

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
