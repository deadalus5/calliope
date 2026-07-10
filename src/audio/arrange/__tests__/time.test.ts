import { describe, expect, it } from 'vitest'
import { beatToTime } from '../time'

describe('beatToTime', () => {
  it('pins the brief\'s worked examples for 4/4', () => {
    expect(beatToTime(0, 4)).toBe('0:0:0')
    expect(beatToTime(3.5, 4)).toBe('0:3:2')
    expect(beatToTime(4.75, 4)).toBe('1:0:3')
    expect(beatToTime(13.25, 4)).toBe('3:1:1')
  })

  it('works for a non-4/4 beatsPerBar', () => {
    expect(beatToTime(0, 3)).toBe('0:0:0')
    expect(beatToTime(2.5, 3)).toBe('0:2:2')
    expect(beatToTime(3, 3)).toBe('1:0:0')
    expect(beatToTime(7.25, 3)).toBe('2:1:1')
  })

  it('rolls bar over exactly at the boundary', () => {
    expect(beatToTime(4, 4)).toBe('1:0:0')
    expect(beatToTime(8, 4)).toBe('2:0:0')
  })

  it('handles beats deep into multi-pass offsets (e.g. pass 3 of a 12-bar form)', () => {
    // pass 3 offset = 3 * 12 bars * 4 beats/bar = 144 beats
    expect(beatToTime(144, 4)).toBe('36:0:0')
    expect(beatToTime(144 + 3.5, 4)).toBe('36:3:2')
  })
})
