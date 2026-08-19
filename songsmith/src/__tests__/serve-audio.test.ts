import { describe, expect, it } from 'vitest'
import { parseRange, quantizeRate, rateFileName } from '../serve-audio'

describe('quantizeRate', () => {
  it('quantizes to two decimals within the render range', () => {
    expect(quantizeRate('0.714')).toBe(0.71)
    expect(quantizeRate(undefined)).toBe(1)
    expect(quantizeRate('1')).toBe(1)
    expect(quantizeRate('0.4')).toBeNull()
    expect(quantizeRate('1.3')).toBeNull()
    expect(quantizeRate('nope')).toBeNull()
  })

  it('names rate files stably', () => {
    expect(rateFileName(1)).toBe('audio.m4a')
    expect(rateFileName(0.7)).toBe('audio.r0.70.m4a')
  })
})

describe('parseRange', () => {
  const size = 1000

  it('parses open-ended, bounded, and suffix ranges', () => {
    expect(parseRange('bytes=0-499', size)).toEqual({ start: 0, end: 499 })
    expect(parseRange('bytes=500-', size)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-200', size)).toEqual({ start: 800, end: 999 })
    expect(parseRange('bytes=0-2000', size)).toEqual({ start: 0, end: 999 })
  })

  it('null without a header, invalid on nonsense', () => {
    expect(parseRange(undefined, size)).toBeNull()
    expect(parseRange('bytes=-', size)).toBe('invalid')
    expect(parseRange('bytes=1000-', size)).toBe('invalid')
    expect(parseRange('bytes=9-3', size)).toBe('invalid')
    expect(parseRange('lines=0-5', size)).toBe('invalid')
  })
})
