// Runs the extension's DSP + model pipeline in Node on a raw stereo float32
// file (44.1 kHz, interleaved) and writes the separated vocals next to it.
// Usage: node tests/parity.mjs <onnxruntime-web dir> <in.f32> <out.f32>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as dsp from "../extension/dsp.js";

const [ortDir, input, output] = process.argv.slice(2);
const ort = await import(pathToFileURL(`${ortDir}/dist/ort.node.min.mjs`).href).catch(() => import(pathToFileURL(`${ortDir}/dist/ort.mjs`).href));
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(new URL("../extension/model/spleeter-2stems.onnx", import.meta.url).pathname,
  { executionProviders: ["wasm"], freeDimensionOverrides: { num_splits: 1 } });

const raw = new Float32Array(readFileSync(input).buffer.slice(0));
const n = raw.length / 2;
const left = new Float32Array(n);
const right = new Float32Array(n);
for (let i = 0; i < n; i++) { left[i] = raw[2 * i]; right[i] = raw[2 * i + 1]; }

const chunks = Math.ceil(n / dsp.CORE_SAMPLES);
const out = new Float32Array(chunks * dsp.CORE_SAMPLES * 2);
const times = { stft: 0, model: 0, istft: 0, resample: 0 };
for (let k = 0; k < chunks; k++) {
  const start = k * dsp.CORE_SAMPLES - dsp.CONTEXT_SAMPLES;
  let t = performance.now();
  // Same path as the worker: resample (here 44.1k -> 44.1k) the window out of the source.
  const [l, r] = dsp.resample([left, right], dsp.RATE, 0, start / dsp.RATE, dsp.WINDOW_SAMPLES);
  times.resample += performance.now() - t; t = performance.now();
  const { spec, magnitude } = dsp.analyze(l, r);
  times.stft += performance.now() - t; t = performance.now();
  const result = await session.run({ x: new ort.Tensor("float32", magnitude, [2, 1, 512, 1024]) });
  times.model += performance.now() - t; t = performance.now();
  const vocals = dsp.synthesize(spec, result.mask.data);
  times.istft += performance.now() - t;
  for (let i = 0; i < dsp.CORE_SAMPLES; i++) {
    out[2 * (k * dsp.CORE_SAMPLES + i)] = vocals.left[i];
    out[2 * (k * dsp.CORE_SAMPLES + i) + 1] = vocals.right[i];
  }
}
writeFileSync(output, Buffer.from(out.buffer, 0, n * 2 * 4));
const seconds = n / dsp.RATE;
const total = Object.values(times).reduce((a, b) => a + b, 0) / 1000;
console.log(JSON.stringify({ seconds, chunks, per_chunk_ms: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v / chunks)])), x_realtime: +(seconds / total).toFixed(1) }));
