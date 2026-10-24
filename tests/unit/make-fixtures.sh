#!/usr/bin/env bash
# Regenerates the small media fixtures for the unit tests from synth.py's
# generated audio (nothing copyrighted). Needs ffmpeg and the tests venv.
set -euo pipefail
cd "$(dirname "$0")"
out=fixtures
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
"$(cd .. && pwd)/.venv/bin/python" ../synth.py "$tmp/clip.wav" 3
ff() { ffmpeg -v error -y "$@"; }
# WebM/Opus as YouTube serves it, and fragmented MP4/AAC with 1 s fragments.
ff -i "$tmp/clip.wav" -c:a libopus -b:a 96k -ar 48000 -cluster_time_limit 1000 -f webm "$out/opus.webm"
ff -i "$tmp/clip.wav" -c:a aac -b:a 96k -ar 44100 -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof -frag_duration 1000000 "$out/aac.mp4"
# Common Encryption (ClearKey test key), which the demuxer must report as protected.
ff -i "$out/opus.webm" -c:a copy -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof \
  -encryption_scheme cenc-aes-ctr -encryption_key 76a6c65c5ea762046bd749a2e632ccbb \
  -encryption_kid a7e61c373e219033c21091fa607bf3b8 "$out/encrypted.mp4"
ls -la "$out"
