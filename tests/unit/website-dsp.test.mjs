import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, BANDS, changed, musicFeatures, synthesize } from "../../landing/audio/dsp.js";
import { applyFades, BINS, FRAMES, HOP, N_FFT, OVERLAP_SAMPLES, RATE, STRIDE_SAMPLES, WINDOW_SAMPLES } from "../../landing/audio/grid.js";

const PLANE = FRAMES * BINS;
const noise = (length, seed) => {
  let state = seed;
  return new Float32Array(length).map(() => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  });
};

test("the website grid matches the model's 513 x 2049 input", () => {
  assert.deepEqual([FRAMES, BINS, WINDOW_SAMPLES, STRIDE_SAMPLES, OVERLAP_SAMPLES], [513, 2049, 524288, 522240, 2048]);
  assert.equal(RATE, 44100);
});

test("an unchanged spectrum gives back the whole window, edges included", () => {
  const left = noise(WINDOW_SAMPLES, 1);
  const right = noise(WINDOW_SAMPLES, 2);
  const out = synthesize(analyze(left, right));
  let worst = 0;
  for (let i = 0; i < WINDOW_SAMPLES; i++) {
    worst = Math.max(worst, Math.abs(out.left[i] - left[i]), Math.abs(out.right[i] - right[i]));
  }
  assert.ok(worst < 1e-5, `max error ${worst}`);
});

test("the planes are left re, left im, right re, right im of a forward DFT", () => {
  const left = noise(WINDOW_SAMPLES, 3);
  const right = noise(WINDOW_SAMPLES, 4);
  const x = analyze(left, right);
  const frame = 100;
  const origin = frame * HOP - N_FFT / 2;
  for (const k of [0, 1, 700, 2048]) {
    const sums = [0, 0, 0, 0];
    for (let n = 0; n < N_FFT; n++) {
      const w = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));
      const angle = (-2 * Math.PI * k * n) / N_FFT;
      sums[0] += left[origin + n] * w * Math.cos(angle);
      sums[1] += left[origin + n] * w * Math.sin(angle);
      sums[2] += right[origin + n] * w * Math.cos(angle);
      sums[3] += right[origin + n] * w * Math.sin(angle);
    }
    for (let p = 0; p < 4; p++) {
      const got = x[p * PLANE + frame * BINS + k];
      assert.ok(Math.abs(got - sums[p]) < 1e-3 * (1 + Math.abs(sums[p])), `plane ${p} bin ${k}: ${got} vs ${sums[p]}`);
    }
  }
});

test("a silent spectrum gives silence", () => {
  const out = synthesize(new Float32Array(4 * PLANE));
  assert.ok(out.left.every((v) => v === 0) && out.right.every((v) => v === 0));
});

test("neighbouring windows crossfade to exactly the input", () => {
  const ones = () => [new Float32Array(WINDOW_SAMPLES).fill(1)];
  const [first] = ones();
  const [second] = ones();
  applyFades([first], 0);
  applyFades([second], 1);
  assert.equal(first[0], 1, "the first window does not fade in");
  for (let i = 0; i < OVERLAP_SAMPLES; i++) {
    assert.ok(Math.abs(first[STRIDE_SAMPLES + i] + second[i] - 1) < 1e-6);
  }
});

test("the music detector reads mid and side mel bands relative to a loud frame", () => {
  const silent = musicFeatures(new Float32Array(4 * PLANE));
  assert.equal(silent.length, 2 * FRAMES * BANDS);
  assert.ok(silent.every((v) => v === -5), "silence sits at the -100 dB floor");

  // A 1 kHz tone, the same in both channels: one mid band near 0 dB, no side.
  const tone = new Float32Array(WINDOW_SAMPLES).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / RATE));
  const x = musicFeatures(analyze(tone, tone));
  const frame = x.subarray(200 * BANDS, 201 * BANDS);
  const loudest = frame.indexOf(Math.max(...frame));
  const mel = (hz) => 2595 * Math.log10(1 + hz / 700);
  const centre = 700 * (10 ** ((mel(60) + (loudest + 1) * ((mel(8000) - mel(60)) / (BANDS + 1))) / 2595) - 1);
  assert.ok(Math.abs(centre - 1000) < 60, `loudest band centred at ${centre} Hz`);
  assert.ok(frame[loudest] > -0.2 && frame[loudest] <= 0, `${frame[loudest]}`);
  assert.ok(x.subarray(FRAMES * BANDS).every((v) => v === -5), "identical channels have no side");
});

test("a window counts as changed when the model removed more than -40 dB, or -35 dB in a second", () => {
  const input = [noise(WINDOW_SAMPLES, 5), noise(WINDOW_SAMPLES, 6)];
  const scaled = (gain) => input.map((channel) => channel.map((v) => v * gain));
  assert.equal(changed(input, input), false);
  assert.equal(changed(input, scaled(1 - 10 ** (-45 / 20))), false, "-45 dB removed");
  assert.equal(changed(input, scaled(1 - 10 ** (-38 / 20))), true, "-38 dB removed");
  // One second removed entirely: about -11 dB of the window, 0 dB in that second.
  const cue = input.map((channel) => channel.map((v, i) => (i >= RATE && i < 2 * RATE ? 0 : v)));
  assert.equal(changed(input, cue), true);
  // 15% of a 34 ms click removed: -42 dB of the window, but -31 dB in its second.
  const click = input.map((channel) => channel.map((v, i) => (i >= 3 * RATE && i < 3 * RATE + 1500 ? 0.85 * v : v)));
  assert.equal(changed(input, click), true);
  const silent = [new Float32Array(WINDOW_SAMPLES)];
  assert.equal(changed(silent, silent), false, "silence is unchanged");
});
