// The files handed to Firefox's Web Audio decoder must contain exactly the
// captured packets, with encoder priming applied only in the original timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemuxer } from "../../extension/demux.js";
import { load } from "./sandbox.mjs";

function captured(name, mime) {
  const input = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const demuxer = createDemuxer(mime);
  const frames = demuxer.push(input).slice(20, 45);
  for (const frame of frames) frame.config = demuxer.config;
  return frames;
}

async function wrap(frames) {
  let file;
  const self = { postMessage(message, [, reply]) {
    file = new Uint8Array(message.file);
    reply.postMessage({ channels: [new Float32Array(48000)], rate: 48000 });
    reply.close();
  } };
  const { canWrap, decodeInFrame } = load("web-audio-decode.js", { self, TextEncoder, MessageChannel, Uint8Array });
  assert.equal(canWrap(frames[0].config), true);
  assert.equal((await decodeInFrame(frames)).rate, 48000);
  return file;
}

test("Web Audio fallback wraps a mid-stream Opus window without changing its packets or source header", async () => {
  const mime = 'audio/webm; codecs="opus"';
  const frames = captured("opus.webm", mime);
  const original = frames[0].config.description.slice();
  const reader = createDemuxer(mime);
  const decoded = reader.push(await wrap(frames));
  assert.deepEqual(decoded.map(f => Buffer.from(f.data)), frames.map(f => Buffer.from(f.data)));
  assert.deepEqual(decoded.map(f => Math.round(f.time * 1000)), frames.map(f => Math.round((f.time - frames[0].time) * 1000)));
  assert.equal(reader.config.description[10] | reader.config.description[11], 0);
  assert.deepEqual(frames[0].config.description, original);
});

test("an AAC run retains the original MP4 sample entry and packet bytes", async () => {
  const frames = captured("aac.mp4", 'audio/mp4; codecs="mp4a.40.2"');
  const file = Buffer.from(await wrap(frames));
  assert.equal(file.toString("ascii", 4, 8), "ftyp");
  assert(file.includes(Buffer.from(frames[0].config.sampleEntry)));
  const payload = Buffer.concat(frames.map(f => Buffer.from(f.data)));
  const start = file.indexOf("mdat") + 4;
  assert.deepEqual(file.subarray(start, start + payload.length), payload);
});
