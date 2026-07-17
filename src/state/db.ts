import Dexie, { type EntityTable } from 'dexie'
import type { Degree, PitchClass } from '../music-core'
import { cellKeyOf, freshCell, updateCell, type DrillType, type SkillCell } from './skill-model'

/**
 * Practice history in IndexedDB: an append-only attempts log plus the
 * current skill-cell snapshots. Everything is local to this machine.
 */

export interface Attempt {
  id?: number
  ts: number
  drill: DrillType
  degree: Degree
  key: PitchClass
  correct: boolean
  latencyMs: number
  detail?: string
}

/**
 * Song Maps and their user-correction overlays (Jam Room). Stored as opaque
 * JSON documents on purpose: state/ never imports the Spotify module's
 * types, so deleting src/integrations/spotify still breaks nothing here.
 * Typed access lives in integrations/spotify/songmap-store.ts.
 */
export interface JsonDoc {
  trackUri: string
  updatedAt: number
  data: unknown
}

const db = new Dexie('calliope') as Dexie & {
  attempts: EntityTable<Attempt, 'id'>
  cells: EntityTable<SkillCell, 'cellKey'>
  songmaps: EntityTable<JsonDoc, 'trackUri'>
  songcorrections: EntityTable<JsonDoc, 'trackUri'>
}

db.version(1).stores({
  attempts: '++id, ts, drill, [drill+degree+key]',
  cells: 'cellKey, drill, lastTs',
})

db.version(2).stores({
  attempts: '++id, ts, drill, [drill+degree+key]',
  cells: 'cellKey, drill, lastTs',
  songmaps: 'trackUri, updatedAt',
  songcorrections: 'trackUri, updatedAt',
})

export async function recordAttempt(a: Attempt): Promise<SkillCell> {
  await db.attempts.add(a)
  const key = cellKeyOf(a.drill, a.degree, a.key)
  const existing = await db.cells.get(key)
  const updated = updateCell(existing ?? freshCell(a.drill, a.degree, a.key), a.correct, a.latencyMs, a.ts)
  await db.cells.put(updated)
  return updated
}

export async function loadCells(drill: DrillType, key: PitchClass, degrees: Degree[]): Promise<SkillCell[]> {
  const found = await db.cells.bulkGet(degrees.map((d) => cellKeyOf(drill, d, key)))
  return degrees.map((d, i) => found[i] ?? freshCell(drill, d, key))
}

export async function allCells(): Promise<SkillCell[]> {
  return db.cells.toArray()
}

export async function attemptCount(): Promise<number> {
  return db.attempts.count()
}

export { db }
