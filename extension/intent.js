// Runs in the page's own JavaScript world at document_start, next to
// capture.js. While Musicless holds a video paused for audio that is not ready,
// the page's own play()/pause() calls still express what the user wants
// (pause() on an already paused video fires no event), so they are reported
// to the content script as musicless:playback-intent events.

(() => {
  if (window.__musiclessIntent) return;
  window.__musiclessIntent = true;
  const proto = HTMLMediaElement.prototype;
  for (const method of ["play", "pause"]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, method);
    const original = descriptor.value;
    Object.defineProperty(proto, method, {
      ...descriptor,
      value(...args) {
        const result = original.apply(this, args);
        if (this.dataset?.musiclessPlaybackTrack === "1" && this.dataset.musiclessPlaybackInternal !== "1") {
          this.dispatchEvent(new CustomEvent("musicless:playback-intent", { detail: { playing: method === "play" } }));
        }
        return result;
      },
    });
  }
})();
