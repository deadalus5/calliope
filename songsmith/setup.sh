#!/bin/bash
# Songsmith one-time setup (the Mac mini, or any Mac).
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

# 2. yt-dlp — YouTube now gates most downloads behind PO tokens; the nightly
# build plus the bgutil provider plugin mints them. The uv-tool install is
# isolated at ~/.local/bin/yt-dlp, which config.ts prefers automatically.
if command -v uv >/dev/null; then
  uv tool install --prerelease=allow --with bgutil-ytdlp-pot-provider yt-dlp@latest
  echo "yt-dlp: $("$HOME/.local/bin/yt-dlp" --version) (at ~/.local/bin/yt-dlp, with PO-token provider)"
elif command -v yt-dlp >/dev/null; then
  echo "yt-dlp: $(yt-dlp --version) — WARNING: stable builds without the bgutil PO-token provider often hit HTTP 403 on YouTube"
else
  echo "yt-dlp not found — install uv (https://docs.astral.sh/uv/) or brew install yt-dlp" >&2; exit 1
fi

# 3. ffmpeg (yt-dlp needs it for m4a extraction; allin1 for demixing; the
#    practice deck for atempo re-renders)
if command -v ffmpeg >/dev/null; then
  echo "ffmpeg: ok"
else
  echo "ffmpeg not found — brew install ffmpeg" >&2; exit 1
fi

# 4. Python venv with the analyzer.
# The analyzer stack (torch <2.8 + NATTEN + madmom) does not build on Python
# 3.13+; a pinned 3.11 is the known-good floor. `uv` fetches one on demand;
# without uv, point PY at a 3.9–3.12 interpreter (brew install python@3.11).
PYVER="${PYVER:-3.11}"
if [ ! -d .venv ]; then
  echo "creating venv (python $PYVER)…"
  if command -v uv >/dev/null; then
    uv venv --python "$PYVER" --seed .venv
  else
    PY="${PY:-python3}"
    if ! command -v "$PY" >/dev/null; then
      echo "python3 not found — brew install python@3.11, then: PY=python3.11 ./setup.sh" >&2; exit 1
    fi
    minor=$("$PY" -c 'import sys; print(sys.version_info.minor)')
    if [ "$minor" -ge 13 ]; then
      echo "$PY is Python 3.$minor — too new for the analyzer stack (torch/NATTEN/madmom)." >&2
      echo "brew install python@3.11 && PY=python3.11 ./setup.sh" >&2
      exit 1
    fi
    "$PY" -m venv .venv
  fi
fi
source .venv/bin/activate
pip install --upgrade pip >/dev/null

# The published allin1 deps have drifted; this exact order is the one that
# builds on Apple Silicon in 2026: torch first, pinned <2.8 (2.8 changed the
# API NATTEN 0.17 compiles against); madmom from git (its PyPI release
# predates Python 3.10); NATTEN 0.17.x built against the torch already in
# the venv (hence --no-build-isolation); then allin1 itself.
echo "installing the analyzer (torch first — this downloads gigabytes)…"
pip install "torch>=2.0,<2.8"
pip install "numpy>=1.26,<2" cython cmake ninja
pip install --no-build-isolation "git+https://github.com/CPJKU/madmom"
# NATTEN must be 0.14.x — allin1 1.1.0 imports the pre-0.15 functional API
# (natten1dav etc.). Its build runs through torch's ninja cpp_extension,
# which ignores CXXFLAGS but honors $CXX — and newer Apple clang rejects a
# std::is_arithmetic specialization in torch's own headers as an error, so
# the wrapper injects the one diagnostic downgrade the build needs.
printf '#!/bin/bash\nexec c++ -Wno-invalid-specialization "$@"\n' > .cxx-wrap.sh
chmod +x .cxx-wrap.sh
CXX="$PWD/.cxx-wrap.sh" pip install --no-build-isolation "natten==0.14.6"
pip install allin1

# librosa powers the chroma-DTW timing refiner (POST /refine); same venv.
pip install librosa soundfile

echo
echo "analyzer check:"
.venv/bin/allin1 --help >/dev/null && echo "allin1: ok"

echo
echo "== done =="
echo "next steps:"
echo "  1. cp config.example.json config.json  (and paste your UG cookie for Official charts)"
echo "  2. npm start   — or ./install-launchd.sh to keep it running across reboots"
echo "  3. in Calliope's Jam Room ⚙ songsmith panel, set the sidecar URL (http://<this-machine>:8765)"
