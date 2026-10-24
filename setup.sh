#!/usr/bin/env bash
# Fetch and build the large files the extension needs (not committed):
#   extension/model/spleeter-2stems.onnx  (37.5 MiB, from sherpa-onnx's Spleeter export)
#   extension/vendor/ort*                  (ONNX Runtime Web 1.30, WebAssembly build)
# Needs: curl, tar, npm and python3 (a throwaway venv gets onnx + numpy).
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Downloading Spleeter 2-stem (sherpa-onnx export of Deezer's MIT-licensed weights)..."
curl -fsSL -o "$work/spleeter.tar.bz2" \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems.tar.bz2
mkdir "$work/spleeter"
tar -xjf "$work/spleeter.tar.bz2" -C "$work/spleeter" --strip-components=1
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install --quiet onnx==1.23.2 numpy
"$work/venv/bin/python" tools/build_model.py "$work/spleeter" extension/model/spleeter-2stems.onnx

echo "Installing test dependencies and copying ONNX Runtime Web..."
(cd tests && npm install --no-audit --no-fund)
mkdir -p extension/vendor
for file in ort.wasm.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  cp "tests/node_modules/onnxruntime-web/dist/$file" extension/vendor/
done
cp tests/node_modules/onnxruntime-web/LICENSE extension/vendor/onnxruntime-LICENSE 2>/dev/null || true
echo "Done. Load the extension folder as an unpacked extension."
