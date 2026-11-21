import { analyze, synthesize } from '../../extension/dsp.js';
import { applyFades, RATE, STRIDE_SAMPLES } from '../../extension/grid.js';
import { inspect, prepareEncoder, preflight, makeOutput, encode, readWindow, joinWindow } from './media.js';
import { getModel } from './model-cache.js';

let media;
let busy = false;
const report = (phase, percent = null) => postMessage({ type: 'progress', phase, percent });

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
      const model = createModel({ source: bytes });
      await model.load();
      stage = 'processing';
      const { output, source, target } = makeOutput(info);
      try {
        await output.start();
        const total = Math.round(info.duration * RATE);
        let tail;
        report('processing', 0);
        for (let k = 0, start = 0; start < total; k++, start += STRIDE_SAMPLES) {
          const channels = await readWindow(track, info, start);
          const { spec, magnitude } = analyze(channels[0], channels[1] || channels[0]);
          const { mask } = await model.run(magnitude, 0);
          const { left, right } = synthesize(spec, mask);
          const vocals = info.channels === 1 ? [left] : [left, right];
          applyFades(vocals, k);
          tail = joinWindow(vocals, tail);
          await encode(source, vocals, start, Math.min(STRIDE_SAMPLES, total - start));
          report('processing', Math.min(100, Math.floor((start + STRIDE_SAMPLES) / total * 100)));
        }
        stage = 'export';
        report('export');
        source.close();
        await output.finalize();
        const buffer = target.buffer;
        postMessage({ type: 'done', buffer, mime: info.format === 'mp3' ? 'audio/mpeg' : 'audio/mp4' }, [buffer]);
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
