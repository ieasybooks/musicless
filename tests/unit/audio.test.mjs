// The page's shared AudioContext and each video's routing (audio.js), with
// stand-in Web Audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./sandbox.mjs";

const FIREFOX = "moz-extension://id/";
const CHROME = "chrome-extension://id/";
const SAFARI = "safari-web-extension://id/";

// A gain that logs its automation, and what it connects to on its context.
class GainNode {
  constructor(context, name) {
    this.context = context;
    this.name = name;
    this.log = [];
    const event = (type) => (...args) => this.log.push([type, ...args]);
    this.gain = { value: 1, cancelScheduledValues: event("cancel"), setValueAtTime: event("set"), linearRampToValueAtTime: event("ramp") };
  }
  connect(next) {
    this.context.edges.push(`${this.name} -> ${next.name}`);
    return next;
  }
}

// A copy of Musicless (audio.js) in the browser `base` names. Its context's
// clock reads 10; `videos` are the page's.
function copyOf(base, { failing = false, videos = [], AudioContext, navigator } = {}) {
  AudioContext ??= class {
    constructor() {
      this.currentTime = 10;
      this.destination = { name: "speakers" };
      this.edges = [];
      this.gains = ["original", "output", "leash"];
    }
    createMediaElementSource() {
      if (failing) throw new Error("cannot route");
      return new GainNode(this, "video");
    }
    createGain() { return new GainNode(this, this.gains.shift()); }
  };
  return load("audio.js", {
    AudioContext, GainNode, Event, XPCNativeWrapper: (value) => value, window: { addEventListener() {} },
    chrome: { runtime: { getURL: (path) => base + path } }, document: { querySelectorAll: () => videos },
    ...(navigator ? { navigator } : {}),
  });
}

// A video element: its listeners and seeks, and its view in the page's world.
function video({ paused = true, seeking = false } = {}) {
  const seeks = [];
  const listeners = {};
  return {
    paused, seeking, seeks, listeners, wrappedJSObject: {},
    get currentTime() { return 12.5; },
    set currentTime(time) { seeks.push(time); },
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
  };
}

const leashOn = (element) => Object.getOwnPropertyDescriptor(element.wrappedJSObject, "musiclessLeash")?.value;

test("a suspended or interrupted context is resumed", () => {
  const resumed = [];
  class AudioContext {
    constructor() { this.state = "suspended"; }
    resume() { resumed.push(this.state); return Promise.resolve(); }
  }
  const { audioContext, resumeAudio } = copyOf(CHROME, { AudioContext });
  const context = audioContext();
  resumeAudio();
  context.state = "interrupted";
  resumeAudio();
  context.state = "running";
  resumeAudio();
  assert.deepEqual(resumed, ["suspended", "interrupted"]);
});

test("in Firefox, a video routed while playing is seeked to where it is, once", () => {
  const cases = [
    [FIREFOX, { paused: false }, [12.5]],
    [CHROME, { paused: false }, []],
    [FIREFOX, { paused: true }, []],
    [FIREFOX, { paused: false, seeking: true }, []],
  ];
  for (const [base, state, expected] of cases) {
    const element = video(state);
    const { routeElement } = copyOf(base);
    routeElement(element);
    routeElement(element);
    assert.deepEqual(element.seeks, expected, `${base} ${JSON.stringify(state)}`);
  }
});

test("in Firefox, the video's own sound and Musicless's both pass the leash", () => {
  const firefox = copyOf(FIREFOX).routeElement(video());
  assert.deepEqual(firefox.ctx.edges.sort(), ["leash -> speakers", "original -> leash", "output -> leash", "video -> original"]);
  const chrome = copyOf(CHROME).routeElement(video());
  assert.equal(chrome.leash, null);
  assert.deepEqual(chrome.ctx.edges.sort(), ["original -> speakers", "output -> speakers", "video -> original"]);
});

test("in Firefox, a routed video's sound closes 3 s ahead unless renewed: every second, and when it plays", () => {
  const routed = video();
  const other = video();
  const copy = copyOf(FIREFOX, { videos: [other, routed] });
  const graph = copy.routeElement(routed);
  const { log } = graph.leash;
  assert.deepEqual(log, [["cancel", 10], ["set", 1, 10], ["set", 1, 13], ["ramp", 0, 13.05]]);
  graph.ctx.currentTime = 11;
  copy.renewLeashes(); // every second, for each video this copy routed
  assert.deepEqual(log.slice(4), [["cancel", 11], ["set", 1, 11], ["set", 1, 14], ["ramp", 0, 14.05]]);
  graph.ctx.currentTime = 12;
  routed.listeners.play.forEach((fn) => fn()); // timers run seldom in a background tab
  assert.deepEqual(log.slice(8), [["cancel", 12], ["set", 1, 12], ["set", 1, 15], ["ramp", 0, 15.05]]);
  assert.equal(other.listeners.play, undefined);
});

test("in Firefox, a later copy takes over a video an earlier one routed, and closes its leash at once", () => {
  const element = video();
  const earlier = copyOf(FIREFOX).routeElement(element);
  assert.equal(leashOn(element), earlier.leash, "left on the video");
  assert.deepEqual(Object.keys(element.wrappedJSObject), [], "out of the page's way");
  earlier.ctx.currentTime = 21;
  const unrouted = video();
  const later = copyOf(FIREFOX);
  later.adopt(unrouted);
  assert.equal(leashOn(unrouted), undefined, "a video no copy routed is left alone");
  later.adopt(element);
  assert.deepEqual(earlier.leash.log.slice(4), [["cancel", 21], ["set", 1, 21], ["set", 1, 21], ["ramp", 0, 21.05]], "faded out now");
  const own = leashOn(element);
  assert.ok(own instanceof GainNode && own !== earlier.leash, "routed by the later copy, whose leash is left for the next");
  later.adopt(element);
  assert.equal(earlier.leash.log.length, 8, "once");
});

test("in Firefox, an earlier copy's leash is left to close by itself when the later copy cannot route the video", () => {
  const element = video();
  const earlier = copyOf(FIREFOX).routeElement(element);
  copyOf(FIREFOX, { failing: true }).adopt(element);
  assert.equal(earlier.leash.log.length, 4);
});

test("a later copy takes over only for a GainNode left on the video, and runs nothing the page put there", () => {
  const forged = { gain: { value: 1, cancelScheduledValues() { throw new Error("touched"); } } };
  let read = false;
  for (const wrappedJSObject of [{ musiclessLeash: forged }, { get musiclessLeash() { read = true; return forged; } }]) {
    const element = { ...video(), wrappedJSObject };
    const copy = copyOf(FIREFOX);
    copy.adopt(element);
    assert.equal(copy.audioContext().edges.length, 0, "left alone");
  }
  assert.equal(read, false, "no getter ran");
});

test("Chrome leaves nothing on the video and takes nothing over", () => {
  const element = video();
  copyOf(CHROME).routeElement(element);
  assert.deepEqual(Object.getOwnPropertyNames(element.wrappedJSObject), []);
  const marked = video();
  copyOf(FIREFOX).routeElement(marked);
  const chrome = copyOf(CHROME);
  chrome.adopt(marked);
  assert.equal(chrome.audioContext().edges.length, 0, "nothing routed");
});

test("in Safari, routing skips createMediaElementSource, sets audioSession playback, and drives native silence", () => {
  const navigator = { audioSession: { type: "auto" } };
  const events = [];
  const element = {
    ...video(),
    muted: true,
    dataset: {},
    dispatchEvent: (event) => events.push(event.type),
  };
  const safari = copyOf(SAFARI, { failing: true, navigator });
  const graph = safari.routeElement(element);
  assert.equal(navigator.audioSession.type, "playback");
  assert.equal(graph.element, null, "createMediaElementSource was not called");
  assert.equal(graph.original.gain.value, 1);
  graph.original.gain.value = 0;
  assert.equal(element.dataset.musiclessNativeSilence, "1");
  assert.deepEqual(events, ["musicless:native-silence"]);
  graph.original.gain.value = 1;
  assert.equal(element.dataset.musiclessNativeSilence, undefined);
  assert.equal(events.length, 2);
  element.dataset.musiclessUserMuted = "0";
  assert.equal(safari.isMuted(element), false, "reads logical user mute when set");
  element.dataset.musiclessUserMuted = "1";
  assert.equal(safari.isMuted(element), true);
  delete element.dataset.musiclessUserMuted;
  assert.equal(safari.isMuted(element), true, "falls back to native muted");
});
