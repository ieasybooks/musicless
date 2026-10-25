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
//
// The player must never notice: each wrapper calls the browser's own method
// first (its errors reach the page as before), records only what the browser
// accepted, and swallows any error of its own.

(() => {
  if (window.__nomusicCapture) return;
  window.__nomusicCapture = true;

  const NS = "nomusic";
  const AUDIO_CODECS = /mp4a|opus/i;
  const STREAM_LIMIT = 16 * 2 ** 20; // ~14 minutes of YouTube audio
  const TOTAL_LIMIT = 48 * 2 ** 20; // across all streams on the page

  const MAX_HEADER = 256 * 1024; // a format header is a few kilobytes: past this, parts are media

  const streamIds = new WeakMap(); // MediaSource -> stream id
  const urls = new WeakMap(); // MediaSource -> its latest object URL
  const buffers = new WeakMap(); // SourceBuffer -> { streamId, bufferId }
  const streams = new Map(); // stream id -> { url, buffers, headers, log, bytes, subscribed }
  let nextId = 1;

  const safely = (fn) => {
    try {
      fn();
    } catch {
      // Only nomusic's copy suffers: missing audio makes the session fail closed.
    }
  };

  const post = (message, transfer = []) => window.postMessage({ [NS]: "capture", ...message }, "*", transfer);

  // Where an append starts: a format header ("init"), a new media segment
  // ("media"), or the continuation of a segment split across appends ("part",
  // marked `header` while it continues a format header).
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

  // A Media Source's stream. A closed one's audio is freed; if the player opens
  // that Media Source again, it is a new stream.
  function streamFor(mediaSource) {
    let id = streamIds.get(mediaSource);
    if (!streams.has(id)) {
      id = nextId++;
      streamIds.set(mediaSource, id);
      streams.set(id, { url: urls.get(mediaSource) ?? null, buffers: new Map(), headers: new Map(), log: [], bytes: 0, subscribed: false });
      mediaSource.addEventListener("sourceclose", () => {
        if (streamIds.get(mediaSource) === id) streamIds.delete(mediaSource);
        if (streams.delete(id)) post({ type: "closed", streamId: id });
      }, { once: true });
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
    const latestHeader = new Map(); // buffer id -> log positions of its latest format header (init and parts)
    const started = new Set();
    const kept = [];
    for (let at = 0; at < log.length; at++) {
      const entry = log[at];
      if (entry.kind === "buffer" || entry.kind === "changeType") started.delete(entry.bufferId);
      if (entry.kind === "append" && entry.header) {
        if (entry.segment === "init") latestHeader.set(entry.bufferId, [at]);
        else latestHeader.get(entry.bufferId)?.push(at);
      }
      if (drop.has(at)) continue;
      // An abort before a buffer's oldest kept audio no longer means anything.
      if (entry.kind === "abort" && !started.has(entry.bufferId)) continue;
      if (entry.kind === "append" && !started.has(entry.bufferId)) {
        started.add(entry.bufferId);
        const header = latestHeader.get(entry.bufferId);
        if (!entry.header && header?.some((position) => drop.has(position))) {
          for (const position of header) {
            kept.push(log[position]);
            bytes += log[position].bytes.byteLength;
          }
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
    if (entry.kind === "append") {
      // A format header can come in several appends; its parts stay with it.
      const size = stream.headers.get(entry.bufferId);
      if (entry.segment === "init" || (entry.segment === "part" && size + entry.bytes.length <= MAX_HEADER)) {
        stream.headers.set(entry.bufferId, (entry.segment === "init" ? 0 : size) + entry.bytes.length);
        entry.header = true;
      } else {
        stream.headers.delete(entry.bufferId);
      }
    }
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
    safely(() => {
      if (!(object instanceof MediaSource)) return;
      urls.set(object, url);
      const id = streamFor(object);
      streams.get(id).url = url;
      post(describe(id));
    });
    return url;
  };

  const msProto = MediaSource.prototype;
  const nativeAdd = msProto.addSourceBuffer;
  msProto.addSourceBuffer = function (mime) {
    const sourceBuffer = nativeAdd.apply(this, arguments);
    safely(() => {
      if (!AUDIO_CODECS.test(String(mime))) return;
      const streamId = streamFor(this);
      const bufferId = nextId++;
      buffers.set(sourceBuffer, { streamId, bufferId });
      streams.get(streamId).buffers.set(bufferId, { bufferId, mime: String(mime) });
      record(streamId, { kind: "buffer", bufferId, mime: String(mime) });
      post(describe(streamId));
    });
    return sourceBuffer;
  };

  const nativeEnd = msProto.endOfStream;
  msProto.endOfStream = function () {
    const result = nativeEnd.apply(this, arguments);
    safely(() => {
      const id = streamIds.get(this);
      if (id) record(id, { kind: "end" });
    });
    return result;
  };

  const sbProto = SourceBuffer.prototype;
  const nativeAppend = sbProto.appendBuffer;
  sbProto.appendBuffer = function (data) {
    const result = nativeAppend.apply(this, arguments);
    safely(() => {
      const info = buffers.get(this);
      if (!info || !streams.has(info.streamId)) return;
      const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
      const bytes = view.slice();
      record(info.streamId, {
        kind: "append",
        bufferId: info.bufferId,
        offset: this.timestampOffset,
        segment: segmentKind(bytes),
        bytes,
      });
    });
    return result;
  };

  const nativeAbort = sbProto.abort;
  sbProto.abort = function () {
    const result = nativeAbort.apply(this, arguments);
    safely(() => {
      const info = buffers.get(this);
      if (info) record(info.streamId, { kind: "abort", bufferId: info.bufferId });
    });
    return result;
  };

  if (sbProto.changeType) {
    const nativeChangeType = sbProto.changeType;
    sbProto.changeType = function (mime) {
      const result = nativeChangeType.apply(this, arguments);
      safely(() => {
        const info = buffers.get(this);
        if (info) record(info.streamId, { kind: "changeType", bufferId: info.bufferId, mime: String(mime) });
      });
      return result;
    };
  }

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
