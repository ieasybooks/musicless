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
import { applyFades, chunkIndex, chunkStart, RATE, WINDOW_SAMPLES, WINDOW_SECONDS } from "./grid.js";

const WARMUP_SECONDS = 0.25; // decoder pre-roll before a window starts
const GAP_TOLERANCE = 0.005;
const LEAD_TOLERANCE = 0.3; // the page asks from 0.25 s before the playhead
// Encoded audio kept around the playhead. Players hold at most ~10 minutes of
// audio in their own buffers; seeking further makes them append it again.
const KEEP_BEHIND_SECONDS = 900;
const KEEP_AHEAD_SECONDS = 900;
const MAX_STREAM_BYTES = 64 * 2 ** 20; // far more than 30 minutes of the audio players send
const SHARED_MODEL_TIMEOUT_MS = 20000;
const LOAD_TIMEOUT_MS = 60000; // including a fallback to a copy of our own
const RUN_TIMEOUT_MS = 120000;
const MODEL_PING_MS = 5000;
const MODEL_SILENT_MS = 30000; // longer than the shared model ever runs one job

let port = null;
let model = null;
// stream id -> { id, buffers, frames, removed, bytes, ended, duration, wanted, done, playing, position }
const streams = new Map();
let busy = false;
let current = null; // the job being separated
const supported = new Map(); // decoder config -> whether this browser decodes it (a promise)

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

// The shared model, falling back to a local copy if it cannot start. If it
// stops later (its process crashed, say), the worker cannot go on: the content
// script starts the engine again.
function sharedModel(modelPort) {
  const pending = new Map();
  let nextId = 1;
  let fallback = null;
  let started = false;
  let pinged = 0;
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const failed = (message) => {
    clearTimeout(timer);
    if (fallback) return; // no longer used
    if (!started) {
      settle.reject(new Error(message));
      return;
    }
    clearInterval(watch);
    send({ type: "error", fatal: true, message: `The shared model stopped: ${message}` });
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(message));
    }
    pending.clear();
  };
  const timer = setTimeout(() => failed("the shared model did not answer"), SHARED_MODEL_TIMEOUT_MS);
  // While results are due, ask now and then: a shared model that stays silent has stopped.
  const watch = setInterval(() => {
    if (!started || fallback || !pending.size) {
      pinged = 0;
    } else if (!pinged) {
      pinged = performance.now();
      modelPort.postMessage({ type: "ping" });
    } else if (performance.now() - pinged > MODEL_SILENT_MS) {
      failed("it stopped answering");
    }
  }, MODEL_PING_MS);
  modelPort.onmessage = ({ data }) => {
    pinged = 0;
    if (data.type === "ready" && !fallback) {
      clearTimeout(timer);
      started = true;
      settle.resolve(data.seconds);
    } else if (data.type === "failed") {
      failed(data.message);
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
    clearInterval(watch);
    fallback = localModel();
    return fallback.load();
  });
  return {
    get shared() {
      return !fallback;
    },
    failed,
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

// A model that fails to load, or takes far too long, ends this worker: the
// content script starts the engine again (once).
function loadModel() {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("it took too long")), LOAD_TIMEOUT_MS);
  });
  return Promise.race([model.load(), late]).finally(() => clearTimeout(timer)).then(
    (seconds) => send({ type: "model", seconds, shared: model.shared }),
    (error) => send({ type: "error", fatal: true, message: `The model failed to load: ${error.message}` }),
  );
}

// ---- captured audio ---------------------------------------------------------

function newStream(id) {
  const stream = {
    id, buffers: new Map(), frames: [], removed: [], bytes: 0, ended: false, duration: Infinity,
    wanted: [], done: new Map(), playing: false, position: 0, // done: k -> where its audio was cut by the stream's end
  };
  streams.set(id, stream);
  return stream;
}

const sameFrame = (a, b) => Math.abs(a.time - b.time) < 1e-4 && a.data.length === b.data.length &&
  a.data.every((byte, i) => byte === b.data[i]);

// Index of the first frame at or after `time` in a list sorted by time.
function firstFrom(list, time) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time < time - 1e-4) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const inWindow = (k, from, to) => chunkStart(k) + GAP_TOLERANCE < to && chunkStart(k) + WINDOW_SECONDS - GAP_TOLERANCE > from;
const widen = (span, from, to) => (span ? [Math.min(span[0], from), Math.max(span[1], to)] : [from, to]);

// Frames stay sorted by time. As in the browser's own buffer, newer audio
// replaces the frames it overlaps: appending the same audio again changes
// nothing (also where the player removed it before), other audio there
// (another audio track) replaces it. Returns the spans of time with different
// audio and with audio where there was none.
function addFrames(stream, buffer, frames) {
  const list = stream.frames;
  const spans = { replaced: null, added: null };
  for (const frame of frames) {
    frame.buffer = buffer;
    const end = frame.time + frame.duration;
    const lo = firstFrom(list, frame.time);
    let hi = lo;
    while (hi < list.length && list[hi].time < end - 1e-4) hi++;
    if (hi === lo + 1 && sameFrame(list[lo], frame)) continue;
    let kind = hi > lo ? "replaced" : "added";
    if (kind === "added") {
      const at = firstFrom(stream.removed, frame.time);
      let past = at;
      while (past < stream.removed.length && stream.removed[past].time < end - 1e-4) past++;
      const removed = stream.removed.splice(at, past - at);
      if (removed.length) kind = removed.length === 1 && sameFrame(removed[0], frame) ? null : "replaced";
    }
    if (kind) spans[kind] = widen(spans[kind], frame.time, hi > lo ? Math.max(end, list[hi - 1].time + list[hi - 1].duration) : end);
    for (const replaced of list.splice(lo, hi - lo, frame)) stream.bytes -= replaced.data.length;
    stream.bytes += frame.data.length;
  }
  return spans;
}

// Frames of `buffer` starting in [start, end): audio the player removed. In
// the windows of made chunks they are remembered, so that the same audio
// appended again (a player refilling its buffer) changes nothing.
function removeFrames(stream, buffer, start, end) {
  const kept = [];
  const gone = [];
  for (const frame of stream.frames) {
    if (frame.buffer !== buffer || frame.time < start || frame.time >= end) {
      kept.push(frame);
    } else {
      stream.bytes -= frame.data.length;
      if ([...stream.done.keys()].some((k) => inWindow(k, frame.time, frame.time + frame.duration))) gone.push(frame);
    }
  }
  stream.frames = kept;
  if (gone.length) stream.removed = [...stream.removed, ...gone].sort((a, b) => a.time - b.time);
}

// Audio changed: chunks made from what was there before must be made again.
// The page drops them and asks again; one being made now is dropped. Other
// audio changes a chunk; audio where there was none only changes one that was
// cut short by the end of the stream (which was not the end after all).
function invalidate(stream, { replaced, added }) {
  const changes = (k, cut) => (replaced && inWindow(k, ...replaced)) ||
    (added && added[1] > cut + GAP_TOLERANCE && inWindow(k, ...added));
  if (current?.stream === stream && changes(current.k, current.cut)) current.stale = true;
  const changed = [...stream.done].filter(([k, cut]) => changes(k, cut)).map(([k]) => k);
  for (const k of changed) stream.done.delete(k);
  if (changed.length) send({ type: "changed", streamId: stream.id, chunks: changed });
}

// Some builds (e.g. open-source Chromium) cannot decode AAC.
function decodable(config) {
  const key = configKey(config);
  if (!supported.has(key)) supported.set(key, AudioDecoder.isConfigSupported(config).then((result) => result.supported, () => false));
  return supported.get(key);
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
  if (entry.kind === "append" || entry.kind === "remove") stream.ended = false; // both reopen an ended Media Source
  let buffer = stream.buffers.get(entry.bufferId);
  if (entry.kind === "buffer" || entry.kind === "changeType") {
    try {
      const demuxer = createDemuxer(entry.mime);
      if (entry.kind === "buffer" || !buffer) {
        buffer = { id: entry.bufferId };
        stream.buffers.set(entry.bufferId, buffer);
      }
      Object.assign(buffer, { mime: entry.mime, demuxer, checkedConfig: null }); // a new type keeps the buffer's audio
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
  if (entry.kind === "remove" || entry.kind === "removeBuffer") {
    // Gone from the browser's buffer, so not separated again. Chunks already made
    // stay: if other audio is appended there, that changes them.
    removeFrames(stream, buffer, entry.start ?? -Infinity, entry.end ?? Infinity);
    if (entry.kind === "removeBuffer") stream.buffers.delete(entry.bufferId);
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
        decodable(config).then((ok) => ok || report(stream, "codec", `This browser cannot decode this video's audio (${config.codec}).`));
      }
      for (const frame of frames) frame.config = config;
      invalidate(stream, addFrames(stream, buffer, frames));
    } else if (buffer.demuxer.unsupported) {
      report(stream, "codec", `This video's audio format (${buffer.demuxer.unsupported}) is not supported.`);
    }
  } catch (error) {
    send({ type: "error", streamId: stream.id, message: `Could not read the audio stream: ${error.message}` });
  }
}

// Frames far from the playhead, which the page is unlikely to need: beyond
// KEEP_BEHIND/AHEAD_SECONDS, and the farthest past MAX_STREAM_BYTES.
function evict(stream) {
  const list = stream.frames;
  const { position } = stream;
  let first = 0;
  let end = list.length;
  let bytes = stream.bytes;
  while (first < end && list[first].time + list[first].duration < position - KEEP_BEHIND_SECONDS) bytes -= list[first++].data.length;
  while (end > first && list[end - 1].time > position + KEEP_AHEAD_SECONDS) bytes -= list[--end].data.length;
  while (end > first && bytes > MAX_STREAM_BYTES) {
    if (position - list[first].time > list[end - 1].time - position) bytes -= list[first++].data.length;
    else bytes -= list[--end].data.length;
  }
  if (first || end < list.length) stream.frames = list.slice(first, end);
  stream.bytes = bytes;
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
  // Audio may begin a little after the requested point. Ahead of the playhead
  // that is a gap in the media (muxing offsets put the first frame at e.g.
  // 0.01 s), silent in the browser too: the chunk counts from its start. At the
  // playhead the earlier audio may just not be captured (after a seek), so the
  // page plays the chunk only from where its audio starts.
  if (runStart > Math.max(from, start, 0) + LEAD_TOLERANCE) return null;
  const late = from > start && runStart > start + GAP_TOLERANCE;
  return { range: [first, last], validFrom: late ? runStart : start, cut: stop < end ? stop : Infinity };
}

// Decodes frames of one decoder config. Output is placed at the rate it comes
// at (an AAC config can state half of it, with SBR). The decoder is closed
// however it ends.
async function decode(frames, counts) {
  const first = frames[0].time;
  const last = frames[frames.length - 1];
  const seconds = last.time + last.duration - first;
  const byRate = new Map(); // output sample rate -> { channels, placed }
  let failure = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        const rate = data.sampleRate;
        if (!byRate.has(rate)) {
          const length = Math.ceil(seconds * rate) + 4096;
          byRate.set(rate, { channels: [new Float32Array(length), new Float32Array(length)], placed: [] });
        }
        const { channels, placed } = byRate.get(rate);
        const at = Math.round((data.timestamp / 1e6 - first) * rate);
        const count = Math.min(data.numberOfFrames, channels[0].length - at);
        placed.push([at, at + count]);
        if (count > 0 && at >= 0) {
          const plane = new Float32Array(data.numberOfFrames);
          for (let c = 0; c < 2; c++) {
            data.copyTo(plane, { planeIndex: Math.min(c, data.numberOfChannels - 1), format: "f32-planar" });
            channels[c].set(plane.subarray(0, count), at);
          }
        }
      } catch (error) {
        failure ??= error;
      } finally {
        data.close();
      }
    },
    error: (error) => { failure ??= error; },
  });
  try {
    decoder.configure(frames[0].config);
    for (const frame of frames) {
      decoder.decode(new EncodedAudioChunk({
        type: "key",
        timestamp: Math.round(frame.time * 1e6),
        duration: Math.round(frame.duration * 1e6),
        data: frame.data,
      }));
    }
    await decoder.flush();
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
  if (failure) throw failure;
  // Unfilled samples between decoded frames: timestamp holes the separation would hear as silence.
  for (const [rate, { placed }] of byRate) {
    placed.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < placed.length; i++) counts.holes += Math.max(0, placed[i][0] - placed[i - 1][1]) / rate;
    counts.outputs += placed.length;
  }
  return [...byRate].map(([rate, { channels }]) => ({ channels, rate, start: first }));
}

// The window's audio at 44.1 kHz, decoded in runs of one config (a quality
// switch can change the format, even the sample rate, mid-window). Nothing is
// decoded with a config this browser cannot decode.
async function decodeWindow(stream, frames, windowStart) {
  const counts = { holes: 0, outputs: 0 };
  let out = null;
  for (let i = 0; i < frames.length;) {
    const config = frames[i].config;
    let j = i + 1;
    while (j < frames.length && configKey(frames[j].config) === configKey(config)) j++;
    if (!(await decodable(config))) {
      report(stream, "codec", `This browser cannot decode this video's audio (${config.codec}).`);
      throw new Error(`cannot decode ${config.codec}`);
    }
    for (const run of await decode(frames.slice(i, j), counts)) {
      const resampled = resample(run.channels, run.rate, run.start, windowStart, WINDOW_SAMPLES);
      if (!out) out = resampled;
      else for (let c = 0; c < 2; c++) for (let n = 0; n < WINDOW_SAMPLES; n++) out[c][n] += resampled[c][n];
    }
    i = j;
  }
  return { channels: out ?? [new Float32Array(WINDOW_SAMPLES), new Float32Array(WINDOW_SAMPLES)], holesMs: counts.holes * 1000, outputs: counts.outputs };
}

async function separate(stream, job) {
  const t0 = performance.now();
  const frames = stream.frames.slice(job.range[0], job.range[1] + 1); // before anything can change the list
  const windowStart = chunkStart(job.k);
  const end = streamEnd(stream);
  const decoded = await decodeWindow(stream, frames, windowStart);
  const [left, right] = decoded.channels;
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
      holesMs: decoded.holesMs, frames: `${decoded.outputs}/${frames.length}`,
    },
  };
}

// The most urgent separable chunk across the tab's streams: the nearest to its
// playhead (the chunk a video is at first), a playing video's before a paused
// one's. The shared model orders every tab's jobs by the same numbers.
function nextJob() {
  let best = null;
  for (const stream of streams.values()) {
    if (stream.reported || stream.failed) continue;
    const here = chunkIndex(stream.position);
    for (const { k, from } of stream.wanted) {
      if (stream.done.has(k)) continue;
      const found = ready(stream, k, from);
      if (!found) continue;
      const priority = (stream.playing ? 0 : 10) + Math.max(0, k - here);
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
      stream.done.set(job.k, job.cut);
      current = job;
      try {
        const { vocals, timing } = await separate(stream, job);
        if (streams.get(stream.id) !== stream || job.stale) continue; // dropped, or its audio changed, while it ran
        send({ type: "chunk", streamId: stream.id, k: job.k, validFrom: job.validFrom, left: vocals.left, right: vocals.right, timing },
          [vocals.left.buffer, vocals.right.buffer]);
      } catch (error) {
        if (streams.get(stream.id) !== stream || job.stale) continue;
        // Its session fails closed and drops it; the other streams go on.
        stream.failed = true;
        if (!stream.reported) send({ type: "error", streamId: stream.id, message: `Separation failed: ${error.message}` });
      } finally {
        current = null;
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
    done: [...(stream?.done.keys() ?? [])],
    frames: list.length,
    bytes: stream?.bytes ?? 0,
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
    case "stream":
      newStream(data.streamId);
      break;
    case "drop":
      streams.delete(data.streamId);
      return;
    case "entries":
      if (!stream) return;
      for (const entry of data.entries) onEntry(stream, entry);
      evict(stream);
      break;
    case "want":
      if (!stream) return;
      stream.wanted = data.chunks;
      stream.playing = !!data.playing;
      stream.position = data.position ?? stream.position;
      if (Number.isFinite(data.duration)) stream.duration = data.duration;
      // Chunks the page evicted can be separated again when it asks later; the
      // ones it has (also from before this worker) are watched for changes.
      for (const k of data.forget ?? []) stream.done.delete(k);
      for (const k of data.have ?? []) if (!stream.done.has(k)) stream.done.set(k, Infinity);
      stream.removed = stream.removed.filter((frame) => [...stream.done.keys()].some((k) => inWindow(k, frame.time, frame.time + frame.duration)));
      evict(stream);
      break;
    case "stats":
      send(stats(stream));
      return;
    case "ping":
      send({ type: "pong" });
      return;
    default:
      return;
  }
  model.load().then(pump, () => {});
}

self.onmessage = (event) => {
  if (event.data?.type === "shared-model-failed") {
    model?.failed?.("the shared model could not start");
    return;
  }
  if (event.data?.type !== "port") return;
  [port] = event.ports;
  model = event.ports[1] ? sharedModel(event.ports[1]) : localModel();
  port.onmessage = onMessage;
  send({ type: "connected" });
  loadModel();
};
