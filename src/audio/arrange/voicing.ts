import { normalizePc, type Chord } from '../../music-core'

/**
 * Voice-leading comping voicing engine. Pure function of (chord, prev,
 * register) — no Tone, no DOM, no rng (voicing choice is deterministic;
 * only the arranger that calls it is seeded). Replaces the old
 * `pianoVoicing` in sequencer.ts, which always rebuilt from a fixed floor
 * (MIDI 58) with no memory of the previous chord, and truncated to 4 notes
 * by dropping the root — losing 9ths/11ths/13ths on extended qualities.
 *
 * Every chord tone offset here is relative to `chord.root` (never
 * `chord.bass`): for keys, slash-chord basses are ignored entirely — the
 * bass player owns them (see Task 5's bass.ts and its report for why this
 * matters: intervals are defined relative to the chord's root in
 * music-core, so anchoring on the bass would re-derive the wrong pcs for
 * e.g. D/C, whose intervals [0,4,7,11] land on D-F#-A-C#, not reinterpreted
 * around the C bass).
 */

export const KEYS_REGISTER: [number, number] = [48, 69] // C3-A4

// Extension-ish scale-degree offsets a chord's intervals can legitimately
// contain beyond the third/seventh/fifth shell: b9, 9, #9(as a bare "3"
// alongside a major third), 11(as a bare "5" alongside the true fifth "7"),
// #5/b13, and 13-or-6 (as a bare "9" once the seventh slot is filled).
const EXTENSION_DEGREES = new Set([1, 2, 3, 5, 8, 9])

// The only two qualities where the brief's "you may add ... the natural 9"
// filler license is exercised here. 'maj' (the plain triad) is deliberately
// EXCLUDED — see the report for why (gravity's C/G subset test).
const NATURAL_NINE_BUCKET = new Set(['dom7', 'min7'])

interface ShellColors {
  required: number[]
  colors: number[]
}

/**
 * The shell (third/sus-tone + seventh, or third+fifth for triads/6-chords)
 * plus 1-2 color voices — extensions actually present in the quality, or a
 * sensible filler (the fifth, or root) when none are present.
 */
function analyzeChordQuality(chord: Chord): ShellColors {
  const intervals = chord.quality.intervals
  const has = (n: number): boolean => intervals.includes(n)
  const used = new Set<number>()
  const required: number[] = []

  const hasThird = has(3) || has(4)
  const seventh = has(11) ? 11 : has(10) ? 10 : null
  const pickFifth = (): number => (has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 7)

  if (hasThird) {
    const third = has(4) ? 4 : 3 // prefer the major third: only 7#9 has both.
    required.push(third)
    used.add(third)
  } else {
    // Sus chords replace the third with the sus tone (prefer sus4's 5 over
    // sus2's 2, matching the quality's own name when both are present, as
    // in 9sus4). No sus tone at all means a bare power chord.
    const susTone = has(5) ? 5 : has(2) ? 2 : null
    if (susTone !== null) {
      required.push(susTone)
      used.add(susTone)
    }
  }

  if (seventh !== null) {
    required.push(seventh)
    used.add(seventh)
  } else {
    const fifth = pickFifth()
    required.push(fifth)
    used.add(fifth)
  }

  let colors = intervals
    .filter((i) => i !== 0 && !used.has(i) && EXTENSION_DEGREES.has(i))
    .slice(0, 2)

  if (colors.length === 0) {
    if (NATURAL_NINE_BUCKET.has(chord.quality.id)) {
      colors = [2]
    } else {
      const fifthCandidate = [7, 6, 8].find((f) => has(f) && !used.has(f))
      colors = [fifthCandidate !== undefined ? fifthCandidate : 0]
    }
  }

  return { required, colors }
}

/** All MIDI values within [lo,hi] sharing pc's pitch class, ascending. */
function candidatesForPc(pc: number, lo: number, hi: number): number[] {
  const out: number[] = []
  let m = lo + ((((pc - lo) % 12) + 12) % 12)
  while (m <= hi) {
    out.push(m)
    m += 12
  }
  return out
}

/** Every distinct-MIDI, in-register placement of targetPcs (one octave choice per entry). */
function enumeratePlacements(targetPcs: number[], register: [number, number]): number[][] {
  const [lo, hi] = register
  const perIndex = targetPcs.map((pc) => candidatesForPc(pc, lo, hi))
  const results: number[][] = []
  const seen = new Set<string>()
  const rec = (i: number, acc: number[]): void => {
    if (i === perIndex.length) {
      const sorted = [...acc].sort((a, b) => a - b)
      if (new Set(sorted).size !== sorted.length) return // a doubled pc landed on the same octave twice
      const key = sorted.join(',')
      if (seen.has(key)) return
      seen.add(key)
      results.push(sorted)
      return
    }
    for (const m of perIndex[i]) rec(i + 1, [...acc, m])
  }
  rec(0, [])
  return results
}

/**
 * Best injective matching of the shorter array's voices into the longer
 * array's, minimizing total |distance| (unmatched extra voices cost 0).
 * Both arrays are <=5 long here, so brute-force permutation is cheap.
 */
function minMatchingCost(a: number[], b: number[]): number {
  const [small, large] = a.length <= b.length ? [a, b] : [b, a]
  if (small.length === 0) return 0
  const used = new Array<boolean>(large.length).fill(false)
  let best = Infinity
  const rec = (i: number, acc: number): void => {
    if (acc >= best) return
    if (i === small.length) {
      best = acc
      return
    }
    for (let j = 0; j < large.length; j++) {
      if (used[j]) continue
      used[j] = true
      rec(i + 1, acc + Math.abs(small[i] - large[j]))
      used[j] = false
    }
  }
  rec(0, 0)
  return best
}

function placementCost(candidate: number[], prev: number[] | null): number {
  if (prev === null || prev.length === 0) {
    return Math.abs(candidate[candidate.length - 1] - 64)
  }
  const moveSum = minMatchingCost(candidate, prev)
  const topMove = Math.abs(candidate[candidate.length - 1] - prev[prev.length - 1])
  return moveSum + 2 * topMove
}

/** Voice-led comping voicing: minimal movement from prev; null prev = fresh seat near the register middle. */
export function nextVoicing(
  chord: Chord,
  prev: number[] | null,
  register: [number, number] = KEYS_REGISTER,
): number[] {
  const { required, colors } = analyzeChordQuality(chord)
  const offsets = [...required, ...colors]
  // Only the bare power chord (root+fifth, no extensions at all) can land
  // here short of 3 voices; pad with a doubled voice to reach the minimum.
  while (offsets.length < 3) offsets.push(offsets[offsets.length - 1])

  const targetPcs = offsets.map((off) => normalizePc(chord.root + off))
  const placements = enumeratePlacements(targetPcs, register)
  if (placements.length === 0) {
    throw new Error(`nextVoicing: no valid placement for ${chord.quality.id} in register [${register.join(',')}]`)
  }

  let best = placements[0]
  let bestCost = placementCost(best, prev)
  for (let i = 1; i < placements.length; i++) {
    const c = placementCost(placements[i], prev)
    if (c < bestCost) {
      bestCost = c
      best = placements[i]
    }
  }
  return best
}
