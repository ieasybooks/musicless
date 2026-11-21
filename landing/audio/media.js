import {
  Input, BlobSource, MP3, MP4, AudioSampleSink, AudioSample, AudioSampleSource,
  Output, BufferTarget, Mp3OutputFormat, Mp4OutputFormat, Quality, canEncodeAudio,
} from 'mediabunny';
import { resample } from '../../extension/dsp.js';
import { RATE, WINDOW_SAMPLES, STRIDE_SAMPLES, OVERLAP_SAMPLES } from '../../extension/grid.js';
import { MAX_BYTES, MAX_SECONDS } from './config.js';

export const fail = code => { throw Object.assign(new Error(code), { code }); };

export async function inspect(file) {
  const format = /\.(mp3|m4a)$/i.exec(file.name)?.[1].toLowerCase();
  if (!format) fail('file-type');
  if (!file.size) fail('file-invalid');
  if (file.size > MAX_BYTES) fail('file-size');
  const input = new Input({ formats: [format === 'mp3' ? MP3 : MP4], source: new BlobSource(file) });
  try {
    const tracks = await input.getAudioTracks();
    if (tracks.length !== 1 || (await input.getVideoTracks()).length) fail('file-tracks');
    const track = tracks[0];
    const codec = await track.getCodec();
    if (codec !== (format === 'mp3' ? 'mp3' : 'aac')) fail(format === 'm4a' ? 'file-aac' : 'file-type');
    if (!await track.canDecode()) fail('decode-unsupported');
    const channels = await track.getNumberOfChannels();
    const sampleRate = await track.getSampleRate();
    if (![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 96000) fail('file-layout');
    const start = Math.max(0, await track.getFirstTimestamp());
    const duration = await track.computeDuration() - start;
    if (!Number.isFinite(duration) || duration <= 0) fail('file-invalid');
    if (duration > MAX_SECONDS + 0.1) fail('file-duration');
    const info = { format, codec, channels, sampleRate, start, duration };
    return { input, track, info };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

export function encoding(info) {
  return {
    codec: info.codec,
    quality: new Quality({ bitrate: info.channels === 1 ? 96000 : 192000 }),
    ...(info.codec === 'aac' ? { fullCodecString: 'mp4a.40.2' } : {}),
  };
}

export async function prepareEncoder(info) {
  const config = { ...encoding(info), numberOfChannels: info.channels, sampleRate: RATE };
  if (!await canEncodeAudio(info.codec, config)) {
    // These official extensions contain their own small WASM codecs. Imports are
    // deliberately lazy; selecting a file does not download either encoder.
    if (info.codec === 'mp3') (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
    else (await import('@mediabunny/aac-encoder')).registerAacEncoder();
  }
  if (!await canEncodeAudio(info.codec, config)) fail('encode-unsupported');
}

export function makeOutput(info) {
  const target = new BufferTarget();
  const output = new Output({
    target,
    format: info.format === 'mp3' ? new Mp3OutputFormat() : new Mp4OutputFormat({ fastStart: false }),
  });
  const source = new AudioSampleSource(encoding(info));
  output.addAudioTrack(source);
  return { output, source, target };
}

export async function encode(source, channels, start, length = channels[0].length) {
  // Small writes respect encoder backpressure and bound transient allocations.
  for (let offset = 0; offset < length; offset += 8192) {
    const count = Math.min(8192, length - offset);
    const data = new Float32Array(count * channels.length);
    for (let c = 0; c < channels.length; c++) {
      data.set(channels[c].subarray(offset, offset + count), c * count);
    }
    const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels.length,
      sampleRate: RATE, timestamp: (start + offset) / RATE });
    try { await source.add(sample); } finally { sample.close(); }
  }
}

// Decode only a window and its sinc-filter margins. MediaBunny handles decoder
// pre-roll at each seek (including the MP3 bit reservoir); its iterator is closed
// before inference so decoded audio cannot queue up behind the model.
export async function readWindow(track, info, startFrame, count = WINDOW_SAMPLES) {
  const from = Math.floor((info.start + startFrame / RATE) * info.sampleRate) - 32;
  const to = Math.ceil((info.start + (startFrame + count) / RATE) * info.sampleRate) + 32;
  const channels = Array.from({ length: info.channels }, () => new Float32Array(to - from));
  let frames = 0;
  const sink = new AudioSampleSink(track);
  for await (const sample of sink.samples(Math.max(info.start, from / info.sampleRate),
    Math.min(info.start + info.duration, to / info.sampleRate))) {
    try {
      if (sample.sampleRate !== info.sampleRate || sample.numberOfChannels !== info.channels) fail('file-layout');
      const at = Math.round(sample.timestamp * info.sampleRate) - from;
      const first = Math.max(0, -at);
      const last = Math.min(sample.numberOfFrames, to - from - at);
      if (last <= first) continue;
      for (let c = 0; c < channels.length; c++) {
        sample.copyTo(channels[c].subarray(at + first, at + last),
          { planeIndex: c, format: 'f32-planar', frameOffset: first, frameCount: last - first });
      }
      frames += last - first;
    } finally { sample.close(); }
  }
  if (!frames) fail('file-invalid');
  return resample(channels, info.sampleRate, from / info.sampleRate, info.start + startFrame / RATE, count);
}

// Finalize a real, short encode before fetching 37.5 MiB of model weights.
export async function preflight(track, info) {
  const channels = await readWindow(track, info, 0, Math.min(8192, Math.ceil(info.duration * RATE)));
  const { output, source, target } = makeOutput(info);
  try {
    await output.start();
    await encode(source, channels, 0);
    source.close();
    await output.finalize();
    if (!target.buffer?.byteLength) fail('encode-unsupported');
  } finally {
    if (output.state !== 'finalized') await output.cancel();
  }
}

// Only the previous 46 ms overlap is retained between windows. Fades are applied
// by the shared extension code before this overlap-add, then output is trimmed.
export function joinWindow(channels, tail) {
  if (tail) for (let c = 0; c < channels.length; c++) {
    for (let i = 0; i < OVERLAP_SAMPLES; i++) channels[c][i] += tail[c][i];
  }
  return channels.map(channel => channel.slice(STRIDE_SAMPLES));
}
