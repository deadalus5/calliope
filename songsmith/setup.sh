#!/bin/bash
# Songsmith one-time setup on the Mac mini.
# Builds the Python venv for the analyzer and checks the other tools.
set -euo pipefail
cd "$(dirname "$0")"

echo "== songsmith setup =="

# 1. Node deps
if ! command -v node >/dev/null; then
  echo "node not found — install Node 22+ (brew install node)" >&2; exit 1
fi
echo "node: $(node --version)"
npm install

# 2. yt-dlp
if command -v yt-dlp >/dev/null; then
  echo "yt-dlp: $(yt-dlp --version)"
else
  echo "yt-dlp not found — brew install yt-dlp" >&2; exit 1
fi

# 3. ffmpeg (yt-dlp needs it for m4a extraction; allin1 needs it for demixing)
if command -v ffmpeg >/dev/null; then
  echo "ffmpeg: ok"
else
  echo "ffmpeg not found — brew install ffmpeg" >&2; exit 1
fi

# 4. Python venv with the analyzer
PY=python3
if ! command -v $PY >/dev/null; then
  echo "python3 not found — install Python 3.10+ (brew install python)" >&2; exit 1
fi
if [ ! -d .venv ]; then
  echo "creating venv…"
  $PY -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip >/dev/null

ANALYZER="${1:-allin1}"
if [ "$ANALYZER" = "mlx" ]; then
  echo "installing all-in-one-mlx (Apple Silicon)…"
  pip install all-in-one-mlx
else
  echo "installing allin1 (this pulls torch — takes a while)…"
  pip install git+https://github.com/CPJKU/madmom
  pip install allin1
fi

echo
echo "analyzer check:"
.venv/bin/allin1 --help >/dev/null && echo "allin1: ok"

echo
echo "== done =="
echo "next steps:"
echo "  1. cp config.example.json config.json  (and paste your UG cookie for Official charts)"
echo "  2. npm start"
echo "  3. in Calliope's Jam Room settings, set the sidecar URL (http://<this-machine>:8765)"
