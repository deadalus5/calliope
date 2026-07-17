import { describe, expect, it } from 'vitest'
import {
  filterCalliopeKeys,
  restoreCalliopeKeys,
  validAttemptRow,
  validCellRow,
  validateBackup,
  type BackupFile,
  type StorageLike,
} from '../backup'

// Dexie itself is NOT exercised here — jsdom lacks indexedDB, so
// collectBackup/applyBackup (which touch db.attempts/db.cells) stay out of
// unit scope. Only the pure, unit-testable surface: validateBackup and the
// localStorage key filter.

function canonical(): BackupFile {
  return {
    version: 1,
    exportedAt: '2026-07-10T00:00:00.000Z',
    attempts: [{ id: 1, ts: 0, drill: 'find', degree: 0, key: 0, correct: true, latencyMs: 100 }],
    cells: [{ cellKey: 'find:0:0', drill: 'find', degree: 0, key: 0, n: 1, ewmaAcc: 1, ewmaLatMs: 100, lastTs: 0 }],
    localStorage: { 'calliope:app-prefs': '{"state":{"micMode":"on"}}' },
  }
}

describe('validateBackup', () => {
  it('accepts a canonical backup object', () => {
    expect(validateBackup(canonical())).toBe(true)
  })

  it('accepts an empty-history backup', () => {
    expect(validateBackup({ version: 1, exportedAt: 'x', attempts: [], cells: [], localStorage: {} })).toBe(true)
  })

  it('rejects unknown versions', () => {
    expect(validateBackup({ ...canonical(), version: 3 })).toBe(false)
    expect(validateBackup({ ...canonical(), version: '1' })).toBe(false)
  })

  it('accepts a v2 backup with song-map doc tables', () => {
    expect(validateBackup({
      ...canonical(),
      version: 2,
      songmaps: [{ trackUri: 'spotify:track:x', updatedAt: 1, data: { version: 1 } }],
      songcorrections: [],
    })).toBe(true)
  })

  it('rejects v2 without the doc arrays, and rejects bad doc rows', () => {
    expect(validateBackup({ ...canonical(), version: 2 })).toBe(false)
    expect(validateBackup({
      ...canonical(),
      version: 2,
      songmaps: [{ trackUri: '', updatedAt: 1, data: {} }], // empty uri
      songcorrections: [],
    })).toBe(false)
    expect(validateBackup({
      ...canonical(),
      version: 2,
      songmaps: [],
      songcorrections: [{ trackUri: 'spotify:track:x', updatedAt: 1, data: 'not-an-object' }],
    })).toBe(false)
  })

  it('rejects a missing attempts array', () => {
    const { attempts: _attempts, ...rest } = canonical()
    expect(validateBackup(rest)).toBe(false)
  })

  it('rejects a missing cells array', () => {
    const { cells: _cells, ...rest } = canonical()
    expect(validateBackup(rest)).toBe(false)
  })

  it('rejects attempts that is not an array', () => {
    expect(validateBackup({ ...canonical(), attempts: {} })).toBe(false)
  })

  it('rejects a non-object localStorage value', () => {
    expect(validateBackup({ ...canonical(), localStorage: null })).toBe(false)
    expect(validateBackup({ ...canonical(), localStorage: ['calliope:x'] })).toBe(false)
  })

  it('rejects localStorage entries whose values are not strings', () => {
    expect(validateBackup({ ...canonical(), localStorage: { 'calliope:x': 5 } })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(validateBackup(null)).toBe(false)
    expect(validateBackup(undefined)).toBe(false)
    expect(validateBackup('backup')).toBe(false)
    expect(validateBackup(42)).toBe(false)
  })

  it('rejects the whole file when a single attempt row is bad (no partial imports)', () => {
    const b = canonical()
    b.attempts.push({ ts: Number.NaN, drill: 'find', degree: 0, key: 0, correct: true, latencyMs: 100 })
    expect(validateBackup(b)).toBe(false)
  })

  it('rejects the whole file when a single cell row is bad (no partial imports)', () => {
    const b = canonical()
    b.cells.push({ cellKey: 'find:1:0', drill: 'find', degree: 1, key: 0, n: 1, ewmaAcc: 1.5, ewmaLatMs: 100, lastTs: 0 })
    expect(validateBackup(b)).toBe(false)
  })
})

describe('validAttemptRow', () => {
  const good = { ts: 1783717169136, drill: 'find', degree: 3, key: 7, correct: true, latencyMs: 500 }

  it('accepts a canonical row, with or without extra fields', () => {
    expect(validAttemptRow(good)).toBe(true)
    expect(validAttemptRow({ ...good, id: 12, detail: 'note' })).toBe(true)
  })

  it('rejects non-objects and missing fields', () => {
    expect(validAttemptRow(null)).toBe(false)
    expect(validAttemptRow('row')).toBe(false)
    const { ts: _ts, ...noTs } = good
    expect(validAttemptRow(noTs)).toBe(false)
    const { correct: _c, ...noCorrect } = good
    expect(validAttemptRow(noCorrect)).toBe(false)
  })

  it('rejects wrong types', () => {
    expect(validAttemptRow({ ...good, correct: 'yes' })).toBe(false)
    expect(validAttemptRow({ ...good, drill: 4 })).toBe(false)
    expect(validAttemptRow({ ...good, ts: '1783717169136' })).toBe(false)
  })

  it('rejects non-finite numbers', () => {
    expect(validAttemptRow({ ...good, ts: Number.NaN })).toBe(false)
    expect(validAttemptRow({ ...good, latencyMs: Infinity })).toBe(false)
  })

  it('rejects out-of-range or non-integer degree/key', () => {
    expect(validAttemptRow({ ...good, degree: 12 })).toBe(false)
    expect(validAttemptRow({ ...good, degree: -1 })).toBe(false)
    expect(validAttemptRow({ ...good, degree: 1.5 })).toBe(false)
    expect(validAttemptRow({ ...good, key: 12 })).toBe(false)
  })
})

describe('validCellRow', () => {
  const good = { cellKey: 'find:3:7', drill: 'find', degree: 3, key: 7, ewmaAcc: 0.59, ewmaLatMs: 1730, n: 4, lastTs: 1783717169136 }

  it('accepts a canonical row, with or without extra fields', () => {
    expect(validCellRow(good)).toBe(true)
    expect(validCellRow({ ...good, extra: 'ok' })).toBe(true)
  })

  it('accepts boundary ewmaAcc values 0 and 1', () => {
    expect(validCellRow({ ...good, ewmaAcc: 0 })).toBe(true)
    expect(validCellRow({ ...good, ewmaAcc: 1 })).toBe(true)
  })

  it('rejects non-objects and missing fields', () => {
    expect(validCellRow(null)).toBe(false)
    const { cellKey: _k, ...noKey } = good
    expect(validCellRow(noKey)).toBe(false)
  })

  it('rejects ewmaAcc outside 0..1 or non-finite', () => {
    expect(validCellRow({ ...good, ewmaAcc: 1.5 })).toBe(false)
    expect(validCellRow({ ...good, ewmaAcc: -0.1 })).toBe(false)
    expect(validCellRow({ ...good, ewmaAcc: Number.NaN })).toBe(false)
  })

  it('rejects negative or non-integer n and negative/non-finite ewmaLatMs/lastTs', () => {
    expect(validCellRow({ ...good, n: -1 })).toBe(false)
    expect(validCellRow({ ...good, n: 2.5 })).toBe(false)
    expect(validCellRow({ ...good, ewmaLatMs: -1 })).toBe(false)
    expect(validCellRow({ ...good, lastTs: Number.NaN })).toBe(false)
  })

  it('rejects out-of-range degree/key', () => {
    expect(validCellRow({ ...good, degree: 12 })).toBe(false)
    expect(validCellRow({ ...good, key: -1 })).toBe(false)
  })
})

/** Map-backed Storage fake (jsdom's localStorage is unreliable in this sandbox). */
function fakeStorage(initial: Record<string, string>): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  }
}

describe('restoreCalliopeKeys', () => {
  it('removes existing calliope:* keys absent from the backup (replace, not merge)', () => {
    const storage = fakeStorage({
      'calliope:app-prefs': 'stale',
      'calliope:orphan-pref': 'should not survive',
      'spotify:access_token': 'keep me',
    })
    restoreCalliopeKeys(storage, { 'calliope:app-prefs': 'restored' })
    expect(storage.dump()).toEqual({
      'calliope:app-prefs': 'restored',
      'spotify:access_token': 'keep me',
    })
  })

  it('leaves non-calliope keys untouched and never writes them from the backup', () => {
    const storage = fakeStorage({ 'spotify:refresh_token': 'secret' })
    restoreCalliopeKeys(storage, {
      'calliope:board-prefs': 'b',
      'spotify:access_token': 'smuggled', // hand-edited backup — must not be written
    })
    expect(storage.dump()).toEqual({
      'spotify:refresh_token': 'secret',
      'calliope:board-prefs': 'b',
    })
  })

  it('clears all calliope keys when the backup has none', () => {
    const storage = fakeStorage({ 'calliope:app-prefs': 'x', 'calliope:board-prefs': 'y', other: 'z' })
    restoreCalliopeKeys(storage, {})
    expect(storage.dump()).toEqual({ other: 'z' })
  })
})

describe('filterCalliopeKeys', () => {
  it('keeps only calliope:* keys', () => {
    const out = filterCalliopeKeys([
      ['calliope:app-prefs', 'a'],
      ['calliope:board-prefs', 'b'],
      ['spotify:access_token', 'secret'],
      ['unrelated-key', 'c'],
    ])
    expect(out).toEqual({ 'calliope:app-prefs': 'a', 'calliope:board-prefs': 'b' })
  })

  it('returns an empty object when nothing matches', () => {
    expect(filterCalliopeKeys([['spotify:x', '1']])).toEqual({})
  })

  it('handles an empty input', () => {
    expect(filterCalliopeKeys([])).toEqual({})
  })
})
