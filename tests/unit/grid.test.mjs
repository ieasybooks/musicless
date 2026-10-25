import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFades, CHUNK_SECONDS, chunkIndex, chunkStart, OVERLAP_SAMPLES, RATE, STRIDE_SAMPLES, WINDOW_SAMPLES,
} from "../../extension/grid.js";

test("windows sit on a fixed grid from media time 0, two hops apart from back to back", () => {
  assert.equal(WINDOW_SAMPLES, 524288);
  assert.equal(STRIDE_SAMPLES, WINDOW_SAMPLES - OVERLAP_SAMPLES);
  assert.equal(STRIDE_SAMPLES % 1024, 0, "every window starts on the STFT hop grid");
  assert.equal(chunkStart(0), 0);
  assert.ok(Math.abs(chunkStart(3) - (3 * STRIDE_SAMPLES) / RATE) < 1e-12);
});

test("chunkIndex finds the chunk whose own span holds a time", () => {
  for (const k of [0, 1, 7, 120]) {
    assert.equal(chunkIndex(chunkStart(k)), k);
    assert.equal(chunkIndex(chunkStart(k) + CHUNK_SECONDS / 2), k);
    assert.equal(chunkIndex(chunkStart(k + 1) - 1e-6), k);
  }
  assert.equal(chunkIndex(-1), 0);
});

test("neighbouring chunks crossfade to exactly the original level", () => {
  const a = new Float32Array(WINDOW_SAMPLES).fill(1);
  const b = new Float32Array(WINDOW_SAMPLES).fill(1);
  applyFades([a], 4);
  applyFades([b], 5);
  for (let i = 0; i < OVERLAP_SAMPLES; i++) {
    // a's tail and b's head cover the same samples.
    const sum = a[STRIDE_SAMPLES + i] + b[i];
    assert.ok(Math.abs(sum - 1) < 1e-6, `overlap sample ${i} sums to ${sum}`);
  }
  assert.equal(a[OVERLAP_SAMPLES + 10], 1, "the middle is untouched");
});

test("the first chunk does not fade in (nothing comes before it)", () => {
  const first = new Float32Array(WINDOW_SAMPLES).fill(1);
  applyFades([first], 0);
  assert.equal(first[0], 1);
  assert.ok(first[WINDOW_SAMPLES - 1] < 0.001);
});

test("up to the media's end, the chunks that cover it add up to the full level", () => {
  for (const end of [chunkStart(3) - 0.01, chunkStart(3) + 0.02, chunkStart(3) + (OVERLAP_SAMPLES / RATE) / 2, chunkStart(3) + 1]) {
    // The page plays chunks 0 to chunkIndex(end); the worker zero-fills each past the end.
    const last = chunkIndex(end - 0.001);
    const level = new Float32Array(Math.ceil(end * RATE) + WINDOW_SAMPLES);
    for (let k = 0; k <= last; k++) {
      const chunk = new Float32Array(WINDOW_SAMPLES).fill(1);
      applyFades([chunk], k);
      for (let i = 0; i < WINDOW_SAMPLES; i++) level[k * STRIDE_SAMPLES + i] += chunk[i];
    }
    const endSample = Math.floor(end * RATE);
    for (let n = 0; n < endSample; n++) assert.ok(Math.abs(level[n] - 1) < 1e-6, `end ${end}: sample ${n} at ${level[n]}`);
  }
});
