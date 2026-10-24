// Hidden frame that hosts a tab's separation worker in the extension's own
// origin, where WebAssembly is allowed and the page cannot reach it. The
// content script hands over a MessagePort and the worker talks to it directly.
// The worker reaches the shared model through a second port; if shared workers
// are unavailable it loads its own copy of the model.
window.addEventListener("message", (event) => {
  if (event.data?.type !== "nomusic-port" || !event.ports[0]) return;
  const worker = new Worker(new URL("./tab-worker.js", import.meta.url), { type: "module", name: "nomusic" });
  const ports = [event.ports[0]];
  try {
    const shared = new SharedWorker(new URL("./model-worker.js", import.meta.url), { type: "module", name: "nomusic-model" });
    const channel = new MessageChannel();
    shared.port.postMessage({ type: "client" }, [channel.port2]);
    ports.push(channel.port1);
  } catch {
    // No shared workers here (or they are blocked): the tab worker loads the model itself.
  }
  worker.postMessage({ type: "port" }, ports);
});
