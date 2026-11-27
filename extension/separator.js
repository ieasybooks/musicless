// Hidden frame that hosts a tab's separation worker in the extension's own
// origin, where WebAssembly is allowed and the page cannot reach it. The
// content script hands over a MessagePort and the worker talks to it directly.
// The worker reaches the shared model through a second port.
//
// A page can load this frame too and post to it, so the frame takes one port,
// and only with the token from extension storage that the content script sends.
const IN_SAFARI = new URL(import.meta.url).protocol === "safari-web-extension:";
let taken = false;
window.addEventListener("message", async (event) => {
  if (taken || event.data?.type !== "musicless-port" || typeof event.data.token !== "string" || !event.ports[0]) return;
  const { engineToken } = await chrome.storage.local.get("engineToken");
  if (taken || !engineToken || event.data.token !== engineToken) return;
  taken = true;
  const worker = new Worker(new URL("./tab-worker.js", import.meta.url), { type: "module", name: "musicless" });
  // Firefox for Android exposes its native audio decoders through Web Audio.
  // Only this worker requests decoding; no page message can submit a file.
  let decoder;
  worker.onmessage = async ({ data, ports }) => {
    if (data.type !== "decode-audio") return;
    const [reply] = ports;
    try {
      decoder ??= new OfflineAudioContext(2, 1, 48000);
      const audio = await decoder.decodeAudioData(data.file);
      const left = audio.getChannelData(0);
      const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
      reply.postMessage({ channels: [left, right], rate: audio.sampleRate },
        left === right ? [left.buffer] : [left.buffer, right.buffer]);
    } catch (error) {
      reply.postMessage({ error: error.message });
    } finally {
      reply.close();
    }
  };
  const channel = new MessageChannel();
  worker.postMessage({ type: "port" }, [event.ports[0], channel.port1]);
  // A shared model that cannot start ends the worker at once rather than after
  // a timeout, and Musicless fails closed. In Safari, WebKit's SharedWorker
  // loader omits safari-web-extension:// scheme handlers (NSURLError -1002 on
  // sub-imports), so Safari runs model-worker.js in a dedicated Worker instead.
  try {
    if (IN_SAFARI) {
      const modelWorker = new Worker(new URL("./model-worker.js", import.meta.url), { type: "module", name: "musicless-model" });
      modelWorker.addEventListener("error", () => worker.postMessage({ type: "shared-model-failed" }));
      modelWorker.postMessage({ type: "client" }, [channel.port2]);
    } else {
      const shared = new SharedWorker(new URL("./model-worker.js", import.meta.url), { type: "module", name: "musicless-model" });
      shared.addEventListener("error", () => worker.postMessage({ type: "shared-model-failed" }));
      shared.port.postMessage({ type: "client" }, [channel.port2]);
    }
  } catch {
    worker.postMessage({ type: "shared-model-failed" });
  }
});
