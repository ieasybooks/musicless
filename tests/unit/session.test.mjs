// Session's lifecycle against stand-ins for the video element, Web Audio, the
// capture bus and the engine, on a clock the test moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as grid from "../../extension/grid.js";
import { PlaybackIntent } from "../../extension/playback-intent.js";
import { flush, load } from "./sandbox.mjs";

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

export function sessionSandbox({ video: props, settings = {}, streams = { "blob:a": 1 }, stretch = async (channels) => ({ channels }) } = {}) {
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
    importStretch: async () => ({ StretchClient: class { stretch(...args) { return stretch(...args); } } }),
  };
  const { Session } = load("session.js", env, {
    rewrite: (source) => source.replace('import(chrome.runtime.getURL("stretch.js"))', "importStretch()"),
  });
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
    ids: 0,
    attach(session) { this.sessions.set(++this.ids, session); return this.ids; },
    detach(streamId) { this.sessions.delete(streamId); },
    post(message) { this.posts.push(message); },
    wants() { return this.posts.filter((message) => message.type === "want"); },
    // A message from the worker, routed like the engine does.
    deliver(message) { this.sessions.get(message.streamId)?.onEngine(message); },
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

test("a seek inside the chunk still being made asks for it from the new position", () => {
  const { session, video, engine } = sessionSandbox(); // playing at 8 s, chunk 0 not made yet
  assert.equal(engine.wants().at(-1).chunks[0].from, 7.75);
  video.currentTime = 10;
  video.dispatchEvent(new Event("seeking"));
  session.tick();
  const want = engine.wants().at(-1);
  assert.equal(want.chunks[0].k, 0);
  assert.equal(want.chunks[0].from, 9.75);
});

test("a new source gets a fresh hold deadline", () => {
  const { session, video, capture, advance } = sessionSandbox();
  assert.equal(session.intent.held, true, "held for the first chunk");
  advance(29500);
  session.tick();
  capture.urls.set("blob:b", 3);
  video.currentSrc = video.src = "blob:b";
  session.checkSource();
  advance(1000);
  session.tick();
  assert.equal(session.failure, null, "B is not failed for A's wait");
  advance(30000);
  session.tick();
  assert.equal(session.failure?.reason, "slow");
});

test("a changed duration is passed on to the worker", () => {
  const { session, video, engine } = sessionSandbox({ video: { duration: Infinity } });
  const before = engine.wants().length;
  session.tick();
  assert.equal(engine.wants().length, before, "nothing new to ask");
  video.duration = 500;
  session.tick();
  assert.equal(engine.wants().at(-1).duration, 500);
});

test("a lost engine is joined again once, then the session fails closed", () => {
  const { session, engine, capture } = sessionSandbox();
  assert.equal(session.attached, true);
  engine.sessions.clear();
  session.onEngineLost();
  assert.equal(session.attached, true, "attached to a new engine");
  assert.equal(engine.sessions.get(session.workerId), session);
  assert.equal(capture.subscribed.get(1), session, "subscribed again, so the new worker gets the audio");
  assert.equal(session.failure, null);
  engine.sessions.clear();
  session.onEngineLost();
  assert.equal(session.failure?.reason, "engine");
  assert.equal(session.intent.held, true);
});

test("after Retry, a late error or chunk for the earlier attachment does not reach the session", () => {
  const { session, engine, advance } = sessionSandbox();
  const first = session.workerId;
  advance(31000);
  session.tick();
  assert.equal(session.failure?.reason, "slow");
  session.retry();
  assert.equal(session.failure, null);
  assert.notEqual(session.workerId, first, "the same captured stream gets a new worker id");
  engine.deliver({ type: "error", streamId: first, message: "Separation failed: the earlier job" });
  engine.deliver({ ...chunk(0), streamId: first });
  assert.equal(session.failure, null);
  assert.equal(session.chunks.size, 0);
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  assert.equal(session.chunks.size, 1);
});

test("a failed speed change fails closed, unless the chunk was replaced since", async () => {
  const pending = [];
  const { session, engine } = sessionSandbox({ stretch: () => new Promise((resolve, reject) => pending.push(reject)) });
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  session.stretch(0, 1.5);
  await flush();
  engine.deliver({ ...chunk(0), streamId: session.workerId }); // made again meanwhile (after a seek, say)
  pending.shift()(new Error("stretch failed"));
  await flush();
  assert.equal(session.failure, null);
  session.stretch(0, 1.5);
  await flush();
  pending.shift()(new Error("stretch failed"));
  await flush();
  assert.equal(session.failure?.reason, "error");
});
