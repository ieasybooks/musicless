// Opens the welcome page: once on install, and when the "Set up nomusic"
// button on a video asks for it (focusing the page if it is already open).
// Tabs that were open before need a reload before nomusic can work in them.
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "open-welcome") openWelcome();
});
