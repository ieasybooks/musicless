// Shared worker holding the one copy of the model for every tab (the network
// alone needs ~500 MB of WebAssembly memory). Each tab's worker gets its own
// MessagePort here and sends separation requests with a priority: the chunk a
// playing video needs now goes before look-ahead work from any tab.

import { createModel } from "./model.js";

const model = createModel();

function serve(port) {
  port.onmessage = async ({ data }) => {
    if (data?.type === "load") {
      model.load().then(
        (seconds) => port.postMessage({ type: "ready", seconds }),
        (error) => port.postMessage({ type: "failed", message: error.message }),
      );
    } else if (data?.type === "run") {
      try {
        const { mask, ms } = await model.run(data.magnitude, data.priority);
        port.postMessage({ type: "result", id: data.id, mask, ms }, [mask.buffer]);
      } catch (error) {
        port.postMessage({ type: "error", id: data.id, message: error.message });
      }
    }
  };
}

self.onconnect = (event) => {
  const connection = event.ports[0];
  connection.onmessage = ({ data, ports }) => {
    if (data?.type === "client" && ports[0]) serve(ports[0]);
  };
};
