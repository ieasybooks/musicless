// The hidden frame's handshake (separator.js) and the content script's side of
// it (engine.js), with stand-ins for the DOM, workers and extension storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flush, load, plain } from "./sandbox.mjs";

function separator() {
  const handlers = [];
  let workers = 0;
  load("separator.js", {
    window: { addEventListener: (type, handler) => handlers.push(handler) },
    chrome: { storage: { local: { get: async () => ({ engineToken: "secret" }) } } },
    Worker: class { constructor() { workers++; } postMessage() {} },
    SharedWorker: class { constructor() { this.port = { postMessage() {} }; } addEventListener() {} },
    MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    URL,
  }, (source) => source.replaceAll("import.meta.url", JSON.stringify("chrome-extension://id/separator.js")));
  const post = async (data, ports = [{}]) => {
    for (const handler of handlers) await handler({ data, ports, origin: "https://www.youtube.com" });
  };
  return { post, workers: () => workers };
}

test("the hidden frame starts a worker only for the content script's token, once", async () => {
  const frame = separator();
  await frame.post({ type: "nomusic-port" });
  await frame.post({ type: "nomusic-port", token: "guess" });
  await frame.post({ type: "nomusic-port", token: "secret" }, []);
  assert.equal(frame.workers(), 0, "no token, a wrong one, or no port: nothing starts");
  await frame.post({ type: "nomusic-port", token: "secret" });
  assert.equal(frame.workers(), 1);
  await frame.post({ type: "nomusic-port", token: "secret" });
  assert.equal(frame.workers(), 1, "one connection per frame");
});

export function engineSandbox({ stored = {} } = {}) {
  const frames = [];
  const storage = { ...stored };
  const ports = [];
  class Port {
    constructor() { this.sent = []; this.closed = false; ports.push(this); }
    postMessage(message) { this.sent.push(message); }
    close() { this.closed = true; }
  }
  const document = {
    createElement() {
      const listeners = {};
      const frame = {
        src: "", style: { setProperty() {} }, isConnected: false, tabIndex: 0,
        contentWindow: { posted: [], postMessage(message, origin) { this.posted.push({ message, origin }); } },
        setAttribute() {},
        addEventListener(type, handler) { listeners[type] = handler; },
        remove() { this.isConnected = false; },
        load() { listeners.load?.(); },
      };
      return frame;
    },
    documentElement: { appendChild(frame) { frame.isConnected = true; frames.push(frame); } },
  };
  let now = 0;
  const globals = {
    document,
    chrome: {
      runtime: { getURL: (file) => `chrome-extension://id/${file}` },
      storage: { local: {
        get: async (key) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (values) => { Object.assign(storage, values); },
      } },
    },
    crypto: { randomUUID: () => "made-token" },
    MessageChannel: class { constructor() { this.port1 = new Port(); this.port2 = new Port(); } },
    performance: { now: () => now },
    URL,
  };
  const { Engine } = load("engine.js", globals);
  return { Engine, frames, storage, ports, advance: (ms) => { now += ms; } };
}

test("the engine hands its port to the frame with the token, making one the first time", async () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  engine.post({ type: "hello" });
  env.frames[0].load();
  await flush();
  assert.deepEqual(plain(env.frames[0].contentWindow.posted.map((p) => p.message)), [{ type: "nomusic-port", token: "made-token" }]);
  assert.equal(env.storage.engineToken, "made-token");

  const again = engineSandbox({ stored: { engineToken: "kept" } });
  const second = new again.Engine();
  second.post({ type: "hello" });
  again.frames[0].load();
  await flush();
  assert.equal(again.frames[0].contentWindow.posted[0].message.token, "kept", "an existing token is reused");
});
