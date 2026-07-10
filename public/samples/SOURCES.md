# Sample provenance

All samples below are downloaded once and committed; the app runs fully
offline afterward. Nothing under `public/samples/` is fetched at runtime.

## Salamander Drumkit (`kits/salamander/`)

- **Source**: [archive.org/details/SalamanderDrumkit](https://archive.org/details/SalamanderDrumkit)
  (`salamanderDrumkit.tar.bz2`, ~388 MB, overhead-mic ("OH") multisamples,
  original untrimmed set — leading silence is removed by
  `scripts/prepare-kit.mjs`'s trim step).
  - The preferred "trimmed" fileset (`github.com/endolith/Salamander-Drumkit`)
    turned out to contain only `.sfz` mapping files, not audio — the actual
    trimmed WAVs are Google-Drive-hosted and not fetchable headlessly, so this
    task used the archive.org original instead. Its content is identical
    (same author, same samples), just with a bit of leading silence per file,
    which the prep script's silence-trim step removes.
- **Author**: Alexander Holm (axeldenstore@gmail.com)
- **License**: [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/).
  Per the author's own license note: "The share-alike condition only applies
  if you modify the samples themselves or create new sample libraries with
  them. Produced music and other non-sample-library works can be licensed at
  will." Calliope uses the samples as-is (trimmed/normalized/re-encoded) to
  play back drum hits in a practice app; the derived kit itself remains
  CC BY-SA 3.0 if redistributed as a sample library.
- **Download date**: 2026-07-10
- **What was taken**: 53 curated one-shot hits (2 velocity layers where the
  kit provides them, else 1) across 11 articulations — kick, snare, xstick
  (cross-stick), hat-closed, hat-open, hat-pedal, ride, ride-bell, crash,
  tom-hi, tom-lo. See `scripts/salamander-curation.json` for the exact
  source-file mapping and `scripts/prepare-kit.mjs` for the trim / cap /
  fade / group-normalize / encode pipeline. Full articulation mapping and
  processing notes are in `.superpowers/sdd/briefs/task-1-report.md`.

## Piano (`piano/`)

- **Source**: Salamander Grand Piano, distributed via
  [tonejs.github.io](https://tonejs.github.io/audio/salamander/) (Tone.js's
  mirror of the same Alexander Holm Salamander piano library).
- **License**: CC BY 3.0 (Salamander Grand Piano, Alexander Holm).
- **What was taken**: a 17-note velocity-1 sample set (`A1`...`A5` at major
  third/minor third spacing) used by `Tone.Sampler` in `src/audio/samples.ts`.

## Guitar and bass (`guitar/`, `bass/`)

- **Source**: `tonejs-instruments` sample pack, distributed via
  [nbrosowsky.github.io/tonejs-instruments](https://nbrosowsky.github.io/tonejs-instruments/).
- **License**: CC (per the tonejs-instruments project; samples redistributed
  for use with Tone.js).
- **What was taken**: guitar 12-note and bass 9-note sample sets used by
  `Tone.Sampler` in `src/audio/samples.ts`.

## Drums (`drums/`) — legacy, single-sample-per-hit

- **Source**: Tone.js "Kit8" drum sample set, via
  [tonejs.github.io](https://tonejs.github.io/audio/).
- **License**: bundled with Tone.js's example audio assets.
- **What was taken**: one file per drum (`kick.mp3`, `snare.mp3`,
  `hihat.mp3`, `tom1.mp3`) — a single velocity layer, no round robins.
- **Status**: to be removed in a later task once the Salamander-kit-backed
  `DrumVoice` engine (consuming `kits/salamander/kit.json`) replaces the
  `DrumHit` player path in `src/audio/samples.ts`.
