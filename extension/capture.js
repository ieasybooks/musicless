// Runs in the page's own JavaScript world at document_start, before the site's
// player. Media Source players (YouTube and most streaming sites) hand the
// browser encoded audio through SourceBuffer.appendBuffer, usually well ahead
// of the playhead. This hook keeps a copy of recent audio appends so the
// content script can separate audio before it plays, without downloading
// anything. Nothing is stored beyond page memory.
//
// Memory is bounded: a stream's copy is dropped when its player detaches it,
// each live stream keeps only its most recent STREAM_LIMIT bytes (players
// re-append audio after a seek to anything they no longer hold themselves),
// all streams together TOTAL_LIMIT, and entries and streams are counted too.
//
// Messages to the content script go through window.postMessage. The page can
// see them, but they only contain the page's own media bytes.
//
// The player must never notice: each wrapper calls the browser's own method
// first (its errors reach the page as before), records only what the browser
// accepted, and swallows any error of its own.
//
// Before the user turns nomusic on, only format headers are kept (any audio
// read later needs them). The content script says which as soon as it knows;
// until then audio is kept, and dropped if the answer is no.

(() => {
  if (window.__nomusicCapture) return;
  window.__nomusicCapture = true;

  const NS = "nomusic";
  const AUDIO_CODECS = /mp4a|opus/i;
  const STREAM_LIMIT = 16 * 2 ** 20; // ~14 minutes of YouTube audio
  const TOTAL_LIMIT = 48 * 2 ** 20; // across all streams on the page
  const MAX_ENTRIES = 10000; // per stream; a player's stay far below
  const MAX_STREAMS = 64;
  const MAX_HEADER = 256 * 1024; // a format header is a few kilobytes: past this, parts are media

  const streamIds = new WeakMap(); // MediaSource -> stream id
  const urls = new WeakMap(); // MediaSource -> its latest object URL
  const buffers = new WeakMap(); // SourceBuffer -> { streamId, bufferId }
  const streams = new Map(); // stream id -> { url, buffers, headers, log, bytes, subscribed, missed }
  let nextId = 1;
  let consented = null; // unknown until the content script says

  const safely = (fn) => {
    try {
      fn();
    } catch {
      // Only nomusic's copy suffers: missing audio makes the session fail closed.
    }
  };

  const post = (message, transfer = []) => window.postMessage({ [NS]: "capture", ...message }, "*", transfer);

  const isWebm = (bytes) => bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3; // EBML
  const MEDIA_BOXES = new Set(["moof", "styp", "sidx", "emsg", "prft", "mdat"]);

  // Where an append starts: a format header ("init"), a new media segment
  // ("media"), or the continuation of a segment split across appends ("part",
  // marked `header` while it continues a format header).
  function segmentKind(bytes) {
    if (isWebm(bytes)) return "init";
    if (bytes[0] === 0x1f && bytes[1] === 0x43 && bytes[2] === 0xb6 && bytes[3] === 0x75) return "media"; // WebM Cluster
    if (bytes.length >= 8) {
      const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      if (type === "ftyp" || type === "moov") return "init";
      if (MEDIA_BOXES.has(type) && type !== "mdat") return "media";
    }
    return "part";
  }

  // An EBML variable-length number: { value, length, unknown }, or null if cut off.
  function vint(bytes, pos, keepMarker) {
    const first = bytes[pos];
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8 || pos + length > bytes.length) return null;
    let value = keepMarker ? first : first & (0xff >> length);
    let unknown = !keepMarker && value === 0xff >> length;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[pos + i];
      if (bytes[pos + i] !== 0xff) unknown = false;
    }
    return { value, length, unknown };
  }

  // Where the format header at the start of `bytes` ends: at the first WebM
  // Cluster, or at the first MP4 box of a media segment. null if it goes on.
  function headerEnd(bytes) {
    const webm = isWebm(bytes);
    let pos = 0;
    while (pos < bytes.length) {
      if (webm) {
        const id = vint(bytes, pos, true);
        const size = id && vint(bytes, pos + id.length, false);
        if (!size) return null;
        if (id.value === 0x1f43b675) return pos;
        if (id.value === 0x18538067) pos += id.length + size.length; // into the Segment, which holds the rest
        else if (size.unknown) return null;
        else pos += id.length + size.length + size.value;
      } else {
        if (pos + 8 > bytes.length) return null;
        if (MEDIA_BOXES.has(String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]))) return pos;
        let size = bytes[pos] * 2 ** 24 + bytes[pos + 1] * 2 ** 16 + bytes[pos + 2] * 2 ** 8 + bytes[pos + 3];
        if (size === 1) {
          if (pos + 16 > bytes.length) return null;
          size = 0;
          for (let i = pos + 8; i < pos + 16; i++) size = size * 256 + bytes[i];
        }
        if (size < 8) return null; // to the end of the file (or not a box at all)
        pos += size;
      }
    }
    return null;
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
      // Media Sources that are never attached never close: past MAX_STREAMS the oldest unused one goes.
      if (streams.size > MAX_STREAMS) {
        const [oldest] = [...streams].find(([, stream]) => !stream.subscribed) ?? [];
        if (streams.delete(oldest)) post({ type: "closed", streamId: oldest });
      }
    }
    return id;
  }

  function describe(id) {
    const stream = streams.get(id);
    return { type: "stream", streamId: id, url: stream.url, buffers: [...stream.buffers.values()] };
  }

  // Drop the oldest appended audio until the stream fits in `limit`. Structural
  // entries stay while they mean something for the kept audio. Each buffer's
  // kept data starts at a segment boundary, with its latest format header put
  // back in front when that was dropped.
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
    const typeChange = new Map(); // buffer id -> where in `kept` its type change waits for kept audio
    const kept = [];
    for (let at = 0; at < log.length; at++) {
      const entry = log[at];
      if (entry.kind === "buffer" || entry.kind === "changeType") started.delete(entry.bufferId);
      if (entry.kind === "append" && entry.header) {
        if (entry.segment === "init") latestHeader.set(entry.bufferId, [at]);
        else latestHeader.get(entry.bufferId)?.push(at);
      }
      if (drop.has(at)) continue;
      // An abort or removal before a buffer's oldest kept audio no longer means anything.
      if ((entry.kind === "abort" || entry.kind === "remove") && !started.has(entry.bufferId)) continue;
      // Nor does a type change followed by another before any kept audio.
      if (entry.kind === "changeType") {
        if (typeChange.has(entry.bufferId)) kept[typeChange.get(entry.bufferId)] = null;
        typeChange.set(entry.bufferId, kept.length);
      }
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
      if (entry.kind === "append") typeChange.delete(entry.bufferId);
      kept.push(entry);
    }
    stream.log = kept.filter(Boolean);
    stream.bytes = bytes;
  }

  // Past the page-wide limit, every stream keeps its share (its newest audio),
  // the ones being separated too: the worker already has their older audio.
  function enforceTotal() {
    let total = 0;
    let holding = 0;
    for (const stream of streams.values()) {
      total += stream.bytes;
      if (stream.bytes) holding++;
    }
    if (total <= TOTAL_LIMIT) return;
    for (const stream of streams.values()) {
      if (stream.bytes <= TOTAL_LIMIT / holding) continue;
      trim(stream, TOTAL_LIMIT / holding);
      stream.dropped = true;
    }
  }

  // Log positions of a buffer's aborts and type changes since its last append.
  function resets(log, bufferId) {
    const found = new Set();
    for (let at = log.length - 1; at >= 0; at--) {
      const { kind } = log[at];
      if (log[at].bufferId !== bufferId) continue;
      if (kind === "append" || kind === "buffer") break;
      if (kind === "abort" || kind === "changeType") found.add(at);
    }
    return found;
  }

  // Without consent: the audio goes, and the stream cannot be read later.
  function dropMedia(stream) {
    const kept = stream.log.filter((entry) => entry.kind !== "append" || entry.header);
    if (kept.length === stream.log.length) return;
    stream.log = kept;
    stream.bytes = kept.reduce((sum, entry) => sum + (entry.bytes?.byteLength ?? 0), 0);
    stream.missed = true;
  }

  // A format header can come in several appends, and an append can hold the
  // end of a header and media: the header bytes are recorded on their own
  // (marked `header`), so that before consent nothing else is kept. One that
  // grows past MAX_HEADER is taken for media.
  function appended({ streamId, bufferId }, offset, bytes) {
    const stream = streams.get(streamId);
    if (!stream) return;
    const kind = segmentKind(bytes);
    const before = kind === "init" ? new Uint8Array(0) : kind === "part" ? stream.headers.get(bufferId) : null;
    stream.headers.delete(bufferId);
    let media = bytes;
    if (before) {
      const all = new Uint8Array(before.length + bytes.length);
      all.set(before);
      all.set(bytes, before.length);
      const end = headerEnd(all);
      if ((end ?? all.length) <= MAX_HEADER) {
        if (end === null) stream.headers.set(bufferId, all); // the header goes on in the next append
        const cut = end === null ? bytes.length : Math.max(0, end - before.length);
        media = cut === 0 ? bytes : cut < bytes.length ? bytes.slice(cut) : null;
        if (cut) record(streamId, { kind: "append", bufferId, offset, segment: before.length ? "part" : "init", bytes: media ? bytes.slice(0, cut) : bytes, header: true });
      }
    }
    if (media) record(streamId, { kind: "append", bufferId, offset, segment: segmentKind(media), bytes: media });
  }

  function record(id, entry) {
    const stream = streams.get(id);
    if (!stream) return;
    if (entry.kind === "append" && !entry.header && consented === false) {
      stream.missed = true;
      return;
    }
    // Between two appends, a type change replaces earlier ones and aborts (it
    // starts the parser afresh), and an abort after either says nothing new.
    // Of the stream's ends only the last counts.
    if (entry.kind === "abort" || entry.kind === "changeType") {
      const since = resets(stream.log, entry.bufferId);
      if (entry.kind === "abort" && since.size) return;
      if (since.size) stream.log = stream.log.filter((e, at) => !since.has(at));
    } else if (entry.kind === "end") {
      stream.log = stream.log.filter((e) => e.kind !== "end");
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
    if (stream.log.length > MAX_ENTRIES) {
      // Many small appends, or entries without audio piling up (removals).
      trim(stream, stream.bytes / 2);
      stream.dropped = true;
      const cut = stream.log.length - MAX_ENTRIES / 2;
      if (cut > 0) stream.log = stream.log.filter((e, at) => at >= cut || (e.kind !== "abort" && e.kind !== "remove"));
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

  // A removed buffer's audio is gone from the element: from the copy too, and
  // from a subscriber's.
  const nativeRemoveBuffer = msProto.removeSourceBuffer;
  msProto.removeSourceBuffer = function (sourceBuffer) {
    const result = nativeRemoveBuffer.apply(this, arguments);
    safely(() => {
      const info = buffers.get(sourceBuffer);
      const stream = streams.get(info?.streamId);
      if (!stream) return;
      buffers.delete(sourceBuffer);
      stream.buffers.delete(info.bufferId);
      stream.headers.delete(info.bufferId);
      stream.log = stream.log.filter((entry) => entry.bufferId !== info.bufferId);
      stream.bytes = stream.log.reduce((sum, entry) => sum + (entry.bytes?.byteLength ?? 0), 0);
      if (stream.subscribed) post({ type: "event", streamId: info.streamId, entry: { kind: "removeBuffer", bufferId: info.bufferId } });
    });
    return result;
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
      appended(info, this.timestampOffset, view.slice());
    });
    return result;
  };

  const nativeRemove = sbProto.remove;
  sbProto.remove = function (start, end) {
    const result = nativeRemove.apply(this, arguments);
    safely(() => {
      const info = buffers.get(this);
      if (info) record(info.streamId, { kind: "remove", bufferId: info.bufferId, start: Number(start), end: Number(end) });
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
    } else if (type === "consent") {
      consented = event.data.consented === true;
      if (!consented) for (const stream of streams.values()) dropMedia(stream);
    } else if (type === "subscribe") {
      const stream = streams.get(streamId);
      if (!stream) {
        post({ type: "closed", streamId });
        return;
      }
      stream.subscribed = true;
      const entries = stream.log.map((entry) => ({ ...entry, bytes: entry.bytes ? entry.bytes.slice() : null }));
      post({ type: "replay", streamId, dropped: !!stream.dropped, missed: !!stream.missed, entries },
        entries.filter((entry) => entry.bytes).map((entry) => entry.bytes.buffer));
    } else if (type === "unsubscribe" && streams.has(streamId)) {
      streams.get(streamId).subscribed = false;
    }
  });
})();
