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
const PASS_SECONDS = 3; // the fixture's length

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
  load("tab-worker.js", env, { rewrite: (source) => source.replace('import("./model.js")', "importModel()") });
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
    feed(id, seconds, { from = 0, bufferId = 2, header = true } = {}) {
      const entries = header ? [
        { kind: "buffer", bufferId, mime: WEBM },
        { kind: "append", bufferId, bytes: INIT.slice(), offset: 0, segment: "init" },
      ] : [];
      for (let at = from; at < from + seconds; at += PASS_SECONDS) {
        for (const cluster of CLUSTERS) entries.push({ kind: "append", bufferId, bytes: cluster.slice(), offset: at, segment: "media" });
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
