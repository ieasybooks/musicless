"""Build the audio tool's music detector, landing/audio/engine/detector.onnx.

The website runs its music-removal model only on windows where this detector
finds music. It reads the mel bands of the spectrum the tool already computes
(music_features in tests/website_reference.py, musicFeatures in
landing/audio/dsp.js) and scores every 8 STFT frames (~0.19 s) of a window.

    python tools/detector.py fetch DATA                # speech, singing, music, sermons, PANNs: ~8 GB
    python tools/detector.py make DATA SHARDS          # 1,500 + 14,000 synthetic windows
    python tools/detector.py label MODEL DATA LABELS   # real recordings through the website's model
    python tools/detector.py judge DATA LABELS         # PANNs' second opinion on what it changed
    python tools/detector.py mix DATA LABELS MIXES     # known music added to real clean speech
    python tools/detector.py train SHARDS LABELS MIXES landing/audio/engine/detector.onnx
    python tools/detector.py evaluate LABELS landing/audio/engine/detector.onnx dev,calib,test,sermons

Synthetic windows. Speech: FLEURS (CC BY 4.0) in Arabic, English, Persian, Urdu,
French and Turkish; the Arabic test split is not used, so its speakers can serve
for evaluation. Singing without instruments: about half of VocalSet (CC BY 4.0),
so that a sung or chanted voice alone is not taken for music. Music: the FMA
small set (Creative Commons licenses chosen by the artists) less the tracks in
tools/detector-fma-exclude.txt, which hold little music or mostly speech.
Windows mix speech or singing with music beds, short cues, intros and outros, or
music alone, with room reverb up to that of a large mosque, noise, hum,
microphone EQ, MP3/AAC coding and mono or stereo layouts. A tile is music when
the music is within 30 dB of the speech, clean when it is more than 40 dB below
or absent, and ignored in between.

Real windows (tools/detector-episodes.json): Thmanyah's podcasts from YouTube,
used with Thmanyah's permission and split by programme so that no programme's
intro is both trained on and tested, and Friday sermons of the SAT dataset (CC
BY 4.0), split by sermon. The website's own separation model is the teacher: a
window it does not change can be skipped with no difference in the output, so
it is clean. Where it changes a window, PANNs (Cnn14, AudioSet; used offline
only, never shipped) must confirm music, in the input or in what was removed:
the model sometimes removes speech. Confirmed windows are music; the rest are
not trained on. Known FMA music added to clean real windows, dry or through a
hall's loudspeakers, gives music under real speech with exact levels.

Training mixes the three. The threshold is the lowest score of any music window
of the synthetic validation set and of the calibration programmes, less a
margin; it is folded into the scores, so music is likely where a score is >= 0
and the worker separates the window (landing/README.md). The development
programmes chose the recipe and the test programmes were scored only once it
was fixed; the held-out sermons were also looked at while choosing it.
Shipped: these defaults on an Apple M3 (MPS). Needs FFmpeg, yt-dlp and
tools/detector-requirements.txt.
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
    """Files are split by name hash: about 10% for validation. FMA tracks without music are left out."""
    pick = lambda files: [f for f in sorted(files) if (zlib.crc32(os.path.basename(f).encode()) % 10 == 0) == (part == "val")]
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "detector-fma-exclude.txt")) as f:
        exclude = {line.strip() for line in f if line.strip() and not line.startswith("#")}
    music = [f for f in glob.glob(f"{data}/fma/*.wav") if os.path.basename(f)[:-4] not in exclude]
    return pick(glob.glob(f"{data}/fleurs/*/*/*.wav")), pick(glob.glob(f"{data}/vocalset/*.wav")), pick(music)


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
            self.convs = nn.ModuleList([block(2, 32), block(32, 64), block(64, 96), block(96, 128)])
            self.head = nn.Sequential(nn.Conv1d(128 * 3, 64, 5, padding=2), nn.ReLU(),
                                      nn.Conv1d(64, 64, 5, padding=4, dilation=2), nn.ReLU(), nn.Conv1d(64, 1, 1))

        def forward(self, x):
            for conv, pool in zip(self.convs, [2, 2, 2, (1, 2)]):
                x = F.max_pool2d(conv(x), pool)  # 513 x 48 -> 64 x 3
            b, c, t, f = x.shape
            return self.head(x.permute(0, 1, 3, 2).reshape(b, c * f, t))[:, 0]

    return Detector()


def synthetic(shards, part, music_db=-30, clean_db=-40):
    files = sorted(glob.glob(f"{shards}/{part}-*.npz"))
    y = np.concatenate([np.load(p)["y"] for p in files]).astype(np.float32)
    # Tiles: 1 music, 0 clean, -1 in between (ignored).
    return np.concatenate([np.load(p)["x"] for p in files]), np.where(y > music_db, 1, np.where(y < clean_db, 0, -1)).astype(np.int8)


def train(shards, labels, mixes, out, epochs=16, margin=1.0, seed=0):
    """Batches of 64: 23 synthetic, 26 real, 15 real speech with known music."""
    epochs, margin, seed = int(epochs), float(margin), int(seed)
    import torch
    import torch.nn.functional as F

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    files = sorted(glob.glob(f"{mixes}/*.npz"))
    pools = [(*synthetic(shards, "train"), 23), (*real(labels, "train")[:2], 26),
             (np.concatenate([np.load(p)["x"] for p in files]), np.concatenate([np.load(p)["y"] for p in files]), 15)]
    model = detector().to(device)
    opt = torch.optim.AdamW(model.parameters(), 2e-3, weight_decay=1e-3)
    steps = epochs * sum(len(x) for x, _, _ in pools) // 64
    schedule = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps)
    weight = lambda w: torch.tensor(w, device=device)
    for step in range(steps):
        model.train()
        picks = [rng.integers(0, len(x), k) for x, _, k in pools]
        x = torch.from_numpy(np.concatenate([p[0][i] for p, i in zip(pools, picks)])).float().to(device)
        y = torch.from_numpy(np.concatenate([p[1][i] for p, i in zip(pools, picks)])).to(device)
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
        if (step + 1) % (steps // epochs) == 0:
            print(f"epoch {(step + 1) // (steps // epochs)} of {epochs}", flush=True)
    model.cpu().eval()
    score = lambda x: np.concatenate([model(torch.from_numpy(x[i : i + 256]).float()).detach().numpy().max(1) for i in range(0, len(x), 256)])
    xv, yv = synthetic(shards, "val")
    xc, _, calib = real(labels, "calib")
    with torch.no_grad():
        lows = score(xv[(yv == 1).any(1)]).min(), score(xc[calib["must"]]).min()
    threshold = min(lows) - margin
    print(f"Music windows: synthetic validation from {lows[0]:.2f}, calibration programmes from {lows[1]:.2f}; threshold {threshold:.2f}")
    model.head[-1].bias.data -= threshold
    torch.onnx.export(model, torch.zeros(1, 2, 513, 48), out, input_names=["x"], output_names=["y"], opset_version=17, dynamo=False)
    print(f"Saved {out}")
    evaluate(labels, out)


def evaluate(labels, detector_path, splits="dev,calib"):
    """The gate as the worker runs it (separate when the score is >= 0, or after a window the model changed). Clean
    windows count only where the gate's decision is known: the score separates them, they start a recording, or
    the carry from the window before is known (that window is known, or the model did not change it)."""
    import onnxruntime as ort

    session = ort.InferenceSession(detector_path, providers=["CPUExecutionProvider"])
    for split in splits.split(","):
        x, _, info = real(labels, split)
        s = np.array([session.run(None, {"x": x[i : i + 1].astype(np.float32)})[0].max() for i in range(len(x))])
        changed = info["changed"]  # as dsp.js changed() would say after separating it
        at = {(e, int(k)): i for i, (e, k) in enumerate(zip(info["episode"], info["k"]))}
        separated, known = np.zeros(len(s), bool), np.zeros(len(s), bool)
        for i in sorted(range(len(s)), key=lambda i: (info["episode"][i], info["k"][i])):
            prev = at.get((info["episode"][i], int(info["k"][i]) - 1))
            # Without the window before, or with one whose own carry is unknown and that the model changed, the
            # browser may carry separation into this window: separated is then a lower bound.
            carry_known = info["k"][i] == 0 or (prev is not None and (known[prev] or not changed[prev]))
            separated[i] = s[i] >= 0 or (prev is not None and separated[prev] and changed[prev])
            known[i] = carry_known or s[i] >= 0
        must, clean = info["must"], info["clean"] & known
        events = sum(1 for i in np.flatnonzero(must) if (info["episode"][i], int(info["k"][i]) - 1) not in at or not must[at[(info["episode"][i], int(info["k"][i]) - 1)]])
        print(f"{split}: {len(s)} windows; music windows {must.sum()} ({events} events), missed {(must & ~separated).sum()}"
              f" ({(must & (s < 0)).sum()} by the detector alone); clean windows skipped {np.mean(~separated[clean]):.1%} of {clean.sum()};"
              f" possible music skipped {(info['possible'] & ~separated).sum()} of {info['possible'].sum()}")
        for programme in sorted(set(info["programme"])):
            p = info["programme"] == programme
            print(f"    {programme}: clean skipped {np.mean(~separated[clean & p]) if (clean & p).any() else float('nan'):.1%} of {(clean & p).sum()},"
                  f" music missed {(must & p & ~separated).sum()} of {(must & p).sum()}, possible skipped {(info['possible'] & p & ~separated).sum()} of {(info['possible'] & p).sum()}")


# Real recordings -------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
EPISODES = os.path.join(HERE, "detector-episodes.json")
SAT = "https://data.mendeley.com/public-api/zip/fnz5bt24st/download/1"
PANNS = "https://zenodo.org/record/3987831/files/{}?download=1"
PANNS_SED, PANNS_CLIP = "Cnn14_DecisionLevelMax_mAP%3D0.385.pth", "Cnn14_mAP%3D0.431.pth"
AS_MUSIC, AS_SPEECH = 137, 0  # AudioSet classes
HOPS = N // ref.HOP


def episodes():
    with open(EPISODES) as f:
        return {e["id"]: e for e in __import__("json").load(f)["episodes"]}


def fetch_real(data):
    """SAT's sermons, rebuilt from their segments; PANNs' checkpoints and labels."""
    import soundfile as sf

    out = os.path.join(data, "audio")
    os.makedirs(out, exist_ok=True)
    if not glob.glob(f"{out}/sat_*.wav"):
        with tempfile.TemporaryDirectory(dir=data) as work:
            urllib.request.urlretrieve(SAT, os.path.join(work, "sat.zip"))
            zipfile.ZipFile(os.path.join(work, "sat.zip")).extractall(work)
            for d in glob.glob(f"{work}/*/audio dataset/sermon_*"):
                files = sorted(glob.glob(f"{d}/*.wav"), key=lambda p: int(os.path.basename(p).split("_")[0]))
                parts = [sf.read(f, dtype="float32") for f in files]
                assert len({rate for _, rate in parts}) == 1, d  # one sample rate per sermon
                sf.write(f"{out}/sat_{d.rsplit('_', 1)[1]}.wav", np.concatenate([x for x, _ in parts]), parts[0][1])
    panns = os.path.join(data, "panns")
    os.makedirs(panns, exist_ok=True)
    for name in (PANNS_SED, PANNS_CLIP):
        if not os.path.exists(os.path.join(panns, name.replace("%3D", "="))):
            urllib.request.urlretrieve(PANNS.format(name), os.path.join(panns, name.replace("%3D", "=")))
    labels = os.path.expanduser("~/panns_data/class_labels_indices.csv")  # read by panns_inference on import
    if not os.path.exists(labels):
        os.makedirs(os.path.dirname(labels), exist_ok=True)
        urllib.request.urlretrieve("https://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv", labels)


def istft(spec):
    """ref.istft without its loop over frames (identical output)."""
    frames = np.fft.irfft(spec, n=ref.N_FFT, axis=-1) * ref.SQRT_HANN
    out = np.zeros((2, ref.FRAMES + 3, ref.HOP))
    for c in range(4):
        out[:, c : c + ref.FRAMES] += frames[:, :, c * ref.HOP : (c + 1) * ref.HOP]
    out = out.reshape(2, -1)[:, ref.N_FFT // 2 : ref.N_FFT // 2 + N]
    weight = np.zeros(N + ref.N_FFT)
    for f in range(ref.FRAMES):
        weight[f * ref.HOP : f * ref.HOP + ref.N_FFT] += ref.SQRT_HANN**2
    weight = weight[ref.N_FFT // 2 : ref.N_FFT // 2 + N]
    return out / np.where(weight > 1e-11, weight, 1)


def pick(n, vid, split):
    """Windows on the browser's grid: the intro, the outro, a run in the middle and a few others (all of a short
    recording). Training recordings get fewer: the teacher takes about a second a window."""
    edge, extra = (26, 12) if split != "train" else (13, 8)
    if n <= 3 * edge + extra + 10:
        return list(range(n))
    rng = np.random.default_rng([ord(c) for c in vid])
    a = int(rng.integers(edge, n - 2 * edge))
    chosen = set(range(edge)) | set(range(n - edge, n)) | set(range(a, a + edge))
    rest = sorted(set(range(n)) - chosen)
    return sorted(chosen | set(rng.choice(rest, size=min(extra, len(rest)), replace=False).tolist()))


def audio(data, vid):
    path = os.path.join(data, "audio", f"{vid}.wav")
    if not os.path.exists(path):
        path = os.path.join(data, "audio", f"{vid}.m4a")
        if not os.path.exists(path):  # YouTube's 128 kb/s AAC, as a listener would download it
            subprocess.run(["yt-dlp", "-q", "--no-warnings", "--no-playlist", "-f", "140/bestaudio[ext=m4a]", "-o", path,
                            f"https://www.youtube.com/watch?v={vid}"], check=True, timeout=1800)
    return path


def blocks(path, ks):
    """The windows ks of a file, decoded run by run (a whole episode at 44.1 kHz would not fit in memory)."""
    out, runs = {}, []
    for k in ks:
        if runs and k == runs[-1][1] + 1:
            runs[-1][1] = k
        else:
            runs.append([k, k])
    for k0, k1 in runs:
        start, length = k0 * ref.STRIDE, (k1 - k0) * ref.STRIDE + N
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", f"{start / 44100:.6f}", "-i", path, "-t", f"{length / 44100:.6f}",
                                       "-ar", "44100", "-ac", "2", "-f", "f32le", "pipe:1"])
        x = np.frombuffer(raw, "<f4").reshape(-1, 2).T
        for k in range(k0, k1 + 1):
            out[k] = x[:, (k - k0) * ref.STRIDE : (k - k0) * ref.STRIDE + N]
    return out


_teacher = None


def label_one(job):
    """One recording: per window the detector input, and the teacher's input, removed and kept energy per hop,
    its removal per second (changed()'s spans) and verdict. The audio of every window it changed (and 2% of the
    others) is kept for the judge; for training recordings, also a few clean windows to mix music into."""
    global _teacher
    import onnxruntime as ort
    from scipy.signal import resample_poly

    model, data, labels, ep = job
    vid, out = ep["id"], os.path.join(labels, f"{ep['id']}.npz")
    if os.path.exists(out):
        return vid, 0
    if _teacher is None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        _teacher = ort.InferenceSession(model, options, providers=["CPUExecutionProvider"])
    path = audio(data, vid)
    duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))
    n = int(np.ceil(duration * 44100 / ref.STRIDE))
    ks = pick(n, vid, ep["split"])
    rng = np.random.default_rng([ord(c) for c in vid])
    energy = lambda z: (z**2).reshape(2, HOPS, ref.HOP).sum((0, 2)).astype(np.float32)
    rows, keep = {k: [] for k in ["k", "x", "e_in", "e_rm", "e_kept", "spans", "valid", "changed"]}, {}
    for k, seg in blocks(path, ks).items():
        block = np.zeros((2, N))
        block[:, : seg.shape[1]] = seg
        spec = ref.stft(block)
        planes = np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag]).astype(np.float32)
        y = _teacher.run(None, {"x": planes[None]})[0][0].astype(np.float64)
        y = istft(np.stack([y[0] + 1j * y[1], y[2] + 1j * y[3]]))
        removed, mean = block - y, max(np.mean(block**2), 1e-10)
        changed = ref.changed(block, y)
        for key, v in [("k", k), ("x", ref.music_features(planes).astype(np.float16)), ("e_in", energy(block)), ("e_rm", energy(removed)),
                       ("e_kept", energy(y)), ("valid", seg.shape[1]), ("changed", changed),
                       ("spans", np.array([10 * np.log10(np.mean(removed[:, i : i + 44100] ** 2) / mean + 1e-20) for i in range(0, N, 22050)], np.float32))]:
            rows[key].append(v)
        if changed or rng.random() < 0.02:
            keep[f"aud_{k}"] = np.stack([resample_poly(block.mean(0), 320, 441), resample_poly(removed.mean(0), 320, 441)]).astype(np.float16)
        elif ep["split"] == "train" and seg.shape[1] == N and np.mean(removed**2) < 10**-4.5 * mean and np.abs(block).max() > 1e-3 \
                and sum(key.startswith("clean_") for key in keep) < 8 and rng.random() < 0.3:
            keep[f"clean_{k}"] = block.astype(np.float16)
    np.savez(out + ".part.npz", n=n, **{key: np.array(v) for key, v in rows.items()}, **keep)
    os.replace(out + ".part.npz", out)
    if ep["split"] == "train" and path.endswith(".m4a"):
        os.remove(path)
    return vid, len(ks)


def label(model, data, labels, workers=6):
    os.makedirs(labels, exist_ok=True)
    jobs = [(model, data, labels, e) for e in episodes().values()]
    with Pool(int(workers)) as pool:
        for i, (vid, m) in enumerate(pool.imap_unordered(label_safely, jobs)):
            print(f"{i + 1}/{len(jobs)} {vid}: {m}", flush=True)


def label_safely(job):
    try:
        vid, m = label_one(job)
        return vid, f"{m} windows"
    except Exception as error:  # a recording taken down or behind a sign-in: the others go on
        return job[3]["id"], f"failed: {error}"


def judge(data, labels):
    """PANNs on the audio label_one kept: frame-wise Music and Speech per tile of the input and of what the
    teacher removed, and the clip-level verdict on the removed signal."""
    import contextlib
    import torch
    from panns_inference import AudioTagging, SoundEventDetection
    from panns_inference.models import Cnn14_DecisionLevelMax

    with contextlib.redirect_stdout(io.StringIO()):
        sed = SoundEventDetection(checkpoint_path=os.path.join(data, "panns", PANNS_SED.replace("%3D", "=")), device="cpu",
                                  model=Cnn14_DecisionLevelMax(sample_rate=32000, window_size=1024, hop_size=320, mel_bins=64, fmin=50, fmax=14000, classes_num=527))
        clip = AudioTagging(checkpoint_path=os.path.join(data, "panns", PANNS_CLIP.replace("%3D", "=")), device="cpu")
    torch.set_num_threads(4)
    span = [(max(0, 8 * j * 1024 - 2048) // 441, int(np.ceil(((8 * j + 7) * 1024 + 2048) / 441))) for j in range(TILES)]

    def scaled(a):
        loud = np.abs(a) > 1e-7
        return None if loud.sum() < 3200 else (a / np.sqrt(np.mean(a[loud] ** 2)) * 0.1)[None].astype(np.float32)  # content, not level

    def tiles(a):
        a = scaled(a)
        if a is None:
            return np.zeros((2, TILES), np.float32)
        p = sed.inference(a)[0]
        return np.array([[p[x : max(x + 1, y), c].max() if x < len(p) else 0 for x, y in span] for c in (AS_MUSIC, AS_SPEECH)], np.float32)

    for path in sorted(glob.glob(f"{labels}/*.npz")):
        if path.endswith(".part.npz") or path.endswith(".judge.npz") or os.path.exists(path[:-4] + ".judge.npz"):  # done
            continue
        d = np.load(path)
        found = {key: np.full((len(d["k"]), TILES), np.nan, np.float32) for key in ["mi", "si", "mr", "sr"]}
        clip_music, clip_speech = np.full(len(d["k"]), np.nan), np.full(len(d["k"]), np.nan)
        for i, k in enumerate(d["k"]):
            if f"aud_{k}" not in d.files:
                continue
            a = d[f"aud_{k}"].astype(np.float64)
            (found["mi"][i], found["si"][i]), (found["mr"][i], found["sr"][i]) = tiles(a[0]), tiles(a[1])
            if d["changed"][i] and scaled(a[1]) is not None:
                p = clip.inference(scaled(a[1]))[0][0]
                clip_music[i], clip_speech[i] = p[AS_MUSIC], p[AS_SPEECH]
        np.savez(path[:-4] + ".judge.part.npz", **found, clip_music=clip_music, clip_speech=clip_speech)
        os.replace(path[:-4] + ".judge.part.npz", path[:-4] + ".judge.npz")
        print(os.path.basename(path), flush=True)


def tile_levels(e_rm, e_kept):
    """Removed energy per tile, dB re the kept speech's typical hop (at least -60 dBFS)."""
    p95 = np.quantile(e_kept, 0.95, axis=1, keepdims=True)
    active = e_kept > p95 * 1e-3
    typical = np.maximum((e_kept * active).sum(1) / np.maximum(active.sum(1), 1), 2048e-6)
    db = lambda v: 10 * np.log10(np.maximum(v, 1e-30))
    return np.stack([db(e_rm[:, max(0, 8 * j - 2) : min(HOPS, 8 * j + 9)].mean(1)) - db(typical) for j in range(TILES)], 1)


def classify(d, j):
    """clean: the teacher did not change the window (3 dB inside changed()'s thresholds). must: it changed it
    clearly (3 dB past them) and PANNs confirms music, in the input where it removed something (frame-wise Music
    >= 0.2; real speech alone reaches ~0.06) or in what it removed (clip-level Music >= 0.3, above Speech).
    possible: other changed windows with some sign of music; teacher-only: no sign of music (it removed speech)."""
    db = lambda v: 10 * np.log10(np.maximum(v, 1e-30))
    e_in = d["e_in"].sum(1)
    whole = np.where(e_in < 1e-6, -200, db(d["e_rm"].sum(1)) - db(e_in))
    span = np.where(e_in < 1e-6, -200, d["spans"].max(1))
    changed = d["changed"].astype(bool)
    levels = tile_levels(d["e_rm"], d["e_kept"])
    where = levels > -40
    where[~where.any(1)] = True
    judged = ~np.isnan(j["mi"]).any(1)
    heard_in = np.where(where, np.nan_to_num(j["mi"]), 0).max(1)
    heard_rm = np.where(where, np.nan_to_num(j["mr"]), 0).max(1)
    removed_music = (j["clip_music"] >= 0.3) & (j["clip_music"] > j["clip_speech"])
    clean = ~changed & (whole < -43) & (span < -38)
    must = changed & judged & ((whole > -37) | (span > -32)) & ((heard_in >= 0.2) | removed_music)
    possible = changed & ~must & judged & ((heard_in >= 0.05) | (heard_rm >= 0.2) | removed_music)
    return dict(changed=changed, clean=clean, must=must, possible=possible, teacher_only=changed & ~must & ~possible, levels=levels,
                heard=np.nan_to_num(j["mi"]), removed_music=removed_music)


def targets(c):
    """Tiles of clean windows: 0. Of music windows: 1 where the teacher removed > -30 dB re the speech and music is
    heard there (or the removal is music), 0 where it removed < -45 dB, else ignored. Other windows: ignored."""
    y = np.full(c["levels"].shape, -1, np.int8)
    y[c["clean"]] = 0
    m = np.flatnonzero(c["must"])
    lv, heard = c["levels"][m], (c["heard"][m] >= 0.1) | c["removed_music"][m, None]
    y[m] = np.where((lv > -30) & heard, 1, np.where(lv < -45, 0, -1))
    none = m[(y[m] == 1).sum(1) == 0]
    y[none, np.argmax(np.where(c["levels"][none] > -40, c["heard"][none] + 1e-3 * c["levels"][none], -1e9), 1)] = 1
    return y


def real(labels, split):
    """The labelled windows of a split: features, tile targets, and classes, recordings and positions."""
    eps = episodes()
    missing = sorted(v for v, e in eps.items() if e["split"] == split and not os.path.exists(f"{labels}/{v}.judge.npz"))
    if missing:  # a recording taken down, or not yet labelled or judged: the split's numbers leave it out
        print(f"{split}: {len(missing)} recordings not labelled and judged: {', '.join(missing)}", file=sys.stderr)
    xs, ys, info = [], [], {k: [] for k in ["changed", "clean", "must", "possible", "teacher_only", "episode", "programme", "k"]}
    for path in sorted(glob.glob(f"{labels}/*.npz")):
        vid = os.path.basename(path)[:-4]
        if vid not in eps or eps[vid]["split"] != split or not os.path.exists(path[:-4] + ".judge.npz"):
            continue
        d, j = np.load(path), np.load(path[:-4] + ".judge.npz")
        c = classify(d, j)
        xs.append(d["x"]), ys.append(targets(c))
        for key in ["changed", "clean", "must", "possible", "teacher_only"]:
            info[key].append(c[key])
        info["episode"].append([vid] * len(d["k"])), info["programme"].append([eps[vid]["programme"]] * len(d["k"])), info["k"].append(d["k"])
    return np.concatenate(xs), np.concatenate(ys), {k: np.concatenate(v) for k, v in info.items()}


def hall(x, seed, linear=False):
    """A mosque or lecture hall: loudspeaker band-pass and soft clipping, a later loudspeaker, a long room. The same
    seed gives the same hall; linear leaves out the clipping and the level, to measure what reaches the listener."""
    from scipy.signal import butter, fftconvolve, sosfilt

    rng = np.random.default_rng(seed)
    y = sosfilt(butter(2, [rng.uniform(100, 250), rng.uniform(4000, 8000)], "bandpass", fs=44100, output="sos"), x, axis=-1)
    drive = rng.uniform(1, 4)
    if not linear:
        y = np.tanh(drive * y / (np.abs(y).max() + 1e-9)) / np.tanh(drive)
    y = y + rng.uniform(0.2, 0.7) * np.pad(y, ((0, 0), (int(rng.uniform(0.05, 0.35) * 44100), 0)))[:, :N]
    rt = rng.uniform(0.8, 3.5)
    h = rng.standard_normal((2, int(min(rt, 2.5) * 44100))) * np.exp(-6.9 * np.arange(int(min(rt, 2.5) * 44100)) / 44100 / rt)
    h /= np.sqrt((h**2).sum(1, keepdims=True))
    h[:, 0] += rng.uniform(0.3, 3)
    y = np.stack([fftconvolve(y[c], h[c])[:N] for c in range(2)])
    return y if linear else y / (np.abs(y).max() + 1e-9) * np.abs(x).max()


def mixed(block, music, rng, room=None):
    """Known music added to a clean real window: a bed, cues, an intro or outro, or a quiet bed (-36 to -30 dB re
    the speech, which the synthetic windows ignore), dry or through the hall of seed room. Tiles: 1 where the music
    is above -33 dB re the speech, 0 below -45 dB."""
    from scipy.signal import resample_poly

    scenario = rng.choice(["bed", "cues", "edge", "quiet"], p=[0.35, 0.25, 0.25, 0.15])
    m = resample_poly(tilt(music, rng), 441, 160)[:N]
    m = np.pad(m, (0, N - len(m))) / rms(m)
    segments = {"bed": [(0, N)], "quiet": [(0, N)], "cues": [(a, a + rng.uniform(0.3, 4) * 44100) for a in rng.uniform(0, N, rng.integers(1, 3))]}
    t = rng.uniform(0.05, 0.95) * N
    m = m * np.interp(np.arange(N), np.arange(N16) * 44100 / SR, envelope([(a * SR / 44100, b * SR / 44100) for a, b in
                      segments.get(scenario, [(0, t) if rng.random() < 0.5 else (t, N)])], rng))
    M = np.stack([m, m]) if rng.random() < 0.5 else np.stack([m, rng.uniform(0.6, 1) * np.roll(m, int(rng.uniform(0.0003, 0.02) * 44100))])
    speech = np.mean(block[:, np.abs(block).max(0) > 0.05 * np.abs(block).max()] ** 2)
    M *= np.sqrt(speech) * 10 ** ((rng.uniform(-36, -30) if scenario == "quiet" else rng.uniform(-30, 6)) / 20)
    x = block + M if room is None else hall(block + M, room)
    peak = max(np.abs(x).max(), 1.0)
    spec = ref.stft(x / peak)
    features = ref.music_features(np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag]).astype(np.float32))
    # ponytail: tiles are labelled from the dry music, so in a hall the music's echo and reverberation after it ends
    # counts as clean (the window's label is right). Labelling that tail as music or ignoring it trained no better
    # detectors in five runs.
    power = np.mean(M**2, 0)
    level = np.array([10 * np.log10(power[max(0, 8 * j * 1024 - 2048) : (8 * j + 7) * 1024 + 2048].mean() / speech + 1e-20) for j in range(TILES)])
    return features.astype(np.float16), np.where(level > -33, 1, np.where(level < -45, 0, -1)).astype(np.int8)


def mix_one(job):
    data, path, out, seed = job
    rng = np.random.default_rng(seed)
    music = sources(data, "train")[2]
    d, X, Y = np.load(path), [], []
    for key in [k for k in d.files if k.startswith("clean_")]:
        block = d[key].astype(np.float64)
        if np.abs(block).max() < 1e-3:  # digital silence: no speech to mix with
            continue
        for _ in range(6):
            pair = mixed(block, read(music[rng.integers(len(music))], N16, rng), rng)
            X.append(pair[0]), Y.append(pair[1])
        spec = ref.stft(hall(block, int(rng.integers(1 << 30))))  # the same speech through a hall's loudspeakers: still no music
        X.append(ref.music_features(np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag]).astype(np.float32)).astype(np.float16))
        Y.append(np.zeros(TILES, np.int8))
        pair = mixed(block, read(music[rng.integers(len(music))], N16, rng), rng, room=int(rng.integers(1 << 30)))  # a nasheed over the PA
        X.append(pair[0]), Y.append(pair[1])
    if X:
        np.savez(out, x=np.stack(X), y=np.stack(Y))


def mix(data, labels, out):
    os.makedirs(out, exist_ok=True)
    eps = episodes()
    jobs = [(data, p, os.path.join(out, os.path.basename(p)), zlib.crc32(os.path.basename(p).encode())) for p in sorted(glob.glob(f"{labels}/*.npz"))
            if eps.get(os.path.basename(p)[:-4], {}).get("split") == "train"]
    with Pool(max(1, os.cpu_count() - 1)) as pool:
        list(pool.imap_unordered(mix_one, jobs))


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"fetch": lambda data: (fetch(data), fetch_real(data)), "make": make, "label": label, "judge": judge, "mix": mix,
     "train": train, "evaluate": evaluate}[command](*args)
