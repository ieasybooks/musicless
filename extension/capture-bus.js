// The content script's side of capture.js: which Media Source URL is which
// captured stream, and the captured audio entries of streams a session
// subscribed to. Messages arrive through window.postMessage from the page world.

const NS = "nomusic";

export class CaptureBus {
  constructor() {
    this.urls = new Map(); // object URL -> stream id
    this.subscribers = new Map(); // stream id -> session
    this.watchers = new Set(); // sessions told about new and closed streams
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.[NS] !== "capture") return;
      this.receive(event.data);
    });
    this.control({ type: "hello" });
  }

  control(message) {
    window.postMessage({ [NS]: "control", ...message }, "*");
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

  unsubscribe(streamId) {
    if (!this.subscribers.delete(streamId)) return;
    this.control({ type: "unsubscribe", streamId });
  }

  receive(data) {
    switch (data.type) {
      case "stream":
        if (data.url) this.urls.set(data.url, data.streamId);
        for (const session of this.watchers) session.checkSource();
        break;
      case "closed":
        for (const [url, streamId] of this.urls) if (streamId === data.streamId) this.urls.delete(url);
        this.subscribers.get(data.streamId)?.onCaptureClosed(data.streamId);
        this.subscribers.delete(data.streamId);
        break;
      case "replay":
      case "event":
        this.subscribers.get(data.streamId)?.onEntries(data.streamId, data.type === "replay" ? data.entries : [data.entry]);
        break;
      default:
        break;
    }
  }
}
