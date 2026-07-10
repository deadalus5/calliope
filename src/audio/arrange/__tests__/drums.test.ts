import { describe, expect, it } from 'vitest'
import { arrangeDrums } from '../drums'
import { mulberry32 } from '../rng'
import type { GrooveSpec } from '../types'

function makeGroove(overrides: Partial<GrooveSpec> = {}): GrooveSpec {
  return {
    id: 'test',
    pocket: { hat: 0, snare: 0, kick: 0, bass: 0, keys: 0 },
    hatVel: [0.85, 0.35, 0.6, 0.35, 0.75, 0.35, 0.6, 0.4],
    fillEveryBars: 4,
    ornaments: { ghostSnareP: 0.25, openHatP: 0.3, kickAndP: 0.2 },
    ...overrides,
  }
}

const BEATS_PER_BAR = 4

describe('arrangeDrums — determinism', () => {
  it('identical args produce a deep-equal result', () => {
    const g = makeGroove({ ridePhase: true })
    const a = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(42))
    const b = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('different seeds produce different arrangements', () => {
    const g = makeGroove()
    const a = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(1))
    const b = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(2))
    expect(a).not.toEqual(b)
  })
})

describe('arrangeDrums — fill placement (fillEveryBars 4, 16 bars, barOffset 0)', () => {
  const g = makeGroove({ fillEveryBars: 4 })

  function fillEventsInBar(events: ReturnType<typeof arrangeDrums>, bar: number) {
    const start = bar * BEATS_PER_BAR
    const end = start + BEATS_PER_BAR
    return events.filter((e) => e.fill && e.atBeat >= start && e.atBeat < end)
  }

  it('a fill is ALWAYS present in the last beat of form bars 7 and 15', () => {
    // Try many seeds — bars 7 and 15 must fire every time (forced-always).
    for (let seed = 0; seed < 25; seed++) {
      const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(seed))
      expect(fillEventsInBar(events, 7).length).toBeGreaterThan(0)
      expect(fillEventsInBar(events, 15).length).toBeGreaterThan(0)
    }
  })

  it('bars 3 and 11 are p-.5 candidates (fire on some seeds, not others)', () => {
    let anyFired3 = false
    let anySkipped3 = false
    for (let seed = 0; seed < 40; seed++) {
      const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(seed))
      if (fillEventsInBar(events, 3).length > 0) anyFired3 = true
      else anySkipped3 = true
    }
    expect(anyFired3).toBe(true)
    expect(anySkipped3).toBe(true)
  })

  it('no fills fire outside candidate bars (3, 7, 11, 15)', () => {
    for (let seed = 0; seed < 25; seed++) {
      const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(seed))
      for (const bar of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) {
        expect(fillEventsInBar(events, bar).length).toBe(0)
      }
    }
  })

  it('a crash lands at beat 0 of the bar after every fired fill', () => {
    for (let seed = 0; seed < 25; seed++) {
      const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(seed))
      for (let bar = 0; bar < 15; bar++) {
        const fired = fillEventsInBar(events, bar).length > 0
        const nextBarStart = (bar + 1) * BEATS_PER_BAR
        const crash = events.find((e) => e.art === 'crash' && e.atBeat === nextBarStart)
        if (fired) expect(crash).toBeDefined()
        else expect(crash).toBeUndefined()
      }
    }
  })
})

describe('arrangeDrums — ride phase', () => {
  // fillEveryBars: 0 isolates ride-phase behavior from fill-strip interaction
  // (a fired fill legitimately removes the last-beat hat-pedal — covered
  // separately by the fill-placement tests).
  const g = makeGroove({ ridePhase: true, fillEveryBars: 0 })

  it('bars 8-15 use ride instead of hat-closed and include hat-pedal on beats 1 and 3', () => {
    const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(7))
    for (let bar = 8; bar <= 15; bar++) {
      const start = bar * BEATS_PER_BAR
      const barEvents = events.filter((e) => e.atBeat >= start && e.atBeat < start + BEATS_PER_BAR)
      expect(barEvents.some((e) => e.art === 'hat-closed')).toBe(false)
      const pedals = barEvents.filter((e) => e.art === 'hat-pedal')
      const pedalBeats = pedals.map((e) => e.atBeat - start).sort()
      expect(pedalBeats).toEqual([1, 3])
      for (const p of pedals) expect(p.vel).toBe(0.5)
    }
  })

  it('bars 0-7 use hat-closed, not ride', () => {
    const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(7))
    for (let bar = 0; bar < 8; bar++) {
      const start = bar * BEATS_PER_BAR
      const barEvents = events.filter((e) => e.atBeat >= start && e.atBeat < start + BEATS_PER_BAR)
      expect(barEvents.some((e) => e.art === 'ride')).toBe(false)
    }
  })
})

describe('arrangeDrums — halftime', () => {
  const g = makeGroove({ halftime: true, fillEveryBars: 0 })

  it('snare only at beat 2, kick only at beat 0 (plus kickAndP extras at 2.5)', () => {
    const events = arrangeDrums(8, g, BEATS_PER_BAR, mulberry32(3))
    for (let bar = 0; bar < 8; bar++) {
      const start = bar * BEATS_PER_BAR
      const barEvents = events.filter((e) => e.atBeat >= start && e.atBeat < start + BEATS_PER_BAR)
      const snares = barEvents.filter((e) => e.art === 'snare')
      for (const s of snares) expect(s.atBeat - start).toBe(2)
      const kicks = barEvents.filter((e) => e.art === 'kick')
      for (const k of kicks) expect([0, 2.5]).toContain(k.atBeat - start)
    }
  })
})

describe('arrangeDrums — ghost snares', () => {
  const g = makeGroove({ ornaments: { ghostSnareP: 0.9, openHatP: 0, kickAndP: 0 }, fillEveryBars: 0 })

  it('ghost snares only land at x.75 offsets with vel .22', () => {
    const events = arrangeDrums(8, g, BEATS_PER_BAR, mulberry32(11))
    const ghosts = events.filter((e) => e.art === 'snare' && e.vel === 0.22)
    expect(ghosts.length).toBeGreaterThan(0)
    for (const gh of ghosts) {
      const offset = gh.atBeat % BEATS_PER_BAR
      expect([1.75, 3.75]).toContain(offset)
    }
  })
})

describe('arrangeDrums — open hat', () => {
  it('fires only at beat 3.5 on formBar % 4 === 3, never during a ride phase', () => {
    const g = makeGroove({
      ridePhase: true,
      fillEveryBars: 0,
      ornaments: { ghostSnareP: 0, openHatP: 1, kickAndP: 0 },
    })
    const events = arrangeDrums(16, g, BEATS_PER_BAR, mulberry32(5))
    const opens = events.filter((e) => e.art === 'hat-open')
    for (const o of opens) {
      const bar = Math.floor(o.atBeat / BEATS_PER_BAR)
      expect(bar % 4).toBe(3)
      expect(o.atBeat - bar * BEATS_PER_BAR).toBe(3.5)
      expect(bar % 16).toBeLessThan(8) // never during the ride-phase half (bars 8-15)
    }
    expect(opens.length).toBeGreaterThan(0)
  })
})

describe('arrangeDrums — barOffset continuity', () => {
  it('arrangeDrums(4, g, 4, rng, 4) makes fill decisions as form bars 4-7 (bar 7 candidate rule fires)', () => {
    const g = makeGroove({ fillEveryBars: 4 })
    let fired = false
    for (let seed = 0; seed < 25; seed++) {
      const events = arrangeDrums(4, g, BEATS_PER_BAR, mulberry32(seed), 4)
      // Local bar 3 corresponds to form bar 7 -> forced-always fill.
      const localBar3Start = 3 * BEATS_PER_BAR
      const fillsInBar3 = events.filter(
        (e) => e.fill && e.atBeat >= localBar3Start && e.atBeat < localBar3Start + BEATS_PER_BAR,
      )
      expect(fillsInBar3.length).toBeGreaterThan(0)
      fired = true
    }
    expect(fired).toBe(true)
  })

  it('without barOffset, the same 4-bar call places no forced fill at local bar 3', () => {
    const g = makeGroove({ fillEveryBars: 4 })
    // formBar 3 (no offset) is a p-.5 candidate, not forced-always -- so across
    // many seeds some runs must have NO fill in local bar 3.
    let anySkipped = false
    for (let seed = 0; seed < 40; seed++) {
      const events = arrangeDrums(4, g, BEATS_PER_BAR, mulberry32(seed), 0)
      const localBar3Start = 3 * BEATS_PER_BAR
      const fillsInBar3 = events.filter(
        (e) => e.fill && e.atBeat >= localBar3Start && e.atBeat < localBar3Start + BEATS_PER_BAR,
      )
      if (fillsInBar3.length === 0) anySkipped = true
    }
    expect(anySkipped).toBe(true)
  })
})

describe('arrangeDrums — short-form rule', () => {
  it('bars=2, fillEveryBars=8 -> only the last local bar is the fill candidate', () => {
    const g = makeGroove({ fillEveryBars: 8 })
    for (let seed = 0; seed < 25; seed++) {
      const events = arrangeDrums(2, g, BEATS_PER_BAR, mulberry32(seed))
      const bar0Fills = events.filter((e) => e.fill && e.atBeat < BEATS_PER_BAR)
      expect(bar0Fills.length).toBe(0)
    }
    // And across seeds, bar 1 (the candidate) must fire at least sometimes.
    let anyFired = false
    for (let seed = 0; seed < 25; seed++) {
      const events = arrangeDrums(2, g, BEATS_PER_BAR, mulberry32(seed))
      const bar1Fills = events.filter((e) => e.fill && e.atBeat >= BEATS_PER_BAR)
      if (bar1Fills.length > 0) anyFired = true
    }
    expect(anyFired).toBe(true)
  })
})

describe('arrangeDrums — non-4/4 guard', () => {
  it('beatsPerBar 3 emits timekeeping only: no event at/after local beat 3, no fill/ornament arts', () => {
    const g = makeGroove({ fillEveryBars: 4, ridePhase: true })
    const events = arrangeDrums(4, g, 3, mulberry32(9))
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      const bar = Math.floor(e.atBeat / 3)
      const localBeat = e.atBeat - bar * 3
      expect(localBeat).toBeLessThan(3)
      expect(e.fill).toBeUndefined()
      expect(['hat-closed', 'kick', 'snare']).toContain(e.art)
    }
  })

  it('does not throw for an unusual beatsPerBar', () => {
    const g = makeGroove()
    expect(() => arrangeDrums(3, g, 5, mulberry32(1))).not.toThrow()
    expect(() => arrangeDrums(3, g, 1, mulberry32(1))).not.toThrow()
  })
})
