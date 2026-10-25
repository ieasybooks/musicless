// Session's lifecycle against stand-ins for the video element, Web Audio, the
// capture bus and the engine, on a clock the test moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as grid from "../../extension/grid.js";
import { PlaybackIntent } from "../../extension/playback-intent.js";
import { load } from "./sandbox.mjs";

class Video extends EventTarget {
  constructor(props = {}) {
    super();
    Object.assign(this, {
      currentSrc: "blob:a", src: "blob:a", srcObject: null, currentTime: 8, duration: 200, paused: false, ended: false,
      seeking: false, readyState: 4, volume: 1, muted: false, playbackRate: 1, preservesPitch: true, dataset: {},
    }, props);
  }
  // Like a browser, the events come after the call returns.
  pause() {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event("pause")));
  }
  play() {
    if (this.paused) {
      this.paused = false;
      queueMicrotask(() => this.dispatchEvent(new Event("play")));
    }
    return Promise.resolve();
  }
}

export function sessionSandbox({ video: props, settings = {}, streams = { "blob:a": 1 } } = {}) {
  let now = 1000;
  const param = () => ({ value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const started = [];
  const ctx = {
    currentTime: 0, state: "running", sampleRate: 48000,
    createBuffer: (channels, length, rate) => ({ duration: length / rate, length, sampleRate: rate, copyToChannel() {}, getChannelData: () => new Float32Array(length) }),
    createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
    createBufferSource: () => {
      const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {}, start: (when, offset) => started.push({ source, when, offset }) };
      return source;
    },
  };
  const graph = { ctx, original: { gain: param() }, output: { gain: param() }, element: {} };
  const reloads = [];
  const env = {
    ...grid, PlaybackIntent,
    settings: { autoStart: true, consented: true, ...settings },
    resumeAudio() {},
    routeElement: () => graph,
    performance: { now: () => now },
    chrome: { runtime: { id: "test", getManifest: () => ({}), getURL: (file) => file } },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    location: {
      hostname: "www.youtube.com", pathname: "/watch", href: "https://www.youtube.com/watch?v=abc",
      reload: () => reloads.push("reload"), replace: (url) => reloads.push(String(url)),
    },
    URL,
  };
  const { Session } = load("session.js", env);
  const capture = {
    urls: new Map(Object.entries(streams)),
    subscribed: new Map(),
    watch() {},
    unwatch() {},
    streamFor(url) { return this.urls.get(url) ?? null; },
    subscribe(streamId, session) { this.subscribed.set(streamId, session); },
    unsubscribe(streamId) { this.subscribed.delete(streamId); },
  };
  const engine = {
    sessions: new Map(),
    posts: [],
    model: null,
    attach(streamId, session) { this.sessions.set(streamId, session); },
    detach(streamId) { this.sessions.delete(streamId); },
    post(message) { this.posts.push(message); },
    wants() { return this.posts.filter((message) => message.type === "want"); },
  };
  const video = new Video(props);
  const session = new Session(video, { capture, engine });
  return {
    session, video, capture, engine, ctx, graph, env, started, reloads,
    advance(ms) { now += ms; },
  };
}

// A separated chunk as the worker sends it.
export function chunk(k, validFrom = grid.chunkStart(k)) {
  return { type: "chunk", k, validFrom, left: new Float32Array(16), right: new Float32Array(16), timing: {} };
}

test("a closed stream for the source still playing holds the video, then fails closed", () => {
  const { session, capture, advance } = sessionSandbox();
  assert.equal(session.attached, true);
  capture.urls.delete("blob:a");
  session.onCaptureClosed(1);
  assert.equal(session.streamId, null);
  assert.equal(session.intent.held, true, "held rather than playing on in silence");
  assert.equal(session.status, "starting");
  advance(2500);
  session.tick();
  assert.equal(session.failure?.reason, "uncaptured");
  assert.equal(session.intent.held, true);
});

test("a stream that reopens under the same URL is attached again", () => {
  const { session, capture, advance } = sessionSandbox();
  capture.urls.delete("blob:a");
  session.onCaptureClosed(1);
  capture.urls.set("blob:a", 7);
  session.checkSource(); // the bus tells every session about a new stream
  assert.equal(session.streamId, 7);
  assert.equal(session.attached, true);
  advance(2500);
  session.tick();
  assert.equal(session.failure, null);
});

test("a closed stream that is not the session's changes nothing", () => {
  const { session } = sessionSandbox();
  session.onCaptureClosed(99);
  assert.equal(session.streamId, 1);
  assert.equal(session.attached, true);
});
