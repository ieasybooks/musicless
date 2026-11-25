// Web Audio accepts complete files. Wrap one decoder run in memory for browsers
// without AudioDecoder in workers. The caller keeps the run's media timestamp.
const text = new TextEncoder();
function join(parts) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function element(id, ...parts) {
  const bodySize = parts.reduce((total, part) => total + part.length, 0);
  let width = 1;
  while (bodySize >= 2 ** (7 * width) - 1) width++;
  const length = new Uint8Array(width);
  let size = bodySize;
  for (let i = width - 1; i >= 0; i--) {
    length[i] = size & 255;
    size = Math.floor(size / 256);
  }
  length[0] |= 1 << (8 - width);
  return join([Uint8Array.from(id), length, ...parts]);
}

// One dense WebM cluster. Packet times are restored after Web Audio decodes it.
// Each run is bounded by the model window, well within a block's signed 16 bits.
function opus(frames, config) {
  const header = element([0x1a, 0x45, 0xdf, 0xa3],
    element([0x42, 0x82], text.encode("webm")), element([0x42, 0x87], Uint8Array.of(4)),
    element([0x42, 0x85], Uint8Array.of(2)));
  const head = config.description?.slice() ?? Uint8Array.of(...text.encode("OpusHead"), 1,
    config.numberOfChannels, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0);
  // The demuxed timestamps already locate each packet. A mid-stream window
  // must not discard a file's encoder priming a second time.
  head[10] = head[11] = 0;
  const track = element([0xae], element([0xd7], Uint8Array.of(1)), element([0x73, 0xc5], Uint8Array.of(1)),
    element([0x83], Uint8Array.of(2)), element([0x86], text.encode("A_OPUS")), element([0x63, 0xa2], head),
    element([0xe1], element([0xb5], Uint8Array.of(0x47, 0x3b, 0x80, 0)), // 48000 as a big-endian float
      element([0x9f], Uint8Array.of(config.numberOfChannels))));
  let elapsed = 0;
  const blocks = frames.map(({ data, duration }) => {
    const ms = Math.round(elapsed * 1000);
    elapsed += duration;
    return element([0xa3], Uint8Array.of(0x81, ms >> 8, ms, 0x80), data);
  });
  const segment = element([0x18, 0x53, 0x80, 0x67],
    element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], Uint8Array.of(0x0f, 0x42, 0x40))),
    element([0x16, 0x54, 0xae, 0x6b], track),
    element([0x1f, 0x43, 0xb6, 0x75], element([0xe7], Uint8Array.of(0)), ...blocks));
  return join([header, segment]).buffer;
}

// Firefox trims one AAC packet from an ADTS file, including a one-packet file.
// An audio-only MP4 with the original sample entry and no edit list preserves
// the whole run. All packets share one chunk directly after the file header.
function words(...values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value));
  return bytes;
}

function box(type, ...parts) {
  const size = 8 + parts.reduce((n, part) => n + part.length, 0);
  return join([words(size), text.encode(type), ...parts]);
}

function aac(frames, config) {
  const rate = config.sampleRate;
  const durations = frames.map(frame => Math.round(frame.duration * rate));
  const length = durations.reduce((n, duration) => n + duration, 0);
  const matrix = words(65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000);
  const ftyp = box("ftyp", text.encode("isom"), words(0), text.encode("isommp41"));
  const stbl = box("stbl", box("stsd", words(0, 1), config.sampleEntry),
    box("stts", words(0, frames.length), words(...durations.flatMap(duration => [1, duration]))),
    box("stsc", words(0, 1, 1, frames.length, 1)),
    box("stsz", words(0, 0, frames.length), words(...frames.map(f => f.data.length))),
    box("stco", words(0, 1, ftyp.length + 8)));
  const minf = box("minf", box("smhd", words(0, 0)),
    box("dinf", box("dref", words(0, 1), box("url ", words(1)))), stbl);
  const mdia = box("mdia", box("mdhd", words(0, 0, 0, rate, length, 0x55c40000)),
    box("hdlr", words(0, 0), text.encode("soun"), words(0, 0, 0, 0)), minf);
  const trak = box("trak", box("tkhd", words(7, 0, 0, 1, 0, length, 0, 0, 0, 0x01000000), matrix, words(0, 0)), mdia);
  const mvhd = box("mvhd", words(0, 0, 0, rate, length, 65536, 0x01000000, 0, 0), matrix, words(0, 0, 0, 0, 0, 0, 2));
  return join([ftyp, box("mdat", ...frames.map(f => f.data)), box("moov", mvhd, trak)]).buffer;
}

export function canWrap(config) {
  if (config.codec === "opus") return !!config.description || config.numberOfChannels <= 2;
  return /^mp4a\.40\.[1-4]$/.test(config.codec) && !!config.sampleEntry;
}

async function readInFrame(file) {
  const { port1, port2 } = new MessageChannel();
  try {
    const reply = new Promise((resolve, reject) => {
      port1.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
    });
    self.postMessage({ type: "decode-audio", file }, [file, port2]);
    return await reply;
  } finally {
    port1.close();
  }
}

export async function decodeInFrame(frames, read = readInFrame) {
  const config = frames[0].config;
  const file = config.codec === "opus" ? opus(frames, config) : aac(frames, config);
  const { channels, rate } = await read(file);
  // Web Audio returns continuous PCM even across timestamp gaps. Copy each
  // packet to its media offset once, without restarting a decoder at a gap.
  const origin = frames[0].time;
  const length = Math.round((frames.at(-1).time + frames.at(-1).duration - origin) * rate);
  let placed;
  let elapsed = 0;
  for (const frame of frames) {
    const from = Math.round(elapsed * rate);
    elapsed += frame.duration;
    const to = Math.round((frame.time - origin) * rate);
    if (!placed && to === from) continue;
    if (!placed) placed = channels.map(channel => {
      const output = new Float32Array(length);
      output.set(channel.subarray(0, Math.min(from, length)));
      return output;
    });
    const end = Math.min(Math.round(elapsed * rate), from + length - to);
    for (let c = 0; c < channels.length; c++) placed[c].set(channels[c].subarray(from, end), to);
  }
  return { channels: placed ?? channels.map(channel => channel.subarray(0, length)), rate };
}
