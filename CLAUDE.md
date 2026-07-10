# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Calliope is a local-only browser app that teaches music theory to one specific guitarist (the repo owner) through his existing mental model: the five pentatonic positions plus note names on the low E and A strings. There is no backend; all state is localStorage/IndexedDB.

## Commands

```bash
npm run dev                          # Vite dev server — bound to 127.0.0.1:5173 (required, see Spotify)
npx vitest run                       # all unit tests (music-core, pitch worklet, skill model)
npx vitest run src/music-core        # one suite; single test via -t "name"
npx tsc -p tsconfig.app.json --noEmit    # typecheck (app code only; tests are excluded from this config)
npm run build                        # tsc -b + vite build
npm run lint                         # oxlint

# E2E verification (dev server must be running; Playwright + Chromium are installed as devDeps)
node scripts/verify-sing.mjs <outdir>     # mic pipeline: patches getUserMedia with a synthetic tone
node scripts/verify-eargym.mjs <outdir>   # full drill loop with a fake "guitarist" cycling notes
node scripts/verify-songlab.mjs <outdir>  # backing band plays, chord changes advance
node scripts/screenshot.mjs <outdir>      # walks views and screenshots them
```

The E2E scripts live in `scripts/` (not scratch dirs) because they must resolve the project's `playwright` install. The getUserMedia-patch pattern in `verify-sing.mjs` is the way to test anything mic-driven headlessly — keep test tones silent through the ~1s calibration window or the noise floor gets poisoned.

## The pedagogy drives the code

Everything is expressed as **scale degrees relative to a key** (0–11 semitones: `1, b3, 4, 5, b7`), not letter names — that vocabulary (`Degree`, `degreeOf`, `degreeLabel`) appears throughout. Modes are never "modes of the major scale"; they are a pentatonic **skeleton** plus two **color** degrees (`ModeSpec { skeleton, colors }` in `music-core/scale.ts`). Slash chords are "a triad over a bass note on the E/A strings". Preserve this framing in any new feature or copy: meet the user's mental model, don't teach standard curriculum.

Song charts in `src/music-core/songs/index.ts` are simplified "style of" changes. The user knows these songs cold — treat the data as editable and verify changes against *his* corrections, not recall.

## Architecture and hard-won invariants

**Dependency boundaries (enforce by convention):** `music-core` imports nothing and stays pure TS (no DOM, no Tone) — it is the exhaustively-tested foundation. `audio/`, `pitch/`, `fretboard/` import only music-core. `integrations/spotify/` is lazy-loaded via `import()` in `app/App.tsx`; nothing else may depend on it.

**Pentatonic geometry is generated, not hardcoded** (`music-core/pentatonic.ts`): position k anchors on the low-E fret of the k-th scale tone; each string takes the two consecutive scale frets ≥ anchor−1. Tests in `__tests__/pentatonic.test.ts` pin the classic box shapes — if you touch the generator, those fret maps are the ground truth.

**One AudioContext.** `audio/context.ts` creates it behind the start-gate gesture and hands it to Tone; the pitch worklet shares it so drill latency is scored on the audio clock. Never create another context. All Tone.js imports live under `src/audio/`.

**Shared-Transport gotcha:** every view that schedules on `Tone.Transport` (Song Lab, Modal Colors, Triad Practice) must call `sequencer.dispose()` — not `stop()` — when unmounting or before claiming the transport. Stopped-but-scheduled Parts fire again when another view starts the transport (this caused double drum hits and "time must be greater than" errors).

**Sampled instruments only.** Audition guitar, band piano/bass/drums are `Tone.Sampler`/`Tone.Player` over files in `public/samples/` (downloaded once from tonejs.github.io and nbrosowsky.github.io; app runs offline). Do not reintroduce `Tone.PluckSynth` — reusing a ringing Karplus-Strong voice re-tunes its tail and sounds like a double note (the original "two notes per click" bug). Arrangements (walking bass, comping patterns per `feel`) are pure functions in `audio/sequencer.ts`.

**The pitch worklet is deliberately dependency-free** (`public/pitch-processor.js`, plain JS, served as-is): worklet module imports are unreliable across browsers. It implements MPM/NSDF inline at a 2x-decimated rate; its math is tested by `src/pitch/__tests__/worklet.test.ts`, which evals the file with stubbed worklet globals. `NoteTracker` (main thread) owns gating/median/onset logic. Mic constraints keep echoCancellation/noiseSuppression/AGC **off**; backing-track bleed is solved musically (ducking via `duckBacking`), not with DSP. All mic-verified drills are single-note by design — browser polyphonic detection is not reliable; chords are verified by arpeggiating.

**Fretboard is data-driven.** Views never draw on the board; they pass `FretboardLayer[]` built by `fretboard/build-layers.ts`. Markers carry a `degree`; **degree picks the hue** (via `fretboard/palette.ts` + the global color-mode pref in `state/board-prefs.ts`), **role picks the treatment** (CSS in `fretboard.css`: skeleton = dim outline, chordTone/triad = solid glow, target = pearl dashed, ghost = context). The two palettes were validated for CVD separation and contrast on the black board — if you change colors, re-run the dataviz validator rather than eyeballing.

**Adaptive engine:** every drill logs to Dexie (`state/db.ts`) and updates EWMA `skillCells` keyed (drill, degree, key); target selection is softmax over `cellWeakness` (`state/skill-model.ts`, unit-tested, injectable RNG).

**Spotify (Jam Room):** Authorization Code + PKCE, fully client-side, user supplies his own Client ID. The redirect URI must be exactly `http://127.0.0.1:5173/callback` — Spotify rejects `localhost`, which is why `vite.config.ts` binds 127.0.0.1. Playback needs Premium + Chrome (DRM). Spotify's audio-analysis API is deprecated: chart sync is user-tapped (`charts.ts`), never fetched.
