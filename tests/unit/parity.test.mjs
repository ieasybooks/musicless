// The extension's separation pipeline (dsp.js, the model on ONNX Runtime Web,
// grid.js windows and crossfades) run in Node, against tests/reference.py on
// the same synthetic audio. Needs the built model and tests/.venv (setup.sh --dev).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, synthesize } from "../../extension/dsp.js";
import { applyFades, STRIDE_SAMPLES, WINDOW_SAMPLES } from "../../extension/grid.js";

const TESTS = new URL("..", import.meta.url).pathname;
const MODEL = new URL("../../extension/model/spleeter-2stems.onnx", import.meta.url).pathname;
const PYTHON = join(TESTS, ".venv", "bin", "python");
const ready = existsSync(MODEL) && existsSync(PYTHON);

function readWav(path) {
  const bytes = readFileSync(path);
  const data = bytes.indexOf("data", 12) + 8;
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset + data, (bytes.length - data) >> 1);
  const left = new Float32Array(samples.length / 2);
  const right = new Float32Array(samples.length / 2);
  for (let i = 0; i < left.length; i++) {
    left[i] = samples[2 * i] / 32768;
    right[i] = samples[2 * i + 1] / 32768;
  }
  return { left, right };
}

test("the browser pipeline matches the Python reference", { skip: !ready && "run ./setup.sh --dev first", timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nomusic-parity-"));
  try {
    const wav = join(dir, "clip.wav");
    execFileSync(PYTHON, [join(TESTS, "synth.py"), wav, "30"]);
    execFileSync(PYTHON, ["-c", `
import sys, wave, numpy as np
sys.path.insert(0, ${JSON.stringify(TESTS)})
import reference
w = wave.open(${JSON.stringify(wav)})
x = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 2) / 32768
reference.vocals(x).astype("<f4").tofile(${JSON.stringify(join(dir, "python.f32"))})
`]);
    const python = new Float32Array(readFileSync(join(dir, "python.f32")).buffer.slice(0));

    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(MODEL, { executionProviders: ["wasm"], freeDimensionOverrides: { num_splits: 1 } });
    const { left, right } = readWav(wav);
    const n = left.length;
    const out = new Float32Array(2 * (n + WINDOW_SAMPLES));
    for (let k = 0, start = 0; start < n; k++, start += STRIDE_SAMPLES) {
      const l = new Float32Array(WINDOW_SAMPLES);
      const r = new Float32Array(WINDOW_SAMPLES);
      l.set(left.subarray(start, start + WINDOW_SAMPLES));
      r.set(right.subarray(start, start + WINDOW_SAMPLES));
      const { spec, magnitude } = analyze(l, r);
      const result = await session.run({ x: new ort.Tensor("float32", magnitude, [2, 1, 512, 1024]) });
      const vocals = synthesize(spec, result.mask.data);
      applyFades([vocals.left, vocals.right], k);
      for (let i = 0; i < WINDOW_SAMPLES; i++) {
        out[2 * (start + i)] += vocals.left[i];
        out[2 * (start + i) + 1] += vocals.right[i];
      }
    }
    let signal = 0;
    let error = 0;
    for (let i = 0; i < 2 * n; i++) {
      signal += python[i] ** 2;
      error += (out[i] - python[i]) ** 2;
    }
    const agreement = 10 * Math.log10(signal / error);
    assert.ok(agreement > 60, `JS and Python agree to ${agreement.toFixed(1)} dB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
