/**
 * Guide-tone target selection for the Song Lab drill (pure — split from
 * use-guide-tone-drill.ts so it can be unit-tested without dragging the
 * hook's audio/pitch imports into the test env).
 *
 * A chord's guide tones are its 3rd and 7th — the notes that name the
 * change. The drill alternates which one it asks for; when the upcoming
 * chord doesn't have the preferred tone it falls back gracefully:
 * no 7th -> the 3rd; a sus chord (no 3rd at all) -> its sus tone; and a
 * chord with none of those (e.g. a power chord) -> no target this turn.
 */

const THIRDS = new Set([3, 4])
const SEVENTHS = new Set([10, 11])
const SUS = new Set([2, 5])

export interface PickedTarget {
  /** Semitones above the chord root. */
  interval: number
  label: '3rd' | '7th' | 'sus2' | 'sus4'
}

export function pickTargetInterval(intervals: number[], preferSeventh: boolean): PickedTarget | null {
  const third = intervals.find((i) => THIRDS.has(i))
  const seventh = intervals.find((i) => SEVENTHS.has(i))
  const sus = intervals.find((i) => SUS.has(i))
  const order = preferSeventh ? [seventh, third, sus] : [third, sus, seventh]
  for (const interval of order) {
    if (interval === undefined) continue
    const label = SEVENTHS.has(interval) ? '7th' : THIRDS.has(interval) ? '3rd' : interval === 2 ? 'sus2' : 'sus4'
    return { interval, label }
  }
  return null
}
