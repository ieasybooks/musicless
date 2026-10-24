// Runs in the page's own JavaScript world at document_start, before the site's
// player. Media Source players (YouTube and most streaming sites) hand the
// browser encoded audio through SourceBuffer.appendBuffer, usually well ahead
// of the playhead. This hook keeps a copy of every audio append so the content
// script can separate audio before it plays, without downloading anything.
//
// Messages to the content script go through window.postMessage. The page can
// see them, but they only contain the page's own media bytes.

(() => {
  if (window.__nomusicOfflineCapture) return;
  window.__nomusicOfflineCapture = true;

  const NS = "nomusic-offline";
  const AUDIO_CODECS = /mp4a|opus/i;
  const STORE_LIMIT = 256 * 2 ** 20; // bytes kept across all streams on the page

  const streamIds = new WeakMap(); // MediaSource -> stream id
  const buffers = new WeakMap(); // SourceBuffer -> { streamId, bufferId }
  const streams = new Map(); // stream id -> { url, buffers: Map, log: [], bytes, subscribed }
  let nextId = 1;
  let storedBytes = 0;

  const post = (message, transfer = []) => window.postMessage({ [NS]: "capture", ...message }, "*", transfer);

  function streamFor(mediaSource) {
    let id = streamIds.get(mediaSource);
    if (!id) {
      id = nextId++;
      streamIds.set(mediaSource, id);
      streams.set(id, { url: null, buffers: new Map(), log: [], subscribed: false, created: Date.now() });
    }
    return id;
  }

  function describe(id) {
    const stream = streams.get(id);
    return { type: "stream", streamId: id, url: stream.url, buffers: [...stream.buffers.values()] };
  }

  // Oldest streams that nobody is listening to are dropped first.
  function enforceLimit() {
    for (const [id, stream] of streams) {
      if (storedBytes <= STORE_LIMIT) return;
      if (stream.subscribed) continue;
      for (const entry of stream.log) storedBytes -= entry.bytes?.byteLength ?? 0;
      stream.log = [];
      stream.dropped = true;
    }
  }

  function record(id, entry) {
    const stream = streams.get(id);
    if (!stream) return;
    stream.counts ??= {};
    stream.counts[entry.kind] = (stream.counts[entry.kind] ?? 0) + 1;
    if (entry.kind === "append") (stream.offsets ??= new Set()).add(entry.offset);
    if (entry.bytes) storedBytes += entry.bytes.byteLength;
    stream.log.push(entry);
    if (stream.subscribed) {
      // The log keeps its own copy; the content script gets a transferred one.
      const copy = entry.bytes ? entry.bytes.slice() : null;
      post({ type: "event", streamId: id, entry: { ...entry, bytes: copy } }, copy ? [copy.buffer] : []);
    }
    enforceLimit();
  }

  const nativeCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    const url = nativeCreateObjectURL.apply(this, arguments);
    if (object instanceof MediaSource) {
      const id = streamFor(object);
      streams.get(id).url = url;
      post(describe(id));
    }
    return url;
  };

  const msProto = MediaSource.prototype;
  const nativeAdd = msProto.addSourceBuffer;
  msProto.addSourceBuffer = function (mime) {
    const sourceBuffer = nativeAdd.apply(this, arguments);
    if (AUDIO_CODECS.test(String(mime))) {
      const streamId = streamFor(this);
      const bufferId = nextId++;
      buffers.set(sourceBuffer, { streamId, bufferId });
      streams.get(streamId).buffers.set(bufferId, { bufferId, mime: String(mime) });
      record(streamId, { kind: "buffer", bufferId, mime: String(mime) });
      post(describe(streamId));
    }
    return sourceBuffer;
  };

  const nativeEnd = msProto.endOfStream;
  msProto.endOfStream = function () {
    const id = streamIds.get(this);
    if (id) record(id, { kind: "end" });
    return nativeEnd.apply(this, arguments);
  };

  const sbProto = SourceBuffer.prototype;
  const nativeAppend = sbProto.appendBuffer;
  sbProto.appendBuffer = function (data) {
    const info = buffers.get(this);
    if (info) {
      const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      record(info.streamId, {
        kind: "append",
        bufferId: info.bufferId,
        offset: this.timestampOffset,
        bytes: view.slice(),
      });
    }
    return nativeAppend.apply(this, arguments);
  };

  const nativeAbort = sbProto.abort;
  sbProto.abort = function () {
    const info = buffers.get(this);
    if (info) record(info.streamId, { kind: "abort", bufferId: info.bufferId });
    return nativeAbort.apply(this, arguments);
  };

  if (sbProto.changeType) {
    const nativeChangeType = sbProto.changeType;
    sbProto.changeType = function (mime) {
      const info = buffers.get(this);
      if (info) record(info.streamId, { kind: "changeType", bufferId: info.bufferId, mime: String(mime) });
      return nativeChangeType.apply(this, arguments);
    };
  }

  // Test diagnostics (localStorage.nomusicDebug = "1"): what the player appended.
  try {
    if (localStorage.getItem("nomusicDebug") === "1") {
      window.__nomusicCaptureDebug = () => [...streams].map(([id, s]) => ({
        id, url: s.url, buffers: [...s.buffers.values()], counts: s.counts, offsets: [...(s.offsets ?? [])].slice(0, 10),
        stored: s.log.length, subscribed: s.subscribed,
      }));
    }
  } catch { /* storage unavailable */ }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.[NS] !== "control") return;
    const { type, streamId } = event.data;
    if (type === "hello") {
      for (const id of streams.keys()) post(describe(id));
    } else if (type === "subscribe" && streams.has(streamId)) {
      const stream = streams.get(streamId);
      stream.subscribed = true;
      const entries = stream.log.map((entry) => ({ ...entry, bytes: entry.bytes ? entry.bytes.slice() : null }));
      post({ type: "replay", streamId, dropped: !!stream.dropped, entries },
        entries.filter((entry) => entry.bytes).map((entry) => entry.bytes.buffer));
    } else if (type === "unsubscribe" && streams.has(streamId)) {
      streams.get(streamId).subscribed = false;
    }
  });
})();
