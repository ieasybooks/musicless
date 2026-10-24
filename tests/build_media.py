"""Build local Media Source test streams from a video file.

Usage: build_media.py <input video> <out dir> [seconds]
Writes <out>/{webm-opus,mp4-aac}/ (separate audio and video segment lists, as
YouTube and DASH players use), <out>/muxed/ and muxed-gap/ (one fragmented MP4 with
both tracks, appended in byte slices like a progressive player) and
<out>/progressive.mp4 (a plain file the extension cannot capture).
"""

import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
limit = ["-t", sys.argv[3]] if len(sys.argv) > 3 else []
VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-vf", "scale=-2:360",
         "-force_key_frames", "expr:gte(t,n_forced*4)", "-sc_threshold", "0"]
NS = {"d": "urn:mpeg:dash:schema:mpd:2011"}


def run(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def dash(variant, audio_codec, audio_mime):
    folder = out / variant
    folder.mkdir(parents=True, exist_ok=True)
    run("-i", str(src), *limit, "-map", "0:v:0", "-map", "0:a:0", *VIDEO, *audio_codec,
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
print("built", out)
