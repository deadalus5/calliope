import { describe, expect, it } from 'vitest'
import { PC, pcName } from '../note'
import { QUALITIES, chordPcs } from '../chord'
import { identifyNotes } from '../chord-name'

describe('empty and single notes', () => {
  it('empty set is kind empty with no candidates', () => {
    const id = identifyNotes([], undefined)
    expect(id.kind).toBe('empty')
    expect(id.candidates).toEqual([])
  })

  it('one note names itself, spelled in its own key', () => {
    expect(identifyNotes([PC.G]).kind).toBe('note')
    expect(identifyNotes([PC.G]).noteName).toBe('G')
    expect(identifyNotes([10]).noteName).toBe('Bb')
    expect(identifyNotes([6]).noteName).toBe('F#')
  })

  it('duplicates and unnormalized pcs collapse to one note', () => {
    const id = identifyNotes([12, 0, 24])
    expect(id.kind).toBe('note')
    expect(id.noteName).toBe('C')
  })
})

describe('two notes: interval, plus the power chord', () => {
  it('G+D is a perfect fifth and an exact G5', () => {
    const id = identifyNotes([PC.G, PC.D], PC.G)
    expect(id.kind).toBe('interval')
    expect(id.intervalLabel).toMatch(/fifth/)
    expect(id.candidates[0].symbol).toBe('G5')
    expect(id.candidates[0].exact).toBe(true)
  })

  it('a bare major third stays an interval with no candidates', () => {
    const id = identifyNotes([PC.G, PC.B], PC.G)
    expect(id.kind).toBe('interval')
    expect(id.intervalLabel).toMatch(/major third/)
    expect(id.candidates).toEqual([])
  })

  it('a minor third labels with the degree vocabulary', () => {
    const id = identifyNotes([PC.A, PC.C], PC.A)
    expect(id.intervalLabel).toMatch(/minor third/)
    expect(id.intervalLabel).toMatch(/b3/)
  })

  it('a perfect fourth reads as the inverted power chord', () => {
    const id = identifyNotes([PC.C, PC.F], PC.C)
    expect(id.kind).toBe('interval')
    expect(id.intervalLabel).toMatch(/fourth/)
    expect(id.candidates.map((c) => c.symbol)).toEqual(['F5/C'])
  })
})

describe('pinned chord readings (the acceptance flow)', () => {
  it('G D A over G is Gsus2, with Dsus4/G offered', () => {
    const id = identifyNotes([PC.G, PC.D, PC.A], PC.G)
    expect(id.kind).toBe('chord')
    expect(id.candidates[0].symbol).toBe('Gsus2')
    expect(id.candidates[0].exact).toBe(true)
    const dsus = id.candidates.find((c) => c.symbol === 'Dsus4/G')
    expect(dsus).toBeDefined()
    expect(dsus?.exact).toBe(true)
  })

  it('C triad over E is C/E', () => {
    const id = identifyNotes([PC.C, PC.E, PC.G], PC.E)
    expect(id.candidates[0].symbol).toBe('C/E')
  })

  it('A C E G is Am7 over A but C6 over C', () => {
    expect(identifyNotes([PC.A, PC.C, PC.E, PC.G], PC.A).candidates[0].symbol).toBe('Am7')
    expect(identifyNotes([PC.A, PC.C, PC.E, PC.G], PC.C).candidates[0].symbol).toBe('C6')
  })

  it('A C E G over an E bass reads as the inversion, not the 6-chord', () => {
    // Deliberate tie-break: same pitch set, neither root in the bass —
    // min7's earlier QUALITIES rank wins, so Am7/E edges out C6/E.
    const syms = identifyNotes([PC.A, PC.C, PC.E, PC.G], PC.E).candidates.slice(0, 2).map((c) => c.symbol)
    expect(syms).toEqual(['Am7/E', 'C6/E'])
  })

  it('C E G B is Cmaj7', () => {
    const top = identifyNotes([PC.C, PC.E, PC.G, PC.B], PC.C).candidates[0]
    expect(top.symbol).toBe('Cmaj7')
    expect(top.exact).toBe(true)
    expect(top.additions).toEqual([])
    expect(top.omissions).toEqual([])
  })

  it('B D F G# is Bdim7 first, with other dim7 roots as alternates', () => {
    const id = identifyNotes([PC.B, PC.D, PC.F, PC.Gs], PC.B)
    expect(id.candidates[0].symbol).toBe('Bdim7')
    const dim7s = id.candidates.filter((c) => c.chord.quality.id === 'dim7')
    expect(dim7s.length).toBeGreaterThanOrEqual(2)
  })

  it('C E F# B is Cmaj7(#11): 5th dropped, #11 added', () => {
    const top = identifyNotes([PC.C, PC.E, PC.Fs, PC.B], PC.C).candidates[0]
    expect(top.symbol).toBe('Cmaj7(#11)')
    expect(top.additions).toEqual([6])
    expect(top.omissions).toEqual([7])
    expect(top.exact).toBe(false)
  })

  it('C D E G is Cadd9', () => {
    expect(identifyNotes([PC.C, PC.D, PC.E, PC.G], PC.C).candidates[0].symbol).toBe('Cadd9')
  })

  it('all six notes of G13 name as G13', () => {
    const id = identifyNotes([PC.G, PC.B, PC.D, PC.F, PC.A, PC.E], PC.G)
    expect(id.candidates[0].symbol).toBe('G13')
    expect(id.candidates[0].exact).toBe(true)
  })

  it('E G# B D F# is E9', () => {
    expect(identifyNotes([PC.E, PC.Gs, PC.B, PC.D, PC.Fs], PC.E).candidates[0].symbol).toBe('E9')
  })

  it('Bb D F spells flat', () => {
    const top = identifyNotes([10, 2, 5], 10).candidates[0]
    expect(top.symbol).toBe('Bb')
    expect(top.chord.root).toBe(10)
  })
})

describe('input hygiene and list contract', () => {
  it('a bass not in the set falls back to the first pc', () => {
    const id = identifyNotes([PC.C, PC.E, PC.G], PC.D)
    expect(id.candidates[0].symbol).toBe('C')
  })

  it('bass defaults to the first pc', () => {
    expect(identifyNotes([PC.A, PC.A, PC.C, PC.E]).candidates[0].symbol).toBe('Am')
  })

  it('a chromatic cluster is still kind chord, just with no candidates', () => {
    const id = identifyNotes([0, 1, 2], 0)
    expect(id.kind).toBe('chord')
    expect(id.candidates).toEqual([])
  })

  it('candidates are capped at 8 and sorted by descending score', () => {
    for (const pcs of [
      [PC.G, PC.B, PC.D, PC.F, PC.A, PC.E],
      [PC.C, PC.D, PC.E, PC.F, PC.G, PC.A],
      [PC.A, PC.C, PC.E, PC.G],
    ]) {
      const id = identifyNotes(pcs, pcs[0])
      expect(id.candidates.length).toBeGreaterThanOrEqual(1)
      expect(id.candidates.length).toBeLessThanOrEqual(8)
      for (let i = 1; i < id.candidates.length; i++) {
        expect(id.candidates[i].score).toBeLessThanOrEqual(id.candidates[i - 1].score)
      }
    }
  })
})

// Qualities whose pc sets are rotations of another quality: dim7/aug are
// symmetric, 6<->m7 and m6<->m7b5 share pcs, sus4 rotates into sus2.
const AMBIGUOUS = new Set(['dim7', 'aug', '6', 'min7', 'm6', 'm7b5', 'sus4', 'sus2'])
const ROOTS = [PC.C, PC.E, PC.Fs, PC.A, PC.As]

describe('property: every quality names itself from its own pcs', () => {
  it('ranks the generating quality first (top 3 for the rotations)', () => {
    for (const q of QUALITIES) {
      for (const root of ROOTS) {
        const id = identifyNotes(chordPcs({ root, quality: q }), root)
        expect(id.kind).toBe(q.intervals.length === 2 ? 'interval' : 'chord')
        const expected = `${pcName(root, root)}${q.suffix}`
        if (AMBIGUOUS.has(q.id)) {
          expect(id.candidates.slice(0, 3).map((c) => c.symbol)).toContain(expected)
        } else {
          expect(id.candidates[0].symbol).toBe(expected)
          expect(id.candidates[0].chord.root).toBe(root)
          expect(id.candidates[0].exact).toBe(true)
        }
      }
    }
  })
})
