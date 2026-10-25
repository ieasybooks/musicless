// nomusic content script (isolated world). Manifest V3 content scripts cannot
// be ES modules, so this file only bootstraps the module graph: main.js and its
// imports run in the content-script world, with access to chrome.* and the
// page's DOM but not to the page's JavaScript.

(() => {
  if (window.__nomusicLoaded) return;
  window.__nomusicLoaded = true;
  // Until it hears that the user turned nomusic on, the page-world capture
  // keeps no audio. Tell it the stored answer as soon as storage has it, before
  // the player's first audio; main.js says it again once loaded, and keeps
  // saying it.
  chrome.storage.sync.get({ consented: false }).then(({ consented }) => {
    window.postMessage({ nomusic: "control", type: "consent", consented: consented === true }, "*");
  }, () => {});
  import(chrome.runtime.getURL("main.js")).catch((error) => console.error("[nomusic] failed to load", error));
})();
