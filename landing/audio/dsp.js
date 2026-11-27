// The website model's signal processing (tests/website_reference.py mirrors it):
// a centred STFT of each stereo window with reflect padding, n_fft 4096, hop
// 1024 and a periodic square-root Hann window for both analysis and synthesis.
// The model reads every bin of the spectrum at the audio's own level (it scales
// its input itself) and returns the spectrum without the music.

import { BINS, FRAMES, HOP, N_FFT, WINDOW_SAMPLES } from './grid.js';

const HALF = N_FFT / 2;
const PLANE = FRAMES * BINS;
const sqrtHann = new Float64Array(N_FFT).map((_, i) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)));

// In-place radix-2 complex FFT; the inverse is unscaled.
const cos = new Float64Array(HALF).map((_, k) => Math.cos((2 * Math.PI * k) / N_FFT));
const sin = new Float64Array(HALF).map((_, k) => Math.sin((2 * Math.PI * k) / N_FFT));
const reversed = new Uint32Array(N_FFT).map((_, i) => {
  let r = 0;
  for (let b = 0, bits = Math.log2(N_FFT); b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  return r;
});
function fft(re, im, inverse) {
  for (let i = 0; i < N_FFT; i++) {
    const j = reversed[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? -1 : 1;
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
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

// Overlap-add normalization: the sum of the squared synthesis windows at each sample.
const inverseWeight = new Float64Array(WINDOW_SAMPLES);
for (let f = 0; f < FRAMES; f++) {
  for (let i = 0; i < N_FFT; i++) {
    const at = f * HOP - HALF + i;
    if (at >= 0 && at < WINDOW_SAMPLES) inverseWeight[at] += sqrtHann[i] * sqrtHann[i];
  }
}
for (let i = 0; i < WINDOW_SAMPLES; i++) inverseWeight[i] = inverseWeight[i] > 1e-11 ? 1 / inverseWeight[i] : 1;

const reflect = i => (i < 0 ? -i : i >= WINDOW_SAMPLES ? 2 * (WINDOW_SAMPLES - 1) - i : i);

// STFT of a stereo window (two Float32Arrays of WINDOW_SAMPLES) as the model
// input: planes [left re, left im, right re, right im], each FRAMES x BINS.
export function analyze(left, right) {
  const x = new Float32Array(4 * PLANE);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  for (let f = 0; f < FRAMES; f++) {
    const origin = f * HOP - HALF;
    for (let i = 0; i < N_FFT; i++) {
      const at = reflect(origin + i);
      re[i] = left[at] * sqrtHann[i];
      im[i] = right[at] * sqrtHann[i];
    }
    fft(re, im, false);
    // Two real channels packed into one complex FFT: split them by symmetry.
    for (let k = 0; k < BINS; k++) {
      const m = (N_FFT - k) % N_FFT;
      const at = f * BINS + k;
      x[at] = 0.5 * (re[k] + re[m]);
      x[PLANE + at] = 0.5 * (im[k] - im[m]);
      x[2 * PLANE + at] = 0.5 * (im[k] + im[m]);
      x[3 * PLANE + at] = -0.5 * (re[k] - re[m]);
    }
  }
  return x;
}

// The music detector's input (tests/website_reference.py mirrors it): the mid
// and side power of analyze's spectrum in BANDS mel bands from 60 Hz to 8 kHz,
// per frame, in dB relative to a loud frame of the window (its 95th percentile
// energy, and at least FLOOR, about that of -60 dBFS noise), clipped to
// [-100, 20] dB and divided by 20. Layout [mid, side] x FRAMES x BANDS.
export const BANDS = 48;
const FLOOR = 1.5;
const mel = hz => 2595 * Math.log10(1 + hz / 700);
const edges = Array.from({ length: BANDS + 2 }, (_, i) => {
  const m = mel(60) + i * ((mel(8000) - mel(60)) / (BANDS + 1));
  return 700 * (10 ** (m / 2595) - 1);
});
// Bin k is on the rising edge of triangle band[k] and the falling edge of the
// one below. Below the lowest band and above the highest there is no triangle:
// musicFeatures adds those edges to spare slots.
const FIRST = Math.floor((edges[0] * N_FFT) / 44100) + 1;
const LAST = Math.ceil((edges[BANDS + 1] * N_FFT) / 44100);
const band = new Int32Array(LAST);
const rise = new Float64Array(LAST);
for (let k = FIRST, j = 0; k < LAST; k++) {
  const hz = (k * 44100) / N_FFT;
  while (hz >= edges[j + 1]) j++;
  band[k] = j;
  rise[k] = (hz - edges[j]) / (edges[j + 1] - edges[j]);
}
export function musicFeatures(x) {
  const power = new Float64Array(2 * FRAMES * BANDS);
  const energy = new Float64Array(FRAMES);
  const mid = new Float64Array(BANDS + 2);
  const side = new Float64Array(BANDS + 2);
  for (let f = 0; f < FRAMES; f++) {
    mid.fill(0); side.fill(0);
    for (let k = FIRST, at = f * BINS + FIRST; k < LAST; k++, at++) {
      const lr = x[at], li = x[PLANE + at], rr = x[2 * PLANE + at], ri = x[3 * PLANE + at];
      const a = lr + rr, b = li + ri, c = lr - rr, d = li - ri;
      const m = (a * a + b * b) * 0.25;
      const s = (c * c + d * d) * 0.25;
      // Slot j + 1 holds band j, so slot 0 and slot BANDS + 1 are spares.
      const j = band[k], up = rise[k], down = 1 - up;
      mid[j + 1] += up * m; side[j + 1] += up * s;
      mid[j] += down * m; side[j] += down * s;
    }
    for (let b = 0; b < BANDS; b++) {
      power[f * BANDS + b] = mid[b + 1];
      power[(FRAMES + f) * BANDS + b] = side[b + 1];
      energy[f] += mid[b + 1];
    }
  }
  const reference = Math.max(energy.sort()[Math.floor(0.95 * (FRAMES - 1))], FLOOR);
  return Float32Array.from(power, p => Math.min(20, Math.max(-100, 10 * Math.log10(p / reference + 1e-12))) / 20);
}

// Whether the model changed a window: the energy it removed, over the whole
// window (-40 dB) or in any second of it (-35 dB, seconds every half second),
// relative to the window's mean energy. Clean speech loses less; music far more.
const HALF_SECOND = 22050;
export function changed(input, output) {
  const removed = new Float64Array(Math.ceil(WINDOW_SAMPLES / HALF_SECOND));
  let energy = 0, total = 0;
  for (let c = 0; c < input.length; c++) {
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      const d = input[c][i] - output[c][i];
      energy += input[c][i] * input[c][i];
      removed[Math.floor(i / HALF_SECOND)] += d * d;
      total += d * d;
    }
  }
  // Digital silence (below -100 dBFS) counts as unchanged.
  const mean = Math.max(energy, 1e-10 * input.length * WINDOW_SAMPLES) / WINDOW_SAMPLES;
  if (total / WINDOW_SAMPLES > 1e-4 * mean) return true;
  for (let j = 0; j < removed.length; j++) {
    const length = Math.min(2 * HALF_SECOND, WINDOW_SAMPLES - j * HALF_SECOND);
    if ((removed[j] + (removed[j + 1] || 0)) / length > 10 ** -3.5 * mean) return true;
  }
  return false;
}

// Inverse STFT of the model output (laid out like analyze's) back to the whole
// window for each channel.
export function synthesize(y) {
  const outLeft = new Float64Array(WINDOW_SAMPLES);
  const outRight = new Float64Array(WINDOW_SAMPLES);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  for (let f = 0; f < FRAMES; f++) {
    for (let k = 0; k < BINS; k++) {
      const at = f * BINS + k;
      const lr = y[at];
      const rr = y[2 * PLANE + at];
      // A real signal's DC and Nyquist bins are real: their imaginary parts are dropped.
      const edge = k === 0 || k === HALF;
      const li = edge ? 0 : y[PLANE + at];
      const ri = edge ? 0 : y[3 * PLANE + at];
      // W = L + iR, and its mirror bin carries conj(L) + i conj(R).
      re[k] = lr - ri;
      im[k] = li + rr;
      if (!edge) {
        re[N_FFT - k] = lr + ri;
        im[N_FFT - k] = rr - li;
      }
    }
    fft(re, im, true);
    const origin = f * HOP - HALF;
    for (let i = 0; i < N_FFT; i++) {
      const at = origin + i;
      if (at < 0 || at >= WINDOW_SAMPLES) continue;
      outLeft[at] += (re[i] / N_FFT) * sqrtHann[i];
      outRight[at] += (im[i] / N_FFT) * sqrtHann[i];
    }
  }
  const left = new Float32Array(WINDOW_SAMPLES);
  const right = new Float32Array(WINDOW_SAMPLES);
  for (let i = 0; i < WINDOW_SAMPLES; i++) {
    left[i] = outLeft[i] * inverseWeight[i];
    right[i] = outRight[i] * inverseWeight[i];
  }
  return { left, right };
}
