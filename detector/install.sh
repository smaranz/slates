#!/usr/bin/env bash
#
# Sets up the local AI detector: a Python environment and the MELD weights.
#
# Everything lands under ~/.slates/meld, outside both the repo and the .app
# bundle, so reinstalling Slates doesn't re-download 1.6GB and updating the app
# doesn't touch it.
#
# Roughly 2GB on disk and a few minutes the first time. Re-running is safe: it
# skips what it already has.
set -euo pipefail

ROOT="$HOME/.slates/meld"
VENV="$ROOT/venv"
MODEL="$ROOT/model"
REPO="https://huggingface.co/anon-review-meld-2026/meld/resolve/main"

mkdir -p "$MODEL"

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating a Python environment in $VENV"
  python3 -m venv "$VENV"
fi

echo "Installing torch, transformers and safetensors (the slow part)"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet torch transformers safetensors
"$VENV/bin/python" -c "import torch, transformers; print(f'torch {torch.__version__} · transformers {transformers.__version__}')"

echo "Fetching MELD"
MODEL_DIR="$MODEL" "$VENV/bin/python" - <<'PY'
import os
import urllib.request

base = "https://huggingface.co/anon-review-meld-2026/meld/resolve/main/"
dest = os.environ["MODEL_DIR"]
files = [
    "config.json",
    "meld_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "model.safetensors",
]

for name in files:
    out = os.path.join(dest, name)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        print(f"  {name}: already here ({os.path.getsize(out)/1e6:.1f} MB)")
        continue
    print(f"  {name}: downloading…", flush=True)
    urllib.request.urlretrieve(base + name, out)
    print(f"  {name}: {os.path.getsize(out)/1e6:.1f} MB")
PY

echo
echo "Done. The AI check now runs locally — no API key, and no draft leaves this machine."
echo "Slates starts the detector on first use; it takes ~20s to load, then ~0.2s per essay."
