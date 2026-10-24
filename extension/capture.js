// Runs in the page's own JavaScript world at document_start, before the site's
// player. Media Source players (YouTube and most streaming sites) hand the
// browser encoded audio through SourceBuffer.appendBuffer, usually well ahead
// of the playhead. This hook keeps a copy of recent audio appends so the
// content script can separate audio before it plays, without downloading
// anything. Nothing is stored beyond page memory.
//
// Memory is bounded: a stream's copy is dropped when its player detaches it,
// and each live stream keeps only its most recent STREAM_LIMIT bytes (players
// re-append audio after a seek to anything they no longer hold themselves).
//
// Messages to the content script go through window.postMessage. The page can
// see them, but they only contain the page's own media bytes.

(() => {
  if (window.__nomusicCapture) return;
  window.__nomusicCapture = true;

  const NS = "nomusic";
  const AUDIO_CODECS = /mp4a|opus/i;
  const STREAM_LIMIT = 16 * 2 ** 20; // ~14 minutes of YouTube audio
  const TOTAL_LIMIT = 48 * 2 ** 20; // across all streams on the page

  const streamIds = new WeakMap(); // MediaSource -> stream id
  const buffers = new WeakMap(); // SourceBuffer -> { streamId, bufferId }
  const streams = new Map(); // stream id -> { url, buffers, log, bytes, subscribed }
  let nextId = 1;

  const post = (message, transfer = []) => window.postMessage({ [NS]: "capture", ...message }, "*", transfer);

  // Where an append starts: a format header ("init"), a new media segment
  // ("media"), or the continuation of a segment split across appends ("part").
  function segmentKind(bytes) {
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "init"; // WebM EBML
    if (bytes[0] === 0x1f && bytes[1] === 0x43 && bytes[2] === 0xb6 && bytes[3] === 0x75) return "media"; // WebM Cluster
    if (bytes.length >= 8) {
      const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      if (type === "ftyp" || type === "moov") return "init";
      if (type === "moof" || type === "styp" || type === "sidx" || type === "emsg" || type === "prft") return "media";
    }
    return "part";
  }

  function streamFor(mediaSource) {
    let id = streamIds.get(mediaSource);
    if (!id) {
      id = nextId++;
      streamIds.set(mediaSource, id);
      streams.set(id, { url: null, buffers: new Map(), log: [], bytes: 0, subscribed: false, created: Date.now() });
      // A detached Media Source never plays again: free its audio.
      mediaSource.addEventListener("sourceclose", () => {
        if (!streams.delete(id)) return;
        post({ type: "closed", streamId: id });
      });
    }
    return id;
  }

  function describe(id) {
    const stream = streams.get(id);
    return { type: "stream", streamId: id, url: stream.url, buffers: [...stream.buffers.values()] };
  }

  // Drop the oldest appended audio until the stream fits in `limit`. Structural
  // entries stay. Each buffer's kept data starts at a segment boundary, with its
  // latest format header put back in front when that was dropped.
  function trim(stream, limit) {
    const log = stream.log;
    const drop = new Set();
    let bytes = stream.bytes;
    let i = 0;
    for (; i < log.length && bytes > limit; i++) {
      if (log[i].kind !== "append") continue;
      drop.add(i);
      bytes -= log[i].bytes.byteLength;
    }
    // Finish any segment cut in half: its remaining parts cannot be parsed alone.
    const open = new Set([...drop].map((at) => log[at].bufferId));
    for (; i < log.length && open.size; i++) {
      const entry = log[i];
      if (entry.kind !== "append" || !open.has(entry.bufferId)) continue;
      if (entry.segment !== "part") {
        open.delete(entry.bufferId);
        continue;
      }
      drop.add(i);
      bytes -= entry.bytes.byteLength;
    }
    const latestInit = new Map();
    const started = new Set();
    const kept = [];
    for (let at = 0; at < log.length; at++) {
      const entry = log[at];
      if (entry.kind === "buffer" || entry.kind === "changeType") started.delete(entry.bufferId);
      if (entry.kind === "append" && entry.segment === "init") latestInit.set(entry.bufferId, at);
      if (drop.has(at)) continue;
      // An abort before a buffer's oldest kept audio no longer means anything.
      if (entry.kind === "abort" && !started.has(entry.bufferId)) continue;
      if (entry.kind === "append" && !started.has(entry.bufferId)) {
        started.add(entry.bufferId);
        const init = latestInit.get(entry.bufferId);
        if (entry.segment !== "init" && init !== undefined && drop.has(init)) {
          kept.push(log[init]);
          bytes += log[init].bytes.byteLength;
        }
      }
      kept.push(entry);
    }
    stream.log = kept;
    stream.bytes = bytes;
  }

  // Past the page-wide limit, forget whole streams nobody is listening to, oldest first.
  function enforceTotal() {
    let total = 0;
    for (const stream of streams.values()) total += stream.bytes;
    for (const stream of streams.values()) {
      if (total <= TOTAL_LIMIT) return;
      if (stream.subscribed || !stream.bytes) continue;
      total -= stream.bytes;
      trim(stream, 0);
      stream.dropped = true;
    }
  }

  function record(id, entry) {
    const stream = streams.get(id);
    if (!stream) return;
    stream.counts ??= {};
    stream.counts[entry.kind] = (stream.counts[entry.kind] ?? 0) + 1;
    if (entry.bytes) stream.bytes += entry.bytes.byteLength;
    stream.log.push(entry);
    if (stream.subscribed) {
      // The log keeps its own copy; the content script gets a transferred one.
      const copy = entry.bytes ? entry.bytes.slice() : null;
      post({ type: "event", streamId: id, entry: { ...entry, bytes: copy } }, copy ? [copy.buffer] : []);
    }
    if (stream.bytes > STREAM_LIMIT) {
      trim(stream, STREAM_LIMIT);
      stream.dropped = true;
    }
    enforceTotal();
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
    if (info && streams.has(info.streamId)) {
      const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const bytes = view.slice();
      record(info.streamId, {
        kind: "append",
        bufferId: info.bufferId,
        offset: this.timestampOffset,
        segment: segmentKind(bytes),
        bytes,
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
        id, url: s.url, buffers: [...s.buffers.values()], counts: s.counts, bytes: s.bytes,
        stored: s.log.length, subscribed: s.subscribed, dropped: !!s.dropped,
      }));
    }
  } catch { /* storage unavailable */ }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.[NS] !== "control") return;
    const { type, streamId } = event.data;
    if (type === "hello") {
      for (const id of streams.keys()) post(describe(id));
    } else if (type === "subscribe") {
      const stream = streams.get(streamId);
      if (!stream) {
        post({ type: "closed", streamId });
        return;
      }
      stream.subscribed = true;
      const entries = stream.log.map((entry) => ({ ...entry, bytes: entry.bytes ? entry.bytes.slice() : null }));
      post({ type: "replay", streamId, dropped: !!stream.dropped, entries },
        entries.filter((entry) => entry.bytes).map((entry) => entry.bytes.buffer));
    } else if (type === "unsubscribe" && streams.has(streamId)) {
      streams.get(streamId).subscribed = false;
    }
  });
})();
