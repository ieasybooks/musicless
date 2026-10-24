"""Synthetic test audio with no copyrighted material: a formant-synthesized
voice (vowels with pitch contours, syllables, words, pauses, fricatives) over
generated music (piano chords, bass, kick, snare, hi-hats).

Usage: synth.py <out.wav> <seconds> [--music-db -12] [--voice-only out] [--music-only out]
Writes 44.1 kHz stereo 16-bit WAV. Deterministic for a given length.
"""

import argparse
import wave

import numpy as np

RATE = 44100
rng = np.random.default_rng(7)

# Formant frequencies (Hz) and bandwidths for a few vowels.
VOWELS = {
    "a": ((730, 1090, 2440), (90, 110, 160)),
    "e": ((530, 1840, 2480), (60, 100, 150)),
    "i": ((290, 2290, 3010), (50, 100, 160)),
    "o": ((570, 840, 2410), (70, 90, 150)),
    "u": ((320, 870, 2240), (50, 80, 140)),
}


def formant_gain(freq, formants, bandwidths):
    gain = np.zeros_like(freq)
    for level, (center, width) in zip((1.0, 0.6, 0.3), zip(formants, bandwidths)):
        gain += level / (1 + ((freq - center) / width) ** 2)
    return gain


def syllable(length, f0_start, f0_end, vowel):
    """Additive voiced sound: harmonics of a gliding pitch, shaped by the vowel's formants."""
    t = np.arange(length)
    f0 = np.linspace(f0_start, f0_end, length) * (1 + 0.01 * np.sin(2 * np.pi * 5.5 * t / RATE))
    phase = 2 * np.pi * np.cumsum(f0) / RATE
    formants, bandwidths = VOWELS[vowel]
    out = np.zeros(length)
    for k in range(1, int(5000 / f0_start)):
        out += k**-1.0 * formant_gain(k * f0, formants, bandwidths) * np.sin(k * phase)
    attack, release = int(0.02 * RATE), int(0.05 * RATE)
    envelope = np.ones(length)
    envelope[:attack] = np.linspace(0, 1, attack)
    envelope[-release:] = np.linspace(1, 0, release)
    return out * envelope


def fricative(length):
    """Band-limited noise around 4-7 kHz, like an "s" or "sh"."""
    spectrum = np.fft.rfft(rng.standard_normal(length))
    freq = np.fft.rfftfreq(length, 1 / RATE)
    spectrum *= np.exp(-(((freq - 5500) / 1500) ** 2))
    noise = np.fft.irfft(spectrum, length)
    return noise / (np.abs(noise).max() + 1e-9) * 0.25 * np.hanning(length)


def voice(seconds):
    total = int(seconds * RATE)
    out = np.zeros(total)
    at = int(0.5 * RATE)
    while at < total - RATE:
        # A sentence: 4-9 words of 1-3 syllables, falling intonation.
        words = rng.integers(4, 10)
        base = rng.uniform(105, 150)
        for word in range(words):
            for _ in range(rng.integers(1, 4)):
                if rng.random() < 0.3:
                    length = int(rng.uniform(0.06, 0.12) * RATE)
                    if at + length < total:
                        out[at : at + length] += fricative(length)
                    at += length
                length = int(rng.uniform(0.12, 0.28) * RATE)
                if at + length >= total:
                    break
                drift = 1 - 0.25 * word / words
                start = base * drift * rng.uniform(0.95, 1.15)
                out[at : at + length] += syllable(length, start, start * rng.uniform(0.85, 1.05), rng.choice(list(VOWELS)))
                at += length
            at += int(rng.uniform(0.05, 0.15) * RATE)
        at += int(rng.uniform(0.4, 0.9) * RATE)
    return out / (np.abs(out).max() + 1e-9)


def note(freq, length, decay, harmonics=8, inharmonic=0.0003):
    t = np.arange(length) / RATE
    out = np.zeros(length)
    for k in range(1, harmonics + 1):
        f = k * freq * np.sqrt(1 + inharmonic * k * k)
        if f > 9000:
            break
        out += k**-1.4 * np.sin(2 * np.pi * f * t) * np.exp(-t * decay * (1 + 0.3 * k))
    return out * np.minimum(1, t / 0.005)


def music(seconds):
    total = int(seconds * RATE)
    left, right = np.zeros(total), np.zeros(total)
    beat = 60 / 96  # 96 bpm
    chords = [(220.0, 277.18, 329.63), (164.81, 207.65, 246.94), (185.0, 220.0, 277.18), (146.83, 185.0, 220.0)]
    for b in range(int(seconds / beat)):
        at = int(b * beat * RATE)
        chord = chords[(b // 4) % len(chords)]
        length = min(int(1.6 * RATE), total - at)
        if length <= 0:
            break
        for i, freq in enumerate(chord):
            tone = 0.22 * note(freq * 2, length, 2.5)
            left[at : at + length] += tone * (0.4 + 0.3 * i)
            right[at : at + length] += tone * (1.0 - 0.3 * i)
        if b % 2 == 0:
            bass = 0.35 * note(chord[0] / 2, length, 3.0, harmonics=3)
            left[at : at + length] += bass
            right[at : at + length] += bass
            kick_length = min(int(0.25 * RATE), total - at)
            t = np.arange(kick_length) / RATE
            kick = 0.6 * np.sin(2 * np.pi * (50 + 80 * np.exp(-t * 30)) * t) * np.exp(-t * 18)
            left[at : at + kick_length] += kick
            right[at : at + kick_length] += kick
        else:
            snare_length = min(int(0.18 * RATE), total - at)
            t = np.arange(snare_length) / RATE
            snare = (0.25 * rng.standard_normal(snare_length) + 0.2 * np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 25)
            left[at : at + snare_length] += snare
            right[at : at + snare_length] += snare
        for half in (0, 0.5):
            hat_at = at + int(half * beat * RATE)
            hat_length = min(int(0.05 * RATE), total - hat_at)
            if hat_length > 0:
                hat = np.diff(rng.standard_normal(hat_length + 1)) * 0.06 * np.exp(-np.arange(hat_length) / RATE * 80)
                left[hat_at : hat_at + hat_length] += hat * 0.8
                right[hat_at : hat_at + hat_length] += hat
    peak = max(np.abs(left).max(), np.abs(right).max()) + 1e-9
    return np.stack([left, right], axis=1) / peak


def write(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm.tobytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("seconds", type=float)
    parser.add_argument("--music-db", type=float, default=-12.0, help="music level relative to the voice")
    parser.add_argument("--voice-only")
    parser.add_argument("--music-only")
    args = parser.parse_args()
    v = voice(args.seconds)
    v = np.stack([v, v], axis=1) * 0.5
    m = music(args.seconds) * 0.5 * 10 ** (args.music_db / 20)
    write(args.out, 0.9 * (v + m) / max(1e-9, np.abs(v + m).max()))
    if args.voice_only:
        write(args.voice_only, v)
    if args.music_only:
        write(args.music_only, m)
