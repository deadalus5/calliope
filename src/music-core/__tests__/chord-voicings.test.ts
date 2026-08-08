import { describe, expect, it } from 'vitest'
import { normalizePc, PC } from '../note'
import { QUALITIES, qualityById } from '../chord'
import { coordToPc } from '../fretboard-geometry'
import {
  instantiateTemplate, MAX_SHAPE_FRET, requiredDegrees, type ChordShape,
} from '../chord-shapes'
import { findVoicings, generateVoicings, shapeDifficulty, templatesFor } from '../chord-voicings'

function checkShape(s: ChordShape, root: number, qualityId: string) {
  const q = qualityById(qualityId)
  const pcSet = new Set(q.intervals.map((i) => normalizePc(root + i)))
  const sounding: number[] = []
  for (let i = 0; i < 6; i++) if (s.frets[i] >= 0) sounding.push(i)
  expect(sounding[0]).toBe(s.rootString)
  expect(coordToPc({ string: s.rootString, fret: s.frets[s.rootString] })).toBe(normalizePc(root))
  for (const str of sounding) {
    expect(s.frets[str]).toBeLessThanOrEqual(MAX_SHAPE_FRET)
    expect(pcSet.has(coordToPc({ string: str, fret: s.frets[str] }))).toBe(true)
  }
  const present = new Set(s.degrees)
  for (const d of requiredDegrees(q)) expect(present.has(d)).toBe(true)
  expect(s.span).toBeLessThanOrEqual(4)
  let innerMutes = 0
  for (let i = sounding[0] + 1; i < sounding[sounding.length - 1]; i++) {
    if (s.frets[i] === -1) innerMutes++
  }
  expect(innerMutes).toBeLessThanOrEqual(1)
}

describe('findVoicings ranking pins the grips a guitarist grabs first', () => {
  it('C major: the open C grip', () => {
    expect(findVoicings({ root: PC.C, qualityId: 'maj' })[0].frets).toEqual([-1, 3, 2, 0, 1, 0])
  })

  it('F major from the low E string: the F barre chord', () => {
    expect(findVoicings({ root: PC.F, qualityId: 'maj', rootString: 0 })[0].frets)
      .toEqual([1, 3, 3, 2, 1, 1])
  })

  it('B minor: the A-shape barre at fret 2', () => {
    expect(findVoicings({ root: PC.B, qualityId: 'min' })[0].frets)
      .toEqual([-1, 2, 4, 4, 3, 2])
  })

  it('G7: the open grip', () => {
    expect(findVoicings({ root: PC.G, qualityId: 'dom7' })[0].frets)
      .toEqual([3, 2, 0, 0, 0, 1])
  })

  it('D major from the D string: the open D grip', () => {
    expect(findVoicings({ root: PC.D, qualityId: 'maj', rootString: 2 })[0].frets)
      .toEqual([-1, -1, 0, 2, 3, 2])
  })
})

describe('nearFret pulls the ranking up the neck', () => {
  it('F major near fret 13 anchors at 13, not 1', () => {
    const first = findVoicings({ root: PC.F, qualityId: 'maj', rootString: 0, nearFret: 13 })[0]
    expect(first.frets[0]).toBe(13)
  })
})

describe('coverage: every quality voices at every root', () => {
  it('returns valid, deduped shapes for all 27 qualities across 5 roots', () => {
    for (const q of QUALITIES) {
      for (const root of [PC.C, PC.E, PC.G, PC.A, PC.As]) {
        const shapes = findVoicings({ root, qualityId: q.id })
        expect(shapes.length, `${q.id} at pc ${root}`).toBeGreaterThan(0)
        const sigs = new Set<string>()
        for (const s of shapes) {
          checkShape(s, root, q.id)
          const sig = s.frets.join(',')
          expect(sigs.has(sig)).toBe(false)
          sigs.add(sig)
        }
      }
    }
  })

  it('rootString narrows results to shapes anchored on that string', () => {
    for (const rs of [0, 1, 2]) {
      const shapes = findVoicings({ root: PC.G, qualityId: 'min7', rootString: rs })
      expect(shapes.length).toBeGreaterThan(0)
      for (const s of shapes) expect(s.rootString).toBe(rs)
    }
  })
})

describe('generateVoicings', () => {
  it('keeps the result count sane for the UI', () => {
    for (const q of QUALITIES) {
      expect(generateVoicings(PC.C, q.id).length, q.id).toBeLessThan(400)
    }
  })

  it('memoizes: repeat queries return the same array', () => {
    expect(generateVoicings(PC.E, 'min7')).toBe(generateVoicings(PC.E, 'min7'))
  })

  it('power chords may use only two strings, triads may not', () => {
    for (const s of generateVoicings(PC.G, 'maj')) {
      expect(s.frets.filter((f) => f >= 0).length).toBeGreaterThanOrEqual(3)
    }
    const five = generateVoicings(PC.G, '5')
    expect(five.some((s) => s.frets.filter((f) => f >= 0).length === 2)).toBe(true)
  })
})

describe('shapeDifficulty', () => {
  it('open grips beat barre grips on the same chord', () => {
    const [openC] = findVoicings({ root: PC.C, qualityId: 'maj' })
    const barreC = findVoicings({ root: PC.C, qualityId: 'maj' })
      .find((s) => s.frets.join(',') === '-1,3,5,5,5,3')
    expect(shapeDifficulty(openC)).toBeLessThan(shapeDifficulty(barreC!))
  })
})

describe('templatesFor powers the flavor-first browse', () => {
  it('maj7 includes the curated E-shape and A-shape', () => {
    const ts = templatesFor('maj7')
    expect(ts.some((t) => t.label === 'E-shape' && t.rootString === 0)).toBe(true)
    expect(ts.some((t) => t.label === 'A-shape' && t.rootString === 1)).toBe(true)
  })

  it('template-less qualities still get derived movable forms', () => {
    for (const id of ['aug', 'min11', 'madd9', 'maj9']) {
      const ts = templatesFor(id)
      expect(ts.length, id).toBeGreaterThan(0)
      for (const t of ts) expect(t.rootString).toBeLessThanOrEqual(2)
    }
  })

  it('caps at 8 and every template plants as a valid shape', () => {
    for (const q of QUALITIES) {
      const ts = templatesFor(q.id)
      expect(ts.length).toBeLessThanOrEqual(8)
      for (const t of ts) {
        const shapes = instantiateTemplate(t, PC.C)
        expect(shapes.length, `${q.id} ${t.label}`).toBeGreaterThan(0)
        for (const s of shapes) expect(s.qualityId).toBe(q.id)
      }
    }
  })
})
