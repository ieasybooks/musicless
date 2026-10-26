// The extension's separation pipeline as shipped (dsp.js, grid.js windows and
// crossfades, and model.js on the bundled ONNX Runtime) run in Node: against
// tests/reference.py on the same synthetic audio, and against a quality floor.
// Needs the built model and runtime and tests/.venv (setup.sh --dev); without
// them the tests are skipped, except in CI, where they fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, synthesize } from "../../extension/dsp.js";
import { applyFades, STRIDE_SAMPLES, WINDOW_SAMPLES } from "../../extension/grid.js";

const TESTS = new URL("..", import.meta.url).pathname;
const PYTHON = join(TESTS, ".venv", "bin", "python");
const built = ["model/spleeter-2stems.onnx", "vendor/ort.wasm.min.mjs"].every((file) =>
  existsSync(new URL(`../../extension/${file}`, import.meta.url)));
const skip = !(built && existsSync(PYTHON)) && !process.env.CI && "run ./setup.sh --dev first";

// model.js fetches the model and the WebAssembly runtime by URL, and Node's
// fetch cannot read file: URLs.
const fetchUrl = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("file:")) return fetchUrl(input, init);
  const type = url.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  return new Response(readFileSync(fileURLToPath(url)), { headers: { "content-type": type } });
};

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

// Separates the audio window by window on the fixed grid, as the tab worker does.
let model = null;
async function separate({ left, right }) {
  model ??= import("../../extension/model.js").then(({ createModel }) => createModel());
  const shipped = await model;
  const n = left.length;
  const out = { left: new Float32Array(n + WINDOW_SAMPLES), right: new Float32Array(n + WINDOW_SAMPLES) };
  for (let k = 0, start = 0; start < n; k++, start += STRIDE_SAMPLES) {
    const l = new Float32Array(WINDOW_SAMPLES);
    const r = new Float32Array(WINDOW_SAMPLES);
    l.set(left.subarray(start, start + WINDOW_SAMPLES));
    r.set(right.subarray(start, start + WINDOW_SAMPLES));
    const { spec, magnitude } = analyze(l, r);
    const { mask } = await shipped.run(magnitude, 0);
    const vocals = synthesize(spec, mask);
    applyFades([vocals.left, vocals.right], k);
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      out.left[start + i] += vocals.left[i];
      out.right[start + i] += vocals.right[i];
    }
  }
  return { left: out.left.subarray(0, n), right: out.right.subarray(0, n) };
}

// Energy of a - b·scale over both channels (b may be null).
function energy(a, b = null, scale = 1) {
  let sum = 0;
  for (const channel of ["left", "right"]) {
    for (let i = 0; i < a[channel].length; i++) sum += (a[channel][i] - (b ? scale * b[channel][i] : 0)) ** 2;
  }
  return sum;
}
const db = (ratio) => 10 * Math.log10(ratio);

test("the browser pipeline matches the Python reference", { skip, timeout: 300000 }, async (t) => {
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
    const interleaved = new Float32Array(readFileSync(join(dir, "python.f32")).buffer.slice(0));
    const python = {
      left: interleaved.filter((_, i) => i % 2 === 0),
      right: interleaved.filter((_, i) => i % 2 === 1),
    };
    const out = await separate(readWav(wav));
    const agreement = db(energy(python) / energy(out, python));
    t.diagnostic(`JS and Python agree to ${agreement.toFixed(1)} dB`);
    assert.ok(agreement > 60, `JS and Python agree to ${agreement.toFixed(1)} dB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Parity cannot see a change that moves both sides (a setting, a retrained
// model), so this floor holds whatever the reference says: on a synthetic voice
// over music as loud as it, the voice stays and the music goes. The limits are
// this build's numbers less a margin; a change that misses them needs listening.
test("the separation keeps the voice and removes most of the music", { skip, timeout: 300000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nomusic-quality-"));
  try {
    const [mixWav, voiceWav, musicWav] = ["mix", "voice", "music"].map((name) => join(dir, `${name}.wav`));
    execFileSync(PYTHON, [join(TESTS, "synth.py"), mixWav, "24", "--music-db", "0", "--voice-only", voiceWav, "--music-only", musicWav]);
    const [mix, voice, music] = [mixWav, voiceWav, musicWav].map(readWav);
    // The mix is the two scaled to a peak: find that scale.
    let dot = 0;
    let both = 0;
    for (const channel of ["left", "right"]) {
      for (let i = 0; i < mix[channel].length; i++) {
        const sum = voice[channel][i] + music[channel][i];
        dot += mix[channel][i] * sum;
        both += sum * sum;
      }
    }
    const scale = dot / both;
    const separated = await separate(mix);
    const voiceSdr = db((scale * scale * energy(voice)) / energy(separated, voice, scale));
    const musicKept = db(energy(await separate(music)) / energy(music));
    t.diagnostic(`voice SDR ${voiceSdr.toFixed(1)} dB (the mix: ${db(energy(voice) / energy(music)).toFixed(1)} dB), music alone kept at ${musicKept.toFixed(1)} dB`);
    assert.ok(voiceSdr >= 14, `voice SDR ${voiceSdr.toFixed(1)} dB`);
    assert.ok(musicKept <= -60, `music alone kept at ${musicKept.toFixed(1)} dB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
