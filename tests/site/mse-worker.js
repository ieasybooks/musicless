// Media Source in a dedicated worker (Chrome 108+): the page attaches it with
// video.srcObject = handle and never calls appendBuffer itself, so Musicless's
// capture cannot see the audio. Used to test that Musicless then fails closed.
self.onmessage = async ({ data: { url, mime, slice } }) => {
  const mediaSource = new MediaSource();
  self.postMessage({ handle: mediaSource.handle }, [mediaSource.handle]);
  await new Promise((resolve) => mediaSource.addEventListener("sourceopen", resolve, { once: true }));
  const sb = mediaSource.addSourceBuffer(mime);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const idle = () => sb.updating && new Promise((resolve) => sb.addEventListener("updateend", resolve, { once: true }));
  for (let at = 0; at < bytes.length; at += slice) {
    await idle();
    sb.appendBuffer(bytes.subarray(at, at + slice));
  }
  await idle();
  mediaSource.endOfStream();
};
