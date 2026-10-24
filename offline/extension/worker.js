// Separation worker. Owns the captured encoded audio of one video, decodes
// and separates the ~11.9 s chunks the content script asks for (in its priority
// order), and sends the vocals back. Runs Spleeter on one CPU thread.

import * as ort from "./vendor/ort.wasm.min.mjs";
import { configKey, createDemuxer } from "./demux.js";
import {
  analyze, synthesize, resample, RATE, WINDOW_SAMPLES, CONTEXT_SAMPLES, CORE_SAMPLES, CHUNK_SECONDS,
} from "./dsp.js";

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;
ort.env.logLevel = "error";

const WARMUP_SECONDS = 0.25; // decoder pre-roll before a window starts
const GAP_TOLERANCE = 0.005;
const LEAD_TOLERANCE = 0.3; // the page asks from 0.25 s before the playhead

let port = null;
let session = null;
let sessionReady = null;
let stream = null; // { id, buffers: Map, frames: [], ended, duration }
let wanted = [];
const done = new Set();
let busy = false;

const send = (message, transfer) => port.postMessage(message, transfer ?? []);

function loadModel() {
  sessionReady ??= (async () => {
    const started = performance.now();
    session = await ort.InferenceSession.create(new URL("./model/spleeter-2stems.onnx", import.meta.url).href, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      freeDimensionOverrides: { num_splits: 1 },
    });
    send({ type: "model", seconds: (performance.now() - started) / 1000 });
  })();
  return sessionReady;
}

function newStream(id) {
  stream = { id, buffers: new Map(), frames: [], ended: false, duration: Infinity };
  wanted = [];
  done.clear();
}

// Frames stay sorted by time; a re-appended range replaces nothing, it is skipped.
function addFrames(buffer, frames) {
  const list = stream.frames;
  for (const frame of frames) {
    frame.buffer = buffer;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].time < frame.time) lo = mid + 1;
      else hi = mid;
    }
    if (list[lo] && Math.abs(list[lo].time - frame.time) < 1e-4) continue;
    if (list[lo - 1] && Math.abs(list[lo - 1].time - frame.time) < 1e-4) continue;
    list.splice(lo, 0, frame);
  }
}

function onEntry(entry) {
  if (entry.kind === "end") {
    stream.ended = true;
    return;
  }
  let buffer = stream.buffers.get(entry.bufferId);
  if (entry.kind === "buffer" || entry.kind === "changeType") {
    buffer = { id: entry.bufferId, mime: entry.mime, demuxer: createDemuxer(entry.mime) };
    stream.buffers.set(entry.bufferId, buffer);
    return;
  }
  if (!buffer) return;
  if (entry.kind === "abort") {
    buffer.demuxer.reset();
    return;
  }
  try {
    const frames = buffer.demuxer.push(entry.bytes, entry.offset || 0);
    if (frames.length) {
      const config = buffer.demuxer.config;
      if (config !== buffer.checkedConfig) {
        buffer.checkedConfig = config;
        // Some builds (e.g. open-source Chromium) cannot decode AAC.
        AudioDecoder.isConfigSupported(config).then(({ supported }) => {
          if (!supported) send({ type: "unsupported", message: `this browser cannot decode ${config.codec} audio` });
        }, () => send({ type: "unsupported", message: `this browser cannot decode ${config.codec} audio` }));
      }
      for (const frame of frames) frame.config = config;
      addFrames(buffer, frames);
    } else if (buffer.demuxer.unsupported && !buffer.reported) {
      buffer.reported = true;
      send({ type: "error", message: `Unsupported audio codec ${buffer.demuxer.unsupported}` });
    }
  } catch (error) {
    send({ type: "error", message: `Could not read the audio stream: ${error.message}` });
  }
}

// The run of contiguous frames that reaches `end`, extended back toward
// `start`: [first index, last index, run start time], or null if `end` is not
// covered yet. A seek leaves earlier audio missing, so a run may begin late.
function run(start, end) {
  const list = stream.frames;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time + list[mid].duration < end - GAP_TOLERANCE) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= list.length || list[lo].time > end) return null;
  let first = lo;
  while (first > 0 && list[first].time > start) {
    const previous = list[first - 1];
    if (previous.time + previous.duration < list[first].time - GAP_TOLERANCE) break;
    first--;
  }
  return [first, lo, list[first].time];
}

function streamEnd() {
  const last = stream.frames[stream.frames.length - 1];
  const decodedEnd = last ? last.time + last.duration : 0;
  if (stream.ended) return decodedEnd;
  // Near the media's end, the final frame may stop just short of the duration.
  if (Number.isFinite(stream.duration) && decodedEnd >= stream.duration - 0.25) return decodedEnd;
  return Infinity;
}

// Media-time span of the input window for chunk k.
function windowFor(k) {
  const start = (k * CORE_SAMPLES - CONTEXT_SAMPLES) / RATE;
  return [start, start + WINDOW_SAMPLES / RATE];
}

// A chunk can be separated once audio runs unbroken from `from` (the earliest
// time the page needs) to the window's end. Returns the frame range and the
// time from which the result is valid.
function ready(k, from) {
  const [start, end] = windowFor(k);
  const stop = Math.min(end, streamEnd());
  if (k * CHUNK_SECONDS >= stop) return null;
  const found = run(Math.max(start - WARMUP_SECONDS, 0), stop);
  if (!found) return null;
  const [first, last, runStart] = found;
  // Audio may begin a little after the requested point (muxing offsets put the
  // first frame at e.g. 0.01 s); the page only plays a chunk from where it is valid.
  if (runStart > Math.max(from, start, 0) + LEAD_TOLERANCE) return null;
  return { range: [first, last], validFrom: runStart <= Math.max(start, 0) + GAP_TOLERANCE ? start : runStart };
}

async function decode(range) {
  const frames = stream.frames.slice(range[0], range[1] + 1);
  const config = frames[0].config;
  const sampleRate = config.sampleRate;
  const first = frames[0].time;
  const last = frames[frames.length - 1];
  const length = Math.ceil((last.time + last.duration - first) * sampleRate) + 4096;
  const channels = [new Float32Array(length), new Float32Array(length)];
  let failure = null;
  const placed = [];
  const decoder = new AudioDecoder({
    output: (data) => {
      if (data.sampleRate !== sampleRate) {
        data.close(); // a mid-window sample-rate switch; rare enough to leave silent
        return;
      }
      const at = Math.round((data.timestamp / 1e6 - first) * sampleRate);
      const count = Math.min(data.numberOfFrames, length - at);
      placed.push([at, at + count]);
      if (count > 0 && at >= 0) {
        const plane = new Float32Array(data.numberOfFrames);
        for (let c = 0; c < 2; c++) {
          data.copyTo(plane, { planeIndex: Math.min(c, data.numberOfChannels - 1), format: "f32-planar" });
          channels[c].set(plane.subarray(0, count), at);
        }
      }
      data.close();
    },
    error: (error) => { failure = error; },
  });
  decoder.configure(config);
  let current = configKey(config);
  for (const frame of frames) {
    // A real format change mid-window (e.g. a quality switch): reconfigure and carry on.
    if (configKey(frame.config) !== current) {
      await decoder.flush();
      decoder.configure(frame.config);
      current = configKey(frame.config);
    }
    decoder.decode(new EncodedAudioChunk({
      type: "key",
      timestamp: Math.round(frame.time * 1e6),
      duration: Math.round(frame.duration * 1e6),
      data: frame.data,
    }));
  }
  await decoder.flush();
  decoder.close();
  if (failure) throw failure;
  // Unfilled samples between decoded frames: timestamp holes the separation would hear as silence.
  placed.sort((a, b) => a[0] - b[0]);
  let holes = 0;
  for (let i = 1; i < placed.length; i++) holes += Math.max(0, placed[i][0] - placed[i - 1][1]);
  return { channels, sampleRate, start: first, holesMs: (holes / sampleRate) * 1000, outputs: placed.length, inputs: frames.length };
}

async function separate(k, range) {
  const t0 = performance.now();
  const decoded = await decode(range.range);
  const [windowStart] = windowFor(k);
  const end = streamEnd();
  const [left, right] = resample(decoded.channels, decoded.sampleRate, decoded.start, windowStart, WINDOW_SAMPLES);
  // Before the captured run (after a seek) and past the media's end the window
  // is silence; the resampler already reads missing input as zeros.
  const runStart = Math.round((range.validFrom - windowStart) * RATE);
  if (runStart > 0) {
    left.fill(0, 0, Math.min(runStart, WINDOW_SAMPLES));
    right.fill(0, 0, Math.min(runStart, WINDOW_SAMPLES));
  }
  if (Number.isFinite(end)) {
    const cut = Math.max(0, Math.round((end - windowStart) * RATE));
    left.fill(0, Math.min(cut, WINDOW_SAMPLES));
    right.fill(0, Math.min(cut, WINDOW_SAMPLES));
  }
  const t1 = performance.now();
  const { spec, magnitude } = analyze(left, right);
  const t2 = performance.now();
  const output = await session.run({ x: new ort.Tensor("float32", magnitude, [2, 1, 512, 1024]) });
  const t3 = performance.now();
  const vocals = synthesize(spec, output.mask.data);
  const t4 = performance.now();
  return {
    vocals,
    timing: {
      decode: t1 - t0, stft: t2 - t1, model: t3 - t2, istft: t4 - t3, total: t4 - t0,
      holesMs: decoded.holesMs, frames: `${decoded.outputs}/${decoded.inputs}`,
    },
  };
}

async function pump() {
  if (busy || !session || !stream) return;
  busy = true;
  try {
    for (;;) {
      const streamId = stream.id;
      let job = null;
      for (const { k, from } of wanted) {
        if (done.has(k)) continue;
        const found = ready(k, from);
        if (found) {
          job = { k, ...found };
          break;
        }
      }
      if (!job) break;
      done.add(job.k);
      const { vocals, timing } = await separate(job.k, job);
      if (stream.id !== streamId) continue; // the video changed while this chunk ran
      send({ type: "chunk", streamId, k: job.k, validFrom: job.validFrom, left: vocals.left, right: vocals.right, timing },
        [vocals.left.buffer, vocals.right.buffer]);
    }
  } catch (error) {
    send({ type: "error", message: `Separation failed: ${error.message}` });
  } finally {
    busy = false;
  }
}

function onMessage({ data }) {
  switch (data.type) {
    case "stream":
      newStream(data.streamId);
      break;
    case "entries":
      if (stream?.id !== data.streamId) return;
      for (const entry of data.entries) onEntry(entry);
      break;
    case "want":
      if (stream?.id !== data.streamId) return;
      wanted = data.chunks;
      if (Number.isFinite(data.duration)) stream.duration = data.duration;
      // Chunks the page evicted can be separated again when it asks later.
      for (const k of data.forget ?? []) done.delete(k);
      break;
    case "stats": {
      const list = stream?.frames ?? [];
      const runs = [];
      for (const frame of list) {
        const last = runs[runs.length - 1];
        if (last && frame.time <= last[1] + GAP_TOLERANCE) last[1] = Math.max(last[1], frame.time + frame.duration);
        else runs.push([frame.time, frame.time + frame.duration]);
      }
      send({
        type: "stats",
        runs: runs.slice(0, 20).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]),
        wanted,
        done: [...done],
        frames: list.length,
        first: list[0]?.time ?? null,
        last: list.length ? list[list.length - 1].time + list[list.length - 1].duration : null,
        ended: stream?.ended ?? false,
        crossOriginIsolated: self.crossOriginIsolated,
      });
      return;
    }
    default:
      return;
  }
  loadModel().then(pump, (error) => send({ type: "error", message: `Model failed to load: ${error.message}` }));
}

self.onmessage = (event) => {
  if (event.data?.type !== "port") return;
  port = event.ports[0];
  port.onmessage = onMessage;
  send({ type: "hello" });
  loadModel().catch((error) => send({ type: "error", message: `Model failed to load: ${error.message}` }));
};
