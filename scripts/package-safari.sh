#!/usr/bin/env bash
# Stage the built Safari Web Extension resources into dist/safari-extension
# (or a custom output directory passed as $1), using Safari's manifest from
# tools/safari-manifest.mjs. Run ./setup.sh first: the model and ONNX Runtime
# Web files are built, not committed.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-dist/safari-extension}"

# Always rebuild: source changes cannot leave a stale content script.
npm run build

python3 - "$OUT" <<'PY'
import hashlib, json, os, shutil, subprocess, sys

out = sys.argv[1]
BUILT = [
    "content.bundle.js",
    "model/spleeter-2stems.onnx",
    "vendor/ort.wasm.min.mjs",
    "vendor/ort-wasm-simd-threaded.mjs",
    "vendor/ort-wasm-simd-threaded.wasm",
]
for name in BUILT:
    if not os.path.isfile(os.path.join("extension", name)):
        sys.exit(f"Missing extension/{name}: run ./setup.sh first.")

if os.path.exists(".git"):
    listed = subprocess.run(["git", "ls-files", "-z", "extension"], check=True, capture_output=True, text=True).stdout
    tracked = {os.path.relpath(path, "extension") for path in listed.split("\0") if path}
else:
    tracked = {
        os.path.relpath(os.path.join(folder, name), "extension")
        for folder, _, names in os.walk("extension")
        for name in names
    }
    tracked = {name for name in tracked if not name.startswith(("model/", "vendor/", ".")) and "/." not in name}
files = sorted(tracked | set(BUILT))

manifest = json.load(open("extension/manifest.json"))
if "musicless_test" in manifest:
    sys.exit("extension/manifest.json has the test harness's musicless_test key.")
expected = json.load(open("tools/dependencies.json"))["model_sha256"]
model = hashlib.sha256(open("extension/model/spleeter-2stems.onnx", "rb").read()).hexdigest()
if model != expected:
    sys.exit(f"extension/model/spleeter-2stems.onnx is not the model setup.sh builds (sha256 {model}).")

safari_manifest = subprocess.run(
    ["node", "tools/safari-manifest.mjs", "extension/manifest.json"],
    check=True,
    capture_output=True,
).stdout

if os.path.exists(out):
    shutil.rmtree(out)
os.makedirs(out, exist_ok=True)

for name in files:
    dest = os.path.join(out, name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if name == "manifest.json":
        with open(dest, "wb") as target:
            target.write(safari_manifest)
    else:
        shutil.copy2(os.path.join("extension", name), dest)

size = sum(os.path.getsize(os.path.join(out, name)) for name in files) / 2**20
print(f"{out}: {len(files)} files, {size:.1f} MiB staged for Safari")
PY
