// capture.js in a sandbox with stand-in Media Source classes, its limits
// shrunk so trimming happens with the small fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createDemuxer } from "../../extension/demux.js";

const SOURCE = readFileSync(new URL("../../extension/capture.js", import.meta.url), "utf8");
const WEBM = 'audio/webm; codecs="opus"';
const opus = new Uint8Array(readFileSync(new URL("./fixtures/opus.webm", import.meta.url)));

// The fixture as an init segment and its clusters (media segments).
const starts = [];
for (let i = 0; i + 4 <= opus.length; i++) {
  if (opus[i] === 0x1f && opus[i + 1] === 0x43 && opus[i + 2] === 0xb6 && opus[i + 3] === 0x75) starts.push(i);
}
const INIT = opus.subarray(0, starts[0]);
const CLUSTERS = starts.map((start, i) => opus.subarray(start, starts[i + 1] ?? opus.length));
const CLUSTER_SECONDS = 3 / CLUSTERS.length; // only used to space repeats apart

function sandbox({ streamLimit = 120_000, totalLimit = 400_000 } = {}) {
  const posted = [];
  const listeners = [];
  class MediaSource {
    constructor() { this.listeners = {}; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    close() { for (const fn of this.listeners.sourceclose ?? []) fn(); }
  }
  MediaSource.prototype.addSourceBuffer = function () { return new SourceBuffer(); };
  MediaSource.prototype.endOfStream = function () {};
  class SourceBuffer { constructor() { this.timestampOffset = 0; this.appended = 0; } }
  SourceBuffer.prototype.appendBuffer = function (data) { this.appended += data.byteLength; };
  SourceBuffer.prototype.abort = function () {};
  let urls = 0;
  const context = {
    MediaSource, SourceBuffer, Uint8Array, ArrayBuffer, Date, Map, Set, WeakMap, String, JSON,
    URL: { createObjectURL: () => `blob:test/${++urls}` },
    postMessage: (message) => posted.push(message),
    addEventListener: (type, fn) => listeners.push(fn),
  };
  context.window = context;
  vm.createContext(context);
  const code = SOURCE.replace("16 * 2 ** 20", String(streamLimit)).replace("48 * 2 ** 20", String(totalLimit));
  vm.runInContext(code, context);
  // Inside the sandbox `window` is its global proxy: messages must come from it.
  const self = vm.runInContext("window", context);
  const control = (message) => {
    for (const fn of listeners) fn({ source: self, data: { nomusic: "control", ...message } });
  };
  return { context, posted, control };
}

// A long stream: the fixture's clusters over and over, each pass later in time.
function playLong(env, passes, { split = 1 } = {}) {
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  for (let pass = 0; pass < passes; pass++) {
    sb.timestampOffset = pass * 3;
    if (pass === 2) sb.abort(); // like a seek
    for (const cluster of CLUSTERS) {
      const size = Math.ceil(cluster.length / split);
      for (let at = 0; at < cluster.length; at += size) sb.appendBuffer(cluster.subarray(at, at + size));
    }
  }
  return { mediaSource, sb };
}

function replay(env, streamId) {
  env.control({ type: "subscribe", streamId });
  return env.posted.findLast((m) => m.type === "replay" && m.streamId === streamId);
}

const bytesOf = (entries) => entries.reduce((sum, entry) => sum + (entry.bytes?.length ?? 0), 0);

function demuxReplay(entries) {
  const demuxers = new Map();
  const frames = [];
  for (const entry of entries) {
    if (entry.kind === "buffer") demuxers.set(entry.bufferId, createDemuxer(entry.mime));
    else if (entry.kind === "abort") demuxers.get(entry.bufferId).reset();
    else if (entry.kind === "append") frames.push(...demuxers.get(entry.bufferId).push(entry.bytes, entry.offset));
  }
  return frames;
}

test("a long stream keeps only its most recent audio", () => {
  const env = sandbox();
  playLong(env, 12);
  const { entries, dropped } = replay(env, 1);
  assert.ok(dropped, "older audio was dropped");
  assert.ok(bytesOf(entries) <= 120_000 + INIT.length, `${bytesOf(entries)} bytes kept`);
});

test("the trimmed copy starts with the format header and still decodes", () => {
  const env = sandbox();
  playLong(env, 12);
  const { entries, dropped } = replay(env, 1);
  assert.equal(dropped, true);
  const appends = entries.filter((e) => e.kind === "append");
  assert.equal(appends[0].segment, "init", "the init segment was put back in front");
  assert.equal(appends[1].segment, "media", "kept audio starts at a segment boundary");
  assert.equal(entries.filter((e) => e.kind === "abort").length, 0, "aborts before the kept audio are gone");
  const frames = demuxReplay(entries);
  assert.ok(frames.length > 100);
  // The kept audio is the end of the stream, contiguous up to its last frame.
  const last = frames[frames.length - 1];
  assert.ok(Math.abs(last.time + last.duration - 12 * 3) < 0.05, `ends at ${last.time + last.duration}`);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].time - (frames[i - 1].time + frames[i - 1].duration) <= 0.0015);
  }
});

test("segments split across appends are trimmed whole", () => {
  const env = sandbox();
  playLong(env, 12, { split: 3 });
  const { entries } = replay(env, 1);
  const appends = entries.filter((e) => e.kind === "append");
  assert.equal(appends[0].segment, "init");
  assert.equal(appends[1].segment, "media", "never starts with the middle of a segment");
  assert.ok(demuxReplay(entries).length > 100);
});

test("a short stream is kept whole", () => {
  const env = sandbox();
  playLong(env, 1);
  const { entries, dropped } = replay(env, 1);
  assert.equal(dropped, false);
  assert.equal(entries.filter((e) => e.kind === "append").length, 1 + CLUSTERS.length);
});

test("a detached Media Source frees its audio and says so", () => {
  const env = sandbox();
  const { mediaSource } = playLong(env, 2);
  mediaSource.close();
  assert.ok(env.posted.some((m) => m.type === "closed" && m.streamId === 1));
  env.control({ type: "subscribe", streamId: 1 });
  assert.equal(env.posted.at(-1).type, "closed", "subscribing to a closed stream answers closed");
});

test("past the page-wide limit, streams nobody listens to are emptied, oldest first", () => {
  const env = sandbox({ streamLimit: 120_000, totalLimit: 200_000 });
  playLong(env, 6);
  playLong(env, 6);
  playLong(env, 6);
  const kept = [1, 3, 5].map((id) => bytesOf(replay(env, id).entries)); // stream ids (buffer ids come between)
  const total = kept.reduce((sum, bytes) => sum + bytes, 0);
  assert.ok(total <= 200_000 + 3 * INIT.length, `${total} bytes kept`);
  assert.ok(kept[0] < kept[2], "the oldest stream went first");
});

test("a subscribed stream gets each new append live", () => {
  const env = sandbox();
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  env.control({ type: "subscribe", streamId: 1 });
  sb.appendBuffer(CLUSTERS[0]);
  const live = env.posted.filter((m) => m.type === "event");
  assert.equal(live.length, 1);
  assert.equal(live[0].entry.segment, "media");
  assert.equal(live[0].entry.bytes.length, CLUSTERS[0].length);
  assert.ok(CLUSTER_SECONDS > 0);
});
