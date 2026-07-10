#!/usr/bin/env node
// Drum kit prep pipeline: raw WAVs (per a curation.json map) -> trimmed, capped,
// faded, group-normalized OGG samples + a kit.json manifest.
//
// Usage:
//   node scripts/prepare-kit.mjs --src <rawdir> --map <curation.json> --out public/samples/kits/salamander
//   node scripts/prepare-kit.mjs --validate public/samples/kits/salamander
//
// ffmpeg only (no sox). See .superpowers/sdd/briefs/task-1-brief.md for the
// full spec this implements.

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  rmSync,
  mkdtempSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FFMPEG = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || '/opt/homebrew/bin/ffprobe';

// Articulations that get the "long" cap/fade treatment (ringing cymbals/open hats).
// Everything else gets the "short" treatment (kick/snare/xstick/hat-closed/hat-pedal/toms).
const LONG_ARTICULATIONS = new Set(['hat-open', 'ride', 'ride-bell', 'crash']);
const SHORT_CAP_SEC = 2.0;
const SHORT_FADE_SEC = 0.05;
const LONG_CAP_SEC = 4.0;
const LONG_FADE_SEC = 0.2;

const TARGET_PEAK_DB = -6;
const MAX_KIT_SIZE_BYTES = 15 * 1024 * 1024;
const MIN_FILE_SIZE_BYTES = 1024;

function capFadeFor(articulation) {
  return LONG_ARTICULATIONS.has(articulation)
    ? { cap: LONG_CAP_SEC, fade: LONG_FADE_SEC }
    : { cap: SHORT_CAP_SEC, fade: SHORT_FADE_SEC };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function sh(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (res.error) {
    throw new Error(`${cmd} failed to spawn: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${cmdArgs.join(' ')}\nexited ${res.status}\n${res.stderr || ''}`
    );
  }
  return res;
}

function ffprobeDuration(file) {
  const res = sh(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const d = parseFloat(res.stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`could not parse duration for ${file}: ${res.stdout}`);
  return d;
}

function volumeDetectMaxDb(file) {
  const res = sh(FFMPEG, ['-y', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(res.stderr || '');
  if (!m) throw new Error(`volumedetect: no max_volume parsed for ${file}\n${res.stderr}`);
  return parseFloat(m[1]);
}

// Step 1+2: trim leading silence, cap length. Output is an intermediate WAV.
function trimAndCap(srcFile, outFile, capSec) {
  sh(FFMPEG, [
    '-y',
    '-i', srcFile,
    '-af', 'silenceremove=start_periods=1:start_threshold=-55dB',
    '-t', String(capSec),
    outFile,
  ]);
}

// Step 2b+3+4: tail fade (always applied over the final window) + group gain, encode to ogg.
//
// NOTE: the brief specifies `-c:a libvorbis` (the external libvorbis-based
// encoder). This machine's ffmpeg 8.1.1 build has no libvorbis; it only ships
// ffmpeg's native `vorbis` encoder (marked experimental, hence `-strict -2`).
// Both produce Ogg/Vorbis files with the same container+codec that Tone.js /
// browsers decode identically — only the encoder implementation differs.
function fadeGainEncode(inFile, outFile, durationSec, fadeSec, gainDb) {
  const fadeStart = Math.max(0, durationSec - fadeSec);
  const af = `afade=t=out:st=${fadeStart.toFixed(4)}:d=${fadeSec},volume=${gainDb.toFixed(3)}dB`;
  sh(FFMPEG, ['-y', '-i', inFile, '-af', af, '-c:a', 'vorbis', '-strict', '-2', '-q:a', '5', outFile]);
}

function outFileName(articulation, layerIdx, rrIdx) {
  return `${articulation}_v${layerIdx + 1}_rr${rrIdx + 1}.ogg`;
}

function build({ src, map, out }) {
  if (!src || !map || !out) {
    throw new Error('build mode requires --src <rawdir> --map <curation.json> --out <dir>');
  }
  const curationPath = path.resolve(map);
  const curation = JSON.parse(readFileSync(curationPath, 'utf8'));
  const srcDir = path.resolve(src);
  const outDir = path.resolve(out);
  mkdirSync(outDir, { recursive: true });

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'prepare-kit-'));
  try {
    const kit = { id: 'salamander', articulations: {} };

    for (const [articulation, spec] of Object.entries(curation)) {
      const { cap, fade } = capFadeFor(articulation);
      // Flat list of every source file in this articulation (across all layers),
      // in encounter order, so we can group-normalize across the WHOLE group,
      // not per layer (per the brief: "Never normalize per-file", and the
      // group spans all velocity layers of an articulation).
      const trimmedEntries = []; // { srcPath, tmpWav, layerIdx, rrIdx, duration }

      spec.layers.forEach((layer, layerIdx) => {
        layer.src.forEach((relSrc, rrIdx) => {
          const srcPath = path.join(srcDir, relSrc);
          if (!existsSync(srcPath)) {
            throw new Error(`source file not found: ${srcPath} (articulation=${articulation})`);
          }
          const tmpWav = path.join(tmpDir, `${articulation}_${layerIdx}_${rrIdx}.wav`);
          trimAndCap(srcPath, tmpWav, cap);
          const duration = ffprobeDuration(tmpWav);
          trimmedEntries.push({ srcPath, tmpWav, layerIdx, rrIdx, duration });
        });
      });

      // Group-normalize: probe every trimmed file, find the loudest peak,
      // compute ONE gain for the whole articulation group.
      let groupMaxDb = -Infinity;
      for (const entry of trimmedEntries) {
        entry.maxVolumeDb = volumeDetectMaxDb(entry.tmpWav);
        if (entry.maxVolumeDb > groupMaxDb) groupMaxDb = entry.maxVolumeDb;
      }
      const groupGainDb = TARGET_PEAK_DB - groupMaxDb;

      const layersOut = spec.layers.map((layer, layerIdx) => {
        const rr = layer.src.map((_, rrIdx) => outFileName(articulation, layerIdx, rrIdx));
        return { maxVel: layer.maxVel, rr };
      });

      for (const entry of trimmedEntries) {
        const outName = outFileName(articulation, entry.layerIdx, entry.rrIdx);
        const outPath = path.join(outDir, outName);
        fadeGainEncode(entry.tmpWav, outPath, entry.duration, fade, groupGainDb);
      }

      const { gain, pan, sendDb, choke, chokeable } = spec;
      const articOut = { gain, pan };
      if (sendDb !== undefined) articOut.sendDb = sendDb;
      if (choke !== undefined) articOut.choke = choke;
      if (chokeable !== undefined) articOut.chokeable = chokeable;
      articOut.layers = layersOut.sort((a, b) => a.maxVel - b.maxVel);

      kit.articulations[articulation] = articOut;

      console.log(
        `[${articulation}] group peak ${groupMaxDb.toFixed(2)}dB -> gain ${groupGainDb.toFixed(2)}dB, ` +
        `${trimmedEntries.length} file(s) across ${spec.layers.length} layer(s)`
      );
    }

    writeFileSync(path.join(outDir, 'kit.json'), JSON.stringify(kit, null, 2) + '\n');
    console.log(`\nWrote ${path.join(outDir, 'kit.json')}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function validate(kitDir) {
  const dir = path.resolve(kitDir);
  const kitJsonPath = path.join(dir, 'kit.json');
  if (!existsSync(kitJsonPath)) {
    console.error(`FAIL: ${kitJsonPath} does not exist`);
    return false;
  }

  let kit;
  try {
    kit = JSON.parse(readFileSync(kitJsonPath, 'utf8'));
  } catch (e) {
    console.error(`FAIL: kit.json does not parse: ${e.message}`);
    return false;
  }

  let ok = true;
  let totalSize = 0;
  const rows = [];

  for (const [articulation, spec] of Object.entries(kit.articulations || {})) {
    let fileCount = 0;
    let artSize = 0;
    for (const layer of spec.layers || []) {
      for (const rrFile of layer.rr || []) {
        const p = path.join(dir, rrFile);
        if (!existsSync(p)) {
          console.error(`FAIL: ${articulation}: missing file ${rrFile}`);
          ok = false;
          continue;
        }
        const size = statSync(p).size;
        if (size <= MIN_FILE_SIZE_BYTES) {
          console.error(`FAIL: ${articulation}: ${rrFile} is only ${size} bytes (<= ${MIN_FILE_SIZE_BYTES})`);
          ok = false;
        }
        fileCount++;
        artSize += size;
        totalSize += size;
      }
    }
    rows.push({
      articulation,
      layers: (spec.layers || []).length,
      files: fileCount,
      sizeKB: (artSize / 1024).toFixed(1),
    });
  }

  console.log('\nPer-articulation counts:');
  console.log('articulation'.padEnd(14), 'layers'.padEnd(8), 'files'.padEnd(8), 'size(KB)');
  for (const r of rows) {
    console.log(r.articulation.padEnd(14), String(r.layers).padEnd(8), String(r.files).padEnd(8), r.sizeKB);
  }

  const totalMB = totalSize / (1024 * 1024);
  console.log(`\nTotal kit size: ${totalMB.toFixed(2)} MB`);
  if (totalSize >= MAX_KIT_SIZE_BYTES) {
    console.error(`FAIL: total kit size ${totalMB.toFixed(2)} MB exceeds 15 MB limit`);
    ok = false;
  }

  if (ok) console.log('\nvalidate: PASS');
  else console.error('\nvalidate: FAIL');
  return ok;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.validate) {
    const target = typeof args.validate === 'string' ? args.validate : args.out || args._;
    if (!target) {
      console.error('usage: prepare-kit.mjs --validate <kitdir>');
      process.exit(2);
    }
    const ok = validate(target);
    process.exit(ok ? 0 : 1);
  }

  if (args.src || args.map || args.out) {
    build({ src: args.src, map: args.map, out: args.out });
    return;
  }

  console.error(
    'usage:\n' +
    '  node scripts/prepare-kit.mjs --src <rawdir> --map <curation.json> --out <dir>\n' +
    '  node scripts/prepare-kit.mjs --validate <dir>'
  );
  process.exit(2);
}

main();
