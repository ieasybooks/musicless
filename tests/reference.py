"""Offline Spleeter exactly as the extension runs it (extension/grid.js, dsp.js).

Windows of 524288 samples start every 522240 samples from media time 0. Each
window gets a reflect-padded, centred STFT (n_fft 4096, hop 1024, periodic
Hann); the model reads its magnitude scaled to a -24 dBFS RMS window level; the
model's vocal mask applies to bins below 1024 (the last frame reuses the
previous frame's mask); and neighbouring windows crossfade linearly over their
2048-sample overlap. Needs numpy and onnxruntime only.
"""

from pathlib import Path

import numpy as np
import onnxruntime as ort

MODEL = Path(__file__).resolve().parents[1] / "extension/model/spleeter-2stems.onnx"
RATE = 44100
N_FFT, HOP, BINS, FRAMES = 4096, 1024, 1024, 512
WINDOW = FRAMES * HOP
OVERLAP = 2 * HOP
STRIDE = WINDOW - OVERLAP
INPUT_RMS = 10 ** (-24 / 20)  # the level the model sees each window at (extension/dsp.js)
MAX_INPUT_GAIN = 10 ** (30 / 20)
HANN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)
_INDEX = np.arange(FRAMES + 1)[:, None] * HOP + np.arange(N_FFT)[None, :]
_session = None
_weight = None


def session():
    global _session
    if _session is None:
        _session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    return _session


def stft(block):
    """(2, WINDOW) samples -> (2, FRAMES + 1, BINS) complex spectrum."""
    padded = np.pad(block, ((0, 0), (N_FFT // 2, N_FFT // 2)), mode="reflect")
    return np.fft.rfft(padded[:, _INDEX] * HANN, axis=-1)[..., :BINS]


def istft(spec):
    """(2, FRAMES + 1, BINS) -> (2, WINDOW), overlap-added with window^2 normalization."""
    global _weight
    full = np.zeros(spec.shape[:-1] + (N_FFT // 2 + 1,), complex)
    full[..., :BINS] = spec
    frames = np.fft.irfft(full, n=N_FFT, axis=-1) * HANN
    out = np.zeros((2, WINDOW + N_FFT))
    for f in range(FRAMES + 1):
        out[:, f * HOP : f * HOP + N_FFT] += frames[:, f]
    if _weight is None:
        weight = np.zeros(WINDOW + N_FFT)
        for f in range(FRAMES + 1):
            weight[f * HOP : f * HOP + N_FFT] += HANN**2
        _weight = weight[N_FFT // 2 : N_FFT // 2 + WINDOW]
    return out[:, N_FFT // 2 : N_FFT // 2 + WINDOW] / np.where(_weight > 1e-11, _weight, 1)


def vocals(stereo, first_window=0):
    """(samples, 2) float audio at 44.1 kHz -> separated vocals, same shape.

    `stereo` starts at window `first_window` of the media's grid (sample 0 is
    media time first_window * STRIDE / RATE); its first window then fades in as
    in the full stream, so only the span after the first overlap is exact."""
    x = np.asarray(stereo, np.float64).T
    n = x.shape[1]
    out = np.zeros((2, n + WINDOW))
    rise = (np.arange(OVERLAP) + 0.5) / OVERLAP
    for k, start in enumerate(range(0, n, STRIDE), start=first_window):
        block = np.zeros((2, WINDOW))
        segment = x[:, start : start + WINDOW]
        block[:, : segment.shape[1]] = segment
        spec = stft(block)
        gain = np.clip(INPUT_RMS / (np.sqrt((block**2).mean()) + 1e-9), 1 / MAX_INPUT_GAIN, MAX_INPUT_GAIN)
        magnitude = (np.abs(spec[:, None, :FRAMES]) * gain).astype(np.float32)
        mask = session().run(None, {"x": magnitude})[0][:, 0]
        mask = np.concatenate([mask, mask[:, -1:]], axis=1)
        y = istft(spec * mask)
        if k > 0:
            y[:, :OVERLAP] *= rise
        y[:, -OVERLAP:] *= 1 - rise
        out[:, start : start + WINDOW] += y
    return out[:, :n].T
