import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createDemuxer } from "../../extension/demux.js";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const WEBM = 'audio/webm; codecs="opus"';
const MP4 = 'audio/mp4; codecs="mp4a.40.2"';

function parse(mime, bytes, slices = [bytes.length], offset = 0) {
  const demuxer = createDemuxer(mime);
  const frames = [];
  let at = 0;
  for (let i = 0; at < bytes.length; i++) {
    const size = slices[i % slices.length];
    frames.push(...demuxer.push(bytes.subarray(at, at + size), offset));
    at += size;
  }
  return { demuxer, frames };
}

// WebM timestamps have 1 ms resolution, so 20 ms Opus frames jitter by up to 1 ms.
function assertContiguous(frames) {
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].time - (frames[i - 1].time + frames[i - 1].duration);
    assert.ok(Math.abs(gap) <= 0.0015, `gap of ${gap} s before frame ${i}`);
  }
}

test("WebM/Opus: frames, timestamps and decoder config", () => {
  const { demuxer, frames } = parse(WEBM, fixture("opus.webm"));
  assert.equal(demuxer.config.codec, "opus");
  assert.equal(demuxer.config.sampleRate, 48000);
  assert.equal(demuxer.config.numberOfChannels, 2);
  assert.ok(demuxer.config.description.length >= 19, "OpusHead description");
  const total = frames.reduce((sum, f) => sum + f.duration, 0);
  assert.ok(Math.abs(total - 3) < 0.05, `about 3 s of audio, got ${total}`);
  assert.equal(frames[0].time, 0);
  assertContiguous(frames);
});

test("WebM/Opus: appends split anywhere give the same frames", () => {
  const bytes = fixture("opus.webm");
  const whole = parse(WEBM, bytes).frames;
  for (const slices of [[7], [333, 1, 4096], [5000]]) {
    const split = parse(WEBM, bytes, slices).frames;
    assert.equal(split.length, whole.length);
    assert.deepEqual(split.map((f) => f.time), whole.map((f) => f.time));
    assert.deepEqual(Buffer.from(split[40].data), Buffer.from(whole[40].data));
  }
});

test("WebM/Opus: timestampOffset shifts frame times", () => {
  const frames = parse(WEBM, fixture("opus.webm"), undefined, 10).frames;
  assert.equal(frames[0].time, 10);
});

test("WebM/Opus: after an abort, parsing resumes at the next cluster", () => {
  const bytes = fixture("opus.webm");
  const clusters = [];
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x1f && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75) clusters.push(i);
  }
  assert.ok(clusters.length >= 2, "fixture has several clusters");
  const demuxer = createDemuxer(WEBM);
  demuxer.push(bytes.subarray(0, clusters[1] + 100)); // init, first cluster, part of the second
  demuxer.reset(); // the player aborted mid-segment
  const frames = demuxer.push(bytes.subarray(clusters[2] ?? clusters[1]));
  assert.ok(frames.length > 10);
  assertContiguous(frames);
});

test("fragmented MP4/AAC: frames, timestamps and decoder config", () => {
  const { demuxer, frames } = parse(MP4, fixture("aac.mp4"), [10000]);
  assert.equal(demuxer.config.codec, "mp4a.40.2");
  assert.equal(demuxer.config.sampleRate, 44100);
  assert.equal(demuxer.config.numberOfChannels, 2);
  assert.ok(Math.abs(frames[1].duration - 1024 / 44100) < 1e-9);
  const total = frames.reduce((sum, f) => sum + f.duration, 0);
  assert.ok(Math.abs(total - 3) < 0.1, `about 3 s of audio, got ${total}`);
  assertContiguous(frames);
});

test("encrypted MP4 (Common Encryption) is reported as protected", () => {
  const { demuxer, frames } = parse('audio/mp4; codecs="opus"', fixture("encrypted.mp4"));
  assert.equal(demuxer.protected, true);
  assert.equal(frames.length, 0);
});

test("unsupported containers are refused", () => {
  assert.throws(() => createDemuxer("audio/ogg"));
});

test("an element that never completes stops the stream instead of growing without end", () => {
  const demuxer = createDemuxer(WEBM);
  // An EBML header that claims 1 GiB.
  demuxer.push(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00]));
  assert.throws(() => {
    for (let i = 0; i < 40; i++) demuxer.push(new Uint8Array(2 ** 20));
  }, /never completed/);
});

// The AAC fixture with an edit list (version 1, 64-bit fields) put into its track.
function withEditList(mediaTime) {
  const bytes = fixture("aac.mp4");
  const u32 = (at) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
  const set32 = (array, at, value) => new DataView(array.buffer).setUint32(at, value);
  const elst = new Uint8Array(36);
  set32(elst, 0, 36);
  elst.set([0x65, 0x6c, 0x73, 0x74, 1, 0, 0, 0, 0, 0, 0, 1], 4); // "elst", version 1, one entry
  new DataView(elst.buffer).setBigInt64(24, BigInt(mediaTime)); // segment duration 0, then media_time
  const edts = new Uint8Array(8 + elst.length);
  set32(edts, 0, edts.length);
  edts.set([0x65, 0x64, 0x74, 0x73], 4);
  edts.set(elst, 8);
  const moov = 28;
  const trak = 144;
  const after = trak + 8 + u32(trak + 8); // after tkhd, the trak's first child
  const out = new Uint8Array(bytes.length + edts.length);
  out.set(bytes.subarray(0, after));
  out.set(edts, after);
  out.set(bytes.subarray(after), after + edts.length);
  set32(out, moov, u32(moov) + edts.length);
  set32(out, trak, u32(trak) + edts.length);
  return out;
}

test("fragmented MP4: an edit list's priming is trimmed, an empty edit (version 1) trims nothing", () => {
  const plain = parse(MP4, fixture("aac.mp4")).frames;
  const empty = parse(MP4, withEditList(-1)).frames;
  assert.equal(empty[0].time, plain[0].time);
  const primed = parse(MP4, withEditList(2048)).frames;
  assert.ok(Math.abs(primed[0].time - (plain[0].time - 2048 / 44100)) < 1e-9);
});

// Parses in a context of its own that is stopped after a second, so a parser
// that loops over a malformed count fails the test instead of hanging it.
const DEMUX = readFileSync(new URL("../../extension/demux.js", import.meta.url), "utf8").replace(/^export /gm, "");
function parseWithin(mime, bytes) {
  const context = vm.createContext({ mime, bytes, Uint8Array, DataView, TextDecoder });
  vm.runInContext(DEMUX, context);
  return vm.runInContext("createDemuxer(mime).push(bytes).length", context, { timeout: 1000 });
}

// The AAC fixture with its first sample table (trun) changed.
function withFirstTrun({ count, flags }) {
  const bytes = fixture("aac.mp4");
  const body = Buffer.from(bytes).indexOf("trun") + 4;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  if (flags !== undefined) view.setUint32(body, flags); // version 0
  view.setUint32(body + 4, count);
  return bytes;
}

test("fragmented MP4: a sample count beyond its table or its data is not followed", () => {
  const whole = parse(MP4, fixture("aac.mp4")).frames.length;
  // Per-sample sizes: the table cannot hold four billion entries.
  const sized = parseWithin(MP4, withFirstTrun({ count: 0xffffffff }));
  assert.ok(sized > 0 && sized < whole, `${sized} frames: the other fragments still parse`);
  // Default sizes only: the samples run out with the media data.
  const defaults = parseWithin(MP4, withFirstTrun({ count: 0xffffffff, flags: 0x000001 }));
  assert.ok(defaults > 0 && defaults < 2 * whole, `${defaults} frames`);
});

// The WebM fixture's header (EBML, Segment, Tracks) followed by `body`.
function afterWebmHeader(body) {
  const bytes = fixture("opus.webm");
  const cluster = Buffer.from(bytes).indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
  return new Uint8Array([...bytes.subarray(0, cluster), ...body]);
}

test("WebM: more frames in one append than any player sends are refused", () => {
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];
  const block = [0xa3, 0x85, 0x81, 0x00, 0x00, 0x80, 0xfc]; // track 1, one 20 ms Opus packet
  const blocks = new Uint8Array(70000 * block.length).map((_, i) => block[i % block.length]);
  assert.throws(() => createDemuxer(WEBM).push(afterWebmHeader([...cluster, ...blocks])), /too many audio frames/);
});

test("WebM: a header with more tracks than any stream has is refused", () => {
  const ebml = fixture("opus.webm");
  const header = ebml.subarray(0, 5 + (ebml[4] & 0x7f)); // the EBML element (a one-byte size)
  const tracks = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x16, 0x54, 0xae, 0x6b, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  for (let i = 0; i < 100; i++) tracks.push(0xae, 0x80); // empty track entries
  assert.throws(() => createDemuxer(WEBM).push(new Uint8Array([...header, ...tracks])), /too many WebM tracks/);
});
