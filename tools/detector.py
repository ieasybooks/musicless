"""Build the audio tool's music detector, landing/audio/engine/detector.onnx.

The website runs its music-removal model only on windows where this detector
finds music. It reads the mel bands of the spectrum the tool already computes
(music_features in tests/website_reference.py, musicFeatures in
landing/audio/dsp.js) and scores every 8 STFT frames (~0.19 s) of a window.

    python tools/detector.py fetch DATA          # speech, singing and music to mix, ~5 GB
    python tools/detector.py make DATA SHARDS    # 1,500 + 14,000 labelled windows
    python tools/detector.py train SHARDS landing/audio/engine/detector.onnx

Speech: FLEURS (CC BY 4.0) in Arabic, English, Persian, Urdu, French and Turkish;
the Arabic test split is not used, so its speakers can serve for evaluation. Singing without
instruments: about half of VocalSet (CC BY 4.0), so that a sung or chanted voice
alone is not taken for music. Music: 2,400 tracks of the FMA small set (Creative
Commons licenses chosen by the artists). Windows mix speech or singing with music
beds, short cues, intros and outros, or music alone, with room reverb up to that
of a large mosque, noise, hum, microphone EQ, MP3/AAC coding and mono or stereo
layouts.
A tile is music when the music is within 30 dB of the speech, clean when it is
more than 40 dB below or absent, and ignored in between. Training folds the
threshold at which every music window of the validation set is found into the
scores, so music is likely where a score is >= 0, and the worker separates the
window (landing/README.md). Shipped: these defaults, on an
Apple M3 (MPS). Needs FFmpeg and tools/detector-requirements.txt.
"""

import glob
import io
import os
import random
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.request
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests"))
import website_reference as ref  # noqa: E402

SR, N, TILES = 16000, ref.WINDOW, 64
N16 = int(np.ceil(N * SR / 44100)) + 64
FLEURS = "https://huggingface.co/datasets/google/fleurs/resolve/main/data/{}/audio/{}.tar.gz"
SPEECH = [("ar_eg", "train"), ("ar_eg", "dev"), ("en_us", "dev"), ("fa_ir", "dev"),
          ("ur_pk", "dev"), ("fr_fr", "dev"), ("tr_tr", "dev")]
FMA = "https://os.unil.cloud.switch.ch/fma/fma_small.zip"
VOCALSET = "https://huggingface.co/datasets/Bill13579/vocalset-mirror/resolve/main/data/train-0000{}-of-00006.parquet"


class Remote(io.RawIOBase):
    """A seekable HTTP file: reads a few members of a large zip without downloading it."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD")).headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def seek(self, offset, whence=0):
        self.pos = [offset, self.pos + offset, self.size + offset][whence]
        return self.pos

    def tell(self):
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size or not len(buffer):
            return 0
        end = min(self.pos + len(buffer), self.size) - 1
        data = urllib.request.urlopen(urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})).read()
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)


def fetch(data):
    for lang, part in SPEECH:
        out = os.path.join(data, "fleurs", f"{lang}_{part}")
        if not os.path.isdir(out):
            with urllib.request.urlopen(FLEURS.format(lang, part)) as response:
                tarfile.open(fileobj=response, mode="r|gz").extractall(out, filter="data")
    out = os.path.join(data, "fma")
    os.makedirs(out, exist_ok=True)
    members = [i.filename for i in zipfile.ZipFile(io.BufferedReader(Remote(FMA), 1 << 20)).infolist() if i.filename.endswith(".mp3")]
    local = threading.local()

    def get(name):
        if not hasattr(local, "zip"):
            local.zip = zipfile.ZipFile(io.BufferedReader(Remote(FMA), 1 << 22))
        path = os.path.join(out, os.path.basename(name)[:-4] + ".wav")
        if not os.path.exists(path):  # a few tracks of the set do not decode: they are skipped
            subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-i", "pipe:0", "-ac", "1", "-ar", str(SR), path],
                           input=local.zip.read(name), check=False)

    with ThreadPoolExecutor(12) as pool:
        list(pool.map(get, random.Random(1).sample(members, 2400)))
    import pyarrow.parquet as pq
    import soundfile as sf
    from scipy.signal import resample_poly

    out = os.path.join(data, "vocalset")
    os.makedirs(out, exist_ok=True)
    for part in range(3):
        with urllib.request.urlopen(VOCALSET.format(part)) as response:
            table = pq.read_table(io.BytesIO(response.read()))
        for row in table.column("audio").to_pylist():
            x, rate = sf.read(io.BytesIO(row["bytes"]), dtype="float64", always_2d=True)
            sf.write(os.path.join(out, row["path"]), resample_poly(x.mean(1), SR, rate), SR)


# Windows ---------------------------------------------------------------------

def sources(data, part):
    """Files are split by name hash: about 10% for validation."""
    pick = lambda files: [f for f in sorted(files) if (zlib.crc32(os.path.basename(f).encode()) % 10 == 0) == (part == "val")]
    return pick(glob.glob(f"{data}/fleurs/*/*/*.wav")), pick(glob.glob(f"{data}/vocalset/*.wav")), pick(glob.glob(f"{data}/fma/*.wav"))


def read(path, n=None, rng=None):
    import soundfile as sf

    info = sf.info(path)
    if n is None or info.frames <= n:
        x = sf.read(path, dtype="float64", always_2d=True)[0].mean(1)
        return x if n is None else np.pad(x, (0, n - len(x)))
    start = rng.integers(0, info.frames - n)
    return sf.read(path, start=start, frames=n, dtype="float64", always_2d=True)[0].mean(1)


def rms(x):
    return np.sqrt(np.mean(x**2) + 1e-20)


def speech_track(speech, rng):
    out, pos = np.zeros(N16), int(rng.uniform(-1, 1.5) * SR) if rng.random() < 0.5 else 0
    while pos < N16:
        u = read(speech[rng.integers(len(speech))])
        loud = np.flatnonzero(np.abs(u) > 0.02 * np.abs(u).max() + 1e-9)
        u = u[max(0, loud[0] - 800) : loud[-1] + 800] if len(loud) else u
        u = u[: 20 * SR] / rms(u)
        a, b = max(pos, 0), min(pos + len(u), N16)
        if b > a:
            out[a:b] += u[a - pos : b - pos]
        pos += len(u) + int(rng.uniform(0.05, 1.3) * SR)
    return out


def room(rng):
    rt60 = rng.uniform(0.15, 4)
    n = int(min(rt60, 2) * SR)
    h = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / SR / rt60)
    h /= rms(h) * np.sqrt(n)
    h[0] = 10 ** (rng.uniform(-10, 15) / 20)
    return h


def layout(x, rng, kind):
    from scipy.signal import fftconvolve

    if kind == "mono":
        return np.stack([x, x])
    if kind == "rooms":  # a different room response per channel
        return np.stack([fftconvolve(x, room(rng))[:N16], fftconvolve(x, room(rng))[:N16]])
    other = rng.uniform(0.6, 1) * np.roll(x, int(rng.uniform(0.0003, 0.02) * SR))
    return np.stack([x, other] if rng.random() < 0.5 else [other, x])


def tilt(x, rng):
    """A microphone's or a channel's colour: random low and high shelves."""
    from scipy.signal import lfilter

    for cutoff in (rng.uniform(100, 600), rng.uniform(1500, 6000)):
        a = np.exp(-2 * np.pi * cutoff / SR)
        low = lfilter([1 - a], [1, -a], x)
        x = x + (10 ** (rng.uniform(-9, 6) / 20) - 1) * (low if cutoff < 1000 else x - low)
    return x


def envelope(segments, rng):
    e = np.zeros(N16)
    for a, b in segments:
        a, b = int(max(a, 0)), int(min(b, N16))
        if b > a:
            fade = int(min(rng.uniform(0.02, 1.5) * SR, (b - a) // 2))
            part = np.ones(b - a)
            if fade:
                part[:fade], part[-fade:] = np.linspace(0, 1, fade), np.linspace(1, 0, fade)
            e[a:b] = np.maximum(e[a:b], part)
    return e


def lossy(x, rng):
    codec = rng.choice(["libmp3lame", "aac"])
    with tempfile.TemporaryDirectory() as work:
        raw, coded = os.path.join(work, "x.f32"), os.path.join(work, "x." + ("mp3" if codec == "libmp3lame" else "m4a"))
        x.T.astype("<f4").tofile(raw)
        subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", "44100", "-ac", "2", "-i", raw,
                        "-c:a", codec, "-b:a", rng.choice(["64k", "96k", "128k", "192k"]), coded], check=True)
        y = np.frombuffer(subprocess.check_output(["ffmpeg", "-v", "error", "-i", coded, "-f", "f32le", "-ac", "2", "-ar", "44100", "pipe:1"]), "<f4")
    y = y.reshape(-1, 2).T[:, :N]
    return np.pad(y, ((0, 0), (0, N - y.shape[1]))).astype(np.float64)


def window(speech, singing, music, rng):
    """One 11.9 s stereo window at 44.1 kHz -> (detector input, music level of each tile in dB re the speech)."""
    from scipy.signal import fftconvolve, resample_poly

    scenario = rng.choice(["speech", "bed", "cues", "edge", "music", "quiet"], p=[0.30, 0.27, 0.15, 0.12, 0.08, 0.08])
    talking = scenario not in ("music", "quiet")
    s = speech_track(singing if rng.random() < 0.2 else speech, rng) if talking else np.zeros(N16)
    if talking and rng.random() < 0.15:  # speech in only part of the window
        cut = int(rng.uniform(0.2, 0.8) * N16)
        s[slice(0, cut) if rng.random() < 0.5 else slice(cut, N16)] = 0
    m, level = np.zeros(N16), None
    if scenario in ("bed", "cues", "edge", "music"):
        m = tilt(read(music[rng.integers(len(music))], N16, rng), rng)
        m /= rms(m)
        if scenario == "bed":
            segments, level = [(0, N16)], rng.uniform(-45, 6)
        elif scenario == "music":
            segments, level = [(0, N16) if rng.random() < 0.7 else (rng.uniform(0, 0.6) * N16, N16)], rng.uniform(-10, 10)
        elif scenario == "edge":  # an intro ending or an outro starting in the window
            t = rng.uniform(0.1, 0.9) * N16
            segments, level = [(0, t) if rng.random() < 0.5 else (t, N16)], rng.uniform(-35, 6)
        else:
            starts = rng.uniform(0, N16, rng.integers(1, 4))
            segments, level = [(a, a + rng.uniform(0.3, 5) * SR) for a in starts], rng.uniform(-35, 6)
        m *= envelope(segments, rng)
    speech_layout = rng.choice(["mono", "rooms", "offset"], p=[0.5, 0.35, 0.15])
    S = layout(tilt(s, rng), rng, speech_layout)
    if speech_layout == "mono" and rng.random() < 0.4:
        S = fftconvolve(S, room(rng)[None])[:, :N16]
    M = layout(m, rng, rng.choice(["mono", "offset", "rooms"], p=[0.35, 0.45, 0.2]))
    active = np.abs(s) > 0.05
    speech_power = np.mean(S[:, active] ** 2) if talking and active.mean() > 0.02 else None
    reference = speech_power or 1.0
    if level is not None:
        M *= np.sqrt(reference) * 10 ** (level / 20)
    mix = S + M
    if rng.random() < 0.75:  # noise floor: pink, white or mains hum
        kind = rng.choice(["pink", "white", "hum"], p=[0.5, 0.2, 0.3])
        if kind == "pink":
            f = np.fft.rfftfreq(N16, 1 / SR)
            z = np.fft.irfft(np.fft.rfft(rng.standard_normal(N16)) / np.sqrt(np.maximum(f, 20)), N16)
        elif kind == "white":
            z = rng.standard_normal(N16)
        else:
            t, f0 = np.arange(N16) / SR, rng.choice([50, 60])
            z = sum(rng.uniform(0.1, 1) / k * np.sin(2 * np.pi * f0 * k * t + rng.uniform(0, 6.3)) for k in range(1, 8))
        mix = mix + layout(z / rms(z) * np.sqrt(reference) * 10 ** (rng.uniform(-65, -20) / 20), rng, rng.choice(["mono", "offset"]))
    gain = 10 ** (rng.uniform(-40, -12) / 20) / max(rms(mix), 1e-9)
    if scenario == "quiet" and rng.random() < 0.3:
        gain = 0.0  # digital silence
    x = resample_poly(mix * gain, 441, 160, axis=1)[:, :N]
    if gain and rng.random() < 0.5:
        x = lossy(x, rng)
    peak = max(np.abs(x).max(), 1.0)
    x /= peak
    if rng.random() < 0.1:
        x[1] = x[0]  # a file downmixed to mono
    spec = ref.stft(x)
    features = ref.music_features(np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag]).astype(np.float32))
    power = np.mean(M**2, 0) * (gain / peak) ** 2
    scale = reference * (gain / peak) ** 2 if speech_power else 1e-6  # -60 dBFS without speech
    levels = np.full(TILES, -120.0)  # no music
    for j in range(TILES):  # the samples of the 8 frames of tile j
        a = max(0, int(((8 * j) * 1024 - 2048) * SR / 44100))
        b = min(N16, int(((8 * j + 7) * 1024 + 2048) * SR / 44100))
        p = power[a:b].mean()
        if p > 0 and gain:
            levels[j] = max(-120.0, 10 * np.log10(p / scale))
    return features.astype(np.float16), levels.astype(np.float16)


def shard(job):
    data, out, part, first, count = job
    voices = sources(data, part)
    rng = np.random.default_rng([first, part == "val"])
    pairs = [window(*voices, rng) for _ in range(count)]
    np.savez(os.path.join(out, f"{part}-{first:06d}.npz"), x=np.stack([p[0] for p in pairs]), y=np.stack([p[1] for p in pairs]))


def make(data, out, counts=(("val", 1500), ("train", 14000))):
    os.makedirs(out, exist_ok=True)
    jobs = [(data, out, part, first, min(100, total - first)) for part, total in counts for first in range(0, total, 100)
            if not os.path.exists(os.path.join(out, f"{part}-{first:06d}.npz"))]
    with Pool(max(1, os.cpu_count() - 1)) as pool:
        for i, _ in enumerate(pool.imap_unordered(shard, jobs)):
            print(f"{i + 1}/{len(jobs)} shards", flush=True)


# Model -----------------------------------------------------------------------

def detector():
    import torch.nn as nn
    import torch.nn.functional as F

    class Detector(nn.Module):
        """(1, 2, 513, 48) mid and side bands -> (1, 64) music scores, one per 8 frames."""

        def __init__(self):
            super().__init__()
            block = lambda i, o: nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU())
            self.convs = nn.ModuleList([block(2, 16), block(16, 32), block(32, 48), block(48, 64)])
            self.head = nn.Sequential(nn.Conv1d(64 * 3, 64, 5, padding=2), nn.ReLU(),
                                      nn.Conv1d(64, 64, 5, padding=4, dilation=2), nn.ReLU(), nn.Conv1d(64, 1, 1))

        def forward(self, x):
            for conv, pool in zip(self.convs, [2, 2, 2, (1, 2)]):
                x = F.max_pool2d(conv(x), pool)  # 513 x 48 -> 64 x 3
            b, c, t, f = x.shape
            return self.head(x.permute(0, 1, 3, 2).reshape(b, c * f, t))[:, 0]

    return Detector()


def train(shards, out, epochs=24, margin=0.0, music_db=-30, clean_db=-40):
    import torch
    import torch.nn.functional as F

    torch.manual_seed(0)
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    load = lambda part: [torch.from_numpy(np.concatenate([np.load(p)[k] for p in sorted(glob.glob(f"{shards}/{part}-*.npz"))])) for k in "xy"]
    (X, Y), (Xv, Yv) = load("train"), load("val")
    # Tiles: 1 music, 0 clean, -1 in between (ignored).
    Y, Yv = (torch.where(y.float() > music_db, 1, torch.where(y.float() < clean_db, 0, -1)).to(torch.int8) for y in (Y, Yv))
    model = detector().to(device)
    opt = torch.optim.AdamW(model.parameters(), 2e-3, weight_decay=1e-3)
    batches = len(X) // 64
    schedule = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=epochs * batches)
    weight = lambda w: torch.tensor(w, device=device)

    def scores(x):
        model.eval()
        with torch.no_grad():
            return torch.cat([model(x[i : i + 256].float().to(device)).cpu() for i in range(0, len(x), 256)])

    for epoch in range(epochs):
        model.train()
        order = torch.randperm(len(X))
        for i in range(batches):
            x, y = X[order[i * 64 : (i + 1) * 64]].float().to(device), Y[order[i * 64 : (i + 1) * 64]].to(device)
            logits, known = model(x), (y >= 0).float()
            tiles = (F.binary_cross_entropy_with_logits(logits, y.clamp(min=0).float(), reduction="none", pos_weight=weight(2.0)) * known).sum() / known.sum()
            # The window's decision is its highest score: it must find any music tile.
            has, clean = (y == 1).any(1), (y == 0).all(1)
            keep = has | clean
            windows = F.binary_cross_entropy_with_logits(logits.max(1).values[keep], has[keep].float(), pos_weight=weight(3.0))
            opt.zero_grad()
            (tiles + windows).backward()
            opt.step()
            schedule.step()
        top = scores(Xv).max(1).values
        threshold = top[(Yv == 1).any(1)].min().item()
        print(f"epoch {epoch}: all music windows found at {threshold:.2f}, clean windows skipped {(top[(Yv == 0).all(1)] < threshold - margin).float().mean():.1%}", flush=True)
    model.head[-1].bias.data -= threshold - margin
    model.cpu().eval()
    torch.onnx.export(model, torch.zeros(1, 2, 513, 48), out, input_names=["x"], output_names=["y"], opset_version=17, dynamo=False)
    print(f"Saved {out}: threshold {threshold:.2f} - margin {margin} folded into the scores")


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"fetch": fetch, "make": make, "train": train}[command](*args)
