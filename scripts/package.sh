#!/usr/bin/env bash
# Package the extension for release: dist/musicless-<version>.zip, the archive
# to upload to a browser's add-on store or to share for "Load unpacked".
# Run ./setup.sh first: the model and the runtime are built, not committed.
# The zip holds the files git tracks in extension/ plus the four built ones,
# so nothing else in the folder can slip in; the test-only recorder
# (recorder.js) is left out. It is reproducible: sorted entries with fixed
# timestamps.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import hashlib, json, os, re, subprocess, sys, zipfile

BUILT = ["model/spleeter-2stems.onnx", "vendor/ort.wasm.min.mjs",
         "vendor/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.wasm"]
for name in BUILT:
    if not os.path.isfile(os.path.join("extension", name)):
        sys.exit(f"Missing extension/{name}: run ./setup.sh first.")
tracked = subprocess.run(["git", "ls-files", "-z", "extension"], check=True, capture_output=True, text=True).stdout
files = sorted({os.path.relpath(path, "extension") for path in tracked.split("\0") if path} | set(BUILT))
files = [name for name in files if name != "recorder.js"]

# Only the tested build goes out: the model setup.sh builds, and no test key.
manifest = json.load(open("extension/manifest.json"))
if "musicless_test" in manifest:
    sys.exit("extension/manifest.json has the test harness's musicless_test key.")
expected = re.search(r"^MODEL_SHA256=(\w+)$", open("setup.sh").read(), re.M).group(1)
model = hashlib.sha256(open("extension/model/spleeter-2stems.onnx", "rb").read()).hexdigest()
if model != expected:
    sys.exit(f"extension/model/spleeter-2stems.onnx is not the model setup.sh builds (sha256 {model}).")

version = manifest["version"]
os.makedirs("dist", exist_ok=True)
out = f"dist/musicless-{version}.zip"
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
