import { describe, expect, it } from 'vitest'
import { normalizePc, PC } from '../note'
import { QUALITIES, qualityById } from '../chord'
import { coordToPc } from '../fretboard-geometry'
import {
  curatedShapes, instantiateTemplate, MAX_SHAPE_FRET, OPEN_SHAPES,
  requiredDegrees, SHAPE_TEMPLATES, shapeFromFrets,
  type ChordShape, type ShapeTemplate,
} from '../chord-shapes'

function template(qualityId: string, rootString: number): ShapeTemplate {
  const t = SHAPE_TEMPLATES.find((x) => x.qualityId === qualityId && x.rootString === rootString)
  if (!t) throw new Error(`no template ${qualityId} on string ${rootString}`)
  return t
}

function checkShape(s: ChordShape, root: number, qualityId: string) {
  const q = qualityById(qualityId)
  const pcSet = new Set(q.intervals.map((i) => normalizePc(root + i)))
  const sounding: number[] = []
  for (let i = 0; i < 6; i++) if (s.frets[i] >= 0) sounding.push(i)
  expect(sounding.length).toBeGreaterThan(0)
  expect(sounding[0]).toBe(s.rootString)
  expect(coordToPc({ string: s.rootString, fret: s.frets[s.rootString] })).toBe(normalizePc(root))
  for (const str of sounding) {
    expect(s.frets[str]).toBeLessThanOrEqual(MAX_SHAPE_FRET)
    expect(pcSet.has(coordToPc({ string: str, fret: s.frets[str] }))).toBe(true)
  }
  const present = new Set(s.degrees)
  for (const d of requiredDegrees(q)) expect(present.has(d)).toBe(true)
}

describe('requiredDegrees', () => {
  it('pins the omittable degrees', () => {
    const sorted = (id: string) => [...requiredDegrees(qualityById(id))].sort((a, b) => a - b)
    expect(sorted('maj')).toEqual([0, 4, 7])
    expect(sorted('dom7')).toEqual([0, 4, 10]) // 5th omittable
    expect(sorted('13')).toEqual([0, 4, 9, 10]) // 5th and 9th omittable
    expect(sorted('dim')).toEqual([0, 3, 6]) // nothing omittable in a triad
    expect(sorted('5')).toEqual([0, 7])
    expect(sorted('dim7')).toEqual([0, 3, 6, 9]) // altered 5th never omittable
    expect(sorted('m7b5')).toEqual([0, 3, 6, 10])
    expect(sorted('min11')).toEqual([0, 3, 5, 10])
  })

  it('is always a subset of the quality intervals and keeps the root', () => {
    for (const q of QUALITIES) {
      const req = requiredDegrees(q)
      expect(req).toContain(0)
      for (const d of req) expect(q.intervals).toContain(d)
      if (q.intervals.length <= 3) expect(req).toEqual(q.intervals)
    }
  })
})

describe('shapeFromFrets', () => {
  it('computes derived fields for the open C grip', () => {
    const s = shapeFromFrets([-1, 3, 2, 0, 1, 0], PC.C, 'maj', 'open', 'curated')
    expect(s).not.toBeNull()
    expect(s!.rootString).toBe(1)
    expect(s!.baseFret).toBe(1)
    expect(s!.span).toBe(2)
    expect(s!.midis).toEqual([48, 52, 55, 60, 64])
    expect(s!.degrees).toEqual([0, 4, 7, 0, 4])
    expect(s!.omitted).toEqual([])
    expect(s!.barre).toBeUndefined()
  })

  it('rejects a non-chord tone', () => {
    // F on the high string is not in C major.
    expect(shapeFromFrets([-1, 3, 2, 0, 1, 1], PC.C, 'maj', 't', 'curated')).toBeNull()
  })

  it('rejects a shape whose lowest sounding string is not the root', () => {
    // Open low E under an otherwise fine C grip: shapes anchor on their root.
    expect(shapeFromFrets([0, 3, 2, 0, 1, 0], PC.C, 'maj', 't', 'curated')).toBeNull()
  })

  it('rejects a missing required degree', () => {
    // C and G only — no 3rd.
    expect(shapeFromFrets([-1, 3, -1, 0, 1, -1], PC.C, 'maj', 't', 'curated')).toBeNull()
  })

  it('rejects a fretted note above MAX_SHAPE_FRET', () => {
    expect(shapeFromFrets([-1, 14, 16, 16, 16, 14], PC.B, 'maj', 't', 'curated')).toBeNull()
  })

  it('auto-detects a barre when 3+ strings sit on the base fret', () => {
    const s = shapeFromFrets([5, 7, 7, 6, 5, 5], PC.A, 'maj', 't', 'generated')
    expect(s!.barre).toEqual({ fret: 5, fromString: 0, toString: 5 })
    // Only one string on the lowest fretted fret: no barre.
    const open = shapeFromFrets([0, 2, 2, 1, 0, 0], PC.E, 'maj', 't', 'generated')
    expect(open!.barre).toBeUndefined()
  })

  it('rejects a shape whose pitches do not climb — the root must be the true bass', () => {
    // "G7" at fret 10 with the open D and B ringing below the root: really G7/D.
    expect(shapeFromFrets([-1, 10, 0, 10, 0, -1], PC.G, 'dom7', 't', 'generated')).toBeNull()
  })

  it('never fabricates a barre across a ringing open string', () => {
    // Bb9 (no 5th), x-1-0-1-1-x: three strings on fret 1 but the open D sits inside the span.
    const s = shapeFromFrets([-1, 1, 0, 1, 1, -1], PC.As, 'dom9', 't', 'generated')
    expect(s).not.toBeNull()
    expect(s!.barre).toBeUndefined()
  })
})

describe('curated data validates numerically', () => {
  it('every open grip round-trips at its own root', () => {
    for (const o of OPEN_SHAPES) {
      const s = shapeFromFrets(o.frets, o.root, o.qualityId, o.label, 'curated')
      expect(s, `${o.qualityId} at pc ${o.root}: ${o.frets.join(',')}`).not.toBeNull()
      expect(s!.frets).toEqual(o.frets)
      expect(s!.source).toBe('curated')
      checkShape(s!, o.root, o.qualityId)
    }
  })

  it('every movable template plants cleanly at G, A and C', () => {
    for (const t of SHAPE_TEMPLATES) {
      for (const root of [PC.G, PC.A, PC.C]) {
        const shapes = instantiateTemplate(t, root)
        expect(shapes.length, `${t.label} ${t.qualityId} at pc ${root}`).toBeGreaterThan(0)
        for (const s of shapes) {
          checkShape(s, root, t.qualityId)
          expect(s.span).toBeLessThanOrEqual(4)
          expect(s.label).toBe(t.label)
        }
      }
    }
  })
})

describe('classic grips pin the template math', () => {
  it('E-shape major at F is the F barre chord, both octaves', () => {
    const frets = instantiateTemplate(template('maj', 0), PC.F).map((s) => s.frets)
    expect(frets).toContainEqual([1, 3, 3, 2, 1, 1])
    expect(frets).toContainEqual([13, 15, 15, 14, 13, 13])
  })

  it('F barre records the full barre at fret 1', () => {
    const f = instantiateTemplate(template('maj', 0), PC.F)
      .find((s) => s.baseFret === 1)
    expect(f!.barre).toEqual({ fret: 1, fromString: 0, toString: 5 })
  })

  it('A-shape major at B', () => {
    const frets = instantiateTemplate(template('maj', 1), PC.B).map((s) => s.frets)
    expect(frets).toEqual([[-1, 2, 4, 4, 4, 2]])
  })

  it('E-shape minor at G sits at fret 3', () => {
    const frets = instantiateTemplate(template('min', 0), PC.G).map((s) => s.frets)
    expect(frets).toContainEqual([3, 5, 5, 3, 3, 3])
  })

  it('the Hendrix grip lands on E7#9 as x,7,6,7,8,x', () => {
    const frets = instantiateTemplate(template('7#9', 1), PC.E).map((s) => s.frets)
    expect(frets).toContainEqual([-1, 7, 6, 7, 8, -1])
  })

  it('E-shape 13 omits exactly the 5th and the 9th', () => {
    const a13 = instantiateTemplate(template('13', 0), PC.A)
      .find((s) => s.baseFret === 5)
    expect(a13!.frets).toEqual([5, -1, 5, 6, 7, -1])
    expect([...a13!.omitted].sort((x, y) => x - y)).toEqual([2, 7])
  })
})

describe('curatedShapes', () => {
  it('collects open grip plus barre forms for C major', () => {
    const shapes = curatedShapes(PC.C, 'maj')
    const frets = shapes.map((s) => s.frets)
    expect(frets).toContainEqual([-1, 3, 2, 0, 1, 0])
    expect(frets).toContainEqual([-1, 3, 5, 5, 5, 3])
    expect(frets).toContainEqual([8, 10, 10, 9, 8, 8])
    for (const s of shapes) expect(s.source).toBe('curated')
  })

  it('dedupes the open E grip against the E-shape planted at fret 0', () => {
    const shapes = curatedShapes(PC.E, 'maj')
    const sigs = shapes.map((s) => s.frets.join(','))
    expect(new Set(sigs).size).toBe(sigs.length)
    expect(sigs.filter((x) => x === '0,2,2,1,0,0').length).toBe(1)
  })

  it('never returns shapes for a quality with no curated data', () => {
    expect(curatedShapes(PC.C, 'maj9')).toEqual([])
  })

  it('the late-added iconic grips instantiate: C7b9, G aug, open Am(maj7)', () => {
    expect(curatedShapes(PC.C, '7b9').map((s) => s.frets)).toContainEqual([-1, 3, 2, 3, 2, 3])
    expect(curatedShapes(PC.G, 'aug').map((s) => s.frets)).toContainEqual([3, -1, 5, 4, 4, -1])
    expect(curatedShapes(PC.A, 'minMaj7').map((s) => s.frets)).toContainEqual([-1, 0, 2, 1, 1, 0])
  })
})
