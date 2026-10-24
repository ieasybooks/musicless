"""Build local Media Source test streams.

Usage:
  build_media.py <input video | synthetic> <out dir> [seconds]
  build_media.py long <out dir> [minutes]

The first form writes, from a video file or from generated audio and video
("synthetic", see synth.py; nothing copyrighted):
  <out>/{webm-opus,webm-vp9,mp4-aac}/  separate audio and video segment lists, as YouTube
                                      and DASH players use (VP9 for browsers without H.264)
  <out>/muxed/, <out>/muxed-gap/       one fragmented MP4 with both tracks, appended in byte
                                      slices like a progressive player
  <out>/drm/                           ClearKey-encrypted audio (Common Encryption), which
                                      nomusic must refuse to process
  <out>/progressive.mp4                a plain file nomusic cannot capture
The second form writes a long audio-only WebM/Opus stream (default 25 minutes)
for the capture memory tests.
"""

import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
src, out = sys.argv[1], Path(sys.argv[2])
limit = ["-t", sys.argv[3]] if len(sys.argv) > 3 and src != "long" else []
# Test key for the ClearKey stream (public on purpose).
CLEARKEY = {"kid": "a7e61c373e219033c21091fa607bf3b8", "key": "76a6c65c5ea762046bd749a2e632ccbb"}
VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-vf", "scale=-2:360",
         "-force_key_frames", "expr:gte(t,n_forced*4)", "-sc_threshold", "0"]
NS = {"d": "urn:mpeg:dash:schema:mpd:2011"}


def run(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def dash(variant, audio_codec, audio_mime, video=True):
    folder = out / variant
    folder.mkdir(parents=True, exist_ok=True)
    maps = ["-map", "0:v:0", "-map", "0:a:0", *VIDEO] if video else ["-map", "0:a:0"]
    run("-i", str(src), *limit, *maps, *audio_codec,
        "-f", "dash", "-seg_duration", "4", "-use_template", "1", "-use_timeline", "1",
        "-init_seg_name", "init-$RepresentationID$.$ext$",
        "-media_seg_name", "seg-$RepresentationID$-$Number%05d$.$ext$",
        "-dash_segment_type", "auto", str(folder / "manifest.mpd"))
    mpd = ET.parse(folder / "manifest.mpd").getroot()
    duration = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                     str(src)], capture_output=True, text=True).stdout)
    if limit:
        duration = min(duration, float(limit[1]))
    tracks = []
    for aset in mpd.iterfind(".//d:AdaptationSet", NS):
        rep = aset.find("d:Representation", NS)
        tmpl = aset.find("d:SegmentTemplate", NS) or rep.find("d:SegmentTemplate", NS)
        scale = int(tmpl.get("timescale", 1))
        rid = rep.get("id")
        mime = f'{aset.get("mimeType") or rep.get("mimeType")}; codecs="{rep.get("codecs")}"'
        starts, t = [], 0
        for s in tmpl.find("d:SegmentTimeline", NS):
            t = int(s.get("t", t))
            for _ in range(int(s.get("r", 0)) + 1):
                starts.append(t / scale)
                t += int(s.get("d"))
        ext = "webm" if "webm" in mime else "m4s"
        init_ext = "webm" if "webm" in mime else "m4s"
        number = int(tmpl.get("startNumber", 1))
        tracks.append({
            "mime": mime,
            "init": f"init-{rid}.{init_ext}",
            "segments": [{"url": f"seg-{rid}-{number + i:05d}.{ext}", "start": st} for i, st in enumerate(starts)],
        })
    (folder / "player.json").write_text(json.dumps({"mode": "segments", "duration": duration, "tracks": tracks}, indent=1))
    # The audio track as one file: the exact audio the page plays, for test references.
    audio = next(track for track in tracks if track["mime"].startswith("audio/"))
    suffix = "webm" if "webm" in audio["mime"] else "mp4"
    with open(folder / f"audio.{suffix}", "wb") as joined:
        for name in [audio["init"], *(segment["url"] for segment in audio["segments"])]:
            joined.write((folder / name).read_bytes())


def synthesize(seconds, path):
    """Generated test video: a test pattern with synth.py's voice over music."""
    wav = path.with_suffix(".wav")
    subprocess.run([sys.executable, str(HERE / "synth.py"), str(wav), str(seconds)], check=True)
    run("-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=25:duration={seconds}", "-i", str(wav),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "192k", "-shortest", str(path))
    wav.unlink()


out.mkdir(parents=True, exist_ok=True)
if src == "long":
    # Two minutes of generated audio, looped: content does not matter for memory tests.
    minutes = float(sys.argv[3]) if len(sys.argv) > 3 else 25
    piece = out / "piece.wav"
    subprocess.run([sys.executable, str(HERE / "synth.py"), str(piece), "120"], check=True)
    src = out / "long.wav"
    run("-stream_loop", "-1", "-i", str(piece), "-t", str(minutes * 60), "-c:a", "pcm_s16le", str(src))
    piece.unlink()
    dash("webm-opus", ["-c:a", "libopus", "-b:a", "128k", "-ar", "48000"], "audio/webm", video=False)
    src.unlink()
    print("built", out)
    sys.exit(0)
if src == "synthetic":
    seconds = int(limit[1]) if limit else 240
    src = out / "source.mp4"
    synthesize(seconds, src)
src = Path(src)

dash("webm-opus", ["-c:a", "libopus", "-b:a", "128k", "-ar", "48000"], "audio/webm")
# VP9 video for browsers without H.264 (open-source Chromium), as YouTube serves them.
VIDEO_H264 = VIDEO
VIDEO = ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "500k", "-vf", "scale=-2:360",
         "-force_key_frames", "expr:gte(t,n_forced*4)", "-threads", "2"]
dash("webm-vp9", ["-c:a", "libopus", "-b:a", "128k", "-ar", "48000"], "audio/webm")
VIDEO = VIDEO_H264
dash("mp4-aac", ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"], "audio/mp4")

# Muxed fragmented MP4 without B-frames (clean audio timestamps), and with
# B-frames, where ffmpeg stretches the first AAC packet's duration to 2943
# samples. That leaves a 43.5 ms timestamp gap which Chrome plays straight
# through but the extension honors (a known difference on malformed files).
codecs = 'video/mp4; codecs="avc1.64001e, mp4a.40.2"'
for name, extra in (("muxed", ["-bf", "0"]), ("muxed-gap", [])):
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    run("-i", str(src), *limit, "-map", "0:v:0", "-map", "0:a:0", *VIDEO, *extra, "-c:a", "aac", "-b:a", "128k",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000", str(folder / "media.mp4"))
    (folder / "player.json").write_text(json.dumps({"mode": "bytes", "mime": codecs, "url": "media.mp4"}))
    run("-i", str(folder / "media.mp4"), "-map", "0:a", "-c", "copy", str(folder / "audio.mp4"))
run("-i", str(src), *limit, *VIDEO, "-c:a", "aac", "-movflags", "+faststart", str(out / "progressive.mp4"))

# Encrypted audio (Opus in fragmented MP4, Common Encryption): the player plays it
# with a ClearKey license; nomusic sees an encrypted sample entry and must stop.
folder = out / "drm"
folder.mkdir(parents=True, exist_ok=True)
run("-i", str(out / "webm-opus" / "audio.webm"), "-map", "0:a", "-c:a", "copy", "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000",
    "-encryption_scheme", "cenc-aes-ctr", "-encryption_key", CLEARKEY["key"], "-encryption_kid", CLEARKEY["kid"],
    str(folder / "media.mp4"))
(folder / "player.json").write_text(json.dumps({"mode": "bytes", "mime": 'audio/mp4; codecs="opus"', "url": "media.mp4",
                                                "clearkey": CLEARKEY}))
print("built", out)
