// The page's connection to its separation worker, which runs in a hidden
// extension frame (separator.html). Created on first use and shared by every
// video on the page; messages are routed to sessions by the worker's stream
// id, a new one for every attachment (so nothing meant for an earlier one, a
// late chunk or error, reaches a session that started over). Once no
// session has used it for a while the frame is removed, which stops the
// workers and frees the model's memory (unless another tab still shares it).
//
// A port does not tell when the worker behind it is gone (its frame removed,
// a crash), so a quiet worker is pinged; one that does not answer, or cannot
// go on, is given up and its sessions start again with a new one.

const IDLE_MS = 30 * 1000;
const CONNECT_MS = 10 * 1000; // a new worker says it is connected well within this
const PING_MS = 2000; // a worker quiet this long is asked whether it is still there
const SILENT_MS = 15 * 1000; // longer than the worker ever stays busy before answering

// The hidden frame takes a port only with a secret from extension storage,
// which pages cannot read (a page can load the frame itself). background.js
// makes it; it is asked for at the moment of use and never kept here.
function handshake(frame, origin, port) {
  let asked;
  try {
    asked = chrome.runtime.sendMessage({ type: "engine-token" });
  } catch {
    return; // the extension was updated or removed under this page
  }
  asked.then((answer) => {
    if (answer?.token) frame.contentWindow?.postMessage({ type: "nomusic-port", token: answer.token }, origin, [port]);
  }, () => {});
}

export class Engine {
  constructor() {
    this.frame = null;
    this.port = null;
    this.sessions = new Map(); // stream id -> session
    this.ids = 0;
    this.model = null; // { seconds, shared } once loaded
    this.connected = false;
    this.queue = []; // messages held until the worker has its port
    this.idleSince = performance.now();
    this.heard = 0; // when the worker last said anything (or was started)
    this.pinged = 0; // when it was asked and has not answered since
  }

  ensure() {
    if (this.port) return;
    // The frame is page DOM: the page can change its src. Where the handshake
    // may go is fixed now, so the secret and the port only ever reach the
    // extension's own document (anywhere else the browser drops the message,
    // and the worker is given up when it does not connect).
    const url = chrome.runtime.getURL("separator.html");
    const origin = new URL(url).origin;
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.setProperty("display", "none", "important");
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => this.dispatch(event.data);
    frame.addEventListener("load", () => handshake(frame, origin, channel.port2), { once: true });
    document.documentElement.appendChild(frame);
    this.frame = frame;
    this.port = channel.port1;
    this.model = null;
    this.connected = false;
    this.heard = performance.now();
    this.pinged = 0;
  }

  // Until the worker holds its end of the port, messages wait here: moving a
  // port to another process with megabytes of audio queued on it can stall
  // the page.
  post(message, transfer = []) {
    this.ensure();
    if (this.connected) this.port.postMessage(message, transfer);
    else this.queue.push([message, transfer]);
  }

  // Returns the stream id for the session's messages to the worker.
  attach(session) {
    if (!this.sessions.size) this.heard = performance.now(); // it is watched again from now on
    const streamId = ++this.ids;
    this.sessions.set(streamId, session);
    this.post({ type: "stream", streamId });
    return streamId;
  }

  detach(streamId) {
    if (!this.sessions.delete(streamId)) return;
    if (this.port) this.post({ type: "drop", streamId });
    if (!this.sessions.size) this.idleSince = performance.now();
  }

  dispatch(message) {
    this.heard = performance.now();
    this.pinged = 0;
    if (message.type === "pong") return;
    if (message.type === "connected") {
      this.connected = true;
      for (const [queued, transfer] of this.queue.splice(0)) this.port.postMessage(queued, transfer);
      return;
    }
    if (message.type === "model") {
      this.model = message;
      return;
    }
    if (message.fatal) {
      // The worker cannot go on (the model did not load, or the shared model stopped).
      this.destroy();
      return;
    }
    this.sessions.get(message.streamId)?.onEngine(message);
  }

  // Called every second: release the workers when nothing has needed them for
  // a while, and give up on a worker that is gone.
  tidy() {
    if (!this.port) return;
    const now = performance.now();
    if (!this.sessions.size) {
      if (now - this.idleSince > IDLE_MS) this.destroy();
    } else if (!this.frame.isConnected || (!this.connected && now - this.heard > CONNECT_MS) ||
        (this.pinged && now - this.pinged > SILENT_MS)) {
      this.destroy();
    } else if (this.connected && !this.pinged && now - this.heard > PING_MS) {
      this.pinged = now;
      this.port.postMessage({ type: "ping" });
    }
  }

  // Sessions still using it start again with a new one.
  destroy() {
    const lost = new Set(this.sessions.values());
    this.port?.close();
    this.frame?.remove();
    this.port = null;
    this.frame = null;
    this.model = null;
    this.connected = false;
    this.queue = [];
    this.sessions.clear();
    for (const session of lost) session.onEngineLost();
  }
}
