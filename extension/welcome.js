// First-run page: the disclosure and the one choice that turns Musicless on,
// then what to expect, where the control is, and the one thing left to do.
import { localizePage, localizeWithGlyph, t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
localizePage();
const brand = document.querySelector(".brand");
let currentConsent = null;
function hint(on) {
  $("step1Title").textContent = t(on ? "done_step1_title" : "done_step1_off_title");
  $("step3Title").textContent = t(on ? "done_step3_title" : "done_step3_off_title");
  if (on) {
    $("step1Text").textContent = t("done_step1_text");
    localizeWithGlyph($("step3Text"), "done_step3_text", { on: true });
  } else {
    localizeWithGlyph($("step1Text"), "done_step1_off_text");
    $("step3Text").textContent = t("done_step3_off_text");
  }
}

function show(consented) {
  if (consented === currentConsent) return;
  const celebrate = currentConsent === false && consented;
  currentConsent = consented;
  brand.classList.toggle("intact", !consented);
  brand.removeAttribute("hidden"); // SVG has no reflecting .hidden property
  $("setup").classList.toggle("off", consented);
  $("done").classList.toggle("off", !consented);
  document.querySelector("main").classList.toggle("celebrate", celebrate);
  if (celebrate) $("doneHeading").focus();
}

chrome.storage.sync.get({ consented: false, autoStart: true }).then(({ consented, autoStart }) => {
  hint(autoStart);
  show(consented);
});
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  show(true);
});

// Opened from a video's button: return to its tab and ask that same document
// to reload where it was. A different page later in the tab must be left alone.
let videoTab = null;
function offerBack(tab) {
  videoTab = Number.isInteger(tab?.id) && Number.isInteger(tab.frameId) && typeof tab.documentId === "string" ? tab : null;
  $("back").hidden = videoTab === null;
  $("open").hidden = videoTab !== null;
  $("doneText").hidden = videoTab !== null; // the one tab that matters is reloaded by the button
}
chrome.storage.session.get("videoTab").then(({ videoTab: tab }) => {
  if (Number.isInteger(tab?.id)) chrome.tabs.get(tab.id).then(() => offerBack(tab), () => offerBack(null));
});
// Turned on in the popup meanwhile; or another video's button asked.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "consented" in changes) show(changes.consented.newValue === true);
  if (area === "sync" && "autoStart" in changes) hint(changes.autoStart.newValue !== false);
  if (area === "session" && "videoTab" in changes) offerBack(changes.videoTab.newValue);
});
$("back").addEventListener("click", async () => {
  const target = videoTab;
  chrome.storage.session.remove("videoTab");
  try {
    const tab = await chrome.tabs.update(target.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    // Both IDs matter: a document alone can still be in the Back/Forward cache.
    // Ask only if it is still the active document in the original frame.
    await chrome.tabs.sendMessage(target.id, { type: "reload" }, {
      frameId: target.frameId, documentId: target.documentId,
    }).catch(() => {});
  } catch {
    location.href = $("open").href; // the tab is gone: YouTube, here
    return;
  }
  const self = await chrome.tabs.getCurrent();
  if (self) chrome.tabs.remove(self.id);
});
