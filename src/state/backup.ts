import { db } from './db'

/**
 * One-click backup/restore of everything that makes practice history
 * personal: the Dexie attempts+cells tables and the calliope:* localStorage
 * prefs (spotify:* tokens are excluded by construction — filterCalliopeKeys
 * only ever looks at keys starting 'calliope:').
 */

export interface BackupFile {
  version: 1
  exportedAt: string // ISO
  attempts: unknown[] // db.attempts.toArray()
  cells: unknown[] // db.cells.toArray()
  localStorage: Record<string, string> // ONLY keys starting 'calliope:'
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

export function validateBackup(data: unknown): data is BackupFile {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (d.version !== 1) return false
  if (typeof d.exportedAt !== 'string') return false
  if (!Array.isArray(d.attempts)) return false
  if (!Array.isArray(d.cells)) return false
  if (typeof d.localStorage !== 'object' || d.localStorage === null || Array.isArray(d.localStorage)) return false
  for (const v of Object.values(d.localStorage as Record<string, unknown>)) {
    if (typeof v !== 'string') return false
  }
  return true
}

export async function collectBackup(): Promise<BackupFile> {
  const [attempts, cells] = await Promise.all([db.attempts.toArray(), db.cells.toArray()])
  const entries: [string, string][] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    entries.push([key, value])
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    attempts,
    cells,
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
  URL.revokeObjectURL(url)
}

/**
 * REPLACE semantics: clears the attempts+cells tables and bulk-loads the
 * backup's rows in their place (not a merge), restores the calliope:*
 * localStorage keys over whatever is currently there, then reloads the page
 * so the zustand `persist` stores (app-prefs, board-prefs) rehydrate from
 * the freshly-written localStorage instead of holding their stale in-memory
 * state.
 */
export async function applyBackup(b: BackupFile): Promise<void> {
  await db.transaction('rw', db.attempts, db.cells, async () => {
    await db.attempts.clear()
    await db.cells.clear()
    await db.attempts.bulkAdd(b.attempts as never[])
    await db.cells.bulkPut(b.cells as never[])
  })
  for (const [key, value] of Object.entries(b.localStorage)) {
    localStorage.setItem(key, value)
  }
  location.reload()
}
