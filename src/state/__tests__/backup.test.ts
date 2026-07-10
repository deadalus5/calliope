import { describe, expect, it } from 'vitest'
import { filterCalliopeKeys, validateBackup, type BackupFile } from '../backup'

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

  it('rejects the wrong version', () => {
    expect(validateBackup({ ...canonical(), version: 2 })).toBe(false)
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
