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

/**
 * Count of adjacent voice pairs a bare semitone apart. On piano these read
 * as fingering mistakes (Fm7 as 55,56,63; C13 as 50,57,58,64): the b3/9 or
 * 13/b7 pair wants to sit a 7th/9th apart, and 7#9's #9 belongs well above
 * the major third (the Hendrix spread), never crushed against it.
 * nextVoicing rejects clustered candidates outright; when the register
 * makes a cluster unavoidable at full voice count (two single-slot pcs a
 * semitone apart — e.g. G7#9 in [48,69]: the third's pc B has only MIDI 59
 * and the #9's pc Bb only 58), it drops color voices instead, largest
 * surviving subset first. The shell alone can never cluster: no quality
 * pairs shell tones a semitone apart mod 12, and octave duplicates from
 * padding are 12 apart — so the relaxation always terminates cluster-free
 * and the least-cluster fallback below is defensive only (reachable at
 * most under a caller-supplied pathologically narrow register).
 */
function semitoneClusterCount(sorted: number[]): number {
  let count = 0
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] === 1) count++
  return count
}

/** Voice-led comping voicing: minimal movement from prev; null prev = fresh seat near the register middle. */
export function nextVoicing(
  chord: Chord,
  prev: number[] | null,
  register: [number, number] = KEYS_REGISTER,
): number[] {
  const { required, colors } = analyzeChordQuality(chord)

  // Color subsets in preference order: keep everything, then drop one
  // color, then shell-only. A subset is only reached when every larger one
  // yields no cluster-free placement (register-starved pc pairs).
  const subsetGroups: number[][][] =
    colors.length >= 2
      ? [[colors], colors.map((_, k) => colors.filter((__, j) => j !== k)), [[]]]
      : [[colors], [[]]]

  let fullPlacements: number[][] = []
  for (let g = 0; g < subsetGroups.length; g++) {
    const pool: number[][] = []
    const seen = new Set<string>()
    for (const subset of subsetGroups[g]) {
      const offsets = padOffsets([...required, ...subset], chord.root, register)
      const placements = enumeratePlacements(offsets.map((off) => normalizePc(chord.root + off)), register)
      if (g === 0) fullPlacements = placements
      for (const p of placements) {
        if (semitoneClusterCount(p) !== 0) continue
        const key = p.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        pool.push(p)
      }
    }
    if (pool.length > 0) return pickMinCost(pool, prev)
  }

  // Defensive fallback (unreachable in KEYS_REGISTER — the shell-only group
  // above always yields a cluster-free placement): fewest clusters, then cost.
  if (fullPlacements.length === 0) {
    throw new Error(`nextVoicing: no valid placement for ${chord.quality.id} in register [${register.join(',')}]`)
  }
  return pickMinCost(fullPlacements, prev, (p) => semitoneClusterCount(p) * 1e6)
}

function pickMinCost(
  pool: number[][],
  prev: number[] | null,
  penalty: (p: number[]) => number = () => 0,
): number[] {
  let best = pool[0]
  let bestCost = placementCost(best, prev) + penalty(best)
  for (let i = 1; i < pool.length; i++) {
    const c = placementCost(pool[i], prev) + penalty(pool[i])
    if (c < bestCost) {
      bestCost = c
      best = pool[i]
    }
  }
  return best
}

/**
 * Pad to the 3-voice minimum by doubling whichever tone still has a free
 * in-register octave slot. Only the bare power chord (root+fifth) and the
 * shell-only relaxation subset arrive here short — blindly doubling the
 * last offset fails when its pc has only one slot in [48,69] (pcs 10/11).
 */
function padOffsets(base: number[], root: number, register: [number, number]): number[] {
  const offsets = [...base]
  while (offsets.length < 3) {
    const pad = [...new Set(offsets)].find((off) => {
      const pc = normalizePc(root + off)
      const slots = candidatesForPc(pc, register[0], register[1]).length
      const already = offsets.filter((o) => normalizePc(root + o) === pc).length
      return slots > already
    })
    if (pad === undefined) break // no pc has a free slot; a thinner voicing beats throwing
    offsets.push(pad)
  }
  return offsets
}
