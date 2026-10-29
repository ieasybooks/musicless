// Session's lifecycle against stand-ins for the video element, Web Audio, the
// capture bus and the engine, on a clock the test moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as grid from "../../extension/grid.js";
import { PlaybackIntent } from "../../extension/playback-intent.js";
import { flush, load, plain } from "./sandbox.mjs";

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

function sessionSandbox({ video: props, settings = {}, streams = { "blob:a": 1 }, stretch = async (channels) => ({ channels }) } = {}) {
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
    routeElement: () => {
      env.routed = (env.routed ?? 0) + 1;
      return graph;
    },
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
    t: (key) => key, // i18n.js: failure messages by key
    importStretch: async () => ({ stretch }),
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
function chunk(k, validFrom = grid.chunkStart(k)) {
  const samples = { length: grid.WINDOW_SAMPLES }; // only its length is read here
  return { type: "chunk", k, validFrom, cut: Infinity, print: 100 + k, left: samples, right: samples, timing: {} };
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

test("a stream that closed and reopened under the same URL while the session slept is found again", async () => {
  const { session, video, capture, engine, advance } = sessionSandbox({ video: { currentTime: 3 } });
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  engine.deliver({ ...chunk(1), streamId: session.workerId });
  session.tick();
  video.pause(); // the user pauses
  await flush();
  session.tick();
  advance(2 * 60 * 1000 + 1000);
  session.tick();
  assert.equal(session.attached, false, "asleep");
  capture.urls.set("blob:a", 7); // stream 1 closed unseen; the player opened 7 under the same URL
  session.checkSource(); // the bus announces it
  video.play();
  await flush();
  assert.equal(session.attached, true);
  session.onCaptureClosed(1); // what capture.js answers to subscribing to the closed stream
  assert.equal(session.streamId, 7);
  assert.equal(session.attached, true);
  assert.equal(capture.subscribed.has(7), true);
  advance(2500);
  session.tick();
  assert.equal(session.failure, null, "not uncaptured");
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

test("a chunk ahead that starts late (made after a seek) is asked for again, and the video holds before it", () => {
  const { session, video, engine } = sessionSandbox({ video: { currentTime: 1 } });
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  engine.deliver({ ...chunk(1, grid.chunkStart(1) + 2), streamId: session.workerId }); // made for a playhead 2 s into it
  session.tick();
  assert.equal(session.chunks.has(1), false, "dropped");
  assert.equal(session.sources.has(1), false, "and not scheduled");
  const want = engine.wants().at(-1);
  assert.deepEqual(plain(want.forget), [1]);
  assert.equal(want.chunks[0].k, 1);
  assert.equal(want.chunks[0].from, grid.chunkStart(1));
  video.currentTime = grid.chunkStart(1) - 0.4;
  session.tick();
  assert.equal(session.intent.held, true, "held before the seam until chunk 1 is whole");
  engine.deliver({ ...chunk(1), streamId: session.workerId });
  session.tick();
  assert.equal(session.intent.held, false);
});

test("a chunk is scheduled from where its audio starts", () => {
  const { session, engine, started } = sessionSandbox({ video: { currentTime: 30 } });
  const k = grid.chunkIndex(30);
  engine.deliver({ ...chunk(k, 30.04), streamId: session.workerId }); // its audio starts 40 ms after the playhead
  session.tick();
  const first = started.at(-1);
  assert.ok(first, "scheduled");
  assert.ok(Math.abs(first.offset - (30.04 - grid.chunkStart(k))) < 1e-6, `from validFrom, offset ${first.offset}`);
  assert.ok(Math.abs(first.when - 0.04) < 1e-6, `at validFrom on the clock, ${first.when}`);
  engine.deliver({ ...chunk(k + 1), streamId: session.workerId });
  session.tick();
  const next = started.at(-1);
  assert.equal(next.offset, 0, "the next chunk from its start");
  assert.ok(Math.abs(next.when - (grid.chunkStart(k + 1) - 30)) < 1e-6);
});

test("chunks whose audio changed are made again, and the video holds instead of playing the old voice", () => {
  const { session, video, engine, started } = sessionSandbox({ video: { currentTime: 3 } });
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  engine.deliver({ ...chunk(1), streamId: session.workerId });
  session.tick();
  assert.equal(session.intent.held, false);
  assert.equal(started.length >= 2, true);
  engine.deliver({ type: "changed", streamId: session.workerId, chunks: [0, 1] });
  assert.equal(session.chunks.size, 0);
  assert.equal(session.intent.held, true);
  assert.equal(video.paused, true);
  const want = engine.wants().at(-1);
  assert.equal(want.chunks.slice(0, 2).map((c) => c.k).join(), "0,1", "asked for again");
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  engine.deliver({ ...chunk(1), streamId: session.workerId });
  session.tick();
  assert.equal(session.intent.held, false);
});

test("the worker is told which chunks the page has, where they were cut and what they were made from", () => {
  const { session, engine } = sessionSandbox({ video: { currentTime: 3 } });
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  engine.deliver({ ...chunk(1), cut: 20, streamId: session.workerId });
  session.tick();
  assert.deepEqual(plain(engine.wants().at(-1).have), [{ k: 0, cut: null, print: 100 }, { k: 1, cut: 20, print: 101 }]); // (Infinity as JSON: null)
});

test("chunks kept from an earlier worker play only once the new one has checked them", () => {
  const { session, video, engine } = sessionSandbox({ video: { currentTime: 3 } });
  engine.deliver({ ...chunk(0), streamId: session.workerId });
  engine.deliver({ ...chunk(1), streamId: session.workerId });
  session.tick();
  assert.equal(session.intent.held, false);
  engine.sessions.clear();
  session.onEngineLost(); // a new worker, which has not seen the audio yet
  session.onEntries(1, [{ kind: "buffer", bufferId: 2, mime: "audio/webm" }], { missed: false }); // the capture's replay
  assert.deepEqual(engine.posts.slice(-2).map((message) => message.type), ["entries", "replayed"]);
  session.tick();
  assert.equal(session.intent.held, true, "held until they are checked");
  assert.equal(video.paused, true);
  assert.deepEqual(plain(engine.wants().at(-1).have.map((h) => h.k)), [0, 1], "the new worker is told of them");
  engine.deliver({ type: "checked", streamId: session.workerId, chunks: [0] });
  engine.deliver({ type: "changed", streamId: session.workerId, chunks: [1] }); // its audio is not the same
  session.tick();
  assert.equal(session.intent.held, false, "chunk 0 plays");
  assert.equal(session.chunks.has(1), false);
  assert.equal(engine.wants().at(-1).chunks[0].k, 1, "chunk 1 is made again");
});

test("Retry reloads the page for failures only a reload can help, keeping a watch page's position", () => {
  const watch = sessionSandbox({ video: { currentTime: 75.6 } });
  watch.session.fail("uncaptured");
  assert.equal(watch.session.retryReloads, true, "what the button says");
  watch.session.retry();
  assert.deepEqual(watch.reloads, ["https://www.youtube.com/watch?v=abc&t=75s"]);
  const embed = sessionSandbox();
  embed.env.location.pathname = "/embed/abc";
  embed.session.fail("engine");
  embed.session.retry();
  assert.deepEqual(embed.reloads, ["reload"]);
  const slow = sessionSandbox();
  slow.session.fail("slow");
  assert.equal(slow.session.retryReloads, false);
  slow.session.retry();
  assert.deepEqual(slow.reloads, [], "other failures try again in place");
  assert.equal(slow.session.failure, null);
});


test("before consent a session shows setup and leaves the video alone", () => {
  const { session, video, engine, capture, env } = sessionSandbox({ settings: { consented: false } });
  assert.equal(session.status, "setup");
  assert.equal(env.routed ?? 0, 0, "its audio is not routed");
  assert.equal(session.attached, false);
  assert.equal(engine.sessions.size, 0);
  assert.equal(capture.subscribed.size, 0);
  assert.equal(session.intent.held, false);
  assert.equal(video.paused, false);
  video.dispatchEvent(new Event("encrypted"));
  session.toggle();
  assert.equal(session.failure, null);
  assert.equal(session.status, "setup");
});

test("consenting starts the session; withdrawing it stops and gives the original back", () => {
  const { session, env, graph } = sessionSandbox({ settings: { consented: false } });
  env.settings.consented = true;
  session.consentChanged();
  assert.equal(session.attached, true);
  assert.equal(graph.original.gain.value, 0);
  assert.equal(session.status, "starting");
  env.settings.consented = false;
  session.consentChanged();
  assert.equal(session.attached, false);
  assert.equal(graph.original.gain.value, 1);
  assert.equal(session.intent.held, false);
  assert.equal(session.status, "setup");
});

test("a stream whose audio went by before consent holds the video and asks for a reload", () => {
  const { session } = sessionSandbox();
  session.onEntries(1, [{ kind: "buffer", bufferId: 2, mime: "audio/webm" }], { missed: true });
  assert.equal(session.failure?.reason, "missed");
  assert.equal(session.failure.message, "failure_missed");
  assert.equal(session.retryReloads, true, "the dialog's main action reloads the page");
  assert.equal(session.intent.held, true);
});

test("while the browser keeps the sound from playing, the video is held (not failed) until it can", () => {
  for (const state of ["suspended", "interrupted"]) {
    const { session, video, engine, ctx, advance } = sessionSandbox({ video: { currentTime: 3 } });
    engine.deliver({ ...chunk(0), streamId: session.workerId });
    engine.deliver({ ...chunk(1), streamId: session.workerId });
    session.tick();
    assert.equal(session.intent.held, false);
    ctx.state = state; // no click yet, or another app took the audio device
    session.tick();
    assert.equal(session.intent.held, true, state);
    assert.equal(video.paused, true);
    assert.equal(session.status, "blocked");
    advance(40000);
    session.tick();
    assert.equal(session.failure, null, "waiting for a click is not too slow");
    ctx.state = "running";
    session.tick();
    assert.equal(session.intent.held, false);
    assert.equal(session.status, "on");
  }
});

test("if the sound still cannot start shortly after a click, the session fails closed with a way out", () => {
  const blocked = () => {
    const env = sessionSandbox({ video: { currentTime: 3 } });
    env.engine.deliver({ ...chunk(0), streamId: env.session.workerId });
    env.engine.deliver({ ...chunk(1), streamId: env.session.workerId });
    env.ctx.state = "interrupted";
    env.session.tick();
    assert.equal(env.session.status, "blocked");
    env.session.toggle(); // "Click to start the sound"
    return env;
  };
  const stuck = blocked(); // the context does not start
  stuck.advance(2000);
  stuck.session.tick();
  assert.equal(stuck.session.failure, null, "it gets a moment");
  stuck.advance(1500);
  stuck.session.tick();
  assert.equal(stuck.session.failure?.reason, "audio");
  assert.equal(stuck.session.status, "failed");
  assert.equal(stuck.session.retryReloads, true, "only a new page gets a new audio context");
  assert.equal(stuck.session.intent.held, true, "still silent and paused until the user chooses");
  const started = blocked(); // the click lets it play
  started.ctx.state = "running";
  started.advance(4000);
  started.session.tick();
  assert.equal(started.session.failure, null);
  assert.equal(started.session.status, "on");
});

for (const autoStart of [true, false]) {
  test(`a player override resets to default ${autoStart} for the next video`, () => {
    const { session, video, capture, graph } = sessionSandbox({ settings: { autoStart } });
    assert.equal(session.on, autoStart);
    session.toggle();
    assert.equal(session.on, !autoStart);
    capture.urls.set("blob:b", 3);
    video.currentSrc = video.src = "blob:b";
    session.checkSource();
    assert.equal(session.on, autoStart);
    assert.equal(graph.original.gain.value, autoStart ? 0 : 1);
    if (!autoStart) {
      assert.equal(session.intent.held, false, "the previous video's processing hold is released");
      assert.equal(session.attached, false);
    }
  });

  test(`changing default to ${!autoStart} leaves this video alone and applies to the next`, () => {
    const { session, video, capture, env } = sessionSandbox({ settings: { autoStart } });
    env.settings.autoStart = !autoStart;
    session.tick();
    assert.equal(session.on, autoStart);
    capture.urls.set("blob:b", 3);
    video.currentSrc = video.src = "blob:b";
    session.checkSource();
    assert.equal(session.on, !autoStart);
  });
}
