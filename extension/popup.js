// Toolbar popup: one-time consent, then the default for new videos.
import { localizePage, localizeWithGlyph, t } from "./i18n.js";
import { DEFAULTS } from "./settings.js";

const $ = (id) => document.getElementById(id);
localizePage();
$("help").href = t("link_help_url");

// The logo in the catalog's language: Arabic has its own, with «بلا موسيقى».
const logo = document.querySelector(".popup-header img");
if (document.documentElement.lang === "ar") {
  document.querySelector(".popup-header source").srcset = "icons/musicless-logo-ar-paper.svg";
  logo.src = "icons/musicless-logo-ar-ink.svg";
}
logo.alt = t("extension_name");

function show(consented) {
  $("consent").hidden = consented;
  $("settings").hidden = !consented;
}

// The switch sets the default for new videos. The player button changes one video.
function hint() {
  const on = $("autoStart").checked;
  localizeWithGlyph($("oneVideo"), on ? "popup_default_on" : "popup_one_video", { on });
  $("autoStart").setAttribute("aria-describedby", "oneVideo");
}

// `consented` stays false until the user turns Musicless on, here or on the first-run page.
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
