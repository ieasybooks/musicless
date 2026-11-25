// The Firefox Android worker falls back to decodeAudioData. Exercise the same
// packet wrapping and PCM placement with real decoders, including on desktop CI.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gotoExtensionPage, launch } from "./harness.mjs";

export function audioFixtures() {
  return Object.fromEntries(["aac.mp4", "opus.webm"].map(name =>
    [name, readFileSync(new URL(`unit/fixtures/${name}`, import.meta.url)).toString("base64")]));
}

// Runs in an extension page on desktop or Android Firefox.
export async function checkNativeAudio(files) {
  const { createDemuxer } = await import(new URL("demux.js", location.href));
  const { decodeInFrame } = await import(new URL("web-audio-decode.js", location.href));
  const ctx = new OfflineAudioContext(2, 1, 48000);
  const decode = async file => {
    const audio = await ctx.decodeAudioData(file);
    return { channels: [audio.getChannelData(0)], rate: audio.sampleRate };
  };
  for (const [name, mime] of [["aac.mp4", "audio/mp4"], ["opus.webm", "audio/webm"]]) {
    const bytes = Uint8Array.from(atob(files[name]), c => c.charCodeAt(0));
    const demuxer = createDemuxer(mime);
    const frames = demuxer.push(bytes).slice(20, 45).map(f => ({ ...f, config: demuxer.config }));
    const run = await decodeInFrame(frames, decode);
    const [dense] = run.channels;
    const first = frames[0];
    const duration = frames.at(-1).time + frames.at(-1).duration - first.time;
    if (Math.abs(dense.length - duration * run.rate) > 2) throw Error(name + " incomplete window");
    const single = await decodeInFrame([first], decode);
    if (Math.abs(single.channels[0].length - first.duration * run.rate) > 2) throw Error(name + " one-packet length");
    // The fixture MP4 has no edit list. Ignore decoder warmup at the start,
    // then compare the actual waveform at its media timestamp through the tail.
    if (name === "aac.mp4") {
      const [reference] = (await decode(bytes.buffer)).channels;
      const offset = Math.round(first.time * run.rate);
      let energy = 0, error = 0;
      for (let i = 2048; i < dense.length; i++) {
        const expected = reference[offset + i];
        energy += expected * expected;
        error += (dense[i] - expected) ** 2;
      }
      if (!(energy > 0 && error / energy < 0.05)) throw Error("AAC waveform mismatch: " + error / energy);
    }
    const gap = 0.004;
    const [gapped] = (await decodeInFrame(frames.map((f, i) => ({ ...f, time: f.time + i * gap })), decode)).channels;
    const gapSamples = Math.round(gap * run.rate);
    // Native resamplers can round the continuous decode down by one sample.
    // The restored timeline ends at the timestamp of the last packet's end.
    const timelineLength = Math.round((duration + (frames.length - 1) * gap) * run.rate);
    if (gapped.length !== timelineLength) throw Error(name + " timeline length");
    for (let i = 1; i < frames.length; i++) {
      const from = Math.round((frames[i].time - first.time) * run.rate);
      const to = from + i * gapSamples;
      if (gapped.subarray(to - gapSamples, to).some(x => x !== 0) ||
          !gapped.subarray(to, to + 128).every((x, j) => x === dense[from + j])) throw Error(name + " misplaced packet " + i);
    }
  }
  return "AAC and Opus waveform, single-packet and gap checks passed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { browser, extensionId } = await launch({ diagnostics: false });
  try {
    const page = await browser.newPage();
    await gotoExtensionPage(page, extensionId, "separator.html");
    console.log(await page.evaluate(checkNativeAudio, audioFixtures()));
  } finally {
    await browser.close();
  }
}
