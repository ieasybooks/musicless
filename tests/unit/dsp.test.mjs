import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, resample, synthesize } from "../../extension/dsp.js";
import { BINS, FRAMES, RATE, WINDOW_SAMPLES } from "../../extension/grid.js";

const sine = (length, freq, rate, phase = 0) =>
  new Float32Array(length).map((_, i) => Math.sin((2 * Math.PI * freq * i) / rate + phase));

test("a mask of ones gives back the input below 11 kHz", () => {
  const left = sine(WINDOW_SAMPLES, 440, RATE);
  const right = sine(WINDOW_SAMPLES, 1250, RATE, 1);
  const { spec, magnitude } = analyze(left, right);
  assert.equal(magnitude.length, 2 * FRAMES * BINS);
  const out = synthesize(spec, new Float32Array(2 * FRAMES * BINS).fill(1));
  let worst = 0;
  // Away from the window edges (reflect padding), reconstruction is exact.
  for (let i = 8192; i < WINDOW_SAMPLES - 8192; i++) {
    worst = Math.max(worst, Math.abs(out.left[i] - left[i]), Math.abs(out.right[i] - right[i]));
  }
  assert.ok(worst < 1e-4, `max error ${worst}`);
});

test("a mask of zeros gives silence", () => {
  const x = sine(WINDOW_SAMPLES, 300, RATE);
  const { spec } = analyze(x, x);
  const out = synthesize(spec, new Float32Array(2 * FRAMES * BINS));
  assert.ok(out.left.every((v) => v === 0) && out.right.every((v) => v === 0));
});

test("the magnitude the model reads matches the sinusoid's bin", () => {
  const freq = 100 * (RATE / 4096); // exactly bin 100
  const x = sine(WINDOW_SAMPLES, freq, RATE);
  const { magnitude } = analyze(x, x);
  const frame = 200 * BINS;
  let best = 0;
  for (let k = 1; k < BINS; k++) if (magnitude[frame + k] > magnitude[frame + best]) best = k;
  assert.equal(best, 100);
});

test("the model reads every window at the same level", () => {
  const scaled = (gain) => sine(WINDOW_SAMPLES, 440, RATE).map((v) => v * gain);
  const quiet = analyze(scaled(0.05), scaled(0.05)).magnitude;
  const loud = analyze(scaled(0.8), scaled(0.8)).magnitude;
  const at = 200 * BINS + 41; // the 440 Hz bin
  assert.ok(Math.abs(quiet[at] / loud[at] - 1) < 1e-4, `${quiet[at]} vs ${loud[at]}`);
});

test("48 kHz audio resamples to 44.1 kHz accurately", () => {
  const input = sine(48000, 1000, 48000);
  const [out] = resample([input], 48000, 0, 0.25, 4410);
  let worst = 0;
  for (let n = 0; n < out.length; n++) {
    const expected = Math.sin(2 * Math.PI * 1000 * (0.25 + n / RATE));
    worst = Math.max(worst, Math.abs(out[n] - expected));
  }
  assert.ok(worst < 2e-3, `max error ${worst}`);
});

test("reading outside the decoded audio gives silence", () => {
  const input = sine(4800, 500, 48000);
  const [out] = resample([input], 48000, 10, 0, 1000); // input starts at 10 s
  assert.ok(out.every((v) => v === 0));
});
