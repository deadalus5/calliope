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
node scripts/verify-sing.mjs <outdir>       # mic pipeline: patches getUserMedia with a synthetic tone
node scripts/verify-eargym.mjs <outdir>     # full drill loop with a fake "guitarist" cycling notes
node scripts/verify-songlab.mjs <outdir>    # backing band plays, chord changes advance; --bounce records 8 bars to a file for a human-listening spot check
node scripts/verify-nomic.mjs <outdir>      # no-mic mode: tap-to-answer drills, mic never requested
node scripts/verify-guidetone.mjs <outdir>  # Song Lab guide-tone drill: pearls the upcoming chord's 3rd/7th, scores mic locks
node scripts/verify-jamroom.mjs <outdir>    # Song Map Jam Room: stubbed Spotify SDK clock + fixture sidecar; section nav, grid follow, seeks, Dexie persistence
node scripts/screenshot.mjs <outdir>        # walks views and screenshots them

node scripts/prepare-kit.mjs --validate public/samples/kits/salamander   # checks the baked drum kit manifest/files without re-rendering them

# songsmith sidecar (runs on the Mac mini; see songsmith/README.md)
cd songsmith && ./setup.sh && npm start     # one-time venv build (allin1), then the service on :8765
```

The E2E scripts live in `scripts/` (not scratch dirs) because they must resolve the project's `playwright` install. The getUserMedia-patch pattern in `verify-sing.mjs` is the way to test anything mic-driven headlessly — keep test tones silent through the ~1s calibration window or the noise floor gets poisoned. `verify-songlab.mjs` (and other scripts driving Song Lab) seed `calliope:app-prefs` via `page.addInitScript` (count-in off) so playback timing is deterministic from the first click.

## The pedagogy drives the code

Everything is expressed as **scale degrees relative to a key** (0–11 semitones: `1, b3, 4, 5, b7`), not letter names — that vocabulary (`Degree`, `degreeOf`, `degreeLabel`) appears throughout. Modes are never "modes of the major scale"; they are a pentatonic **skeleton** plus two **color** degrees (`ModeSpec { skeleton, colors }` in `music-core/scale.ts`). Slash chords are "a triad over a bass note on the E/A strings". Preserve this framing in any new feature or copy: meet the user's mental model, don't teach standard curriculum.

Song charts in `src/music-core/songs/index.ts` are simplified "style of" changes. The user knows these songs cold — treat the data as editable and verify changes against *his* corrections, not recall.

## Architecture and hard-won invariants

**Dependency boundaries (enforce by convention):** `music-core` imports nothing and stays pure TS (no DOM, no Tone) — it is the exhaustively-tested foundation. `audio/`, `pitch/`, `fretboard/` import only music-core. `integrations/spotify/` is lazy-loaded via `import()` in `app/App.tsx`; nothing else may depend on it.

**Pentatonic geometry is generated, not hardcoded** (`music-core/pentatonic.ts`): position k anchors on the low-E fret of the k-th scale tone; each string takes the two consecutive scale frets ≥ anchor−1. Tests in `__tests__/pentatonic.test.ts` pin the classic box shapes — if you touch the generator, those fret maps are the ground truth.

**One AudioContext.** `audio/context.ts` creates it behind the start-gate gesture and hands it to Tone; the pitch worklet shares it so drill latency is scored on the audio clock. Never create another context. All Tone.js imports live under `src/audio/`, with two pre-existing exceptions grandfathered in — `TriadPractice.tsx` and `SlashGuideView.tsx` both import `tone` directly for their own transport/scheduling needs. Don't add a third; new code schedules through `audio/sequencer.ts` or asks for a dedicated helper there instead.

**Shared-Transport gotcha:** every view that schedules on `Tone.Transport` (Song Lab, Modal Colors, Triad Practice) must call `sequencer.dispose()` — not `stop()` — when unmounting or before claiming the transport. Stopped-but-scheduled Parts fire again when another view starts the transport (this caused double drum hits and "time must be greater than" errors).

**Sequencer contracts (`audio/sequencer.ts`):** `load()` bakes a 4-pass variation of the arrangement up front (the transport loops `bars × 4`) so the same bar doesn't repeat for a while, but views only ever see form-space bar/index — chord-change and beat events are re-emitted in the single-pass coordinate the UI understands, never the baked pass number. `play({ countIn })` schedules stick clicks on raw audio-context time, ahead of `t.start()`, not on the transport (there's nothing to be relative to before it's running). `dispose()` resets swing, time signature, and loop in addition to stopping — a leftover swing/loop from the last song otherwise bleeds into the next `load()`. A/B looping is `setLoop(startBar, endBar)`/`clearLoop()`/`seek(bar)`; `load()` bumps a `generation` counter and `loopActive` reports whether a narrower-than-full loop is set — both exist so drills that score against "the next chord in form order" (guide tones) can tell a stale schedule (key change reusing the same progression id, or a loop wrap where the next audible chord isn't `timeline[index+1]`) from a live one, and abort instead of mis-scoring.

**Sampled instruments only.** Audition guitar, band piano/bass are `Tone.Sampler`/`Tone.Player` over files in `public/samples/` (downloaded once from tonejs.github.io and nbrosowsky.github.io; app runs offline). Drums are a multisampled Salamander kit — velocity layers, round robins, and hi-hat choke groups — played by `audio/drum-voice.ts` against `public/samples/kits/salamander/kit.json`, a manifest baked by `scripts/prepare-kit.mjs` from raw WAVs (trim/cap/fade/normalize; `--validate` checks an existing kit without re-rendering). The old single-Player `DrumHit` is gone — its `setValueAtTime` re-leveling of a still-ringing hit is exactly the failure mode multisampling was built to avoid. Do not reintroduce `Tone.PluckSynth` — reusing a ringing Karplus-Strong voice re-tunes its tail and sounds like a double note (the original "two notes per click" bug).

**Arrangements** (walking bass, comping patterns, drum grooves/fills) live in `src/audio/arrange/` — pure functions, no Tone imports, seeded with `mulberry32` (so a bar is reproducible from `(progression.id, pass, voice)`), unit-tested independent of playback. Each song is driven by a `StyleSpec` from the registry in `audio/styles.ts` (bass approach, comping pattern, groove/pocket, swing); `Progression` carries an optional `styleId` as a bare string, so `music-core` stays free of any audio-layer type.

**Mixer.** `audio/mixer.ts` is a singleton graph: per-channel (`keys`/`bass`/`drums`) EQ + compression, a shared reverb send, and a `duck` gain — the submix `duckBacking`/`unduckBacking` ramp — sitting pre-master, so ducking never touches the master chain. Everything sums through a master compressor into a limiter at -1dB before the one AudioContext's destination. Audition playback and the drone stay direct-to-destination, outside this graph, on purpose. `MixerStrip`'s mute/solo read and write `Tone.Channel.mute`/`.solo` directly — `recompose()` (the one place BASE + style trim + user gain combine) must capture and re-assert a channel's mute flag around writing `volume.value`, since Tone derives `mute` from `volume.value === -Infinity` and a raw write silently un-mutes it.

**The pitch worklet is deliberately dependency-free** (`public/pitch-processor.js`, plain JS, served as-is): worklet module imports are unreliable across browsers. It implements MPM/NSDF inline at a 2x-decimated rate; its math is tested by `src/pitch/__tests__/worklet.test.ts`, which evals the file with stubbed worklet globals. `NoteTracker` (main thread) owns gating/median/onset logic. Mic constraints keep echoCancellation/noiseSuppression/AGC **off**; backing-track bleed is solved musically (ducking via `duckBacking`), not with DSP. All mic-verified drills are single-note by design — browser polyphonic detection is not reliable; chords are verified by arpeggiating.

**No-mic mode:** `state/app-prefs.ts` persists `'calliope:app-prefs'` (`micMode`, `countIn`). With `micMode: 'off'`, `pitch/pitch-engine.ts` throws `MicDisabledError` instead of grabbing `getUserMedia` — kept in sync via `setMicDisabled` called from the app layer, since `pitch/` itself can't import `state/`. Sing, Ear Gym's sing game, and Modal Colors' hunt are disabled outright without a mic; Ear Gym's "find" instead accepts a fretboard tap as the answer, logged with `detail: 'tap'` (including an unanswered timeout — it inherits whatever input mode the round was armed with, not a hardcoded 'mic'). The mic is never requested on view mount, only on an explicit user action (pressing "begin"/toggling a drill on).

**Layering, extended:** `audio/` and `pitch/` must not import `state/` (no toasts, no prefs, no Dexie) — failures surface through pure callback registries instead and get turned into UI by the app layer: `audio/load-errors.ts` for sample/kit load failures, `app/mic-errors.ts` for mic-grab failures, both funneled into the shared toast system (`state/toasts.ts`).

**Fretboard is data-driven.** Views never draw on the board; they pass `FretboardLayer[]` built by `fretboard/build-layers.ts`. Markers carry a `degree`; **degree picks the hue** (via `fretboard/palette.ts` + the global color-mode pref in `state/board-prefs.ts`), **role picks the treatment** (CSS in `fretboard.css`: skeleton = dim outline, chordTone/triad = solid glow, target = pearl dashed, ghost = context). The two palettes were validated for CVD separation and contrast on the black board — if you change colors, re-run the dataviz validator rather than eyeballing.

**Adaptive engine:** every drill logs to Dexie (`state/db.ts`) and updates EWMA `skillCells` keyed (drill, degree, key); target selection is softmax over `cellWeakness` (`state/skill-model.ts`, unit-tested, injectable RNG).

**PWA + wake lock.** `public/sw.js` (plain JS, same "served as-is" convention as the pitch worklet) is registered from `main.tsx` in production builds only — the dev server at `127.0.0.1:5173` must never have it intercept anything, since Spotify's OAuth `/callback` round-trip has to hit the network untouched. The worker also never intercepts non-GET requests. It's cache-first for samples/assets (they don't change once shipped) and network-first for the app shell (so a rebuild is picked up promptly), backed by `manifest.webmanifest`. `useWakeLock` requests a screen wake lock only while the transport is actually running (Song Lab playing, Modal Colors' vamp, Triad Practice), so a practice session doesn't dim the screen mid-song.

**Backup.** `state/backup.ts` exports/imports Dexie's attempts+cells tables plus every `calliope:*` localStorage key as one JSON file (Stats has the buttons). Import is replace, not merge — restoring a backup is meant to put you back exactly where that backup was taken, not fork your history. Spotify tokens are excluded by construction: the filter only ever matches keys starting `calliope:`, never `spotify:`.

**`__calliope` (`audio/debug.ts`) is the E2E introspection contract** every `verify-*.mjs` script reads: `peakDb`, `chordEvents`, `songDebug`, `guideTone`, and the lazy `recorder` (only instantiated if a script calls `startRecording`). It's a merge-only surface (`exposeDebug` spreads onto whatever's already there) so mixer, sequencer, and drill hooks can each publish their own fields without clobbering each other's.

**Spotify (Jam Room):** Authorization Code + PKCE, fully client-side, user supplies his own Client ID. Redirect URIs must be HTTPS or the loopback IP (`localhost` is rejected — why `vite.config.ts` binds 127.0.0.1); the callback path is base-relative, so both `http://127.0.0.1:5173/callback` and the Pages site's `https://deadalus5.github.io/calliope/callback` are registered and the Jam Room works from either. Playback needs Premium + Chrome (DRM). Spotify's audio-analysis API is deprecated: timing never comes from Spotify — only position, via the SDK's polled `getCurrentState` + interpolation (`player.ts` `estimatePositionMs`).

**Song Maps (Jam Room + songsmith):** the Jam Room follows a per-track **SongMap** JSON (`integrations/spotify/songmap.ts` — types + pure binary-search timing helpers, shared by relative import with the sidecar). It's built by `songsmith/` (Node+Hono on the Mac mini, port 8765): UG chart scraped from the `js-store` JSON (`ug-parse.ts`, pure, fixture-tested; raw page JSON cached so parser fixes re-run offline), audio via yt-dlp (duration-dominant match scoring), beat/downbeat/section analysis via allin1 in a Python venv, fused in `fuse.ts` (pure: UG owns names+chord order, analyzer owns the clock; chords distributed over downbeats per section). Key/mode comes from `music-core/key-infer.ts` (duration-weighted ModeSpec fit, UG tonality as a prior never a veto, per-section overrides for modulations). SongMaps + `UserCorrections` (a separate never-destroyed overlay keyed by `(kind, ordinal)` so it survives re-analysis; applied at read time by `resolveTiming`) persist in Dexie v2 tables as **opaque docs** — `state/songmap-db.ts` knows nothing of their shape; the migrate gates live in `integrations/spotify/songmap-store.ts`, so the delete-spotify-and-nothing-breaks rule still holds. They ride the backup (v2). The sidecar URL lives at `spotify:songsmithUrl` (machine-local, not backed up). Sidecar off = cached songs fully work; uncached songs fall back to the legacy hand-tapped `charts.ts` flow, which must stay. **Transport:** the hosted HTTPS site can't fetch an HTTP LAN sidecar (mixed content) — the user runs Tailscale (`tailscale serve --bg 8765` on the mini → trusted `https://….ts.net` URL); the server answers Chrome's private-network preflight and its `corsOrigins` include both the dev and Pages origins.
