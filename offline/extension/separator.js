// Hidden frame that hosts the separation worker in the extension's own origin,
// where WebAssembly is allowed and the page cannot reach it. The content
// script hands over a MessagePort, and the worker talks to it directly.
window.addEventListener("message", (event) => {
  if (event.data?.type !== "nomusic-port" || !event.ports[0]) return;
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.postMessage({ type: "port" }, [event.ports[0]]);
});
