#!/usr/bin/env bash
# Build the large files the extension needs (they are not committed), checking
# every download against a pinned SHA-256:
#   extension/model/spleeter-2stems.onnx  Spleeter 2-stem (Deezer, MIT), built from
#                                         sherpa-onnx's ONNX export by tools/build_model.py
#   extension/vendor/                     ONNX Runtime Web 1.30.0 (Microsoft, MIT), WebAssembly build
# Also bundles the content script with pinned build-only esbuild.
# Needs Node.js/npm, curl, tar and python3 (a throwaway venv gets onnx and numpy).
#
# ./setup.sh --dev also installs the test tools: tests/node_modules (puppeteer-core)
# with npm, and tests/.venv (numpy, onnxruntime) for the analysis.
set -euo pipefail
cd "$(dirname "$0")"

DEV=0
[[ "${1:-}" == "--dev" ]] && DEV=1

npm ci --no-audit --no-fund
npm run build

SPLEETER_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems.tar.bz2
SPLEETER_SHA256=e26401d9c1801f43c0229731d78d32c2e80085e3aceedeb25f29d2de5fa68ca2
ORT_VERSION=1.30.0
ORT_URL=https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-$ORT_VERSION.tgz
ORT_SHA256=d2228df7e4616bc3348bf504ee888f3bec43789a273f0a63f3e68d203ce3bf71
MODEL_SHA256=3dc5eaf764fc3c12daa4b69a295be426eb0870dbd400afe09c18d0f66e3a50de

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() { # url, output file, expected sha256
  curl -fsSL --retry 3 -o "$2" "$1"
  if [[ "$(sha256 "$2")" != "$3" ]]; then
    echo "Checksum mismatch for $1" >&2
    exit 1
  fi
}

echo "Downloading Spleeter 2-stem (sherpa-onnx's export of Deezer's MIT-licensed weights)..."
fetch "$SPLEETER_URL" "$work/spleeter.tar.bz2" "$SPLEETER_SHA256"
mkdir "$work/spleeter"
tar -xjf "$work/spleeter.tar.bz2" -C "$work/spleeter" --strip-components=1
python3 -m venv "$work/venv"
# numpy is pinned to the same release as tests/requirements.txt. The model
# hash below is only valid for this pin; do not float it.
"$work/venv/bin/pip" install --quiet --disable-pip-version-check onnx==1.23.2 numpy==2.5.4
mkdir -p extension/model
"$work/venv/bin/python" tools/build_model.py "$work/spleeter" extension/model/spleeter-2stems.onnx
if [[ "$(sha256 extension/model/spleeter-2stems.onnx)" != "$MODEL_SHA256" ]]; then
  echo "The built model differs from the tested one (expected sha256 $MODEL_SHA256)." >&2
  exit 1
fi

echo "Downloading ONNX Runtime Web $ORT_VERSION..."
fetch "$ORT_URL" "$work/ort.tgz" "$ORT_SHA256"
tar -xzf "$work/ort.tgz" -C "$work" package/dist
rm -rf extension/vendor
mkdir -p extension/vendor
for file in ort.wasm.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  cp "$work/package/dist/$file" extension/vendor/
done

if [[ $DEV == 1 ]]; then
  echo "Installing test tools..."
  (cd tests && npm ci --no-audit --no-fund)
  python3 -m venv tests/.venv
  tests/.venv/bin/pip install --quiet --disable-pip-version-check -r tests/requirements.txt
fi
echo "Done. Load the extension folder as an unpacked extension (chrome://extensions, Developer mode)."
