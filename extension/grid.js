// The numbers the model and its signal processing are built around, and the
// fixed grid of separation windows, shared by the content script and the
// workers (tests/reference.py mirrors them). Spleeter reads 512 STFT frames
// (about 11.9 s at 44.1 kHz) at a time and is not shift-invariant, so windows
// sit on a fixed grid from media time 0: every seek or restart separates
// exactly the same windows again.
//
// Neighbouring windows overlap by two hops. Each chunk fades in over its first
// OVERLAP_SAMPLES and out over its last, so consecutive chunks crossfade instead
// of meeting in a click (independently separated windows disagree at the seam).

export const RATE = 44100;
export const N_FFT = 4096;
export const HOP = 1024;
export const FRAMES = 512;
export const BINS = 1024; // the model sees 0 to ~11 kHz; higher bins are dropped
// The level every window is shown to the model at, with the gain kept within ±30 dB.
export const INPUT_RMS = 10 ** (-24 / 20);
export const MAX_INPUT_GAIN = 10 ** (30 / 20);
export const WINDOW_SAMPLES = FRAMES * HOP; // 524288 samples the model reads per window
export const OVERLAP_SAMPLES = 2 * HOP; // 2048 samples (46 ms) of crossfade
export const STRIDE_SAMPLES = WINDOW_SAMPLES - OVERLAP_SAMPLES;
export const CHUNK_SECONDS = STRIDE_SAMPLES / RATE; // ~11.84 s between chunk starts
export const WINDOW_SECONDS = WINDOW_SAMPLES / RATE;

// Index of the chunk whose own span [start, next start) contains media time t.
export const chunkIndex = (time) => Math.max(0, Math.floor(time / CHUNK_SECONDS));
export const chunkStart = (k) => (k * STRIDE_SAMPLES) / RATE;

// Linear crossfade weights: a fade-out and the next chunk's fade-in sum to 1.
export function applyFades(channels, k) {
  for (const samples of channels) {
    const length = samples.length;
    for (let i = 0; i < OVERLAP_SAMPLES; i++) {
      const rise = (i + 0.5) / OVERLAP_SAMPLES;
      if (k > 0) samples[i] *= rise;
      samples[length - OVERLAP_SAMPLES + i] *= 1 - rise;
    }
  }
}
