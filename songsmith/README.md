# Songsmith

Calliope's sidecar (this Mac or the always-on mini). Given a Spotify track,
it builds a **Song Map**: chords from Ultimate Guitar, key + mode inferred
with music-core (plus a chroma-measured key prior from the record itself),
beat grid and sections from local audio analysis — fused into one JSON the
Jam Room follows while the real record plays. It also serves the analyzed
audio back to the app (the practice deck: slow-down + beat-tight loops),
chroma-refines chord timing on demand, and caches synced lyrics.

Personal tooling for one user with a UG Pro subscription and explicit
permission; it is deliberately a polite, low-volume client.

## Setup on a new machine (the mini) — one command each

```bash
brew install node ffmpeg uv    # uv fetches the pinned Python + yt-dlp
git clone https://github.com/deadalus5/calliope.git && cd calliope/songsmith
./setup.sh                     # npm install, yt-dlp(+PO-token provider), venv with allin1+librosa
./install-launchd.sh           # keep it running across reboots
curl http://127.0.0.1:8765/health
```

Then in Calliope: Jam Room → **⚙ songsmith** → sidecar URL. (On the dev
server at 127.0.0.1 the app auto-discovers a local sidecar with no setup.)
`cp config.example.json config.json` to change ports/origins or paste a UG
cookie for Official charts — the defaults work without it.

What setup.sh actually pins, because all of it broke once:

- **Python 3.11 venv** (via uv) — torch <2.8 + NATTEN 0.14.6 + madmom-from-git
  don't build on newer Pythons; NATTEN compiles through a `CXX` wrapper that
  downgrades one Apple-clang diagnostic torch's own headers trip.
- **yt-dlp nightly + `bgutil-ytdlp-pot-provider`** at `~/.local/bin/yt-dlp`
  (config prefers it automatically) — YouTube now gates most downloads
  behind PO tokens; brew's stable yt-dlp gets HTTP 403s.

## Reaching the sidecar from the hosted site (Tailscale)

The dev server (`http://127.0.0.1:5173`) can call the sidecar over plain
HTTP. The hosted site (`https://deadalus5.github.io/calliope/`) cannot —
browsers block an HTTPS page from fetching an HTTP LAN address (mixed
content). Tailscale fixes this with a real HTTPS URL for the mini:

1. Install Tailscale on the mini and on every machine you play from, signed
   into the same tailnet. In the admin console, enable **MagicDNS** and
   **HTTPS certificates**.
2. On the mini, put Tailscale's HTTPS proxy in front of songsmith:

   ```bash
   tailscale serve --bg 8765
   ```

   That serves `https://<mini-name>.<tailnet>.ts.net` with a browser-trusted
   certificate, forwarding to the sidecar on 8765. (`tailscale serve status`
   shows the exact URL; `--bg` keeps it across reboots.)
3. In the Jam Room's ⚙ songsmith panel, set the sidecar URL to that
   `https://….ts.net` address. It works from the hosted site and the dev
   server alike, on any of your Tailscale-connected machines, home or away.

CORS: the sidecar must allow the calling page's origin. The defaults (and
`config.example.json`) already include both `http://127.0.0.1:5173` and
`https://deadalus5.github.io`; if you fork or rename the Pages site, update
`corsOrigins` in config.json. The server also answers Chrome's
private-network preflight (`Access-Control-Allow-Private-Network`), which
public HTTPS pages send when calling tailnet/LAN addresses.

## Pipeline

`GET /songmap?uri&artist&title&durationMs` → checks the per-track cache, else:

1. **ug** — search UG; every Official chart is tried when a cookie is set,
   then the top community Chords version (rating × votes) is fetched
   outright — fully automatic, the picker is only ever a re-pick affordance
   in the app ("change chart"). Raw js-store JSON is cached, so parser
   fixes re-run without re-scraping.
2. **audio** — yt-dlp search, candidates scored (duration match dominates,
   "- Topic" channels preferred, live/cover penalized). Below-threshold →
   the app offers the candidates + a paste-a-YouTube-URL box.
3. **analyze** — allin1 in the venv: bpm, every beat/downbeat, meter,
   labeled sections; plus a Krumhansl chroma key estimate of the whole
   record (the prior that saves riff songs whose charts barely write
   chords). 1–2 minutes on Apple Silicon. Cached forever.
4. **fuse (SHEETLAY)** — the sheet owns the song's form: sections in sheet
   order, written repeats/"play the same"/riff mentions expanded, a
   per-song bars-per-chord unit estimated from the record's length, section
   boundaries snapped to the analyzer's segment boundaries by a global DP
   (analyzer labels are soft evidence only), chords placed inside each line
   by their character offsets over the lyrics. Key/mode inferred (UG
   tonality and the chroma key as priors, never vetoes); per-section key
   overrides for modulating bridges. Warnings land in provenance.

Errors are durable (`meta.lastError`) — the app shows them with a retry
button instead of silently re-running; picks and track identity survive a
sidecar restart.

Other routes: `GET /health` · `GET /versions?artist&title` ·
`POST /pick {uri, tabId | youtubeUrl}` ·
`POST /reanalyze {uri, stage: ug|audio|analyze|fuse|all|retry}` ·
`POST /refine {uri}` (chroma-DTW: lines the fused chords up with the
record's beat-synchronous chroma, ±2 beats, confidence-gated — writes
`songmap.refined.json`, which every reader then prefers) ·
`GET /audio/:trackId?rate=` (the practice deck's file; non-1 rates are
pitch-preserving ffmpeg atempo renders, cached; range requests honored) ·
`GET /lyrics?uri&artist&title&durationMs` (LRCLIB, cache-first).

## Cache layout

```
cache/<spotifyTrackId>/
  meta.json             picks + params + last error (restart-durable)
  ug-<tabId>.json       raw js-store (re-parse offline)
  audio.m4a             the analyzed recording
  audio.rX.XX.m4a       atempo renders for the practice deck
  audio-match.json      which video + score
  allin1-out/           analyzer working dir
  allin1.json           beat grid + segments (ms) + chroma key
  songmap.json          the fused Song Map
  songmap.refined.json  chroma-refined timing (preferred when present)
  refine-request.json   what the refiner was asked (debugging)
  lyrics.json           LRCLIB result (misses cached too)
```

Delete a track's directory (or POST /reanalyze) to redo it.

## If something breaks

- **UG markup drift / challenge page** — errors mention `js-store`. The raw
  page JSON of previously fetched tabs is cached; fix `ug-parse.ts` against
  it. Fixtures in `src/__fixtures__` pin the expected shape.
- **Official chart won't fetch** — it needs a fresh `ugCookie` from a
  logged-in browser. Songsmith then falls back to the best community chart
  and records why in `provenance.ug.fallbackReason`.
- **YouTube HTTP 403** — yt-dlp is stale or missing its PO-token provider.
  Re-run `./setup.sh` (it reinstalls the uv-tool yt-dlp), or
  `uv tool upgrade yt-dlp`.
- **allin1 install pain** — the venv is disposable
  (`rm -rf .venv && ./setup.sh`). The pins in setup.sh are the known-good
  combination; don't "upgrade" torch past 2.7.
- **Wrong recording matched** — the Jam Room shows the matched video title
  (provenance); paste the right YouTube URL in the picker to override.
- **Wrong chart** — "change chart" in the Jam Room lists the top versions
  (keeps the audio/analysis cache); "redo this song" starts over.

Tests for the pure parts (ug-parse, fuse, pick, status, refine, serve-audio)
run with the app's suite: `npx vitest run songsmith` from the repo root; the
refiner's DP has its own offline check: `npm run selftest:refine`.
