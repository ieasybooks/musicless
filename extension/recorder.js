// Debug recording for the browser tests. Not part of the release: the test
// harness adds it to its own copy of the extension.
// Taps the original element audio and Musicless's output on the same clock so
// the browser tests can measure sync and leakage from what actually played.

export class Recorder {
  constructor(ctx, original, output, video) {
    this.rate = ctx.sampleRate;
    this.ctx = ctx;
    this.video = video;
    this.media = []; // [clock time, media time] pairs for mapping output back to the video
    this.limit = this.rate * 180;
    this.tracks = { original: [], output: [] };
    this.lengths = { original: 0, output: 0 };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    for (const [name, node] of [["original", original], ["output", output]]) {
      const tap = ctx.createScriptProcessor(4096, 2, 1);
      tap.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const left = input.getChannelData(0);
        const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
        const mono = new Float32Array(left.length);
        for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i]);
        const track = this.tracks[name];
        track.push({ time: event.playbackTime, data: mono });
        if (name === "output") {
          // The media time this block will be heard at, if playback continues as now.
          // A ScriptProcessor hands over its input two buffers after it was rendered.
          const rendered = event.playbackTime - (2 * tap.bufferSize) / this.rate;
          const ahead = (rendered - this.ctx.currentTime) * this.video.playbackRate;
          this.media.push([event.playbackTime, this.video.paused ? null : this.video.currentTime + ahead]);
          if (this.media.length > 4000) this.media.shift();
        }
        this.lengths[name] += mono.length;
        while (this.lengths[name] > this.limit) this.lengths[name] -= track.shift().data.length;
      };
      node.connect(tap);
      tap.connect(sink);
    }
  }

  // Both tracks over the same clock span, as Int16 base64 for transport.
  dump(seconds) {
    seconds = Math.min(Math.max(Number(seconds) || 0, 0), this.limit / this.rate);
    const end = Math.min(...["original", "output"].map((name) => {
      const track = this.tracks[name];
      const last = track[track.length - 1];
      return last ? last.time + last.data.length / this.rate : 0;
    }));
    const start = end - seconds;
    const out = {};
    for (const name of ["original", "output"]) {
      const samples = new Int16Array(Math.round(seconds * this.rate));
      for (const block of this.tracks[name]) {
        const at = Math.round((block.time - start) * this.rate);
        for (let i = 0; i < block.data.length; i++) {
          const j = at + i;
          if (j >= 0 && j < samples.length) samples[j] = Math.max(-32768, Math.min(32767, block.data[i] * 32767));
        }
      }
      let binary = "";
      const bytes = new Uint8Array(samples.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out[name] = btoa(binary);
    }
    const media = this.media.filter(([time]) => time >= start && time <= end).map(([time, m]) => [time - start, m]);
    return { rate: this.rate, start, seconds, media, ...out };
  }
}
