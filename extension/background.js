// Opens the welcome page: once on install, and when the button on a video asks
// for it before the first run ("Turn on Musicless"), focusing the page if it is
// already open. The tab and document that asked are kept for "Back to the video".
// Tabs that were open before need a reload before Musicless can work in them.
async function openWelcome() {
  const url = chrome.runtime.getURL("welcome.html");
  const [tab] = await chrome.tabs.query({ url });
  if (!tab) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) openWelcome();
});

// The hidden frame's secret (see engine.js), made here and nowhere else.
// Requests are answered one at a time, so tabs that start together all get
// the one that is stored; a stored one is never replaced.
let tokens = Promise.resolve();
function engineToken() {
  const next = tokens.then(async () => {
    const { engineToken } = await chrome.storage.local.get("engineToken");
    if (engineToken) return engineToken;
    const token = crypto.randomUUID();
    await chrome.storage.local.set({ engineToken: token });
    return token;
  });
  tokens = next.catch(() => {});
  return next;
}

// Only the extension's own scripts can send these (pages cannot reach it).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "open-welcome") {
    const asked = sender.tab ? chrome.storage.session.set({
      videoTab: { id: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId },
    }) : Promise.resolve();
    asked.catch(() => {}).then(openWelcome);
  }
  if (message?.type !== "engine-token") return;
  engineToken().then((token) => sendResponse({ token }), () => sendResponse({}));
  return true; // the answer comes later
});
