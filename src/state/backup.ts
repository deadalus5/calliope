import { db } from './db'

/**
 * One-click backup/restore of everything that makes practice history
 * personal: the Dexie attempts+cells tables and the calliope:* localStorage
 * prefs (spotify:* tokens are excluded by construction — filterCalliopeKeys
 * only ever looks at keys starting 'calliope:').
 */

export interface BackupFile {
  version: 1 | 2
  exportedAt: string // ISO
  attempts: unknown[] // db.attempts.toArray()
  cells: unknown[] // db.cells.toArray()
  localStorage: Record<string, string> // ONLY keys starting 'calliope:'
  /** v2: Jam Room Song Maps + correction overlays (opaque JSON docs). */
  songmaps?: unknown[]
  songcorrections?: unknown[]
}

/** Pure filter: keep only calliope:* entries. Exported so it's unit-testable
 * without touching real localStorage. */
export function filterCalliopeKeys(entries: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (k.startsWith('calliope:')) out[k] = v
  }
  return out
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isInt0to11(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 11
}

/** Per-row check against the real Attempt shape (state/db.ts). Extra fields
 * are allowed; any bad required field rejects the row. */
export function validAttemptRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return (
    isFiniteNumber(r.ts) &&
    typeof r.drill === 'string' &&
    typeof r.correct === 'boolean' &&
    isInt0to11(r.degree) &&
    isInt0to11(r.key) &&
    isFiniteNumber(r.latencyMs)
  )
}

/** Per-row check against the real SkillCell shape (state/skill-model.ts).
 * A garbage row here (NaN ewmaAcc, degree 37, ...) would silently poison
 * cellWeakness/softmax target selection, so import rejects on any bad row. */
export function validCellRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return (
    typeof r.cellKey === 'string' &&
    typeof r.drill === 'string' &&
    isInt0to11(r.degree) &&
    isInt0to11(r.key) &&
    isFiniteNumber(r.ewmaAcc) && r.ewmaAcc >= 0 && r.ewmaAcc <= 1 &&
    isFiniteNumber(r.ewmaLatMs) && r.ewmaLatMs >= 0 &&
    isFiniteNumber(r.n) && Number.isInteger(r.n) && r.n >= 0 &&
    isFiniteNumber(r.lastTs) && r.lastTs >= 0
  )
}

/** Per-row check for the v2 song-map doc tables (state/db.ts JsonDoc). The
 * payload stays opaque here; the Spotify module re-validates shape on read
 * via its own migrate gate, so a stale doc can never crash the app. */
export function validJsonDocRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return (
    typeof r.trackUri === 'string' && r.trackUri.length > 0 &&
    isFiniteNumber(r.updatedAt) &&
    typeof r.data === 'object' && r.data !== null
  )
}

export function validateBackup(data: unknown): data is BackupFile {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (d.version !== 1 && d.version !== 2) return false
  if (typeof d.exportedAt !== 'string') return false
  if (!Array.isArray(d.attempts)) return false
  if (!Array.isArray(d.cells)) return false
  if (d.version === 2) {
    if (!Array.isArray(d.songmaps) || !Array.isArray(d.songcorrections)) return false
    if (!(d.songmaps as unknown[]).every(validJsonDocRow)) return false
    if (!(d.songcorrections as unknown[]).every(validJsonDocRow)) return false
  }
  if (typeof d.localStorage !== 'object' || d.localStorage === null || Array.isArray(d.localStorage)) return false
  for (const v of Object.values(d.localStorage as Record<string, unknown>)) {
    if (typeof v !== 'string') return false
  }
  // No partial imports: one bad row rejects the whole file.
  if (!d.attempts.every(validAttemptRow)) return false
  if (!d.cells.every(validCellRow)) return false
  return true
}

export async function collectBackup(): Promise<BackupFile> {
  const [attempts, cells, songmaps, songcorrections] = await Promise.all([
    db.attempts.toArray(), db.cells.toArray(), db.songmaps.toArray(), db.songcorrections.toArray(),
  ])
  const entries: [string, string][] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    entries.push([key, value])
  }
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    attempts,
    cells,
    songmaps,
    songcorrections,
    localStorage: filterCalliopeKeys(entries),
  }
}

export async function exportBackup(): Promise<void> {
  const backup = await collectBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = backup.exportedAt.slice(0, 10) // YYYY-MM-DD
  a.href = url
  a.download = `calliope-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Deferred: revoking synchronously after click() can cancel the download
  // in some browsers (the fetch of the blob URL hasn't started yet).
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Minimal Storage surface, so the clear-then-restore logic is unit-testable
 * with a Map-backed fake (jsdom's real localStorage is unreliable here). */
export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

/**
 * REPLACE semantics for prefs: remove every existing calliope:* key first,
 * so a key present locally but absent from the backup does not survive the
 * restore, then write the backup's entries (calliope:* only — defensive
 * against a hand-edited backup smuggling in other keys).
 */
export function restoreCalliopeKeys(storage: StorageLike, entries: Record<string, string>): void {
  const toRemove: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k !== null && k.startsWith('calliope:')) toRemove.push(k)
  }
  for (const k of toRemove) storage.removeItem(k)
  for (const [k, v] of Object.entries(entries)) {
    if (k.startsWith('calliope:')) storage.setItem(k, v)
  }
}

/**
 * REPLACE semantics: clears the attempts+cells tables and bulk-loads the
 * backup's rows in their place (not a merge), clears all existing calliope:*
 * localStorage keys and restores the backup's, then reloads the page so the
 * zustand `persist` stores (app-prefs, board-prefs) rehydrate from the
 * freshly-written localStorage instead of holding their stale in-memory
 * state.
 */
export async function applyBackup(b: BackupFile): Promise<void> {
  await db.transaction('rw', db.attempts, db.cells, db.songmaps, db.songcorrections, async () => {
    await db.attempts.clear()
    await db.cells.clear()
    await db.songmaps.clear()
    await db.songcorrections.clear()
    await db.attempts.bulkAdd(b.attempts as never[])
    await db.cells.bulkPut(b.cells as never[])
    // v1 backups simply have none of these — restoring one clears the tables,
    // which is exactly the documented replace-not-merge semantics.
    if (b.songmaps) await db.songmaps.bulkPut(b.songmaps as never[])
    if (b.songcorrections) await db.songcorrections.bulkPut(b.songcorrections as never[])
  })
  restoreCalliopeKeys(localStorage, b.localStorage)
  location.reload()
}
