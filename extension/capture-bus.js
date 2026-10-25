// The content script's side of capture.js: which Media Source URL is which
// captured stream, and the captured audio entries of streams a session
// subscribed to. Messages arrive through window.postMessage from the page world.
//
// Anything in the page can post those messages, so they are checked before
// they reach a session and the worker: shapes, types, finite numbers, sizes.
// A page can post nomusic's own control messages too, so none of them may
// leave a lasting failure: a stream's audio counts as missed only for a
// stream that existed after nomusic told capture.js "no" and before capture.js
// confirmed a later "yes", and no message stops a subscription (see
// capture.js). Streams from before the first answer on a page do not count:
// the stored answer reaches capture.js before a player's first audio (see
// content.js), and counting them would let a page fail every first video with
// one forged replay. A page that posts forgeries all the time can still
// interfere.

const NS = "nomusic";
const MAX_ENTRY_BYTES = 16 * 2 ** 20; // capture.js keeps no more than this per stream
const MAX_ENTRIES = 20000;
const MAX_URLS = 256;
const SEGMENTS = new Set(["init", "media", "part"]);

const isId = (value) => Number.isSafeInteger(value) && value > 0;

// A copy of a captured entry with only what nomusic reads, or null if it is malformed.
export function cleanEntry(entry) {
  if (typeof entry !== "object" || entry === null) return null;
  const { kind, bufferId } = entry;
  if (kind === "end") return { kind };
  if (!isId(bufferId)) return null;
  switch (kind) {
    case "buffer":
    case "changeType":
      return typeof entry.mime === "string" && entry.mime.length <= 256 ? { kind, bufferId, mime: entry.mime } : null;
    case "append": {
      const { bytes, offset, segment } = entry;
      // Its own whole buffer: the buffer is what moves on to the worker.
      const whole = bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength;
      return whole && bytes.length <= MAX_ENTRY_BYTES && Number.isFinite(offset) && SEGMENTS.has(segment)
        ? { kind, bufferId, bytes, offset, segment } : null;
    }
    case "remove": {
      const { start, end } = entry; // the end may be Infinity
      const ends = end === Infinity || (Number.isFinite(end) && end > start);
      return Number.isFinite(start) && start >= 0 && ends ? { kind, bufferId, start, end } : null;
    }
    case "abort":
    case "removeBuffer":
      return { kind, bufferId };
    default:
      return null;
  }
}

export class CaptureBus {
  constructor() {
    this.urls = new Map(); // object URL -> stream id
    this.subscribers = new Map(); // stream id -> session
    this.watchers = new Set(); // sessions told about new and closed streams
    this.told = null; // nomusic's last answer to capture.js: whether the user turned it on
    this.unsure = false; // nomusic said no, and capture.js has not confirmed a yes since
    this.unclear = new Set(); // ids of streams that existed meanwhile (their audio may have gone by)
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.[NS] !== "capture") return;
      this.receive(event.data);
    });
    this.control({ type: "hello" });
  }

  control(message) {
    window.postMessage({ [NS]: "control", ...message }, "*");
  }

  // Whether the user turned nomusic on: capture.js keeps audio only then.
  consent(consented) {
    this.told = consented;
    if (consented !== true) {
      this.unsure = true;
      for (const streamId of this.urls.values()) this.unclear.add(streamId);
    }
    this.control({ type: "consent", consented });
  }

  streamFor(url) {
    return this.urls.get(url) ?? null;
  }

  watch(session) {
    this.watchers.add(session);
  }

  unwatch(session) {
    this.watchers.delete(session);
    for (const [streamId, subscriber] of this.subscribers) {
      if (subscriber === session) this.unsubscribe(streamId);
    }
  }

  // The stream's captured audio so far arrives as one replay, then live events.
  subscribe(streamId, session) {
    this.subscribers.set(streamId, session);
    this.control({ type: "subscribe", streamId });
  }

  // Live events for a stream nobody watches are dropped here.
  unsubscribe(streamId) {
    this.subscribers.delete(streamId);
  }

  receive(data) {
    if (data.type === "consent") {
      // capture.js applied an answer: streams it announces after this were made under it.
      if (data.consented === true && this.told === true) this.unsure = false;
      return;
    }
    if (!isId(data.streamId)) return;
    switch (data.type) {
      case "stream":
        if (this.unsure) {
          this.unclear.add(data.streamId);
          if (this.unclear.size > MAX_URLS) this.unclear.delete(this.unclear.values().next().value);
        }
        if (typeof data.url === "string" && data.url.startsWith("blob:") && data.url.length <= 2048) {
          this.urls.delete(data.url);
          this.urls.set(data.url, data.streamId);
          if (this.urls.size > MAX_URLS) this.urls.delete(this.urls.keys().next().value);
        }
        for (const session of this.watchers) session.checkSource();
        break;
      case "closed":
        this.unclear.delete(data.streamId);
        for (const [url, streamId] of this.urls) if (streamId === data.streamId) this.urls.delete(url);
        this.subscribers.get(data.streamId)?.onCaptureClosed(data.streamId);
        this.subscribers.delete(data.streamId);
        break;
      case "replay": {
        if (!Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES) return;
        const entries = data.entries.map(cleanEntry);
        const missed = data.missed === true && this.unclear.has(data.streamId);
        if (!entries.includes(null)) this.subscribers.get(data.streamId)?.onEntries(data.streamId, entries, { missed });
        break;
      }
      case "event": {
        const entry = cleanEntry(data.entry);
        if (entry) this.subscribers.get(data.streamId)?.onEntries(data.streamId, [entry]);
        break;
      }
      default:
        break;
    }
  }
}
