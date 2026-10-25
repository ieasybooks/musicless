// The content script's capture bus: anything in the page can post its
// messages, so only well-formed ones reach a session (and the worker).
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./sandbox.mjs";

function bus() {
  const posted = [];
  const { CaptureBus } = load("capture-bus.js", { window: { addEventListener() {}, postMessage: (message) => posted.push(message) }, Uint8Array, ArrayBuffer });
  const capture = new CaptureBus();
  const received = [];
  const missed = [];
  const session = {
    checkSource() {},
    onEntries: (streamId, entries, replay) => {
      received.push(entries);
      if (replay) missed.push(replay.missed);
    },
    onCaptureClosed() {},
  };
  capture.subscribe(5, session);
  return { capture, received, missed, posted };
}

const append = (extra = {}) => ({ kind: "append", bufferId: 2, bytes: new Uint8Array([1, 2, 3]), offset: 0, segment: "media", ...extra });

test("well-formed entries pass on with only the fields nomusic reads", () => {
  const { capture, received } = bus();
  capture.receive({ type: "event", streamId: 5, entry: append({ note: "x".repeat(1000) }) });
  capture.receive({ type: "replay", streamId: 5, entries: [{ kind: "buffer", bufferId: 2, mime: "audio/webm" }, append(), { kind: "end" }] });
  assert.equal(received.length, 2);
  assert.deepEqual(Object.keys(received[0][0]).sort(), ["bufferId", "bytes", "kind", "offset", "segment"]);
  assert.equal(received[1].length, 3);
});

test("malformed messages are dropped", () => {
  const { capture, received } = bus();
  capture.receive({ type: "event", streamId: 5, entry: append({ bytes: new Uint8Array(new ArrayBuffer(4096), 8, 3) }) }); // a view of a bigger buffer
  capture.receive({ type: "event", streamId: 5, entry: append({ bytes: [1, 2, 3] }) });
  capture.receive({ type: "event", streamId: 5, entry: append({ offset: Number.NaN }) });
  capture.receive({ type: "event", streamId: 5, entry: append({ segment: "other" }) });
  capture.receive({ type: "event", streamId: 5, entry: append({ bufferId: -1 }) });
  capture.receive({ type: "event", streamId: "5", entry: { kind: "abort", bufferId: 2 } });
  capture.receive({ type: "event", streamId: 5, entry: { kind: "buffer", bufferId: 2, mime: "x".repeat(300) } });
  capture.receive({ type: "event", streamId: 5, entry: null });
  capture.receive({ type: "replay", streamId: 5, entries: [{ kind: "buffer", bufferId: 2, mime: "audio/webm" }, { kind: "made-up" }] });
  capture.receive({ type: "replay", streamId: 5, entries: "not a list" });
  assert.equal(received.length, 0);
});

test("only blob URLs are mapped to streams", () => {
  const { capture } = bus();
  capture.receive({ type: "stream", streamId: 6, url: "https://example.com/video.mp4" });
  capture.receive({ type: "stream", streamId: 7, url: "blob:https://www.youtube.com/1" });
  capture.receive({ type: "stream", streamId: 0, url: "blob:https://www.youtube.com/2" });
  assert.equal(capture.streamFor("https://example.com/video.mp4"), null);
  assert.equal(capture.streamFor("blob:https://www.youtube.com/1"), 7);
  assert.equal(capture.streamFor("blob:https://www.youtube.com/2"), null);
});

test("removals pass on when well-formed", () => {
  const { capture, received } = bus();
  capture.receive({ type: "event", streamId: 5, entry: { kind: "remove", bufferId: 2, start: 0, end: Infinity } });
  capture.receive({ type: "event", streamId: 5, entry: { kind: "removeBuffer", bufferId: 2 } });
  capture.receive({ type: "event", streamId: 5, entry: { kind: "remove", bufferId: 2, start: 3, end: Number.NaN } });
  capture.receive({ type: "event", streamId: 5, entry: { kind: "remove", bufferId: 2, start: -1, end: 4 } });
  capture.receive({ type: "event", streamId: 5, entry: { kind: "remove", bufferId: 2, start: 4, end: 4 } });
  capture.receive({ type: "event", streamId: 5, entry: { kind: "remove", bufferId: 2, start: 4, end: "9".repeat(400) } }); // a number only when compared
  capture.receive({ type: "event", streamId: 5, entry: { kind: "remove", bufferId: 2, start: 4, end: [10] } });
  assert.equal(received.length, 2);
  assert.equal(received[0][0].end, Infinity);
});

// A stream as capture.js announces it.
const announce = (capture, streamId) => capture.receive({ type: "stream", streamId, url: `blob:https://www.youtube.com/${streamId}` });
const missedFor = (capture, missed, streamId) => {
  capture.subscribe(streamId, { checkSource() {}, onEntries: (id, entries, replay) => missed.push([id, replay.missed]), onCaptureClosed() {} });
  capture.receive({ type: "replay", streamId, entries: [], missed: true }); // what a page can post for any stream
};

test("after nomusic said no, audio counts as missed only for streams from before capture.js confirmed a yes", () => {
  const { capture } = bus();
  const missed = [];
  capture.consent(false); // the user had not turned nomusic on
  announce(capture, 5);
  capture.consent(true); // then did (the welcome page)
  announce(capture, 6); // made before capture.js had the answer
  capture.receive({ type: "consent", consented: true }); // capture.js applied it
  announce(capture, 7); // a later video (a new source)
  for (const id of [5, 6, 7]) missedFor(capture, missed, id);
  assert.deepEqual(missed, [[5, true], [6, true], [7, false]], "a forged replay cannot fail the later, clean stream");
});

test("for a user who turned nomusic on, a forged replay fails no stream; turning it off again does", () => {
  const { capture } = bus();
  const missed = [];
  announce(capture, 3); // the page's first video, before nomusic's answer
  capture.consent(true);
  capture.receive({ type: "consent", consented: true });
  announce(capture, 4);
  missedFor(capture, missed, 3);
  missedFor(capture, missed, 4);
  capture.consent(false); // turned off again (the popup): every stream it has goes unkept
  missedFor(capture, missed, 3);
  missedFor(capture, missed, 4);
  assert.deepEqual(missed, [[3, false], [4, false], [3, true], [4, true]]);
});

test("no message to the page stops a subscription", () => {
  const { capture, posted } = bus();
  capture.unsubscribe(5);
  assert.deepEqual(posted.map((message) => message.type), ["hello", "subscribe"]);
});
