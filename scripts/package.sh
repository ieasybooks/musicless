#!/usr/bin/env bash
# Package the extension for release: dist/nomusic-<version>.zip, the archive
# to upload to a browser's add-on store or to share for "Load unpacked".
# Run ./setup.sh first: the model and the runtime are built, not committed.
# The zip is reproducible: sorted entries with fixed timestamps. The test-only
# recorder (recorder.js) is left out.
set -euo pipefail
cd "$(dirname "$0")/.."

for file in extension/model/spleeter-2stems.onnx extension/vendor/ort.wasm.min.mjs \
  extension/vendor/ort-wasm-simd-threaded.mjs extension/vendor/ort-wasm-simd-threaded.wasm; do
  [[ -f $file ]] || { echo "Missing $file: run ./setup.sh first." >&2; exit 1; }
done

python3 - <<'PY'
import hashlib, json, os, zipfile

version = json.load(open("extension/manifest.json"))["version"]
os.makedirs("dist", exist_ok=True)
out = f"dist/nomusic-{version}.zip"
files = sorted(
    os.path.relpath(os.path.join(root, name), "extension")
    for root, dirs, names in os.walk("extension", followlinks=True)  # worktrees may link the built model and runtime
    for name in names
    if not name.startswith(".")
)
files = [name for name in files if name != "recorder.js"]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(os.path.join("extension", name), "rb") as source:
            archive.writestr(info, source.read(), compresslevel=9)
digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
size = os.path.getsize(out) / 2**20
unpacked = sum(os.path.getsize(os.path.join("extension", name)) for name in files) / 2**20
print(f"{out}: {len(files)} files, {size:.1f} MiB ({unpacked:.1f} MiB unpacked)\nsha256 {digest}")
PY
