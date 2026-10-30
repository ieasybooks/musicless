// Musicless content script (isolated world). Manifest V3 content scripts cannot
// be ES modules, so tools/build-content.mjs bundles this entry and its imports
// into content.bundle.js. Everything runs in the content-script world, with
// access to chrome.* and the page's DOM but not to the page's JavaScript.

(() => {
  if (window.__musiclessLoaded) return;
  window.__musiclessLoaded = true;
  // Until it hears that the user turned Musicless on, the page-world capture
  // keeps no audio. Tell it the stored answer as soon as storage has it, before
  // the player's first audio; main.js says it again once loaded, and keeps
  // saying it.
  chrome.storage.sync.get({ consented: false }).then(({ consented }) => {
    window.postMessage({ musicless: "control", type: "consent", consented: consented === true }, "*");
  }, () => {});
  import("./main.js").catch((error) => console.error("[musicless] failed to load", error));
})();
