import { describe, expect, it } from 'vitest'
import {
  ctxTimeOfSongMs, fileSecOf, filePosAt, foldFilePos, rateForBpm, songMsOf,
} from '../deck-math'

describe('rate mapping (pre-stretched files play at node rate 1)', () => {
  it('round-trips song ms ↔ file seconds at any rate', () => {
    for (const rate of [0.5, 0.7, 0.85, 1, 1.25]) {
      expect(songMsOf(fileSecOf(24_000, rate), rate)).toBeCloseTo(24_000, 6)
    }
    // A 0.5× file is twice as long: the same song moment sits twice as deep.
    expect(fileSecOf(10_000, 0.5)).toBe(20)
    expect(fileSecOf(10_000, 1)).toBe(10)
  })

  it('rateForBpm quantizes to two decimals and clamps to the render range', () => {
    expect(rateForBpm(70, 98)).toBe(0.71)
    expect(rateForBpm(98, 98)).toBe(1)
    expect(rateForBpm(10, 98)).toBe(0.5)
    expect(rateForBpm(300, 98)).toBe(1.25)
    expect(rateForBpm(60, 0)).toBe(1)
  })
})

describe('anchors and loop folding', () => {
  const anchor = { ctxT0: 100, fileSec0: 30 }

  it('file position advances one second per ctx second', () => {
    expect(filePosAt(anchor, 100)).toBe(30)
    expect(filePosAt(anchor, 107.5)).toBe(37.5)
  })

  it('folds past the loop end, sample-accurate wrap semantics', () => {
    const loop = { startFile: 20, endFile: 40 }
    expect(foldFilePos(35, loop)).toBe(35)     // inside
    expect(foldFilePos(41, loop)).toBe(21)     // one past
    expect(foldFilePos(85, loop)).toBe(25)     // several passes
    expect(foldFilePos(35, null)).toBe(35)
  })

  it('ctxTimeOf returns the NEXT occurrence under a loop', () => {
    const rate = 1
    const loop = { startFile: 20, endFile: 40 } // song [20000, 40000)
    // Playhead currently at file 35 (ctxNow 105).
    const now = 105
    // A target ahead in this pass: 38000ms → +3s.
    expect(ctxTimeOfSongMs(anchor, now, 38_000, rate, loop)).toBeCloseTo(108)
    // A target just passed: 25000ms → comes around next pass (+10s).
    expect(ctxTimeOfSongMs(anchor, now, 25_000, rate, loop)).toBeCloseTo(115)
    // No loop: past targets are simply in the past.
    expect(ctxTimeOfSongMs(anchor, now, 25_000, rate, null)).toBeCloseTo(95)
  })

  it('scales with pre-stretched rates', () => {
    // rate 0.5: song 10000ms sits at file 20s. Anchor at file 15 (ctx 100).
    const a = { ctxT0: 100, fileSec0: 15 }
    expect(ctxTimeOfSongMs(a, 100, 10_000, 0.5, null)).toBeCloseTo(105)
  })
})
