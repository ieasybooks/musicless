// Hidden frame that hosts a tab's separation worker in the extension's own
// origin, where WebAssembly is allowed and the page cannot reach it. The
// content script hands over a MessagePort and the worker talks to it directly.
// The worker reaches the shared model through a second port; if shared workers
// are unavailable it loads its own copy of the model.
//
// A page can load this frame too and post to it, so the frame takes one port,
// and only with the token from extension storage that the content script sends.
let taken = false;
window.addEventListener("message", async (event) => {
  if (taken || event.data?.type !== "nomusic-port" || typeof event.data.token !== "string" || !event.ports[0]) return;
  const { engineToken } = await chrome.storage.local.get("engineToken");
  if (taken || !engineToken || event.data.token !== engineToken) return;
  taken = true;
  const worker = new Worker(new URL("./tab-worker.js", import.meta.url), { type: "module", name: "nomusic" });
  const ports = [event.ports[0]];
  try {
    const shared = new SharedWorker(new URL("./model-worker.js", import.meta.url), { type: "module", name: "nomusic-model" });
    // If it cannot start (e.g. blocked by policy), fall back at once rather than after a timeout.
    shared.addEventListener("error", () => worker.postMessage({ type: "shared-model-failed" }));
    const channel = new MessageChannel();
    shared.port.postMessage({ type: "client" }, [channel.port2]);
    ports.push(channel.port1);
  } catch {
    // No shared workers here (or they are blocked): the tab worker loads the model itself.
  }
  worker.postMessage({ type: "port" }, ports);
});
