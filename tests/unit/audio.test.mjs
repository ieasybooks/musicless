// The page's shared AudioContext (audio.js) with a stand-in context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./sandbox.mjs";

test("a suspended or interrupted context is resumed", () => {
  const resumed = [];
  class AudioContext {
    constructor() { this.state = "suspended"; }
    resume() { resumed.push(this.state); return Promise.resolve(); }
  }
  const { audioContext, resumeAudio } = load("audio.js", { AudioContext, window: { addEventListener() {} } });
  const context = audioContext();
  resumeAudio();
  context.state = "interrupted";
  resumeAudio();
  context.state = "running";
  resumeAudio();
  assert.deepEqual(resumed, ["suspended", "interrupted"]);
});
