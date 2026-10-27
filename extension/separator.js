// Hidden frame that hosts a tab's separation worker in the extension's own
// origin, where WebAssembly is allowed and the page cannot reach it. The
// content script hands over a MessagePort and the worker talks to it directly.
// The worker reaches the shared model through a second port.
//
// A page can load this frame too and post to it, so the frame takes one port,
// and only with the token from extension storage that the content script sends.
let taken = false;
window.addEventListener("message", async (event) => {
  if (taken || event.data?.type !== "musicless-port" || typeof event.data.token !== "string" || !event.ports[0]) return;
  const { engineToken } = await chrome.storage.local.get("engineToken");
  if (taken || !engineToken || event.data.token !== engineToken) return;
  taken = true;
  const worker = new Worker(new URL("./tab-worker.js", import.meta.url), { type: "module", name: "musicless" });
  const channel = new MessageChannel();
  worker.postMessage({ type: "port" }, [event.ports[0], channel.port1]);
  // A shared model that cannot start ends the worker at once rather than after
  // a timeout, and Musicless fails closed.
  try {
    const shared = new SharedWorker(new URL("./model-worker.js", import.meta.url), { type: "module", name: "musicless-model" });
    shared.addEventListener("error", () => worker.postMessage({ type: "shared-model-failed" }));
    shared.port.postMessage({ type: "client" }, [channel.port2]);
  } catch {
    worker.postMessage({ type: "shared-model-failed" });
  }
});
