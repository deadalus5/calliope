import { describe, expect, it } from 'vitest'
import { nextPollDelay } from '../use-songmap-request'

/** The polling policy: working keeps a cadence, terminal states stop,
 * offline backs off under a visible banner. */
describe('nextPollDelay', () => {
  it('keeps the 2s cadence while working', () => {
    expect(nextPollDelay('working', 0)).toBe(2000)
  })

  it('stops on the states only a human can move forward', () => {
    expect(nextPollDelay('ready', 0)).toBeNull()
    expect(nextPollDelay('pick', 0)).toBeNull()
    expect(nextPollDelay('error', 0)).toBeNull()
  })

  it('backs off 5s → 10s → 30s (capped) while offline', () => {
    expect(nextPollDelay('offline', 0)).toBe(5000)
    expect(nextPollDelay('offline', 1)).toBe(10_000)
    expect(nextPollDelay('offline', 2)).toBe(30_000)
    expect(nextPollDelay('offline', 9)).toBe(30_000)
  })
})
