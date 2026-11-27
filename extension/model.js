// The Spleeter network on ONNX Runtime Web (WebAssembly, one CPU thread), with
// a priority queue in front of it. Loaded once, in a shared worker for every
// tab (model-worker.js).

import * as ort from "./vendor/ort.wasm.min.mjs";
import { BINS, FRAMES } from "./grid.js";

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;
ort.env.logLevel = "error";

const IN_SAFARI = new URL(import.meta.url).protocol === "safari-web-extension:";
const MODEL_URL = new URL("./model/spleeter-2stems.onnx", import.meta.url).href;
const WASM_URL = new URL("./vendor/ort-wasm-simd-threaded.wasm", import.meta.url).href;
export const INPUT_SHAPE = [2, 1, FRAMES, BINS];

// Yield one macrotask so higher-priority jobs posted during a run can enter
// the queue before the next pick. MessageChannel avoids WebKit's 1-2 s
// setTimeout clamping in hidden cross-origin iframes.
function yieldTurn() {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

// Lower priority values run first; equal priorities run in arrival order.
export function createModel() {
  let session = null;
  let loading = null;
  let seconds = null;
  let busy = false;
  const queue = []; // in arrival order

  function load() {
    loading ??= (async () => {
      const started = performance.now();
      if (IN_SAFARI && !ort.env.wasm.wasmBinary) {
        // safari-web-extension:// does not serve .wasm as application/wasm;
        // supplying the bytes directly skips ORT's streaming-compile warning.
        const response = await fetch(WASM_URL);
        if (response.ok) ort.env.wasm.wasmBinary = await response.arrayBuffer();
      }
      session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        freeDimensionOverrides: { num_splits: 1 },
        // Still one thread; plans buffers differently: 48 MiB less WebAssembly
        // memory, the same masks (measured with ORT Web 1.30).
        executionMode: "parallel",
      });
      seconds = (performance.now() - started) / 1000;
      return seconds;
    })().catch((error) => {
      loading = null; // a later request may try again
      throw error;
    });
    return loading;
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        // A run holds this thread until it ends, so jobs posted meanwhile (from
        // any tab) are still waiting as messages: let them in, then pick.
        await yieldTurn();
        try {
          await load();
        } catch (error) {
          for (const job of queue.splice(0)) job.reject(error);
          return;
        }
        let best = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i].priority < queue[best].priority) best = i;
        const [job] = queue.splice(best, 1);
        try {
          const started = performance.now();
          const output = await session.run({ x: new ort.Tensor("float32", job.magnitude, INPUT_SHAPE) });
          // Copy out so the result can be transferred without touching runtime memory.
          job.resolve({ mask: new Float32Array(output.mask.data), ms: performance.now() - started });
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    load,
    get seconds() {
      return seconds;
    },
    // magnitude: Float32Array shaped INPUT_SHAPE. Resolves to { mask, ms }.
    run(magnitude, priority) {
      return new Promise((resolve, reject) => {
        queue.push({ magnitude, priority, resolve, reject });
        pump();
      });
    },
  };
}
