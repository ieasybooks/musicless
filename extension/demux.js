// Incremental WebM and fragmented-MP4 parsers for captured SourceBuffer bytes.
// They turn the byte stream a player appends into encoded audio frames with
// media timestamps, ready for WebCodecs' AudioDecoder. Appends can split an
// element anywhere, so each parser keeps the unparsed tail until more arrives.

export function createDemuxer(mime) {
  if (/webm/i.test(mime)) return new WebmDemuxer();
  if (/mp4/i.test(mime)) return new Mp4Demuxer();
  throw new Error(`unsupported container: ${mime}`);
}

// Identity of a decoder config by content, so repeated init segments do not count as changes.
export function configKey(config) {
  if (!config) return "";
  return [config.codec, config.sampleRate, config.numberOfChannels, ...(config.description ?? [])].join(",");
}

class ByteQueue {
  constructor() {
    this.bytes = new Uint8Array(0);
  }
  push(chunk) {
    const merged = new Uint8Array(this.bytes.length + chunk.length);
    merged.set(this.bytes);
    merged.set(chunk, this.bytes.length);
    this.bytes = merged;
  }
  consume(count) {
    this.bytes = this.bytes.subarray(count);
  }
  clear() {
    this.bytes = new Uint8Array(0);
  }
}

// ---------------------------------------------------------------------------
// WebM (Matroska): EBML elements, descending into the few masters we need.
// ---------------------------------------------------------------------------

const EBML = {
  header: 0x1a45dfa3, segment: 0x18538067, info: 0x1549a966, timecodeScale: 0x2ad7b1,
  tracks: 0x1654ae6b, trackEntry: 0xae, trackNumber: 0xd7, trackType: 0x83, codecId: 0x86,
  codecPrivate: 0x63a2, codecDelay: 0x56aa, audio: 0xe1, samplingFrequency: 0xb5, channels: 0x9f,
  cluster: 0x1f43b675, timecode: 0xe7, simpleBlock: 0xa3, blockGroup: 0xa0, block: 0xa1,
};
const DESCEND = new Set([EBML.segment, EBML.info, EBML.tracks, EBML.trackEntry, EBML.audio, EBML.cluster, EBML.blockGroup]);

function readVint(bytes, pos, keepMarker) {
  if (pos >= bytes.length) return null;
  const first = bytes[pos];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function readUint(bytes, start, end) {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  return value;
}

function readFloat(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  return end - start === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

// Duration of an Opus packet from its TOC byte (RFC 6716 section 3.1).
function opusPacketSeconds(packet) {
  const config = packet[0] >> 3;
  const frame = config < 12 ? [0.01, 0.02, 0.04, 0.06][config % 4]
    : config < 16 ? [0.01, 0.02][config % 2]
      : [0.0025, 0.005, 0.01, 0.02][config % 4];
  const code = packet[0] & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : packet[1] & 0x3f;
  return frame * frames;
}

class WebmDemuxer {
  constructor() {
    this.queue = new ByteQueue();
    this.scale = 1e6; // nanoseconds per timecode tick
    this.tracks = [];
    this.audio = null;
    this.clusterTime = 0;
    this.config = null;
    this.configVersion = 0;
  }

  reset() {
    this.queue.clear();
  }

  push(chunk, offset) {
    this.queue.push(chunk);
    const frames = [];
    const bytes = this.queue.bytes;
    let pos = 0;
    for (;;) {
      const id = readVint(bytes, pos, true);
      if (!id) break;
      const size = readVint(bytes, pos + id.length, false);
      if (!size) break;
      const body = pos + id.length + size.length;
      if (DESCEND.has(id.value)) {
        if (id.value === EBML.trackEntry) this.tracks.push({});
        if (id.value === EBML.cluster) this.clusterTime = 0;
        pos = body;
        continue;
      }
      if (size.unknown) throw new Error(`unknown-size WebM element 0x${id.value.toString(16)}`);
      const end = body + size.value;
      if (end > bytes.length) break;
      this.leaf(id.value, bytes, body, end, offset, frames);
      pos = end;
    }
    this.queue.consume(pos);
    return frames;
  }

  leaf(id, bytes, start, end, offset, frames) {
    const track = this.tracks[this.tracks.length - 1];
    switch (id) {
      case EBML.header:
        this.tracks = [];
        this.audio = null;
        break;
      case EBML.timecodeScale: this.scale = readUint(bytes, start, end); break;
      case EBML.trackNumber: track.number = readUint(bytes, start, end); break;
      case EBML.trackType: track.type = readUint(bytes, start, end); this.pickTrack(); break;
      case EBML.codecId: track.codec = new TextDecoder().decode(bytes.subarray(start, end)); this.pickTrack(); break;
      case EBML.codecPrivate: track.private = bytes.slice(start, end); this.pickTrack(); break;
      case EBML.samplingFrequency: track.rate = readFloat(bytes, start, end); this.pickTrack(); break;
      case EBML.channels: track.channels = readUint(bytes, start, end); this.pickTrack(); break;
      case EBML.timecode: this.clusterTime = readUint(bytes, start, end); break;
      case EBML.simpleBlock:
      case EBML.block: {
        if (!this.audio) break;
        const number = readVint(bytes, start, false);
        if (number.value !== this.audio.number) break;
        const head = start + number.length;
        const relative = ((bytes[head] << 8) | bytes[head + 1]) << 16 >> 16;
        const flags = bytes[head + 2];
        if (flags & 0x06) break; // laced blocks are not used for audio by mainstream muxers
        const data = bytes.slice(head + 3, end);
        const time = ((this.clusterTime + relative) * this.scale) / 1e9 + offset;
        frames.push({ time, duration: opusPacketSeconds(data), data, configVersion: this.configVersion });
        break;
      }
      default:
        break;
    }
  }

  // The first audio track becomes the source; its decoder config follows.
  pickTrack() {
    const track = this.tracks.find((candidate) => candidate.type === 2 && candidate.codec);
    if (!track || track.codec !== "A_OPUS") {
      if (track) this.unsupported = track.codec;
      return;
    }
    this.audio = track;
    const config = {
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: track.channels ?? 2,
      description: track.private,
    };
    if (configKey(config) !== configKey(this.config)) {
      this.config = config;
      this.configVersion++;
    }
  }
}

// ---------------------------------------------------------------------------
// Fragmented MP4: moov for the audio track's config, moof + mdat for samples.
// ---------------------------------------------------------------------------

function boxes(bytes, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = readUint(bytes, pos, pos + 4);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    let header = 8;
    if (size === 1) {
      size = readUint(bytes, pos + 8, pos + 16);
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos, body: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

const child = (bytes, box, type) => boxes(bytes, box.body, box.end).find((b) => b.type === type);

function descriptorLength(bytes, pos) {
  let length = 0;
  let count = 0;
  for (;;) {
    const byte = bytes[pos + count++];
    length = (length << 7) | (byte & 0x7f);
    if (!(byte & 0x80) || count === 4) return { length, size: count };
  }
}

// AudioSpecificConfig from an esds box: ES_Descriptor > DecoderConfig > DecSpecificInfo.
function audioSpecificConfig(bytes, esds) {
  let pos = esds.body + 4;
  const end = esds.end;
  while (pos < end) {
    const tag = bytes[pos];
    const { length, size } = descriptorLength(bytes, pos + 1);
    const body = pos + 1 + size;
    if (tag === 0x03) {
      const flags = bytes[body + 2];
      pos = body + 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + bytes[body + 3] : 0) + (flags & 0x20 ? 2 : 0);
    } else if (tag === 0x04) {
      pos = body + 13;
    } else if (tag === 0x05) {
      return bytes.slice(body, body + length);
    } else {
      pos = body + length;
    }
  }
  return null;
}

class Mp4Demuxer {
  constructor() {
    this.queue = new ByteQueue();
    this.track = null; // { id, timescale, config, defaults, editSeconds }
    this.pendingMoof = null;
    this.config = null;
    this.configVersion = 0;
  }

  reset() {
    this.queue.clear();
    this.pendingMoof = null;
  }

  push(chunk, offset) {
    this.queue.push(chunk);
    const bytes = this.queue.bytes;
    const frames = [];
    let pos = 0;
    for (const box of boxes(bytes, 0, bytes.length)) {
      if (box.type === "moov") this.parseMoov(bytes, box);
      else if (box.type === "moof") this.pendingMoof = { bytes: bytes.slice(box.start, box.end) };
      else if (box.type === "mdat" && this.pendingMoof && this.track) {
        this.parseFragment(this.pendingMoof.bytes, bytes, box, offset, frames);
        this.pendingMoof = null;
      }
      pos = box.end;
    }
    this.queue.consume(pos);
    return frames;
  }

  parseMoov(bytes, moov) {
    const trex = new Map();
    const mvex = child(bytes, moov, "mvex");
    if (mvex) {
      for (const box of boxes(bytes, mvex.body, mvex.end).filter((b) => b.type === "trex")) {
        const p = box.body + 4;
        trex.set(readUint(bytes, p, p + 4), {
          duration: readUint(bytes, p + 8, p + 12),
          size: readUint(bytes, p + 12, p + 16),
        });
      }
    }
    for (const trak of boxes(bytes, moov.body, moov.end).filter((b) => b.type === "trak")) {
      const mdia = child(bytes, trak, "mdia");
      const hdlr = mdia && child(bytes, mdia, "hdlr");
      if (!hdlr || String.fromCharCode(...bytes.subarray(hdlr.body + 8, hdlr.body + 12)) !== "soun") continue;
      const tkhd = child(bytes, trak, "tkhd");
      const tkhdVersion = bytes[tkhd.body];
      const id = readUint(bytes, tkhd.body + (tkhdVersion ? 20 : 12), tkhd.body + (tkhdVersion ? 24 : 16));
      const mdhd = child(bytes, mdia, "mdhd");
      const mdhdVersion = bytes[mdhd.body];
      const timescale = readUint(bytes, mdhd.body + (mdhdVersion ? 20 : 12), mdhd.body + (mdhdVersion ? 24 : 16));
      const stbl = child(bytes, child(bytes, mdia, "minf"), "stbl");
      const stsd = child(bytes, stbl, "stsd");
      const entry = boxes(bytes, stsd.body + 8, stsd.end)[0];
      if (!entry || entry.type !== "mp4a") {
        this.unsupported = entry?.type;
        continue;
      }
      const channels = readUint(bytes, entry.body + 16, entry.body + 18);
      const rate = readUint(bytes, entry.body + 24, entry.body + 26);
      const esds = boxes(bytes, entry.body + 28, entry.end).find((b) => b.type === "esds");
      const asc = esds && audioSpecificConfig(bytes, esds);
      if (!asc) continue;
      const objectType = asc[0] >> 3;
      // Edit list media_time: the encoder priming that MSE trims from the start.
      let editSeconds = 0;
      const edts = child(bytes, trak, "edts");
      const elst = edts && child(bytes, edts, "elst");
      if (elst && readUint(bytes, elst.body + 4, elst.body + 8) > 0) {
        const version = bytes[elst.body];
        const at = elst.body + 8 + (version ? 8 : 4);
        const mediaTime = version ? readUint(bytes, at, at + 8) : readUint(bytes, at, at + 4);
        if (mediaTime !== 0xffffffff) editSeconds = mediaTime / timescale;
      }
      this.track = { id, timescale, defaults: trex.get(id) ?? {}, editSeconds };
      // Live streams repeat the init segment with every fragment: keep one config while it is unchanged.
      const config = {
        codec: `mp4a.40.${objectType}`,
        sampleRate: rate || timescale,
        numberOfChannels: channels || 2,
        description: asc,
      };
      if (configKey(config) !== configKey(this.config)) {
        this.config = config;
        this.configVersion++;
      }
      return;
    }
  }

  parseFragment(moofBytes, bytes, mdat, offset, frames) {
    const moof = { start: 0, body: 8, end: moofBytes.length };
    for (const traf of boxes(moofBytes, moof.body, moof.end).filter((b) => b.type === "traf")) {
      const tfhd = child(moofBytes, traf, "tfhd");
      const flags = readUint(moofBytes, tfhd.body + 1, tfhd.body + 4);
      let p = tfhd.body + 4;
      const trackId = readUint(moofBytes, p, p + 4);
      p += 4;
      if (trackId !== this.track.id) continue;
      if (flags & 0x01) p += 8; // base data offset: MSE players use moof-relative offsets
      if (flags & 0x02) p += 4;
      let defaultDuration = this.track.defaults.duration ?? 0;
      let defaultSize = this.track.defaults.size ?? 0;
      if (flags & 0x08) { defaultDuration = readUint(moofBytes, p, p + 4); p += 4; }
      if (flags & 0x10) { defaultSize = readUint(moofBytes, p, p + 4); p += 4; }

      const tfdt = child(moofBytes, traf, "tfdt");
      let decodeTime = 0;
      if (tfdt) {
        decodeTime = moofBytes[tfdt.body] === 1
          ? readUint(moofBytes, tfdt.body + 4, tfdt.body + 12)
          : readUint(moofBytes, tfdt.body + 4, tfdt.body + 8);
      }
      for (const trun of boxes(moofBytes, traf.body, traf.end).filter((b) => b.type === "trun")) {
        const trunFlags = readUint(moofBytes, trun.body + 1, trun.body + 4);
        const count = readUint(moofBytes, trun.body + 4, trun.body + 8);
        let q = trun.body + 8;
        let dataOffset = 0;
        if (trunFlags & 0x01) {
          dataOffset = readUint(moofBytes, q, q + 4) << 0;
          q += 4;
        }
        if (trunFlags & 0x04) q += 4;
        // Sample data offset is relative to the moof start; mdat follows the moof directly.
        let dataPos = mdat.start - moofBytes.length + dataOffset;
        for (let i = 0; i < count; i++) {
          let duration = defaultDuration;
          let size = defaultSize;
          if (trunFlags & 0x100) { duration = readUint(moofBytes, q, q + 4); q += 4; }
          if (trunFlags & 0x200) { size = readUint(moofBytes, q, q + 4); q += 4; }
          if (trunFlags & 0x400) q += 4;
          if (trunFlags & 0x800) q += 4;
          if (dataPos >= mdat.body && dataPos + size <= mdat.end) {
            frames.push({
              time: (decodeTime - this.track.editSeconds * this.track.timescale) / this.track.timescale + offset,
              duration: duration / this.track.timescale,
              data: bytes.slice(dataPos, dataPos + size),
              configVersion: this.configVersion,
            });
          }
          decodeTime += duration;
          dataPos += size;
        }
      }
    }
  }
}
