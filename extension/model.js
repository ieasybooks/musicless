// The Spleeter network on ONNX Runtime Web (WebAssembly, one CPU thread), with
// a priority queue in front of it. Loaded either once in a shared worker for
// every tab (model-worker.js) or inside a tab's own worker as a fallback.

import * as ort from "./vendor/ort.wasm.min.mjs";
import { FRAMES } from "./grid.js";

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;
ort.env.logLevel = "error";

const MODEL_URL = new URL("./model/spleeter-2stems.onnx", import.meta.url).href;
export const INPUT_SHAPE = [2, 1, FRAMES, 1024];

// Lower priority values run first; equal priorities run in arrival order.
export function createModel() {
  let session = null;
  let loading = null;
  let seconds = null;
  let busy = false;
  let arrivals = 0;
  const queue = [];

  function load() {
    loading ??= (async () => {
      const started = performance.now();
      session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        freeDimensionOverrides: { num_splits: 1 },
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
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
          await load();
        } catch (error) {
          for (const job of queue.splice(0)) job.reject(error);
          return;
        }
        let best = 0;
        for (let i = 1; i < queue.length; i++) {
          const a = queue[i];
          const b = queue[best];
          if (a.priority < b.priority || (a.priority === b.priority && a.arrival < b.arrival)) best = i;
        }
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
        queue.push({ magnitude, priority, arrival: arrivals++, resolve, reject });
        pump();
      });
    },
  };
}
