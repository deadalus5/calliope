# Calliope

Music theory for a guitarist who already plays — built on the map you already
own: the five pentatonic shapes, the E/A string anchors, and your ear.

## Run it

```bash
npm install
npm run dev        # → http://127.0.0.1:5173
```

Open it in **Chrome** on the laptop, guitar in hand. Click *Pick up the
guitar* (browsers need one gesture before audio), allow the microphone when
asked, and turn the volume up.

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
| **Jam Room** | The real recordings via Spotify, with a chart you tap in sync once and the fretboard following it. |
| **Dark Spots** | Accuracy per degree × key from every drill — the honest map of what needs work. |

## Jam Room (Spotify) setup — one time

1. Create an app at `developer.spotify.com/dashboard` (any name).
2. Add exactly `http://127.0.0.1:5173/callback` as a Redirect URI
   (Spotify rejects `localhost`; the dev server is already bound to `127.0.0.1`).
3. Enable the **Web Playback SDK** API, save, copy the **Client ID** into the
   Jam Room setup screen.
4. Log in (Premium required; Chrome recommended — playback uses DRM).

Charts are yours: type the changes, play the track, tap spacebar on each
change once. Saved locally, follows forever.

## Development

```bash
npx vitest run                     # music-core, pitch (MPM), skill-model tests
npx tsc -p tsconfig.app.json --noEmit
npx vite build
node scripts/verify-sing.mjs      # E2E: synthetic voice → pin (needs dev server)
node scripts/verify-eargym.mjs    # E2E: full drill loop with a fake guitarist
```

All practice data lives in this browser (IndexedDB + localStorage). No backend.

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
```
