import { analyze, changed, musicFeatures, synthesize } from './dsp.js';
import { applyFades, RATE, STRIDE_SAMPLES } from './grid.js';
import { inspect, prepareEncoder, preflight, makeOutput, encode, readWindow, joinWindow } from './media.js';
import { getModel } from './model-cache.js';

let media;
let busy = false;
const report = (phase, percent = null, remaining = null) => postMessage({ type: 'progress', phase, percent, remaining });

// Feature detection in the actual worker context. No browser-name allowlist.
function supported() {
  try {
    return typeof AudioDecoder === 'function' && !!crypto.subtle &&
      WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
  } catch { return false; }
}
postMessage({ type: 'capability', supported: supported() });

self.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  let stage = 'file-invalid';
  try {
    if (data.type === 'inspect') {
      media?.input.dispose();
      media = undefined;
      media = await inspect(data.file);
      postMessage({ type: 'ready', info: media.info });
    } else if (data.type === 'run' && media) {
      const { info, track, input } = media;
      stage = 'encode-unsupported';
      report('preflight');
      await prepareEncoder(info);
      await preflight(track, info);
      stage = 'model-download';
      const bytes = await getModel(report);
      report('initialize');
      stage = 'runtime';
      // Copied verbatim with its vendor directory by build.mjs. Dynamic loading
      // keeps ONNX Runtime off the initial page and the file-selection path.
      const { createModel } = await import(new URL('../engine/model.js', import.meta.url).href);
      const model = await createModel(bytes);
      stage = 'processing';
      const { output, source, target } = makeOutput(info);
      try {
        await output.start();
        const total = Math.round(info.duration * RATE);
        const windows = Math.ceil(total / STRIDE_SAMPLES);
        const started = performance.now();
        // Windows without music keep their audio as it is; only the others pay
        // for the separation model, which takes nearly all the time. A window is
        // separated when the detector finds music likely (score >= 0; Infinity
        // without a working detector), and after a window the model changed,
        // since music often fades out across windows (tests/website_reference.py
        // mirrors both rules).
        let tail, carry = false, separated = 0, changedWindows = 0;
        report('processing', 0);
        for (let k = 0, start = 0; start < total; k++, start += STRIDE_SAMPLES) {
          let voices = await readWindow(track, info, start);
          // A mono file is separated as identical left and right channels.
          const spectrum = analyze(voices[0], voices[1] || voices[0]);
          const score = await model.score(musicFeatures(spectrum));
          const separate = carry || score >= 0;
          carry = false;
          if (separate) {
            separated++;
            const { left, right } = synthesize(await model.run(spectrum));
            const output = info.channels === 1 ? [left] : [left, right];
            if (changed(voices, output)) { changedWindows++; carry = true; }
            voices = output;
          }
          applyFades(voices, k);
          tail = joinWindow(voices, tail);
          await encode(source, voices, start, Math.min(STRIDE_SAMPLES, total - start));
          // The average window so far predicts the rest. Windows without music
          // are much faster, so the estimate follows the share of music so far.
          const remaining = (performance.now() - started) / 1000 / (k + 1) * (windows - k - 1);
          report('processing', Math.min(100, Math.floor((start + STRIDE_SAMPLES) / total * 100)), remaining);
        }
        stage = 'export';
        report('export');
        source.close();
        await output.finalize();
        const buffer = target.buffer;
        // Of the windows, how many the model separated, and how many of those it
        // changed (dsp.js changed(): a threshold, not proof that nothing was removed).
        postMessage({ type: 'done', buffer, mime: info.format === 'mp3' ? 'audio/mpeg' : 'audio/mp4', windows, separated, changedWindows }, [buffer]);
      } finally {
        if (output.state !== 'finalized') await output.cancel();
        input.dispose();
        media = undefined;
      }
    }
  } catch (error) {
    console.error('Musicless audio:', stage, error);
    postMessage({ type: 'error', code: error.code || stage });
  } finally { busy = false; }
};
// Cancellation is immediate: the UI terminates this worker (and its decoders,
// encoder workers, fetches, WASM memory), then inspects the file in a fresh one.
