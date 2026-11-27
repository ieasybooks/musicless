"""Offline website model exactly as the browser tool runs it (landing/audio/grid.js, dsp.js).

Windows of 524288 samples start every 522240 samples from the start of the file.
Each window gets a reflect-padded, centred STFT (n_fft 4096, hop 1024, periodic
square-root Hann, all 2049 bins); the model reads the spectrum as it is and
returns the spectrum without the music; the inverse STFT uses the same window;
and neighbouring windows crossfade linearly over their 2048-sample overlap.
A small detector (landing/audio/engine/detector.onnx) scores mel bands of each
window's spectrum first. A window goes through the model when its score is >= 0,
or when the model changed the window before; others keep their audio.
Needs numpy and onnxruntime only. The model file is a parameter: the tests
download it from R2 and check its hash.
"""

from pathlib import Path

import numpy as np
import onnxruntime as ort

N_FFT, HOP = 4096, 1024
WINDOW = 512 * HOP
FRAMES = WINDOW // HOP + 1
OVERLAP = 2 * HOP
STRIDE = WINDOW - OVERLAP
SQRT_HANN = np.sqrt(0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT))
_INDEX = np.arange(FRAMES)[:, None] * HOP + np.arange(N_FFT)[None, :]
_sessions = {}
DETECTOR = Path(__file__).resolve().parent.parent / "landing/audio/engine/detector.onnx"

# Detector input (musicFeatures in landing/audio/dsp.js): mid and side power in
# 48 mel bands from 60 Hz to 8 kHz, in dB re the window's 95th percentile frame
# energy (at least FLOOR), clipped to [-100, 20] and divided by 20.
BANDS, FLOOR = 48, 1.5
_EDGES = 700 * (10 ** (np.linspace(*(2595 * np.log10(1 + np.array([60.0, 8000.0]) / 700)), BANDS + 2) / 2595) - 1)
_HZ = np.arange(N_FFT // 2 + 1) * 44100 / N_FFT
_MEL = np.maximum(0, np.minimum((_HZ - _EDGES[:-2, None]) / (_EDGES[1:-1] - _EDGES[:-2])[:, None],
                                (_EDGES[2:, None] - _HZ) / (_EDGES[2:] - _EDGES[1:-1])[:, None]))


def music_features(planes):
    """(4, FRAMES, 2049) float32 model input -> (2, FRAMES, BANDS) float32 detector input."""
    p = planes.astype(np.float64)
    mid = ((p[0] + p[2]) ** 2 + (p[1] + p[3]) ** 2) / 4 @ _MEL.T
    side = ((p[0] - p[2]) ** 2 + (p[1] - p[3]) ** 2) / 4 @ _MEL.T
    reference = max(np.sort(mid.sum(1))[int(0.95 * (FRAMES - 1))], FLOOR)
    return (np.clip(10 * np.log10(np.stack([mid, side]) / reference + 1e-12), -100, 20) / 20).astype(np.float32)


def score(planes, detector=DETECTOR):
    """The window's highest detector score; music is likely where it is >= 0."""
    if detector not in _sessions:
        _sessions[detector] = ort.InferenceSession(str(detector), providers=["CPUExecutionProvider"])
    return float(_sessions[detector].run(None, {"x": music_features(planes)[None]})[0].max())


def changed(block, y):
    """Whether the model removed more than -40 dB of the window's energy, or -35 dB in any second of it."""
    removed = (block - y) ** 2
    mean = max(np.mean(block**2), 1e-10)
    if np.mean(removed) > 1e-4 * mean:
        return True
    return any(np.mean(removed[:, i : i + 44100]) > 10**-3.5 * mean for i in range(0, WINDOW, 22050))


def stft(block):
    """(2, WINDOW) samples -> (2, FRAMES, 2049) complex spectrum."""
    padded = np.pad(block, ((0, 0), (N_FFT // 2, N_FFT // 2)), mode="reflect")
    return np.fft.rfft(padded[:, _INDEX] * SQRT_HANN, axis=-1)


def istft(spec):
    """(2, FRAMES, 2049) -> (2, WINDOW), overlap-added with window^2 normalization."""
    frames = np.fft.irfft(spec, n=N_FFT, axis=-1) * SQRT_HANN
    out = np.zeros((2, WINDOW + N_FFT))
    weight = np.zeros(WINDOW + N_FFT)
    for f in range(FRAMES):
        out[:, f * HOP : f * HOP + N_FFT] += frames[:, f]
        weight[f * HOP : f * HOP + N_FFT] += SQRT_HANN**2
    weight = weight[N_FFT // 2 : N_FFT // 2 + WINDOW]
    return out[:, N_FFT // 2 : N_FFT // 2 + WINDOW] / np.where(weight > 1e-11, weight, 1)


def voices(stereo, model, gate=True):
    """(samples, 2) float audio at 44.1 kHz -> the audio without the music, same shape.
    gate=False separates every window without the detector, as the tool did before it."""
    if model not in _sessions:
        _sessions[model] = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    x = np.asarray(stereo, np.float64).T
    n = x.shape[1]
    out = np.zeros((2, n + WINDOW))
    rise = (np.arange(OVERLAP) + 0.5) / OVERLAP
    carry = False
    for k, start in enumerate(range(0, n, STRIDE)):
        block = np.zeros((2, WINDOW))
        segment = x[:, start : start + WINDOW]
        block[:, : segment.shape[1]] = segment
        spec = stft(block)
        planes = np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag]).astype(np.float32)
        if not gate or carry or score(planes) >= 0:
            y = _sessions[model].run(None, {"x": planes[None]})[0][0].astype(np.float64)
            y = istft(np.stack([y[0] + 1j * y[1], y[2] + 1j * y[3]]))
            carry = changed(block, y)
        else:
            y, carry = block.copy(), False
        if k > 0:
            y[:, :OVERLAP] *= rise
        y[:, -OVERLAP:] *= 1 - rise
        out[:, start : start + WINDOW] += y
    return out[:, :n].T
