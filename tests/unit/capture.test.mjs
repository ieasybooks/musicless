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

function sandbox({ streamLimit = 120_000, totalLimit = 400_000, maxEntries = 10000 } = {}) {
  const posted = [];
  const listeners = [];
  class MediaSource {
    constructor() { this.listeners = {}; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    close() { for (const fn of this.listeners.sourceclose ?? []) fn(); }
  }
  MediaSource.prototype.addSourceBuffer = function () { return new SourceBuffer(); };
  // Like the browser's, these refuse some calls (an append to a full buffer, ending while updating).
  MediaSource.prototype.endOfStream = function () { if (this.updating) throw new Error("InvalidStateError"); };
  class SourceBuffer { constructor() { this.timestampOffset = 0; this.appended = 0; } }
  SourceBuffer.prototype.appendBuffer = function (data) {
    if (this.full) throw new Error("QuotaExceededError");
    this.appended += data?.byteLength ?? 0;
  };
  SourceBuffer.prototype.abort = function () {};
  SourceBuffer.prototype.changeType = function () {};
  SourceBuffer.prototype.remove = function (start, end) { if (!(end > start)) throw new TypeError("bad range"); };
  MediaSource.prototype.removeSourceBuffer = function () {};
  let urls = 0;
  const context = {
    MediaSource, SourceBuffer, Uint8Array, ArrayBuffer, Date, Map, Set, WeakMap, String, JSON,
    URL: { createObjectURL: () => `blob:test/${++urls}` },
    postMessage: (message) => posted.push(message),
    addEventListener: (type, fn) => listeners.push(fn),
  };
  context.window = context;
  vm.createContext(context);
  const code = SOURCE.replace("16 * 2 ** 20", String(streamLimit)).replace("48 * 2 ** 20", String(totalLimit))
    .replace("MAX_ENTRIES = 10000", `MAX_ENTRIES = ${maxEntries}`);
  vm.runInContext(code, context);
  // Inside the sandbox `window` is its global proxy: messages must come from it.
  const self = vm.runInContext("window", context);
  const control = (message) => {
    for (const fn of listeners) fn({ source: self, data: { nomusic: "control", ...message } });
  };
  return { context, posted, control };
}

// A long stream: the fixture's clusters over and over, each pass later in time.
function playLong(env, passes, { split = 1, from = 0 } = {}) {
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  for (let pass = 0; pass < passes; pass++) {
    sb.timestampOffset = (from + pass) * 3;
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
    if (entry.kind === "buffer" || entry.kind === "changeType") demuxers.set(entry.bufferId, createDemuxer(entry.mime));
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

test("past the page-wide limit, every stream keeps its share of its newest audio, subscribed or not", () => {
  const env = sandbox({ streamLimit: 120_000, totalLimit: 200_000 });
  playLong(env, 6);
  env.control({ type: "subscribe", streamId: 1 }); // being separated
  playLong(env, 6, { from: 1 });
  playLong(env, 6);
  const replays = [1, 3, 5].map((id) => replay(env, id)); // stream ids (buffer ids come between)
  const kept = replays.map(({ entries }) => bytesOf(entries));
  assert.ok(kept.reduce((sum, bytes) => sum + bytes, 0) <= 200_000 + 3 * INIT.length, `${kept} bytes kept`);
  for (const { entries } of replays) assert.ok(demuxReplay(entries).length > 30, "each still decodes");
});

test("the page-wide limit holds with several streams being separated", () => {
  const env = sandbox({ streamLimit: 16 * 2 ** 20, totalLimit: 48 * 2 ** 20 });
  for (let i = 0; i < 4; i++) {
    const mediaSource = new env.context.MediaSource();
    env.context.URL.createObjectURL(mediaSource);
    const sb = mediaSource.addSourceBuffer(WEBM);
    env.control({ type: "subscribe", streamId: 1 + 2 * i });
    for (let mb = 0; mb < 15; mb++) {
      const bytes = new Uint8Array(2 ** 20);
      bytes.set([0x1f, 0x43, 0xb6, 0x75]); // a cluster each
      sb.appendBuffer(bytes);
    }
  }
  const total = [1, 3, 5, 7].reduce((sum, id) => sum + bytesOf(replay(env, id).entries), 0);
  assert.ok(total <= 48 * 2 ** 20, `${total / 2 ** 20} MiB kept`);
});

test("entries without audio and unused streams are bounded", () => {
  const env = sandbox();
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  for (let i = 0; i < 20000; i++) sb.abort();
  assert.equal(replay(env, 1).entries.length, 3, "repeated aborts are one");
  for (let i = 0; i < 20000; i++) sb.remove(i, i + 1);
  assert.ok(replay(env, 1).entries.length <= 10000);
  for (let i = 0; i < 100; i++) env.context.URL.createObjectURL(new env.context.MediaSource());
  const closed = env.posted.filter((m) => m.type === "closed").length;
  assert.ok(closed >= 101 - 64, `${closed} unused streams let go`);
  assert.equal(replay(env, 1).entries.length > 0, true, "a stream in use stays");
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

test("calls the browser refuses are not recorded, and nomusic's own errors never reach the page", () => {
  const env = sandbox();
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  sb.full = true;
  assert.throws(() => sb.appendBuffer(CLUSTERS[0]), /QuotaExceededError/, "the page sees the browser's error");
  sb.full = false;
  mediaSource.updating = true;
  assert.throws(() => mediaSource.endOfStream(), /InvalidStateError/);
  mediaSource.updating = false;
  sb.appendBuffer(Symbol("not a buffer")); // the browser took it; nomusic cannot copy it
  const { entries } = replay(env, 1);
  assert.equal(entries.map((e) => e.kind).join(), "buffer,append", "only what the browser accepted");
});

test("a Media Source opened again after it closed is a new stream", () => {
  const env = sandbox();
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  mediaSource.addSourceBuffer(WEBM).appendBuffer(INIT);
  mediaSource.close();
  const sb = mediaSource.addSourceBuffer(WEBM); // the player attached it again (same URL)
  sb.appendBuffer(INIT);
  const reopened = env.posted.findLast((m) => m.type === "stream");
  assert.notEqual(reopened.streamId, 1);
  assert.equal(reopened.url, "blob:test/1", "announced under its URL");
  assert.equal(replay(env, reopened.streamId).entries.filter((e) => e.kind === "append").length, 1);
  const url = env.context.URL.createObjectURL(mediaSource);
  assert.equal(env.posted.findLast((m) => m.type === "stream").url, url);
});

test("a format header split across appends is kept whole when older audio is trimmed", () => {
  const env = sandbox();
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT.subarray(0, 16));
  sb.appendBuffer(INIT.subarray(16));
  for (let pass = 0; pass < 12; pass++) {
    sb.timestampOffset = pass * 3;
    for (const cluster of CLUSTERS) sb.appendBuffer(cluster);
  }
  const { entries, dropped } = replay(env, 1);
  assert.equal(dropped, true);
  const header = entries.filter((e) => e.kind === "append").slice(0, 2);
  assert.equal(header[0].bytes.length + header[1].bytes.length, INIT.length);
  assert.ok(demuxReplay(entries).length > 100, "the kept audio still decodes");
});

test("removed audio is recorded, and a removed buffer leaves the copy and its subscriber", () => {
  const env = sandbox();
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  sb.appendBuffer(CLUSTERS[0]);
  assert.throws(() => sb.remove(5, 1), /bad range/);
  sb.remove(0, Infinity);
  const first = replay(env, 1).entries;
  assert.equal(first.map((e) => e.kind).join(), "buffer,append,append,remove", "only the removal the browser accepted");
  assert.equal(first.at(-1).end, Infinity);
  mediaSource.removeSourceBuffer(sb);
  assert.equal(env.posted.at(-1).type, "event");
  assert.equal(env.posted.at(-1).entry.kind, "removeBuffer");
  assert.equal(replay(env, 1).entries.length, 0);
});

function playShort(env) {
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  sb.appendBuffer(INIT);
  for (const cluster of CLUSTERS) sb.appendBuffer(cluster);
  return sb;
}

test("before consent only format headers are kept, and the stream is marked as missed", () => {
  const env = sandbox();
  env.control({ type: "consent", consented: false });
  playShort(env);
  const { entries, missed } = replay(env, 1);
  assert.equal(entries.map((e) => e.kind).join(), "buffer,append");
  assert.equal(entries[1].segment, "init");
  assert.equal(missed, true);
});

test("audio kept before the answer is dropped if the answer is no", () => {
  const env = sandbox();
  playShort(env);
  env.control({ type: "consent", consented: false });
  const { entries, missed } = replay(env, 1);
  assert.equal(bytesOf(entries), INIT.length);
  assert.equal(missed, true);
});

test("with consent the audio is kept", () => {
  const env = sandbox();
  env.control({ type: "consent", consented: true });
  playShort(env);
  const { entries, missed } = replay(env, 1);
  assert.equal(entries.filter((e) => e.kind === "append").length, 1 + CLUSTERS.length);
  assert.equal(missed, false);
});

// The format header kept for a stream: its header appends, joined.
function keptHeader(entries) {
  const appends = entries.filter((e) => e.kind === "append");
  assert.ok(appends.every((e) => e.header), "nothing but header bytes");
  return Buffer.concat(appends.map((e) => Buffer.from(e.bytes)));
}

function appendIn(env, bytes, slices, mime = WEBM) {
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(mime);
  for (let at = 0, i = 0; at < bytes.length; i++) {
    const size = slices[i % slices.length];
    sb.appendBuffer(bytes.subarray(at, at + size));
    at += size;
  }
}

test("before consent, an append holding a header and audio keeps only the header", () => {
  const aac = new Uint8Array(readFileSync(new URL("./fixtures/aac.mp4", import.meta.url)));
  const moof = Buffer.from(aac).indexOf("moof") - 4;
  for (const [bytes, header, mime] of [[opus, INIT, WEBM], [aac, aac.subarray(0, moof), 'audio/mp4; codecs="mp4a.40.2"']]) {
    const env = sandbox();
    env.control({ type: "consent", consented: false });
    appendIn(env, bytes, [bytes.length], mime); // the whole file in one append
    const { entries, missed } = replay(env, 1);
    assert.deepEqual(keptHeader(entries), Buffer.from(header));
    assert.equal(missed, true, "its audio went by");
  }
});

test("before consent, a header and audio split at any byte keep only the header", () => {
  for (const slices of [[7], [16, 333], [INIT.length - 2, 5000], [INIT.length, 1000], [1000]]) {
    const env = sandbox();
    env.control({ type: "consent", consented: false });
    appendIn(env, opus, slices);
    const { entries, missed } = replay(env, 1);
    const kept = keptHeader(entries);
    // A Cluster's ID cut across appends may leave its first bytes with the header: no audio.
    assert.ok(kept.length >= INIT.length && kept.length < INIT.length + 4, `${slices}: ${kept.length} bytes kept`);
    assert.deepEqual(kept.subarray(0, INIT.length), Buffer.from(INIT));
    assert.equal(missed, true);
  }
});

test("a header and audio kept before the answer lose the audio if the answer is no", () => {
  const env = sandbox();
  appendIn(env, opus, [opus.length]); // storage has not answered yet
  assert.equal(bytesOf(replay(env, 1).entries), opus.length);
  env.control({ type: "consent", consented: false });
  const { entries, missed } = replay(env, 1);
  assert.deepEqual(keptHeader(entries), Buffer.from(INIT));
  assert.equal(missed, true);
});

test("a format header larger than any real one is not kept before consent", () => {
  const env = sandbox();
  env.control({ type: "consent", consented: false });
  const size = 300 * 1024; // an EBML header element claiming 300 KiB, then a Cluster
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff, ...new Uint8Array(size), ...CLUSTERS[0]]);
  appendIn(env, bytes, [bytes.length]);
  const { entries, missed } = replay(env, 1);
  assert.equal(entries.filter((e) => e.kind === "append").length, 0);
  assert.equal(missed, true);
});

test("with consent, an append holding a header and audio is kept and decodes as before", () => {
  const env = sandbox();
  env.control({ type: "consent", consented: true });
  appendIn(env, opus, [opus.length]);
  const { entries, missed } = replay(env, 1);
  assert.equal(missed, false);
  assert.equal(bytesOf(entries), opus.length);
  assert.deepEqual(demuxReplay(entries).map((f) => f.time), createDemuxer(WEBM).push(opus).map((f) => f.time));
});

test("type changes, aborts and ends do not pile up, alone or between appends", () => {
  const MP4 = 'audio/mp4; codecs="mp4a.40.2"';
  const env = sandbox({ maxEntries: 20 });
  const mediaSource = new env.context.MediaSource();
  env.context.URL.createObjectURL(mediaSource);
  const sb = mediaSource.addSourceBuffer(WEBM);
  for (let i = 0; i < 50; i++) {
    sb.changeType(i % 2 ? MP4 : WEBM);
    sb.abort();
    mediaSource.endOfStream();
  }
  assert.equal(replay(env, 1).entries.map((e) => `${e.kind}:${e.mime ?? ""}`).join(), `buffer:${WEBM},changeType:${MP4},end:`);
  // Each type change followed by its audio: the oldest go with that audio.
  for (let pass = 0; pass < 50; pass++) {
    sb.changeType(WEBM);
    sb.timestampOffset = pass * 3;
    sb.appendBuffer(INIT);
    for (const cluster of CLUSTERS) sb.appendBuffer(cluster);
    mediaSource.endOfStream();
  }
  const { entries } = replay(env, 1);
  assert.ok(entries.length <= 20, `${entries.length} entries`);
  assert.ok(entries.filter((e) => e.kind === "changeType").length <= 4);
  const frames = demuxReplay(entries);
  assert.ok(frames.length > 0, "the kept audio still decodes");
  assert.ok(Math.abs(frames.at(-1).time + frames.at(-1).duration - 50 * 3) < 0.05, "up to the newest audio");
});
