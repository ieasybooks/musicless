// First-run page: the disclosure and the one choice that turns nomusic on,
// then what to expect, where the control is, and the one thing left to do.
import { localizePage, localizeWithGlyph } from "./i18n.js";

const $ = (id) => document.getElementById(id);
localizePage();
localizeWithGlyph($("doneControl"), "done_control", { on: true });

function show(consented) {
  $("setup").classList.toggle("off", consented);
  $("done").classList.toggle("off", !consented);
}

chrome.storage.sync.get({ consented: false }).then(({ consented }) => show(consented));
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  show(true);
  $("doneHeading").focus();
});

// Opened from a video's button (background.js keeps its tab): the way back to
// that video ends the page, reloaded where it was, since its sound went by
// before nomusic was on. It needs no permission: the tab is known by its id.
let videoTab = null;
function offerBack(id) {
  videoTab = Number.isInteger(id) ? id : null;
  $("back").hidden = videoTab === null;
  $("open").hidden = videoTab !== null;
  $("doneText").hidden = videoTab !== null; // the one tab that matters is reloaded by the button
}
chrome.storage.session.get("videoTab").then(({ videoTab: id }) => {
  if (Number.isInteger(id)) chrome.tabs.get(id).then(() => offerBack(id), () => offerBack(null));
});
// Turned on in the popup meanwhile; or another video's button asked.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "consented" in changes) show(changes.consented.newValue === true);
  if (area === "session" && "videoTab" in changes) offerBack(changes.videoTab.newValue);
});
$("back").addEventListener("click", async () => {
  const id = videoTab;
  chrome.storage.session.remove("videoTab");
  try {
    const tab = await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    // Its own page reloads it where the video was; a page nomusic no longer
    // runs in (an update) is reloaded from here.
    await chrome.tabs.sendMessage(id, { type: "reload" }).catch(() => chrome.tabs.reload(id));
  } catch {
    location.href = $("open").href; // the tab is gone: YouTube, here
    return;
  }
  const self = await chrome.tabs.getCurrent();
  if (self) chrome.tabs.remove(self.id);
});
