// Runs in the page's own JavaScript world at document_start, next to
// capture.js. While Musicless holds a video paused for audio that is not ready,
// the page's own play()/pause() calls still express what the user wants
// (pause() on an already paused video fires no event), so they are reported
// to the content script as musicless:playback-intent events.
//
// In Safari, WebKit ignores AudioContext.createMediaElementSource() on
// MediaSource / ManagedMediaSource videos, so audio.js silences the element by
// setting dataset.musiclessNativeSilence and dispatching musicless:native-silence.
// While silenced, this script keeps native muted = true while presenting the
// user's logical muted state to the page and mirroring it to
// dataset.musiclessUserMuted for the content script.

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

  const nativeMuted = Object.getOwnPropertyDescriptor(proto, "muted");
  if (nativeMuted?.get && nativeMuted.set) {
    const silence = new WeakMap(); // video -> { silent, userMuted }

    function applySilence(video) {
      if (!(video instanceof HTMLMediaElement)) return;
      const wantSilent = video.dataset?.musiclessNativeSilence === "1";
      let entry = silence.get(video);
      if (!entry) {
        entry = { silent: false, userMuted: !!nativeMuted.get.call(video) };
        silence.set(video, entry);
      }
      if (wantSilent === entry.silent) {
        if (wantSilent && !nativeMuted.get.call(video)) nativeMuted.set.call(video, true);
        return;
      }
      if (wantSilent) {
        entry.userMuted = !!nativeMuted.get.call(video);
        entry.silent = true;
        if (video.dataset) video.dataset.musiclessUserMuted = entry.userMuted ? "1" : "0";
        if (!nativeMuted.get.call(video)) nativeMuted.set.call(video, true);
      } else {
        entry.silent = false;
        if (video.dataset) delete video.dataset.musiclessUserMuted;
        if (!!nativeMuted.get.call(video) !== entry.userMuted) nativeMuted.set.call(video, entry.userMuted);
      }
    }

    Object.defineProperty(proto, "muted", {
      ...nativeMuted,
      get() {
        const entry = silence.get(this);
        return entry?.silent ? entry.userMuted : nativeMuted.get.call(this);
      },
      set(value) {
        const next = Boolean(value);
        const entry = silence.get(this);
        if (!entry?.silent) return nativeMuted.set.call(this, next);
        const changed = entry.userMuted !== next;
        entry.userMuted = next;
        if (this.dataset) this.dataset.musiclessUserMuted = next ? "1" : "0";
        if (!nativeMuted.get.call(this)) nativeMuted.set.call(this, true);
        if (changed) this.dispatchEvent(new Event("volumechange"));
      },
    });

    if (typeof document !== "undefined") {
      document.addEventListener("musicless:native-silence", (event) => applySilence(event.target), true);
      // iOS native fullscreen's speaker toggle can flip native muted directly,
      // bypassing the JS setter. Re-assert native mute immediately so original
      // music never leaks over separated vocals.
      document.addEventListener("volumechange", (event) => {
        const video = event.target;
        const entry = silence.get(video);
        if (entry?.silent && !nativeMuted.get.call(video)) nativeMuted.set.call(video, true);
      }, true);
    }
  }
})();
