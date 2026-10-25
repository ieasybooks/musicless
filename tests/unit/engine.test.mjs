// The hidden frame's handshake (separator.js), the content script's side of it
// (engine.js) and the secret's one writer (background.js), with stand-ins for
// the DOM, workers, messaging and extension storage.
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
  }, { rewrite: (source) => source.replaceAll("import.meta.url", JSON.stringify("chrome-extension://id/separator.js")) });
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

// URL as in Chrome, where an extension's pages have an origin of their own.
class ChromeURL extends URL {
  get origin() {
    return this.protocol === "chrome-extension:" ? `${this.protocol}//${this.host}` : super.origin;
  }
}

// `token` is what background.js answers (asked for afresh each time); `gate`
// holds the answer back until it resolves.
function engineSandbox({ token = "secret", gate = null } = {}) {
  const frames = [];
  const asked = [];
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
        // The frame's document: its origin is where `src` pointed when it
        // loaded, and the browser delivers a message only for that origin.
        contentWindow: {
          origin: null,
          posted: [],
          postMessage(message, origin) { this.posted.push({ message, origin, delivered: origin === this.origin }); },
        },
        setAttribute() {},
        addEventListener(type, handler) { listeners[type] = handler; },
        remove() { this.isConnected = false; },
        load() {
          this.contentWindow.origin = new ChromeURL(this.src).origin;
          listeners.load?.();
        },
      };
      return frame;
    },
    documentElement: { appendChild(frame) { frame.isConnected = true; frames.push(frame); } },
  };
  let now = 0;
  const globals = {
    document,
    chrome: {
      runtime: {
        getURL: (file) => `chrome-extension://id/${file}`,
        sendMessage: async (message) => {
          asked.push(message.type);
          await gate;
          return { token: env.token };
        },
      },
    },
    MessageChannel: class { constructor() { this.port1 = new Port(); this.port2 = new Port(); } },
    performance: { now: () => now },
    URL: ChromeURL,
  };
  const { Engine } = load("engine.js", globals);
  const env = { Engine, frames, ports, asked, token, advance: (ms) => { now += ms; } };
  return env;
}

test("the engine hands its port to the frame with the token, asked for when the frame loads", async () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  engine.post({ type: "hello" });
  assert.deepEqual(env.asked, [], "not before the frame is there");
  env.frames[0].load();
  await flush();
  assert.deepEqual(env.asked, ["engine-token"]);
  assert.deepEqual(plain(env.frames[0].contentWindow.posted.map((p) => p.message)), [{ type: "nomusic-port", token: "secret" }]);
  // Given up and started again: the token is asked for again, not kept.
  env.token = "another";
  engine.destroy();
  engine.post({ type: "hello" });
  env.frames[1].load();
  await flush();
  assert.deepEqual(env.asked, ["engine-token", "engine-token"]);
  assert.equal(env.frames[1].contentWindow.posted[0].message.token, "another");
});

// background.js with extension storage whose reads answer late (as when two
// tabs start at once), and a counter for made tokens.
function backgroundSandbox(stored = {}) {
  const storage = { ...stored };
  let made = 0;
  let listener = null;
  const later = () => new Promise((resolve) => setTimeout(resolve, 5));
  load("background.js", {
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: (fn) => { listener = fn; } }, OnInstalledReason: {} },
      storage: { local: {
        get: async (key) => {
          const value = storage[key]; // read now, answered later
          await later();
          return value === undefined ? {} : { [key]: value };
        },
        set: async (values) => {
          await later();
          Object.assign(storage, values);
        },
      } },
    },
    crypto: { randomUUID: () => `token-${++made}` },
  });
  const ask = () => new Promise((resolve) => assert.equal(listener({ type: "engine-token" }, {}, resolve), true));
  return { storage, ask, made: () => made };
}

test("tabs asking for the token at once all get the one that is stored, made once", async () => {
  const background = backgroundSandbox();
  const answers = await Promise.all([background.ask(), background.ask(), background.ask()]);
  assert.deepEqual(plain(answers), [{ token: "token-1" }, { token: "token-1" }, { token: "token-1" }]);
  assert.equal(background.storage.engineToken, "token-1");
  assert.equal(background.made(), 1);
  const kept = backgroundSandbox({ engineToken: "kept" });
  assert.deepEqual(plain(await Promise.all([kept.ask(), kept.ask()])), [{ token: "kept" }, { token: "kept" }]);
  assert.equal(kept.storage.engineToken, "kept", "a stored token is never replaced");
  assert.equal(kept.made(), 0);
});

test("the handshake only ever goes to the extension's own document, wherever the page points the frame", async () => {
  const where = (frame) => plain(frame.contentWindow.posted.map(({ origin, delivered }) => [origin, delivered]));
  // Pointed at a page of the site before it loads.
  const early = engineSandbox();
  new early.Engine().post({ type: "hello" });
  early.frames[0].src = "https://www.youtube.com/attacker";
  early.frames[0].load();
  await flush();
  assert.deepEqual(where(early.frames[0]), [["chrome-extension://id", false]], "posted to the extension's origin: not delivered");
  // Pointed elsewhere while the secret is being read.
  let open;
  const late = engineSandbox({ gate: new Promise((resolve) => { open = resolve; }) });
  new late.Engine().post({ type: "hello" });
  late.frames[0].load();
  late.frames[0].src = "https://www.youtube.com/attacker";
  late.frames[0].contentWindow.origin = "https://www.youtube.com"; // the page's document replaced ours
  open();
  await flush();
  assert.deepEqual(where(late.frames[0]), [["chrome-extension://id", false]]);
  // Left alone, it reaches the frame.
  const normal = engineSandbox();
  new normal.Engine().post({ type: "hello" });
  normal.frames[0].load();
  await flush();
  assert.deepEqual(where(normal.frames[0]), [["chrome-extension://id", true]]);
});

// A session as the engine sees it; `onLost` runs when the engine gives up.
function sessionStub(onLost = () => {}) {
  return { lost: 0, messages: [], onEngine(message) { this.messages.push(message); }, onEngineLost() { this.lost++; onLost(this); } };
}

function connected(env, engine, session = sessionStub()) {
  engine.attach(session);
  engine.port.onmessage({ data: { type: "connected" } });
  return session;
}

test("a worker that never connects is given up and its sessions start again", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  const session = sessionStub();
  engine.attach(session);
  env.advance(9000);
  engine.tidy();
  assert.equal(session.lost, 0);
  env.advance(2000);
  engine.tidy();
  assert.equal(session.lost, 1);
  assert.equal(env.frames[0].isConnected, false, "the frame is removed");
  assert.equal(env.ports[0].closed, true);
  assert.equal(engine.port, null);
});

test("a removed frame is noticed at once", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  const session = connected(env, engine);
  env.frames[0].remove(); // the page removed it
  env.advance(1000);
  engine.tidy();
  assert.equal(session.lost, 1);
});

test("a quiet worker is pinged: one that answers stays, one that does not is given up", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  const session = connected(env, engine);
  const pings = () => env.ports[0].sent.filter((message) => message.type === "ping").length;
  env.advance(1000);
  engine.tidy();
  assert.equal(pings(), 0, "not while it was heard from lately");
  env.advance(2000);
  engine.tidy();
  assert.equal(pings(), 1);
  env.advance(5000);
  engine.port.onmessage({ data: { type: "pong" } });
  env.advance(1000);
  engine.tidy();
  assert.equal(session.lost, 0);
  env.advance(2000);
  engine.tidy();
  assert.equal(pings(), 2);
  env.advance(60000); // timers in a background tab may run this rarely: what counts is the unanswered ping
  engine.tidy();
  assert.equal(session.lost, 1);
});

test("a fatal error from the worker gives it up", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  const session = connected(env, engine);
  engine.port.onmessage({ data: { type: "error", fatal: true, message: "The model failed to load" } });
  assert.equal(session.lost, 1);
  assert.equal(session.messages.length, 0);
  assert.equal(engine.port, null);
});

test("sessions that attach again when the engine is given up get a new engine", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  const session = sessionStub((self) => { self.id = engine.attach(self); });
  connected(env, engine, session);
  env.frames[0].remove();
  engine.tidy();
  assert.equal(session.lost, 1);
  assert.equal(engine.sessions.get(session.id), session, "its new attachment is kept");
  assert.equal(env.frames.length, 2, "on a new frame");
  assert.equal(env.frames[1].isConnected, true);
});

test("an engine nobody uses is removed after 30 seconds", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  connected(env, engine);
  engine.detach(1);
  env.advance(29000);
  engine.tidy();
  assert.notEqual(engine.port, null);
  env.advance(2000);
  engine.tidy();
  assert.equal(engine.port, null);
  assert.equal(env.frames[0].isConnected, false);
});

test("every attachment gets its own stream id, and messages go only to the current one", () => {
  const env = engineSandbox();
  const engine = new env.Engine();
  const session = sessionStub();
  const first = engine.attach(session);
  engine.port.onmessage({ data: { type: "connected" } });
  engine.detach(first);
  const second = engine.attach(session);
  assert.notEqual(first, second);
  assert.deepEqual(env.ports[0].sent.filter((m) => m.type !== "ping").map((m) => `${m.type}:${m.streamId}`),
    [`stream:${first}`, `drop:${first}`, `stream:${second}`]);
  engine.port.onmessage({ data: { type: "error", streamId: first, message: "late" } });
  assert.equal(session.messages.length, 0);
  engine.port.onmessage({ data: { type: "chunk", streamId: second, k: 0 } });
  assert.equal(session.messages.length, 1);
});
