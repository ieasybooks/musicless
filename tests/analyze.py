"""Sync and quality metrics for one in-browser recording.

Usage: analyze.py <base path> <sample rate> [--source <media file>]
Reads <base>.original.s16 (the page's own audio, tapped before it is silenced)
and <base>.output.s16 (what nomusic played), both mono on the same clock, and
prints one JSON line. Sync is measured against Spleeter run offline on the
recorded original (vocals against vocals), which stays reliable when the
music is much louder than the voice:
  lag_ms          median offset of the output against that reference (+ = late)
  lag_spread_ms   max - min of the per-window offsets (drift or jumps)
  corr            median normalized correlation with the reference at the best lag
  mix_corr        the same against the original mix (how much of it was kept)
  env_lag_ms / env_corr  the same on 25 ms loudness envelopes (5 ms steps); robust when
                  the waveforms differ, e.g. two time-stretchers at 1.5x
  dropouts        0.5 s windows where the reference has voice but the output
                  is 20 dB quieter (meaningful at 1x speed)
  media_env_lag_ms / media_env_corr / media_dropouts  with --source: the
                  same envelope checks against Spleeter run at 1x on the source
                  file, read at the media time each output block was heard
                  (<base>.media.json); valid at any playback speed
  over_silence    0.5 s windows where the page's audio is silent (paused or
                  stalled video) but the output is not
  silent_gaps     runs of 30 ms or more where the output is silent while the
                  reference vocals are clearly voiced (dropouts); with --source also
                  media_silent_gaps, against the 1x reference at media time
  reference_db / output_db / original_db  overall levels (a quiet reference
                  means the stretch has no voice to keep)
"""

import json
import sys

from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reference as spleeter  # noqa: E402

base, rate = sys.argv[1], int(sys.argv[2])
original = np.fromfile(f"{base}.original.s16", np.int16).astype(np.float64) / 32768
output = np.fromfile(f"{base}.output.s16", np.int16).astype(np.float64) / 32768


def resample(x, src, dst):
    """FFT resampling (band-limited; fine for analysis)."""
    if src == dst:
        return x
    m = int(round(len(x) * dst / src))
    spectrum = np.fft.rfft(x)
    out = np.zeros(m // 2 + 1, complex)
    keep = min(len(spectrum), len(out))
    out[:keep] = spectrum[:keep]
    return np.fft.irfft(out, m) * (m / len(x))


def spleeter_vocals(audio):
    """Offline Spleeter (the extension's model, windows and crossfades) on audio at
    `rate`, mono or (samples, 2) stereo; returns the vocals as mono at `rate`."""
    stereo = audio if audio.ndim == 2 else np.stack([audio, audio], axis=1)
    x = np.stack([resample(stereo[:, c], rate, spleeter.RATE) for c in range(2)], axis=1)
    vocals = spleeter.vocals(x).mean(axis=1)
    return resample(vocals, spleeter.RATE, rate)[: len(stereo)]


reference = spleeter_vocals(original)

WINDOW = 3 * rate
MAX_LAG = int(0.5 * rate)


def db(x):
    return float(10 * np.log10(np.mean(x**2) + 1e-12))


def align(target):
    lags, corrs = [], []
    for start in range(MAX_LAG, len(target) - WINDOW - MAX_LAG, WINDOW):
        a = output[start : start + WINDOW]
        if db(a) < -50:
            continue
        b = target[start - MAX_LAG : start + WINDOW + MAX_LAG]
        size = 1 << int(np.ceil(np.log2(len(a) + len(b))))
        xc = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)[: 2 * MAX_LAG + 1]
        shift = int(np.argmax(xc))
        seg = target[start - MAX_LAG + shift : start - MAX_LAG + shift + WINDOW]
        corrs.append(float(np.dot(a, seg) / (np.linalg.norm(a) * np.linalg.norm(seg) + 1e-12)))
        # The output plays `MAX_LAG - shift` samples after the matching reference audio.
        lags.append((MAX_LAG - shift) / rate * 1000)
    return lags, corrs


lags, corrs = align(reference)
_, mix_corrs = align(original)

def envelope(x, hop, span=5):
    """RMS over `span` hops (25 ms), every hop (5 ms): syllable-scale loudness."""
    frames = len(x) // hop
    power = np.mean(x[: frames * hop].reshape(frames, hop) ** 2, axis=1)
    return np.sqrt(np.convolve(power, np.ones(span) / span, mode="same"))


HOP = rate // 200
env_out, env_ref = envelope(output, HOP), envelope(reference, HOP)
env_lags, env_corrs = [], []
EW, EL = 3 * 200, 100  # 3 s windows, +-500 ms
for start in range(EL, len(env_ref) - EW - EL, EW):
    a = env_out[start : start + EW]
    if db(output[start * HOP : (start + EW) * HOP]) < -50:
        continue
    scores = []
    for lag in range(-EL, EL + 1):
        b = env_ref[start - lag : start - lag + EW]
        scores.append(np.corrcoef(a, b)[0, 1])
    best = int(np.argmax(scores))
    env_lags.append((best - EL) * 5)
    env_corrs.append(float(scores[best]))
if "--windows" in sys.argv:
    print("lags", [round(x, 1) for x in lags], "corrs", [round(c, 2) for c in corrs], file=sys.stderr)
    print("env lags", env_lags, "env corrs", [round(c, 2) for c in env_corrs], file=sys.stderr)

# Dropouts: half-second stretches where the reference clearly has voice but the
# output is 20 dB quieter (at 1x only; at other speeds the reference itself is
# Spleeter run on Chrome's time-stretched audio and disagrees with it in places).
half = rate // 2
dropouts = 0
for i in range(len(reference) // half):
    ref_db, out_db = db(reference[i * half : (i + 1) * half]), db(output[i * half : (i + 1) * half])
    if ref_db > -40 and out_db < ref_db - 20:
        dropouts += 1

# Talking over silence: half-second stretches where the page's own audio is
# silent (paused or stalled video) but nomusic still plays something.
over_silence = 0
for i in range(len(original) // half):
    if db(original[i * half : (i + 1) * half]) < -70 and db(output[i * half : (i + 1) * half]) > -50:
        over_silence += 1

# Silent gaps: 30 ms or more of output silence while the reference vocals are
# clearly voiced throughout, on 10 ms frames. (The page's own audio is not the
# yardstick: between sentences it is music, which should come out silent.)
frame = rate // 100
gaps = 0
run = 0
for i in range(len(original) // frame):
    bad = db(reference[i * frame : (i + 1) * frame]) > -35 and db(output[i * frame : (i + 1) * frame]) < -70
    run = run + 1 if bad else 0
    if run == 3:
        gaps += 1

media_metrics = {}
if "--source" in sys.argv:
    import subprocess

    source = sys.argv[sys.argv.index("--source") + 1]
    pairs = json.loads(Path(f"{base}.media.json").read_text())
    times = np.array([t for t, m in pairs if m is not None])
    medias = np.array([m for t, m in pairs if m is not None])
    if not len(times):
        sys.exit("the video was paused for the whole recording: nothing to compare at media time")
    # 1x Spleeter of the source, only over the windows this recording heard (plus
    # one before, whose tail completes the first crossfade), cached per span and
    # per separation (the model and reference.py), so a new mask is not judged
    # against references made with the old one.
    import hashlib

    stride_s = spleeter.STRIDE / spleeter.RATE
    first = max(0, int(medias.min() // stride_s) - 1)
    last = int(medias.max() // stride_s) + 1
    separation = hashlib.sha256(spleeter.MODEL.read_bytes() + Path(spleeter.__file__).read_bytes()).hexdigest()[:12]
    cache = Path(f"{source}.ref-{separation}-{first}-{last}-{rate}.npy")
    if cache.exists():
        env_1x = np.load(cache)
    else:
        start = first * spleeter.STRIDE / spleeter.RATE
        span = (last - first) * stride_s + spleeter.WINDOW / spleeter.RATE
        seek = ["-ss", f"{start:.6f}"] if start > 0 else []
        raw = subprocess.run(["ffmpeg", "-v", "error", *seek, "-i", source, "-t", f"{span:.6f}", "-f", "f32le", "-ac", "2",
                              "-ar", str(spleeter.RATE), "-"], capture_output=True, check=True).stdout
        stereo_source = np.frombuffer(raw, np.float32).astype(np.float64).reshape(-1, 2)
        mono = spleeter.vocals(stereo_source, first_window=first).mean(axis=1)
        env_1x = envelope(resample(mono, spleeter.RATE, rate), HOP)
        np.save(cache, env_1x)
    env_start = first * stride_s
    frame_times = np.arange(len(env_out)) * HOP / rate
    media_at = np.interp(frame_times, times, medias, left=np.nan, right=np.nan)
    offset = np.round((np.nan_to_num(media_at) - env_start) * rate / HOP).astype(int)
    inside = np.isfinite(media_at) & (offset >= 0) & (offset < len(env_1x))
    env_media = np.where(inside, env_1x[np.clip(offset, 0, len(env_1x) - 1)], 0)
    lags_m, corrs_m = [], []
    for start in range(EL, len(env_media) - EW - EL, EW):
        a = env_out[start : start + EW]
        if db(output[start * HOP : (start + EW) * HOP]) < -50:
            continue
        scores = [np.corrcoef(a, env_media[start - lag : start - lag + EW])[0, 1] for lag in range(-EL, EL + 1)]
        best = int(np.nanargmax(scores))
        lags_m.append((best - EL) * 5)
        corrs_m.append(float(scores[best]))
    # A paused, held or stalled video makes no sound of its own: silence is right there.
    page_frames = np.sqrt(np.mean(original[: len(env_out) * HOP].reshape(len(env_out), HOP) ** 2, axis=1))
    playing = 20 * np.log10(page_frames + 1e-9) > -70
    drops = 0
    per = int(0.5 * 200)
    for i in range(len(env_media) // per):
        # Only windows where the video played (a hold starting mid-window is not a dropout).
        if np.mean(playing[i * per : (i + 1) * per]) < 0.8:
            continue
        ref_db = 20 * np.log10(np.sqrt(np.mean(env_media[i * per : (i + 1) * per] ** 2)) + 1e-9)
        out_db = 20 * np.log10(np.sqrt(np.mean(env_out[i * per : (i + 1) * per] ** 2)) + 1e-9)
        if ref_db > -40 and out_db < ref_db - 20:
            drops += 1
    # Silent gaps against the same 1x reference: 30 ms or more of output silence
    # (5 ms frames) while the voice at that media time is clearly there.
    out_frames = np.sqrt(np.mean(output[: len(env_out) * HOP].reshape(len(env_out), HOP) ** 2, axis=1))
    voiced = (20 * np.log10(env_media + 1e-9) > -35) & np.isfinite(media_at) & playing
    silent = 20 * np.log10(out_frames + 1e-9) < -70
    media_gaps, run = 0, 0
    for bad in voiced & silent:
        run = run + 1 if bad else 0
        if run == 6:
            media_gaps += 1
    media_metrics = {
        "media_silent_gaps": media_gaps,
        "media_env_lag_ms": float(np.median(lags_m)) if lags_m else None,
        "media_env_corr": round(float(np.median(corrs_m)), 3) if corrs_m else None,
        "media_dropouts": drops,
    }

print(json.dumps({
    "seconds": round(len(original) / rate, 1),
    "windows": len(lags),
    "lag_ms": round(float(np.median(lags)), 1) if lags else None,
    "lag_spread_ms": round(float(np.max(lags) - np.min(lags)), 1) if lags else None,
    "corr": round(float(np.median(corrs)), 3) if corrs else None,
    "mix_corr": round(float(np.median(mix_corrs)), 3) if mix_corrs else None,
    "env_lag_ms": float(np.median(env_lags)) if env_lags else None,
    "env_corr": round(float(np.median(env_corrs)), 3) if env_corrs else None,
    "silent_gaps": gaps,
    "dropouts": dropouts,
    "over_silence": over_silence,
    "reference_db": round(db(reference), 1),
    "output_db": round(db(output), 1),
    "original_db": round(db(original), 1),
    **media_metrics,
}))
