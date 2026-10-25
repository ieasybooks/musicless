// PlaybackIntent with the page-world bridge (intent.js), against a media
// element stand-in that queues events like a browser. Ported from the main
// nomusic extension's tests.
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
  delete video.dataset.nomusicPlaybackTrack; // a page script removed it
  intent.hold();
  assert.equal(video.dataset.nomusicPlaybackTrack, "1");
  video.pause(); // the user pauses during the hold: still reported
  intent.release();
  await flush();
  assert.equal(intent.wantsPlay, false);
  assert.equal(video.paused, true);
  intent.dispose();
});
