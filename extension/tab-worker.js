// A tab's separation worker. It keeps the captured encoded audio of each video
// playing in the tab, decodes and resamples the windows the content script
// asks for (in its priority order), runs them through the model, and sends
// the vocals back. The model itself usually lives in a shared worker so every
// tab uses one copy (see model-worker.js); without one, it is loaded here.
//
// WebCodecs' AudioDecoder is not available in shared workers, which is why
// decoding stays in this per-tab worker.

import { configKey, createDemuxer } from "./demux.js";
import { analyze, resample, synthesize } from "./dsp.js";
import { applyFades, chunkStart, RATE, WINDOW_SAMPLES, WINDOW_SECONDS } from "./grid.js";

const WARMUP_SECONDS = 0.25; // decoder pre-roll before a window starts
const GAP_TOLERANCE = 0.005;
const LEAD_TOLERANCE = 0.3; // the page asks from 0.25 s before the playhead
// Encoded audio kept behind the playhead. Players hold at most ~10 minutes of
// audio in their own buffers; seeking further back makes them append it again.
const KEEP_BEHIND_SECONDS = 900;
const SHARED_MODEL_TIMEOUT_MS = 20000;
const RUN_TIMEOUT_MS = 120000;

let port = null;
let model = null;
const streams = new Map(); // stream id -> { id, buffers, frames, ended, duration, wanted, done, playing, position }
let busy = false;

const send = (message, transfer) => port.postMessage(message, transfer ?? []);

// ---- model access -----------------------------------------------------------

function localModel() {
  let created = null;
  const get = () => (created ??= import("./model.js").then(({ createModel }) => createModel()));
  return {
    shared: false,
    load: () => get().then((m) => m.load()),
    run: (magnitude, priority) => get().then((m) => m.run(magnitude, priority)),
  };
}

// The shared model, falling back to a local copy if it cannot start.
function sharedModel(modelPort) {
  const pending = new Map();
  let nextId = 1;
  let fallback = null;
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const timer = setTimeout(() => settle.reject(new Error("the shared model did not answer")), SHARED_MODEL_TIMEOUT_MS);
  modelPort.onmessage = ({ data }) => {
    if (data.type === "ready") {
      clearTimeout(timer);
      settle.resolve(data.seconds);
    } else if (data.type === "failed") {
      clearTimeout(timer);
      settle.reject(new Error(data.message));
    } else if (data.type === "result" || data.type === "error") {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      clearTimeout(job.timer);
      if (data.type === "result") job.resolve({ mask: data.mask, ms: data.ms });
      else job.reject(new Error(data.message));
    }
  };
  modelPort.postMessage({ type: "load" });
  const loaded = ready.catch(() => {
    fallback = localModel();
    return fallback.load();
  });
  return {
    get shared() {
      return !fallback;
    },
    load: () => loaded,
    async run(magnitude, priority) {
      await loaded;
      if (fallback) return fallback.run(magnitude, priority);
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("the shared model stopped answering"));
        }, RUN_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        modelPort.postMessage({ type: "run", id, priority, magnitude }, [magnitude.buffer]);
      });
    },
  };
}

function loadModel() {
  return model.load().then(
    (seconds) => send({ type: "model", seconds, shared: model.shared }),
    (error) => send({ type: "error", fatal: true, message: `The model failed to load: ${error.message}` }),
  );
}

// ---- captured audio ---------------------------------------------------------

function newStream(id) {
  const stream = {
    id, buffers: new Map(), frames: [], ended: false, duration: Infinity,
    wanted: [], done: new Set(), playing: false, position: 0,
  };
  streams.set(id, stream);
  return stream;
}

// Frames stay sorted by time; a re-appended range replaces nothing, it is skipped.
function addFrames(stream, buffer, frames) {
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

function report(stream, reason, message) {
  if (stream.reported) return;
  stream.reported = reason;
  send({ type: "unsupported", streamId: stream.id, reason, message });
}

function onEntry(stream, entry) {
  if (entry.kind === "end") {
    stream.ended = true;
    return;
  }
  let buffer = stream.buffers.get(entry.bufferId);
  if (entry.kind === "buffer" || entry.kind === "changeType") {
    try {
      buffer = { id: entry.bufferId, mime: entry.mime, demuxer: createDemuxer(entry.mime) };
      stream.buffers.set(entry.bufferId, buffer);
    } catch {
      report(stream, "codec", "This video's audio format is not supported.");
    }
    return;
  }
  if (!buffer) return;
  if (entry.kind === "abort") {
    buffer.demuxer.reset();
    return;
  }
  try {
    const frames = buffer.demuxer.push(entry.bytes, entry.offset || 0);
    if (buffer.demuxer.protected) {
      report(stream, "protected", "This video is copy-protected, so its audio cannot be read.");
      return;
    }
    if (frames.length) {
      const config = buffer.demuxer.config;
      if (config !== buffer.checkedConfig) {
        buffer.checkedConfig = config;
        // Some builds (e.g. open-source Chromium) cannot decode AAC.
        const unsupported = () => report(stream, "codec", `This browser cannot decode this video's audio (${config.codec}).`);
        AudioDecoder.isConfigSupported(config).then(({ supported }) => supported || unsupported(), unsupported);
      }
      for (const frame of frames) frame.config = config;
      addFrames(stream, buffer, frames);
    } else if (buffer.demuxer.unsupported) {
      report(stream, "codec", `This video's audio format (${buffer.demuxer.unsupported}) is not supported.`);
    }
  } catch (error) {
    send({ type: "error", streamId: stream.id, message: `Could not read the audio stream: ${error.message}` });
  }
}

// Old frames the page is unlikely to need again.
function evict(stream) {
  const cutoff = stream.position - KEEP_BEHIND_SECONDS;
  const list = stream.frames;
  if (!list.length || list[0].time + list[0].duration >= cutoff) return;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time + list[mid].duration < cutoff) lo = mid + 1;
    else hi = mid;
  }
  list.splice(0, lo);
}

// The run of contiguous frames that reaches `end`, extended back toward
// `start`: [first index, last index, run start time], or null if `end` is not
// covered yet. A seek leaves earlier audio missing, so a run may begin late.
function run(stream, start, end) {
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

function streamEnd(stream) {
  const last = stream.frames[stream.frames.length - 1];
  const decodedEnd = last ? last.time + last.duration : 0;
  if (stream.ended) return decodedEnd;
  // Near the media's end, the final frame may stop just short of the duration.
  if (Number.isFinite(stream.duration) && decodedEnd >= stream.duration - 0.25) return decodedEnd;
  return Infinity;
}

// A chunk can be separated once audio runs unbroken from `from` (the earliest
// time the page needs) to the window's end. Returns the frame range and the
// time from which the result is valid.
function ready(stream, k, from) {
  const start = chunkStart(k);
  const end = start + WINDOW_SECONDS;
  const stop = Math.min(end, streamEnd(stream));
  if (start >= stop) return null;
  const found = run(stream, Math.max(start - WARMUP_SECONDS, 0), stop);
  if (!found) return null;
  const [first, last, runStart] = found;
  // Audio may begin a little after the requested point (muxing offsets put the
  // first frame at e.g. 0.01 s); the page only plays a chunk from where it is valid.
  if (runStart > Math.max(from, start, 0) + LEAD_TOLERANCE) return null;
  return { range: [first, last], validFrom: runStart <= start + GAP_TOLERANCE ? start : runStart };
}

async function decode(stream, range) {
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

async function separate(stream, job) {
  const t0 = performance.now();
  const decoded = await decode(stream, job.range);
  const windowStart = chunkStart(job.k);
  const end = streamEnd(stream);
  const [left, right] = resample(decoded.channels, decoded.sampleRate, decoded.start, windowStart, WINDOW_SAMPLES);
  // Before the captured run (after a seek) and past the media's end the window
  // is silence; the resampler already reads missing input as zeros.
  const runStart = Math.round((job.validFrom - windowStart) * RATE);
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
  const { mask, ms } = await model.run(magnitude, job.priority);
  const t3 = performance.now();
  const vocals = synthesize(spec, mask);
  applyFades([vocals.left, vocals.right], job.k);
  const t4 = performance.now();
  return {
    vocals,
    timing: {
      decode: t1 - t0, stft: t2 - t1, model: ms, wait: t3 - t2 - ms, istft: t4 - t3, total: t4 - t0,
      holesMs: decoded.holesMs, frames: `${decoded.outputs}/${decoded.inputs}`,
    },
  };
}

// The most urgent separable chunk across the tab's streams: a playing video's
// first wanted chunk before anything else, then look-ahead in request order.
function nextJob() {
  let best = null;
  for (const stream of streams.values()) {
    if (stream.reported) continue;
    for (let i = 0; i < stream.wanted.length; i++) {
      const { k, from } = stream.wanted[i];
      if (stream.done.has(k)) continue;
      const found = ready(stream, k, from);
      if (!found) continue;
      const priority = (stream.playing ? 0 : 10) + i;
      if (!best || priority < best.priority) best = { stream, k, priority, ...found };
      break;
    }
  }
  return best;
}

async function pump() {
  if (busy || !model) return;
  busy = true;
  try {
    for (let job = nextJob(); job; job = nextJob()) {
      const { stream } = job;
      stream.done.add(job.k);
      try {
        const { vocals, timing } = await separate(stream, job);
        if (streams.get(stream.id) !== stream) continue; // the video changed while this chunk ran
        send({ type: "chunk", streamId: stream.id, k: job.k, validFrom: job.validFrom, left: vocals.left, right: vocals.right, timing },
          [vocals.left.buffer, vocals.right.buffer]);
      } catch (error) {
        stream.done.delete(job.k);
        send({ type: "error", streamId: stream.id, message: `Separation failed: ${error.message}` });
        break;
      }
    }
  } finally {
    busy = false;
  }
}

function stats(stream) {
  const runs = [];
  for (const frame of stream?.frames ?? []) {
    const last = runs[runs.length - 1];
    if (last && frame.time <= last[1] + GAP_TOLERANCE) last[1] = Math.max(last[1], frame.time + frame.duration);
    else runs.push([frame.time, frame.time + frame.duration]);
  }
  const list = stream?.frames ?? [];
  return {
    type: "stats",
    streamId: stream?.id,
    runs: runs.slice(0, 20).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]),
    wanted: stream?.wanted ?? [],
    done: [...(stream?.done ?? [])],
    frames: list.length,
    bytes: list.reduce((sum, frame) => sum + frame.data.byteLength, 0),
    first: list[0]?.time ?? null,
    last: list.length ? list[list.length - 1].time + list[list.length - 1].duration : null,
    ended: stream?.ended ?? false,
    streams: streams.size,
    sharedModel: model?.shared ?? null,
  };
}

function onMessage({ data }) {
  const stream = streams.get(data.streamId);
  switch (data.type) {
    case "load":
      break;
    case "stream":
      newStream(data.streamId);
      break;
    case "drop":
      streams.delete(data.streamId);
      return;
    case "entries":
      if (!stream) return;
      for (const entry of data.entries) onEntry(stream, entry);
      break;
    case "want":
      if (!stream) return;
      stream.wanted = data.chunks;
      stream.playing = !!data.playing;
      stream.position = data.position ?? stream.position;
      if (Number.isFinite(data.duration)) stream.duration = data.duration;
      // Chunks the page evicted can be separated again when it asks later.
      for (const k of data.forget ?? []) stream.done.delete(k);
      evict(stream);
      break;
    case "stats":
      send(stats(stream));
      return;
    default:
      return;
  }
  model.load().then(pump, () => {});
}

self.onmessage = (event) => {
  if (event.data?.type !== "port") return;
  [port] = event.ports;
  model = event.ports[1] ? sharedModel(event.ports[1]) : localModel();
  port.onmessage = onMessage;
  send({ type: "connected" });
  loadModel();
};
