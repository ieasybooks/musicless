// nomusic content script (isolated world). Manifest V3 content scripts cannot
// be ES modules, so this file only bootstraps the module graph: main.js and its
// imports run in the content-script world, with access to chrome.* and the
// page's DOM but not to the page's JavaScript.

(() => {
  if (window.__nomusicLoaded) return;
  window.__nomusicLoaded = true;
  import(chrome.runtime.getURL("main.js")).catch((error) => console.error("[nomusic] failed to load", error));
})();
