import { execa } from 'execa'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SongsmithConfig } from './config'
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
    const pkg = config.analyzer === 'mlx' ? 'all-in-one-mlx' : 'allin1'
    const { stdout } = await execa(pip, ['show', pkg], { timeout: 15_000 })
    const m = /^Version:\s*(.+)$/m.exec(stdout)
    return m ? m[1].trim() : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function runAnalyzer(config: SongsmithConfig, audioPath: string, outDir: string): Promise<AnalyzerResult> {
  const bin = join(config.venvDir, 'bin', 'allin1')
  try {
    await execa(bin, ['--out-dir', outDir, '--keep-byproducts', audioPath], {
      timeout: 600_000,
    })
  } catch (e) {
    const msg = (e as Error).message
    if (/ENOENT/.test(msg)) {
      throw new Error(`analyzer not installed — run songsmith/setup.sh (looked for ${bin})`)
    }
    throw new Error(`allin1 failed: ${msg.slice(0, 400)}`)
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
