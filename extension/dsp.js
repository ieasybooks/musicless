// Spleeter's signal processing around the network, matching the reference
// Python pipeline (torch.stft/istft, n_fft 4096, hop 1024, periodic Hann,
// reflect padding): resampling to 44.1 kHz, the magnitude spectrogram the
// model reads, and the masked inverse STFT that produces the vocals.

import { FRAMES, HOP, RATE, WINDOW_SAMPLES } from "./grid.js";

export { FRAMES, HOP, RATE, WINDOW_SAMPLES };
export const N_FFT = 4096;
export const BINS = 1024; // the model sees 0 to ~11 kHz; higher bins are dropped

const HALF = N_FFT / 2;
const hann = new Float64Array(N_FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));

class FFT {
  constructor(n) {
    this.n = n;
    this.cos = new Float64Array(n / 2).map((_, k) => Math.cos((2 * Math.PI * k) / n));
    this.sin = new Float64Array(n / 2).map((_, k) => Math.sin((2 * Math.PI * k) / n));
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  // In-place complex FFT; inverse is unscaled.
  run(re, im, inverse) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sign = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = start + j;
          const b = a + half;
          const c = cos[k];
          const s = sign * sin[k];
          const tr = re[b] * c + im[b] * s;
          const ti = im[b] * c - re[b] * s;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

const fft = new FFT(N_FFT);

const reflect = (i, n) => (i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i);

// The network's masks depend on how loud its input is, so every window is shown
// to it at the same level; the mask still applies to the window as it is.
const INPUT_RMS = 10 ** (-24 / 20);
const MAX_INPUT_GAIN = 10 ** (30 / 20);

export function inputGain(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += left[i] * left[i] + right[i] * right[i];
  const rms = Math.sqrt(sum / (2 * left.length)) + 1e-9;
  return Math.min(MAX_INPUT_GAIN, Math.max(1 / MAX_INPUT_GAIN, INPUT_RMS / rms));
}

// STFT of a stereo window. Returns the complex spectra of bins < BINS for all
// FRAMES + 1 frames, and the model input |X| * inputGain shaped (2, 1, FRAMES, BINS).
export function analyze(left, right) {
  const gain = inputGain(left, right);
  const frames = FRAMES + 1;
  const spec = new Float32Array(2 * 2 * frames * BINS); // [channel][re/im][frame][bin]
  const magnitude = new Float32Array(2 * FRAMES * BINS);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const plane = frames * BINS;
  for (let f = 0; f < frames; f++) {
    const origin = f * HOP - HALF;
    for (let i = 0; i < N_FFT; i++) {
      const at = reflect(origin + i, WINDOW_SAMPLES);
      re[i] = left[at] * hann[i];
      im[i] = right[at] * hann[i];
    }
    fft.run(re, im, false);
    // Two real channels packed into one complex FFT: split them by symmetry.
    for (let k = 0; k < BINS; k++) {
      const m = (N_FFT - k) % N_FFT;
      const lr = 0.5 * (re[k] + re[m]);
      const li = 0.5 * (im[k] - im[m]);
      const rr = 0.5 * (im[k] + im[m]);
      const ri = -0.5 * (re[k] - re[m]);
      const at = f * BINS + k;
      spec[at] = lr;
      spec[plane + at] = li;
      spec[2 * plane + at] = rr;
      spec[3 * plane + at] = ri;
      if (f < FRAMES) {
        magnitude[at] = Math.hypot(lr, li) * gain;
        magnitude[FRAMES * BINS + at] = Math.hypot(rr, ri) * gain;
      }
    }
  }
  return { spec, magnitude };
}

// Apply the vocal mask (2, 1, FRAMES, BINS) and inverse-STFT back to audio.
// Returns the whole window for each channel.
export function synthesize(spec, mask) {
  const frames = FRAMES + 1;
  const plane = frames * BINS;
  const outLeft = new Float64Array(WINDOW_SAMPLES);
  const outRight = new Float64Array(WINDOW_SAMPLES);
  const weight = new Float64Array(WINDOW_SAMPLES);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    re.fill(0);
    im.fill(0);
    const maskFrame = Math.min(f, FRAMES - 1);
    for (let k = 0; k < BINS; k++) {
      const at = f * BINS + k;
      const ml = mask[maskFrame * BINS + k];
      const mr = mask[FRAMES * BINS + maskFrame * BINS + k];
      const lr = spec[at] * ml;
      const li = spec[plane + at] * ml;
      const rr = spec[2 * plane + at] * mr;
      const ri = spec[3 * plane + at] * mr;
      // W = L + iR, and its mirror bin carries conj(L) + i conj(R).
      re[k] = lr - ri;
      im[k] = li + rr;
      if (k > 0) {
        re[N_FFT - k] = lr + ri;
        im[N_FFT - k] = rr - li;
      }
    }
    fft.run(re, im, true);
    const origin = f * HOP - HALF;
    for (let i = 0; i < N_FFT; i++) {
      const at = origin + i;
      if (at < 0 || at >= WINDOW_SAMPLES) continue;
      const w = hann[i];
      outLeft[at] += (re[i] / N_FFT) * w;
      outRight[at] += (im[i] / N_FFT) * w;
      weight[at] += w * w;
    }
  }
  const left = new Float32Array(WINDOW_SAMPLES);
  const right = new Float32Array(WINDOW_SAMPLES);
  for (let i = 0; i < WINDOW_SAMPLES; i++) {
    const w = weight[i] > 1e-11 ? weight[i] : 1;
    left[i] = outLeft[i] / w;
    right[i] = outRight[i] / w;
  }
  return { left, right };
}

// Windowed-sinc resampler: reads `channels` (sampled at `fromRate`, first
// sample at time `fromStart`) at `count` instants starting at `toStart`
// spaced 1 / RATE apart. Out-of-range input reads as silence.
const TAPS = 16;
const PHASES = 512;
const kernels = new Map();

function kernelFor(fromRate) {
  if (kernels.has(fromRate)) return kernels.get(fromRate);
  const cutoff = Math.min(1, RATE / fromRate) * 0.97;
  const table = new Float32Array((PHASES + 1) * 2 * TAPS);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let j = 0; j < 2 * TAPS; j++) {
      const x = j - TAPS + 1 - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const window = Math.abs(x) >= TAPS ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * x) / TAPS);
      table[p * 2 * TAPS + j] = cutoff * sinc * window;
      sum += cutoff * sinc * window;
    }
    for (let j = 0; j < 2 * TAPS; j++) table[p * 2 * TAPS + j] /= sum;
  }
  kernels.set(fromRate, table);
  return table;
}

export function resample(channels, fromRate, fromStart, toStart, count) {
  const table = kernelFor(fromRate);
  const out = channels.map(() => new Float32Array(count));
  const length = channels[0].length;
  for (let n = 0; n < count; n++) {
    const position = (toStart + n / RATE - fromStart) * fromRate;
    const base = Math.floor(position);
    const phase = Math.round((position - base) * PHASES);
    const kernel = phase * 2 * TAPS;
    const first = base - TAPS + 1;
    for (let c = 0; c < channels.length; c++) {
      const input = channels[c];
      let sum = 0;
      for (let j = 0; j < 2 * TAPS; j++) {
        const at = first + j;
        if (at >= 0 && at < length) sum += input[at] * table[kernel + j];
      }
      out[c][n] = sum;
    }
  }
  return out;
}
