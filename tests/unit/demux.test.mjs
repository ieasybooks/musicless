import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
