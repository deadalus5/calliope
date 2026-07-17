# Calliope

Music theory for a guitarist who already plays — built on the map you already
own: the five pentatonic shapes, the E/A string anchors, and your ear.

**Live site: <https://deadalus5.github.io/calliope/>** — works from anywhere,
installable as an app (Chrome: install icon in the address bar / *Add to Home
Screen*), and loads offline after the first visit. Practice data lives in
each browser — use *export backup* in Dark Spots to move your history between
machines.

## Run it

Hosted: just open <https://deadalus5.github.io/calliope/>. Locally:

```bash
npm install
npm run dev        # → http://127.0.0.1:5173
```

Open it in **Chrome**, guitar in hand. Click *Pick up the guitar* (browsers
need one gesture before audio) and turn the volume up. The mic is only
requested when a drill needs it — and there's a global **no mic** toggle next
to the board options if you'd rather answer drills by tapping the fretboard.

## The idea: skeleton + colors

Everything renders on the same fretboard, in the same language:

- **Dim brass dots** — the pentatonic skeleton you already own. Never goes away.
- **Gold** — roots. Your anchors.
- **Ember** — what the current chord wants, labeled by degree *inside your map*.
- **Electric blue** — the two color notes a mode adds to your skeleton.
  Dorian = minor pent + 2 & 6. Mixolydian = major pent + 4 & b7. You already
  play five of every mode's seven notes.
- **Pearl** — live: the note you just sang or played, pinned to the neck.

Degrees (1, b3, 4, 5, b7…), not letter names, everywhere — because degrees are
what your ear hears. Letter names only matter on the low E and A strings,
where they're always shown.

## The modules

| Module | What it trains |
|---|---|
| **Explore the Map** | The five boxes in any key, ghost notes between boxes (dark-spot work), mode colors on demand. Click anything to hear it. |
| **Name What You Sing** | Free ear-to-hand: drone sets the key, sing anything, see its degree and every place it lives on the neck. |
| **Ear Gym** | The translation gap, drilled. *Hear → find* (a note sounds, find it on the guitar; the mic scores your first note and your speed) and *name → sing*. An adaptive model steers targets toward your weak degrees and keys. |
| **Triad Atlas** | Triads as fragments of the barre chords you already build: inversion ladders up the neck per string set, plus the slash-chord builder (any triad over any bass you can name — with what jazz would call it). |
| **Modal Colors** | Each mode as a vamp in the style of a song you know, A/B licks with and without the color notes, then mic-verified color hunts. |
| **Song Lab** | The band plays changes you know (Mayer, Dead, blues forms) while the fretboard names what your hands already follow. Loop, transpose, slow down. |
| **Jam Room** | The real recordings via Spotify, following an auto-built **Song Map**: chords looked up on Ultimate Guitar, key + mode inferred and shown as skeleton + colors, sections and beat grid heard from the audio. Click a section (V1, CH1, SOLO) to jump the record there; the grid and fretboard follow, with a countdown to the next change. Hand-tapped charts remain as the no-sidecar fallback. |
| **Dark Spots** | Accuracy per degree × key from every drill — the honest map of what needs work. |

## Jam Room (Spotify) setup — one time

1. Create an app at `developer.spotify.com/dashboard` (any name).
2. Add exactly `http://127.0.0.1:5173/callback` as a Redirect URI
   (Spotify rejects `localhost`; the dev server is already bound to `127.0.0.1`).
   To use Jam Room from the hosted site too, also add
   `https://deadalus5.github.io/calliope/callback`.
3. Enable the **Web Playback SDK** API, save, copy the **Client ID** into the
   Jam Room setup screen.
4. Log in (Premium required; Chrome recommended — playback uses DRM).

### Song Maps (the songsmith sidecar)

The Jam Room learns songs by asking **songsmith**, a small service meant for
an always-on machine (a Mac mini): it scrapes the Ultimate Guitar chart,
fetches a duration-matched recording via yt-dlp, runs beat/downbeat/section
analysis (allin1) locally, and fuses it all into a Song Map the app caches
forever (Dexie — it rides your backups and works offline once learned).

```bash
cd songsmith
./setup.sh          # npm install + Python venv with the analyzer (one time, slow)
cp config.example.json config.json   # optional: UG Pro cookie for Official charts
npm start           # → http://127.0.0.1:8765
```

Point the Jam Room's ⚙ settings at it. From the dev server, plain
`http://<machine>:8765` works. From the hosted HTTPS site, put Tailscale in
front of it (`tailscale serve --bg 8765`) and use the `https://….ts.net`
URL — see `songsmith/README.md` for the three-step walkthrough. First listen
to a new song takes a minute or two; after that it's instant, sidecar on or
off. If songsmith is unreachable, the old flow still works: type the
changes, tap spacebar on each change once.

## Development

```bash
npx vitest run                     # music-core, arrangers, pitch (MPM), skill-model tests
npx tsc -p tsconfig.app.json --noEmit
npx vite build
node scripts/verify-sing.mjs       # E2E: synthetic voice → pin (needs dev server)
node scripts/verify-eargym.mjs     # E2E: full drill loop with a fake guitarist
node scripts/verify-songlab.mjs    # E2E: band timing/clipping checks; --bounce records 8 bars
node scripts/verify-nomic.mjs      # E2E: no-mic mode, tap answers, zero mic requests
node scripts/verify-guidetone.mjs  # E2E: Song Lab guide-tone drill
node scripts/verify-jamroom.mjs    # E2E: Song Map Jam Room (stubbed Spotify SDK + fixture sidecar)
```

All practice data lives in this browser (IndexedDB + localStorage). No backend.

Deploys are automatic: every push to `main` builds and publishes the live
site via GitHub Actions (`.github/workflows/deploy.yml`).

### Layout

```
src/music-core/     pure theory: degrees, pentatonic geometry, chords, voicings, songs
src/audio/          Tone.js only: context, band, sequencer, drone, audition
src/pitch/          worklet MPM detector (public/pitch-processor.js), note tracker
src/fretboard/      the Living Fretboard: SVG neck + data-driven marker layers
src/drills/         mic-verified round machine
src/state/          Dexie history + EWMA skill cells
src/integrations/spotify/   isolated; delete it and nothing else breaks
src/app/            shell + module views
songsmith/          the Mac-mini sidecar: UG scrape + yt-dlp + allin1 → Song Maps
```
