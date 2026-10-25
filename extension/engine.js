// The page's connection to its separation worker, which runs in a hidden
// extension frame (separator.html). Created on first use and shared by every
// video on the page; messages are routed to sessions by stream id. Once no
// session has used it for a while the frame is removed, which stops the
// workers and frees the model's memory (unless another tab still shares it).

const IDLE_MS = 30 * 1000;

// A secret the hidden frame asks for before it takes a port, so that only
// nomusic's content script can start a worker there: pages cannot read
// extension storage (and a page can load the frame itself). Made on first use.
async function engineToken() {
  let { engineToken } = await chrome.storage.local.get("engineToken");
  if (!engineToken) {
    await chrome.storage.local.set({ engineToken: crypto.randomUUID() });
    ({ engineToken } = await chrome.storage.local.get("engineToken")); // another tab may have made one too
  }
  return engineToken;
}

export class Engine {
  constructor() {
    this.frame = null;
    this.port = null;
    this.token = null;
    this.sessions = new Map(); // stream id -> session
    this.model = null; // { seconds, shared } once loaded
    this.connected = false;
    this.queue = []; // messages held until the worker has its port
    this.idleSince = performance.now();
  }

  get running() {
    return !!this.port;
  }

  ensure() {
    if (this.port) return;
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("separator.html");
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.setProperty("display", "none", "important");
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => this.dispatch(event.data);
    const token = (this.token ??= engineToken().catch((error) => {
      this.token = null; // try again with the next frame
      throw error;
    }));
    frame.addEventListener("load", () => {
      token.then((value) => {
        frame.contentWindow?.postMessage({ type: "nomusic-port", token: value }, new URL(frame.src).origin, [channel.port2]);
      }, () => {});
    }, { once: true });
    document.documentElement.appendChild(frame);
    this.frame = frame;
    this.port = channel.port1;
    this.model = null;
    this.connected = false;
  }

  // Until the worker holds its end of the port, messages wait here: moving a
  // port to another process with megabytes of audio queued on it can stall
  // the page.
  post(message, transfer = []) {
    this.ensure();
    if (this.connected) this.port.postMessage(message, transfer);
    else this.queue.push([message, transfer]);
  }

  attach(streamId, session) {
    this.sessions.set(streamId, session);
    this.post({ type: "stream", streamId });
  }

  detach(streamId) {
    if (!this.sessions.delete(streamId)) return;
    if (this.port) this.post({ type: "drop", streamId });
    if (!this.sessions.size) this.idleSince = performance.now();
  }

  dispatch(message) {
    if (message.type === "connected") {
      this.connected = true;
      for (const [queued, transfer] of this.queue.splice(0)) this.port.postMessage(queued, transfer);
      return;
    }
    if (message.type === "model") {
      this.model = message;
      return;
    }
    if (message.streamId === undefined) {
      // A failure of the whole engine (e.g. the model could not load).
      for (const session of new Set(this.sessions.values())) session.onEngine(message);
      return;
    }
    this.sessions.get(message.streamId)?.onEngine(message);
  }

  // Called periodically: release the workers when nothing has needed them for a while.
  tidy() {
    if (this.port && !this.sessions.size && performance.now() - this.idleSince > IDLE_MS) this.destroy();
  }

  destroy() {
    this.port?.close();
    this.frame?.remove();
    this.port = null;
    this.frame = null;
    this.model = null;
    this.connected = false;
    this.queue = [];
    for (const session of new Set(this.sessions.values())) session.onEngineLost();
    this.sessions.clear();
  }
}
