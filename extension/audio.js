// One AudioContext for every video on the page. Browsers create it suspended
// until the page may play sound (a user gesture, or the site's autoplay
// allowance); it is resumed on the next gesture or playback.

let context = null;
const graphs = new WeakMap(); // media element -> its routing, which cannot be undone

export function audioContext() {
  if (!context) {
    context = new AudioContext({ latencyHint: "playback" });
    for (const type of ["pointerdown", "keydown", "touchend"]) {
      window.addEventListener(type, resumeAudio, { capture: true, passive: true });
    }
  }
  return context;
}

// Suspended (no gesture yet) or interrupted (another app took the audio device).
export function resumeAudio() {
  if (context?.state === "suspended" || context?.state === "interrupted") context.resume().catch(() => {});
}

// Route a media element through Web Audio: its own track goes through
// `original` (muted to silence it) and separated audio plays through `output`.
// The page's volume and mute still apply to the element; `output` follows them.
export function routeElement(video) {
  let graph = graphs.get(video);
  if (!graph) {
    const ctx = audioContext();
    const element = ctx.createMediaElementSource(video);
    const original = ctx.createGain();
    const output = ctx.createGain();
    element.connect(original).connect(ctx.destination);
    output.connect(ctx.destination);
    graph = { ctx, element, original, output };
    graphs.set(video, graph);
  }
  return graph;
}
