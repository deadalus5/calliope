# Songsmith

Calliope's Mac-mini sidecar. Given a Spotify track, it builds a **Song Map**:
chords from Ultimate Guitar, key + mode inferred with music-core, beat grid
and sections from local audio analysis — fused into one JSON the Jam Room
follows while the real record plays.

Personal tooling for one user with a UG Pro subscription and explicit
permission; it is deliberately a polite, low-volume client.

## Setup (once)

```bash
brew install node yt-dlp ffmpeg python
./setup.sh            # npm install + Python venv with allin1
./setup.sh mlx        # …or the Apple-Silicon MLX port instead
cp config.example.json config.json   # optional: paste UG cookie for Official charts
npm start             # listens on http://127.0.0.1:8765
```

Then in Calliope: Jam Room → settings gear → sidecar URL.

To keep it always on, a `launchd` plist pointing at `npm start` in this
directory does the job.

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
3. In the Jam Room settings gear, set the sidecar URL to that
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

1. **ug** — search UG, auto-pick an Official chart when fetchable (needs the
   cookie), else the app shows the top community versions to pick from.
   Raw js-store JSON is cached, so parser fixes re-run without re-scraping.
2. **audio** — yt-dlp search, candidates scored (duration match dominates,
   "- Topic" channels preferred, live/cover penalized). Below-threshold →
   the app offers the candidates + a paste-a-YouTube-URL box.
3. **analyze** — allin1 in the venv: bpm, every beat/downbeat, meter,
   labeled sections. 1–2 minutes on Apple Silicon. Cached forever.
4. **fuse** — UG chord sequences distributed over the downbeat grid section
   by section; key/mode inferred (UG tonality as a prior); per-section key
   overrides for modulating bridges. Warnings land in provenance.

Other routes: `GET /health`, `GET /versions?artist&title`,
`POST /pick {uri, tabId | youtubeUrl}`, `POST /reanalyze {uri, stage}`.

## Cache layout

```
cache/<spotifyTrackId>/
  meta.json         picks + last error
  ug-<tabId>.json   raw js-store (re-parse offline)
  audio.m4a         the analyzed recording
  audio-match.json  which video + score
  allin1-out/       analyzer working dir
  allin1.json       beat grid + segments (ms)
  songmap.json      the fused Song Map
```

Delete a track's directory (or POST /reanalyze) to redo it.

## If something breaks

- **UG markup drift / challenge page** — errors mention `js-store`. The raw
  page JSON of previously fetched tabs is cached; fix `ug-parse.ts` against
  it. Fixtures in `src/__fixtures__` pin the expected shape.
- **Official chart won't fetch** — it needs a fresh `ugCookie` from a
  logged-in browser. Songsmith then falls back to the best community chart
  and records why in `provenance.ug.fallbackReason`.
- **allin1 install pain** — `./setup.sh mlx` uses the MLX port instead of
  torch. Either way the venv is disposable (`rm -rf .venv && ./setup.sh`).
- **Wrong recording matched** — the Jam Room shows the matched video title
  (provenance); paste the right YouTube URL in the picker to override.

Tests for the pure parts (ug-parse, fuse) run with the app's suite:
`npx vitest run songsmith` from the repo root.
