// The content script's capture bus: anything in the page can post its
// messages, so only well-formed ones reach a session (and the worker).
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./sandbox.mjs";

function bus() {
  const { CaptureBus } = load("capture-bus.js", { window: { addEventListener() {}, postMessage() {} }, Uint8Array, ArrayBuffer });
  const capture = new CaptureBus();
  const received = [];
  const session = { checkSource() {}, onEntries: (streamId, entries) => received.push(entries), onCaptureClosed() {} };
  capture.subscribe(5, session);
  return { capture, received };
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
  assert.equal(received.length, 2);
  assert.equal(received[0][0].end, Infinity);
});
