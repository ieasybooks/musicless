// PlaybackIntent with the page-world bridge (intent.js), against a media
// element stand-in that queues events like a browser. Ported from the main
// Musicless extension's tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PlaybackIntent } from "../../extension/playback-intent.js";

const BRIDGE = readFileSync(new URL("../../extension/intent.js", import.meta.url), "utf8");

// A fresh element class per test, so each bridge patches its own prototype.
function mediaClass({ bridge = false } = {}) {
  class MediaElement extends EventTarget {
    constructor({ paused = false } = {}) {
      super();
      this.paused = paused;
      this.ended = false;
      this.dataset = {};
      this.playCalls = 0;
      this.pauseCalls = 0;
    }
    play() {
      this.playCalls++;
      if (this.paused) {
        this.paused = false;
        queueMicrotask(() => this.dispatchEvent(new Event("play")));
      }
      return Promise.resolve();
    }
    pause() {
      this.pauseCalls++;
      // Like a browser: pausing a paused element fires no event.
      if (!this.paused) {
        this.paused = true;
        queueMicrotask(() => this.dispatchEvent(new Event("pause")));
      }
    }
  }
  if (bridge) vm.runInNewContext(BRIDGE, { window: {}, HTMLMediaElement: MediaElement, CustomEvent });
  return MediaElement;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("holding an initially paused video never claims a wish to play", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement({ paused: true });
  const changes = [];
  const intent = new PlaybackIntent(video, (playing) => changes.push(playing));
  intent.hold();
  intent.release();
  intent.dispose({ restore: true });
  await flush();
  assert.equal(video.paused, true);
  assert.equal(video.playCalls, 0);
  assert.deepEqual(changes, []);
});

test("a page pause during a hold cancels the automatic resume", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement();
  const changes = [];
  const intent = new PlaybackIntent(video, (playing) => changes.push(playing));
  intent.hold();
  video.pause(); // already paused by the hold: only the bridge sees this
  intent.release();
  await flush();
  assert.equal(intent.wantsPlay, false);
  assert.equal(video.paused, true);
  assert.equal(video.playCalls, 0);
  assert.deepEqual(changes, [false]);
  intent.dispose();
});

test("play during a startup hold records the wish but waits for release", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement({ paused: true });
  const changes = [];
  const intent = new PlaybackIntent(video, (playing) => changes.push(playing));
  intent.hold();
  await video.play();
  await flush();
  assert.equal(intent.wantsPlay, true);
  assert.equal(video.paused, true, "the hold paused it again");
  intent.release();
  await flush();
  assert.equal(video.paused, false);
  assert.deepEqual(changes, [true]);
  intent.dispose();
});

test("our own pause and play do not count as the user's", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement();
  const changes = [];
  const intent = new PlaybackIntent(video, (playing) => changes.push(playing));
  intent.hold();
  intent.release(); // both native events are still queued
  await flush();
  assert.equal(video.paused, false);
  assert.equal(intent.wantsPlay, true);
  assert.deepEqual(changes, []);
  intent.dispose();
});

test("native controls keep working without the bridge", async () => {
  const MediaElement = mediaClass();
  const video = new MediaElement();
  const intent = new PlaybackIntent(video);
  video.pause();
  await flush();
  assert.equal(intent.wantsPlay, false);
  intent.hold();
  await video.play();
  await flush();
  assert.equal(intent.wantsPlay, true);
  assert.equal(video.paused, true);
  intent.dispose({ restore: true });
  await flush();
  assert.equal(video.paused, false, "disposing with restore resumes a held video the user wanted playing");
});

test("a hold puts back the attribute the page bridge needs", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement();
  const intent = new PlaybackIntent(video);
  delete video.dataset.musiclessPlaybackTrack; // a page script removed it
  intent.hold();
  assert.equal(video.dataset.musiclessPlaybackTrack, "1");
  video.pause(); // the user pauses during the hold: still reported
  intent.release();
  await flush();
  assert.equal(intent.wantsPlay, false);
  assert.equal(video.paused, true);
  intent.dispose();
});

test("a hold the user wants played is marked on the video, and the next copy carries it on", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement();
  const earlier = new PlaybackIntent(video);
  earlier.hold();
  await flush();
  assert.equal(video.dataset.musiclessPlaybackHeld, "1");
  earlier.disposed = true; // Firefox stops that copy mid-hold, without a word to it
  const later = new PlaybackIntent(video);
  assert.equal(later.held, true);
  assert.equal(later.wantsPlay, true);
  later.release();
  await flush();
  assert.equal(video.paused, false, "it plays as the user wanted");
  assert.equal(video.dataset.musiclessPlaybackHeld, undefined);
  later.dispose();
});

test("no mark once the user pauses during a hold, or when the hold ends", async () => {
  const MediaElement = mediaClass({ bridge: true });
  const video = new MediaElement();
  const intent = new PlaybackIntent(video);
  intent.hold();
  video.pause(); // the user's, through the page
  await flush();
  assert.equal(video.dataset.musiclessPlaybackHeld, undefined);
  const later = new PlaybackIntent(video);
  assert.equal(later.wantsPlay, false, "a paused video the next copy finds is the user's");
  intent.dispose();
  later.dispose();
  const other = new MediaElement();
  const held = new PlaybackIntent(other);
  held.hold();
  held.dispose({ restore: true });
  assert.equal(other.dataset.musiclessPlaybackHeld, undefined);
});

test("Safari native silence shadows muted, syncs logical mute, and blocks direct native unmute", () => {
  const docListeners = {};
  const document = {
    addEventListener(type, fn) { (docListeners[type] ??= []).push(fn); },
  };
  let nativeMutedValue = false;
  const volumeChanges = [];
  class SafariMediaElement extends EventTarget {
    constructor() {
      super();
      this.paused = false;
      this.dataset = {};
    }
    play() { return Promise.resolve(); }
    pause() {}
    get muted() { return nativeMutedValue; }
    set muted(value) { nativeMutedValue = Boolean(value); }
  }
  vm.runInNewContext(BRIDGE, {
    window: {}, document, HTMLMediaElement: SafariMediaElement, CustomEvent, Event,
  });
  const video = new SafariMediaElement();
  video.addEventListener("volumechange", () => volumeChanges.push(video.muted));
  const fireDoc = (type) => { for (const fn of docListeners[type] ?? []) fn({ target: video }); };

  // Turn native silence ON while user is unmuted.
  video.dataset.musiclessNativeSilence = "1";
  fireDoc("musicless:native-silence");
  assert.equal(nativeMutedValue, true, "native audio is silenced");
  assert.equal(video.muted, false, "page still sees logical unmuted state");
  assert.equal(video.dataset.musiclessUserMuted, "0");

  // User clicks mute in YouTube UI while silenced.
  video.muted = true;
  assert.equal(nativeMutedValue, true, "native audio stays silenced");
  assert.equal(video.muted, true);
  assert.equal(video.dataset.musiclessUserMuted, "1");
  assert.deepEqual(volumeChanges, [true], "synthetic volumechange notifies listeners");

  // User unmutes in YouTube UI while silenced.
  video.muted = false;
  assert.equal(nativeMutedValue, true);
  assert.equal(video.muted, false);
  assert.equal(video.dataset.musiclessUserMuted, "0");
  assert.deepEqual(volumeChanges, [true, false]);

  // iOS native fullscreen speaker button flips native muted directly and fires volumechange.
  nativeMutedValue = false;
  fireDoc("volumechange");
  assert.equal(nativeMutedValue, true, "native mute is immediately re-asserted");
  assert.equal(video.muted, false, "logical user state is preserved");

  // Turn native silence OFF: restores logical unmuted state.
  delete video.dataset.musiclessNativeSilence;
  fireDoc("musicless:native-silence");
  assert.equal(nativeMutedValue, false);
  assert.equal(video.dataset.musiclessUserMuted, undefined);

  // If user muted while silenced and then Musicless turns off, stays muted.
  video.dataset.musiclessNativeSilence = "1";
  fireDoc("musicless:native-silence");
  video.muted = true;
  delete video.dataset.musiclessNativeSilence;
  fireDoc("musicless:native-silence");
  assert.equal(nativeMutedValue, true, "user mute preference is kept on restore");
});
