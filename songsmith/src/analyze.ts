import { execa } from 'execa'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_ROOT, type SongsmithConfig } from './config'
import type { AnalyzerResult } from './types'

/**
 * allin1 (All-In-One Music Structure Analyzer) behind a subprocess boundary:
 * the heaviest, flakiest dependency in the pipeline gets its own crash
 * domain. Runs inside the venv built by setup.sh; ~1–2 minutes per song.
 */

/** Raw allin1 JSON (seconds). */
interface Allin1Json {
  bpm: number
  beats: number[]
  downbeats: number[]
  beat_positions: number[]
  segments: { start: number; end: number; label: string }[]
}

export function toAnalyzerResult(raw: Allin1Json): AnalyzerResult {
  const toMs = (s: number) => Math.round(s * 1000)
  return {
    bpm: raw.bpm,
    beatsMs: raw.beats.map(toMs),
    downbeatsMs: raw.downbeats.map(toMs),
    beatPositions: raw.beat_positions,
    segments: raw.segments.map((s) => ({ startMs: toMs(s.start), endMs: toMs(s.end), label: s.label })),
  }
}

export async function analyzerVersion(config: SongsmithConfig): Promise<string> {
  try {
    const pip = join(config.venvDir, 'bin', 'pip')
    const { stdout } = await execa(pip, ['show', 'allin1'], { timeout: 15_000 })
    const m = /^Version:\s*(.+)$/m.exec(stdout)
    return m ? m[1].trim() : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Audio-measured key prior; a failed estimate is just "no prior" (null). */
export async function estimateChromaKey(
  config: SongsmithConfig,
  audioPath: string,
): Promise<AnalyzerResult['chromaKey'] | null> {
  try {
    const py = join(config.venvDir, 'bin', 'python')
    const { stdout } = await execa(py, [join(PACKAGE_ROOT, 'py', 'key_chroma.py'), audioPath], { timeout: 120_000 })
    const lines = stdout.trim().split('\n')
    const raw = JSON.parse(lines[lines.length - 1]) as { root: number; minor: boolean; strength: number; error?: string }
    if (raw.error || !Number.isFinite(raw.root) || !Number.isFinite(raw.strength)) return null
    return { root: raw.root, minor: raw.minor, strength: raw.strength }
  } catch {
    return null
  }
}

/**
 * Run allin1 with EVERYTHING per-track. This is load-bearing: allin1 caches
 * demixed stems and spectrograms in --demix-dir/--spec-dir keyed only by the
 * input FILENAME STEM (default: CWD-global dirs) — with every track named
 * audio.m4a, the global defaults made every song after the first silently
 * reuse the first song's audio features (the great Gravity-grid poisoning).
 * --overwrite forces honest recomputation (and sidesteps an UnboundLocalError
 * in allin1's cleanup when a stale out-dir JSON exists); byproducts are NOT
 * kept (~198MB/track; songsmith caches the RESULT in allin1.json, which is
 * the right layer) and the work dir is wiped before and after.
 */
export async function runAnalyzer(
  config: SongsmithConfig, audioPath: string, outDir: string, workDir: string,
): Promise<AnalyzerResult> {
  const bin = join(config.venvDir, 'bin', 'allin1')
  rmSync(outDir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  try {
    await execa(bin, [
      '--out-dir', outDir,
      '--demix-dir', join(workDir, 'demix'),
      '--spec-dir', join(workDir, 'spec'),
      '--overwrite',
      audioPath,
    ], { timeout: 600_000 })
  } catch (e) {
    const msg = (e as Error).message
    if (/ENOENT/.test(msg)) {
      throw new Error(`analyzer not installed — run songsmith/setup.sh (looked for ${bin})`)
    }
    throw new Error(`allin1 failed: ${msg.slice(0, 400)}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  // allin1 writes <audio stem>.json into outDir (a dedicated subdir — the
  // caller must not point this at a directory holding other JSON).
  const jsonFile = readdirSync(outDir).find((f) => f.endsWith('.json'))
  if (!jsonFile) throw new Error('allin1 finished but produced no JSON output')
  const raw = JSON.parse(readFileSync(join(outDir, jsonFile), 'utf8')) as Allin1Json
  if (!Array.isArray(raw.beats) || raw.beats.length === 0) {
    throw new Error('allin1 output has no beats — audio may be corrupt or silent')
  }
  return toAnalyzerResult(raw)
}
