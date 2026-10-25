// The tab worker (tab-worker.js) on a clock the test moves, with the real
// demuxer fed from the WebM fixture, and stand-ins for WebCodecs, the signal
// processing, the shared model and the content script's port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configKey, createDemuxer } from "../../extension/demux.js";
import * as grid from "../../extension/grid.js";
import { flush, load } from "./sandbox.mjs";

const WEBM = 'audio/webm; codecs="opus"';
const opus = new Uint8Array(readFileSync(new URL("./fixtures/opus.webm", import.meta.url)));
const starts = [];
for (let i = 0; i + 4 <= opus.length; i++) {
  if (opus[i] === 0x1f && opus[i + 1] === 0x43 && opus[i + 2] === 0xb6 && opus[i + 3] === 0x75) starts.push(i);
}
const INIT = opus.subarray(0, starts[0]);
const CLUSTERS = starts.map((start, i) => opus.subarray(start, starts[i + 1] ?? opus.length));
const fixtureFrames = createDemuxer(WEBM).push(opus);
const PASS_SECONDS = fixtureFrames.at(-1).time + fixtureFrames.at(-1).duration; // the fixture's length, a little over 3 s

class Port {
  constructor() { this.sent = []; this.onmessage = null; }
  postMessage(message) { this.sent.push(message); }
}

export function workerSandbox({ supported = true, localModel = null } = {}) {
  let now = 0;
  const timers = new Set();
  const decoders = [];
  class AudioDecoder {
    static isConfigSupported = async () => ({ supported });
    constructor({ output, error }) {
      this.output = output;
      this.error = error;
      this.state = "unconfigured";
      decoders.push(this);
    }
    configure(config) { this.config = config; this.state = "configured"; }
    decode(chunk) {
      const frames = Math.round((this.config.sampleRate * chunk.duration) / 1e6);
      this.output({
        sampleRate: this.config.sampleRate, numberOfFrames: frames, numberOfChannels: 2, timestamp: chunk.timestamp,
        copyTo(plane) { plane.fill(0.25); }, close() {},
      });
    }
    flush() { return Promise.resolve(); }
    close() { this.state = "closed"; }
  }
  const env = {
    ...grid, createDemuxer, configKey,
    analyze: () => ({ spec: null, magnitude: new Float32Array(8) }),
    resample: (channels, rate, start, toStart, count) => [new Float32Array(count), new Float32Array(count)],
    synthesize: () => ({ left: new Float32Array(grid.WINDOW_SAMPLES), right: new Float32Array(grid.WINDOW_SAMPLES) }),
    AudioDecoder,
    EncodedAudioChunk: class { constructor(init) { Object.assign(this, init); } },
    importModel: async () => ({ createModel: () => localModel }),
    performance: { now: () => now },
    setTimeout: (fn, ms = 0) => { const timer = { fn, at: now + ms }; timers.add(timer); return timer; },
    clearTimeout: (timer) => timers.delete(timer),
    setInterval: (fn, ms) => { const timer = { fn, at: now + ms, every: ms }; timers.add(timer); return timer; },
    clearInterval: (timer) => timers.delete(timer),
    self: {},
  };
  const inside = load("tab-worker.js", env, {
    rewrite: (source) => source.replace('import("./model.js")', "importModel()"),
    expose: ["streams", "addFrames", "invalidate"],
  });
  const content = new Port();
  const modelPort = new Port();
  const w = {
    env, content, modelPort, decoders,
    get now() { return now; },
    start({ shared = true } = {}) {
      env.self.onmessage({ data: { type: "port" }, ports: shared ? [content, modelPort] : [content] });
    },
    fromModel(data) {
      const run = w.runs().find((message) => message.id === data.id);
      if (run) run.answered = true;
      modelPort.onmessage({ data });
    },
    ready() { w.fromModel({ type: "ready", seconds: 1 }); },
    send(data) { content.onmessage({ data }); },
    stream(id) { w.send({ type: "stream", streamId: id }); },
    // Captured audio as capture.js sends it, one entry per message: the fixture
    // over and over from `from` seconds (its clusters and timestamp offsets).
    // `other` makes it different audio at the same times (another audio track).
    feed(id, seconds, { from = 0, bufferId = 2, header = true, other = false } = {}) {
      const entries = header ? [
        { kind: "buffer", bufferId, mime: WEBM },
        { kind: "append", bufferId, bytes: INIT.slice(), offset: 0, segment: "init" },
      ] : [];
      for (let at = from; at < from + seconds; at += PASS_SECONDS) {
        for (const cluster of CLUSTERS) {
          const bytes = cluster.slice();
          if (other) bytes[bytes.length - 1] ^= 0xff; // the last byte of its last frame
          entries.push({ kind: "append", bufferId, bytes, offset: at, segment: "media" });
        }
      }
      for (const entry of entries) w.send({ type: "entries", streamId: id, entries: [entry] });
    },
    want(id, chunks, { playing = true, position = 0, duration = 600, forget = [] } = {}) {
      w.send({ type: "want", streamId: id, chunks, forget, duration, playing, position });
    },
    runs() { return modelPort.sent.filter((message) => message.type === "run"); },
    // Answers the shared model's oldest unanswered run.
    answer(index = 0) {
      const run = w.runs().filter((message) => !message.answered)[index];
      w.fromModel({ type: "result", id: run.id, mask: new Float32Array(8), ms: 1 });
    },
    chunks(id) { return content.sent.filter((message) => message.type === "chunk" && (id === undefined || message.streamId === id)); },
    changed() { return content.sent.filter((message) => message.type === "changed").map((message) => [...message.chunks]); },
    entry(id, entry) { w.send({ type: "entries", streamId: id, entries: [entry] }); },
    held(id) {
      const stream = inside.streams.get(id);
      return { frames: stream.frames.length, bytes: stream.bytes, first: stream.frames[0]?.time, last: stream.frames.at(-1)?.time };
    },
    // Frames straight into a stream, as its demuxer would give them.
    addRaw(id, frames) {
      const stream = inside.streams.get(id);
      const buffer = stream.buffers.get(9) ?? stream.buffers.set(9, { id: 9 }).get(9);
      for (const frame of frames) frame.config = { codec: "opus", sampleRate: 48000, numberOfChannels: 2 };
      const changed = inside.addFrames(stream, buffer, frames);
      if (changed) inside.invalidate(stream, changed);
      w.send({ type: "entries", streamId: id, entries: [] }); // lets the worker look for work
    },
    errors() { return content.sent.filter((message) => message.type === "error"); },
    // Moves the clock, running due timers in order and letting promises settle.
    async advance(ms = 0) {
      const end = now + ms;
      for (;;) {
        await flush();
        const due = [...timers].filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.every) due.at += due.every;
        else timers.delete(due);
        due.fn();
      }
      now = end;
      await flush();
    },
  };
  return w;
}

test("a shared model that stops answering ends the worker with a fatal error", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.want(1, [{ k: 0, from: 0 }]);
  await w.advance();
  assert.equal(w.runs().length, 1, "the chunk went to the shared model");
  await w.advance(20000);
  assert.ok(w.modelPort.sent.some((message) => message.type === "ping"), "a silent model is asked");
  assert.equal(w.errors().length, 0);
  await w.advance(20000);
  const fatal = w.errors().find((message) => message.fatal);
  assert.ok(fatal, "then given up");
  assert.match(fatal.message, /stopped/);
});

test("a shared model that answers its pings is kept", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.want(1, [{ k: 0, from: 0 }]);
  for (let i = 0; i < 12; i++) {
    await w.advance(5000);
    if (w.modelPort.sent.at(-1).type === "ping") w.fromModel({ type: "pong" }); // busy with other tabs' jobs
  }
  assert.equal(w.errors().length, 0);
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 1);
});

test("a model that cannot load ends the worker with a fatal error", async () => {
  const w = workerSandbox({ localModel: { load: async () => { throw new Error("out of memory"); } } });
  w.start();
  w.fromModel({ type: "failed", message: "out of memory" }); // the shared model, then our own copy
  await w.advance();
  const fatal = w.errors().find((message) => message.fatal);
  assert.ok(fatal);
  assert.match(fatal.message, /out of memory/);
});

test("the worker answers the content script's pings", async () => {
  const w = workerSandbox();
  w.start();
  w.send({ type: "ping" });
  assert.equal(w.content.sent.at(-1).type, "pong");
});

test("an error for a stream dropped meanwhile is not sent", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.want(1, [{ k: 0, from: 0 }]);
  await w.advance();
  w.send({ type: "drop", streamId: 1 }); // its session timed out or moved on
  w.fromModel({ type: "error", id: w.runs()[0].id, message: "the old job failed" });
  await w.advance();
  assert.equal(w.errors().length, 0);
});

test("one stream's failure does not stall the others", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  for (const id of [1, 2]) {
    w.stream(id);
    w.feed(id, 15);
    w.want(id, [{ k: 0, from: 0 }]);
  }
  await w.advance();
  assert.equal(w.runs().length, 1);
  w.fromModel({ type: "error", id: w.runs()[0].id, message: "this one failed" });
  await w.advance();
  assert.deepEqual(w.errors().map((message) => message.streamId), [1]);
  assert.equal(w.runs().length, 2, "the other stream's chunk runs");
  w.answer();
  await w.advance();
  assert.deepEqual(w.chunks().map((message) => message.streamId), [2]);
  w.want(1, [{ k: 1, from: grid.chunkStart(1) }]);
  await w.advance();
  assert.equal(w.runs().length, 2, "the failed stream is not tried again");
});

test("the chunk a playing video waits for goes before another video's look-ahead", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1); // has chunk 0 already and asks for the next one
  w.feed(1, 30);
  w.want(1, [{ k: 1, from: grid.chunkStart(1) }], { position: 5 });
  w.stream(2); // waits for the chunk at its playhead
  w.feed(2, 15);
  w.want(2, [{ k: 0, from: 0 }], { position: 0 });
  await w.advance();
  assert.equal(w.runs()[0].priority, 0);
  w.answer();
  await w.advance();
  assert.deepEqual(w.chunks().map((message) => [message.streamId, message.k]), [[2, 0]]);
  assert.equal(w.runs()[1].priority, 1, "then the look-ahead");
});

test("ahead of the playhead a late start counts as part of the window; at the playhead it is kept", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  const start = grid.chunkStart(1);
  // Audio from 0.1 s into chunk 1's window (as after a seek there), to well past it.
  w.stream(1);
  w.feed(1, 15, { from: start + 0.1 });
  w.want(1, [{ k: 1, from: start }], { position: start - 2 });
  await w.advance();
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1)[0].validFrom, start, "look-ahead: valid from the window start");
  w.stream(2);
  w.feed(2, 15, { from: start + 0.1 });
  w.want(2, [{ k: 1, from: start + 0.05 }], { position: start + 0.3 });
  await w.advance();
  w.answer();
  await w.advance();
  assert.ok(Math.abs(w.chunks(2)[0].validFrom - (start + 0.1)) < 0.002, "at the playhead: from where the audio starts");
});

test("audio appended after the end reopens the stream", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.send({ type: "entries", streamId: 1, entries: [{ kind: "end" }] });
  w.feed(1, 3, { from: 15, header: false }); // the player appends again: not the end after all
  w.want(1, [{ k: 1, from: grid.chunkStart(1) }]);
  await w.advance();
  assert.equal(w.runs().length, 0, "chunk 1 waits for its audio instead of ending in silence at 18 s");
  w.feed(1, 9, { from: 18, header: false });
  await w.advance();
  assert.equal(w.runs().length, 1);
});

// A stream with chunk 0 made from 15 s of audio.
async function madeChunk0() {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.want(1, [{ k: 0, from: 0 }]);
  await w.advance();
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 1);
  return w;
}

test("the same audio appended again (after a seek) changes nothing", async () => {
  const w = await madeChunk0();
  w.entry(1, { kind: "abort", bufferId: 2 });
  w.feed(1, 15, { header: false });
  await w.advance();
  assert.deepEqual(w.changed(), []);
  assert.equal(w.runs().length, 1);
});

test("other audio over a made chunk (another audio track) makes it again from the new audio", async () => {
  const w = await madeChunk0();
  w.feed(1, 15, { header: false, other: true });
  await w.advance();
  assert.deepEqual(w.changed(), [[0]]);
  w.want(1, [{ k: 0, from: 0 }]); // the session dropped it and asks again
  await w.advance();
  assert.equal(w.runs().length, 2);
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 2);
});

test("removed audio is not separated again; other audio appended there changes the chunk", async () => {
  const w = await madeChunk0();
  w.entry(1, { kind: "remove", bufferId: 2, start: 0, end: Infinity });
  await w.advance();
  assert.deepEqual(w.changed(), [], "a removal alone changes no chunk (the player frees memory this way)");
  w.want(1, [{ k: 0, from: 0 }], { forget: [0] });
  await w.advance();
  assert.equal(w.runs().length, 1, "no audio left to separate");
  w.feed(1, 15, { header: false, other: true });
  await w.advance();
  assert.equal(w.runs().length, 2, "the new audio is separated");
});

test("a removed buffer's audio is gone", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.entry(1, { kind: "removeBuffer", bufferId: 2 });
  w.want(1, [{ k: 0, from: 0 }]);
  await w.advance();
  assert.equal(w.runs().length, 0);
});

test("a chunk whose audio changes while it is made is not sent, and is made again", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.want(1, [{ k: 0, from: 0 }]);
  await w.advance();
  w.feed(1, 15, { header: false, other: true }); // the player switched tracks meanwhile
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 0, "made from the old audio: dropped");
  assert.equal(w.runs().length, 2, "made again (it is still wanted)");
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 1);
});

test("the last chunk made against an end that was not the end is made again", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.entry(1, { kind: "end" });
  w.want(1, [{ k: 1, from: grid.chunkStart(1) }]);
  await w.advance();
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 1, "made with silence after 15 s");
  w.feed(1, 3, { from: 15, header: false });
  await w.advance();
  assert.deepEqual(w.changed(), [[1]]);
});

test("chunks the page already has are watched for changes too", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.feed(1, 15);
  w.want(1, [{ k: 1, from: grid.chunkStart(1) }], { position: 5 });
  w.send({ type: "want", streamId: 1, chunks: [], forget: [], have: [0], duration: 600, playing: true, position: 5 }); // from before this worker
  await w.advance();
  w.feed(1, 15, { header: false, other: true });
  await w.advance();
  assert.deepEqual(w.changed(), [[0]]);
});

test("audio appended right after a made chunk does not change it", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  const end = grid.WINDOW_SECONDS - 0.004; // short of the window's end, within the tolerance
  const frames = (from, to, byte) => {
    const list = [];
    for (let t = from; t < to - 1e-9; t += 0.02) list.push(t);
    return list.map((time) => ({ time, duration: Math.min(0.02, to - time), data: new Uint8Array([byte]) }));
  };
  w.want(1, [{ k: 0, from: 0 }]);
  w.addRaw(1, frames(0, end, 1));
  await w.advance();
  w.answer();
  await w.advance();
  assert.equal(w.chunks(1).length, 1);
  w.addRaw(1, frames(end, end + 5, 2));
  await w.advance();
  assert.deepEqual(w.changed(), []);
});

test("audio far from the playhead and past the byte limit is let go", async () => {
  const w = workerSandbox();
  w.start();
  w.ready();
  w.stream(1);
  w.want(1, [], { position: 100 });
  const frames = (from, count, size) => Array.from({ length: count }, (_, i) => ({ time: from + i * 0.02, duration: 0.02, data: new Uint8Array(size) }));
  w.addRaw(1, frames(100, 50, 100));
  w.addRaw(1, frames(1100, 50, 100)); // 1000 s ahead
  await w.advance();
  assert.equal(w.held(1).frames, 50);
  assert.ok(w.held(1).last < 102);
  w.addRaw(1, frames(102, 80, 2 ** 20)); // 80 MiB of "frames" right ahead of the playhead
  await w.advance();
  assert.ok(w.held(1).bytes <= 64 * 2 ** 20, `${w.held(1).bytes / 2 ** 20} MiB`);
  assert.equal(w.held(1).first, 100, "the farthest went first");
});
