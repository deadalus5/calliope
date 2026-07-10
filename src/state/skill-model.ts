import type { Degree, PitchClass } from '../music-core'

/**
 * The dark-spot model. Every drill attempt updates an EWMA per skill cell;
 * target selection samples cells by weakness via softmax, so practice keeps
 * drifting toward what's shaky without ever becoming a rigid quiz.
 */

export type DrillType = 'find' | 'sing' | 'triad' | 'color' | 'chordtone'

export interface SkillCell {
  cellKey: string
  drill: DrillType
  degree: Degree
  key: PitchClass
  ewmaAcc: number // 0..1
  ewmaLatMs: number
  n: number
  lastTs: number
}

const ALPHA = 0.18
const LAT_REF_MS = 4000 // latency above this counts as fully slow

export function cellKeyOf(drill: DrillType, degree: Degree, key: PitchClass): string {
  return `${drill}:${degree}:${key}`
}

export function freshCell(drill: DrillType, degree: Degree, key: PitchClass): SkillCell {
  return {
    cellKey: cellKeyOf(drill, degree, key),
    drill, degree, key,
    ewmaAcc: 0.5, // unknown: neither trusted nor condemned
    ewmaLatMs: LAT_REF_MS / 2,
    n: 0,
    lastTs: 0,
  }
}

export function updateCell(cell: SkillCell, correct: boolean, latencyMs: number, ts: number): SkillCell {
  return {
    ...cell,
    ewmaAcc: cell.ewmaAcc + ALPHA * ((correct ? 1 : 0) - cell.ewmaAcc),
    ewmaLatMs: correct
      ? cell.ewmaLatMs + ALPHA * (Math.min(latencyMs, LAT_REF_MS) - cell.ewmaLatMs)
      : cell.ewmaLatMs,
    n: cell.n + 1,
    lastTs: ts,
  }
}

/** Higher = weaker = should come up more. */
export function cellWeakness(cell: SkillCell, now: number): number {
  const acc = 1 - cell.ewmaAcc
  const lat = 0.35 * (cell.ewmaLatMs / LAT_REF_MS)
  // Unseen-in-a-while bonus, saturating at ~7 days.
  const days = cell.lastTs === 0 ? 7 : Math.min(7, (now - cell.lastTs) / 86_400_000)
  const recency = 0.25 * (days / 7)
  const novelty = cell.n < 3 ? 0.3 : 0
  return acc + lat + recency + novelty
}

/** Softmax sample over candidate cells. rand is injectable for tests. */
export function sampleCell(
  cells: SkillCell[], now: number, temperature = 0.35, rand: () => number = Math.random,
): SkillCell {
  if (cells.length === 0) throw new Error('sampleCell: no candidates')
  const scores = cells.map((c) => cellWeakness(c, now) / temperature)
  const max = Math.max(...scores)
  const exps = scores.map((s) => Math.exp(s - max))
  const total = exps.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < cells.length; i++) {
    r -= exps[i]
    if (r <= 0) return cells[i]
  }
  return cells[cells.length - 1]
}
