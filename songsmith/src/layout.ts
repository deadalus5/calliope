import type { SectionKind } from '../../src/integrations/spotify/songmap'
import type { AnalyzerResult, SheetChord, SheetLine, UgSection } from './types'

/**
 * SHEETLAY: lay a parsed UG sheet onto the analyzer's beat grid.
 *
 * The core inversion vs the old fuser: THE SHEET OWNS SECTION IDENTITY AND
 * ORDER (the user reads the same chart — its form is the truth), while the
 * analyzer owns the CLOCK (beats/downbeats) and contributes its segment
 * boundaries only as snap candidates and its labels only as soft evidence.
 * The old approach — greedy section-by-section alignment against the
 * analyzer's (over-)segmentation with chords spread evenly — put Gravity's
 * chorus chords in its verses.
 *
 * Everything here is pure and fixture-tested. Bars = downbeat intervals;
 * section boundaries land on downbeats, chords on beats.
 */

// --- bar grid ----------------------------------------------------------------

/** Nearest index into a sorted ms array within tolMs, else -1. */
export function nearestBeatIndex(beatsMs: number[], ms: number, tolMs = 40): number {
  if (beatsMs.length === 0) return -1
  let lo = 0
  let hi = beatsMs.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beatsMs[mid] < ms) lo = mid + 1
    else hi = mid
  }
  const best = lo > 0 && Math.abs(beatsMs[lo - 1] - ms) <= Math.abs(beatsMs[lo] - ms) ? lo - 1 : lo
  return Math.abs(beatsMs[best] - ms) <= tolMs ? best : -1
}

export interface BarGrid {
  beats: number[]
  /** Beat index of each bar start, ascending; a final sentinel entry points
   * one past the last usable beat. */
  barStartBeat: number[]
  barCount: number
}

export function buildBarGrid(analyzer: AnalyzerResult): BarGrid {
  const beats = analyzer.beatsMs
  const beatsPerBar = Math.max(1, ...analyzer.beatPositions)
  let starts = analyzer.downbeatsMs
    .map((ms) => nearestBeatIndex(beats, ms))
    .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k)
    .sort((a, b) => a - b)
  if (starts.length < 2) {
    starts = []
    for (let i = 0; i < beats.length; i += beatsPerBar) starts.push(i)
  }
  return { beats, barStartBeat: [...starts, beats.length], barCount: starts.length }
}

function barToBeat(grid: BarGrid, bar: number): number {
  const b = Math.max(0, Math.min(grid.barCount, Math.round(bar)))
  return grid.barStartBeat[b]
}

function barToMs(grid: BarGrid, bar: number): number {
  const beat = barToBeat(grid, bar)
  return grid.beats[Math.min(beat, grid.beats.length - 1)]
}

function msToBar(grid: BarGrid, ms: number): number {
  let best = 0
  let bestD = Infinity
  for (let b = 0; b <= grid.barCount; b++) {
    const d = Math.abs(barToMs(grid, b) - ms)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

// --- expansion ---------------------------------------------------------------

export interface PlanLine {
  chords: SheetChord[]
  lyricLen: number
  chordLineLen: number
  /** Filled by rawBars assignment (slots × unit). */
  rawBars: number
  synthesized?: boolean
}

export interface SectionPlan {
  label: string
  kind: SectionKind
  ordinal: number
  lines: PlanLine[]
  rawBars: number
  /** Instrumental-ish sections stretch further than vocal ones. */
  elastic: boolean
  openEnded: boolean
  synthesized?: boolean
}

const ELASTIC_KINDS = new Set<SectionKind>(['intro', 'solo', 'inst', 'outro', 'other'])

/** Hold symbols come from an already-parsed chord or the fallback tonic —
 * both known-parseable; no re-validation here (layout stays music-theory-free). */
function holdToken(symbol: string): SheetChord {
  return { symbol, raw: symbol, parseable: true, col: 0 }
}

/**
 * Expand the written sheet into per-section line plans: line repeats,
 * section repeats, 'play the same for the next N', riff mentions (a hold on
 * the last-seen chord), and hydration of empty same-kind sections. Slots
 * (chord tokens after expansion) feed the unit estimator.
 */
export function expandSheet(sections: UgSection[], fallbackTonic: string | null): SectionPlan[] {
  const plans: SectionPlan[] = []
  let lastChordSymbol: string | null = null
  const donorByKind = new Map<SectionKind, SheetLine[]>()

  for (const s of sections) {
    let lines: SheetLine[] = s.lines
    if (lines.length === 0) {
      const donor = donorByKind.get(s.kind)
      if (!donor) continue // nothing written, nothing to hydrate from
      lines = donor
    } else if (!donorByKind.has(s.kind)) {
      donorByKind.set(s.kind, lines)
    }

    const planLines: PlanLine[] = []
    for (const line of lines) {
      const reps = Math.max(1, line.repeat ?? 1)
      for (let r = 0; r < reps; r++) {
        if (line.riffRef && line.chords.length === 0) {
          const symbol = lastChordSymbol ?? fallbackTonic
          if (!symbol) continue
          planLines.push({
            chords: [holdToken(symbol)], lyricLen: 0, chordLineLen: 1, rawBars: 0, synthesized: true,
          })
        } else if (line.chords.length > 0) {
          planLines.push({
            chords: line.chords, lyricLen: line.lyricLen, chordLineLen: line.chordLineLen, rawBars: 0,
          })
          lastChordSymbol = line.chords[line.chords.length - 1].symbol
        }
      }
    }
    if (planLines.length === 0) continue

    // '[Chorus] x2' doubles the body; 'play the same for the following 2
    // verses' means the record repeats this whole block (headers for those
    // verses usually don't exist).
    const bodyReps = Math.max(1, s.repeat ?? 1) + (s.playSameForNext ?? 0)
    const allLines: PlanLine[] = []
    for (let r = 0; r < bodyReps; r++) allLines.push(...planLines.map((l) => ({ ...l })))

    plans.push({
      label: s.label,
      kind: s.kind,
      ordinal: s.ordinal,
      lines: allLines,
      rawBars: 0,
      elastic: ELASTIC_KINDS.has(s.kind) || allLines.every((l) => l.lyricLen === 0),
      openEnded: Boolean(s.openEnded),
    })
  }
  return plans
}

export function countSlots(plans: SectionPlan[]): number {
  return plans.reduce((sum, p) => sum + p.lines.reduce((s2, l) => s2 + l.chords.length, 0), 0)
}

// --- unit estimation ---------------------------------------------------------

export const UNIT_LATTICE = [0.5, 1, 2, 4] as const

/**
 * Bars-per-chord-slot for this song. The asymmetric guard is the
 * load-bearing rule: a written sheet can only UNDERSTATE the record (vamps,
 * fades, unwritten repeats add time; nothing subtracts), so a unit that
 * would overrun the record is disqualified even when the raw ratio prefers
 * it — this, not the argmin, is what picks Gravity's unit 2.
 */
export function estimateUnit(slots: number, availableBars: number, hasDoubledBareRun: boolean): {
  unit: number
  compressed: boolean
} {
  if (slots <= 0 || availableBars <= 0) return { unit: 1, compressed: false }
  const ratio = availableBars / slots
  const ranked = [...UNIT_LATTICE].sort((a, b) => Math.abs(Math.log2(ratio / a)) - Math.abs(Math.log2(ratio / b)))
  let chosen: number | null = null
  for (const u of ranked) {
    if (slots * u <= availableBars * 1.15) { chosen = u; break }
  }
  if (chosen === null) return { unit: 0.5, compressed: true }
  // A bare run writing the same chord twice in a row ('G G') is direct
  // 1-token-=-1-bar notation.
  if (hasDoubledBareRun && chosen !== 1 && Math.abs(Math.log2(ratio)) <= 1 && slots * 1 <= availableBars * 1.15) {
    chosen = 1
  }
  return { unit: chosen, compressed: false }
}

export function hasDoubledBareRun(plans: SectionPlan[]): boolean {
  for (const p of plans) {
    for (const l of p.lines) {
      if (l.lyricLen > 0) continue
      for (let i = 1; i < l.chords.length; i++) {
        if (l.chords[i].symbol === l.chords[i - 1].symbol) return true
      }
    }
  }
  return false
}

export function assignRawBars(plans: SectionPlan[], unit: number): void {
  for (const p of plans) {
    p.rawBars = 0
    for (const l of p.lines) {
      l.rawBars = Math.max(unit, l.chords.length * unit)
      p.rawBars += l.rawBars
    }
  }
}

// --- anchor ------------------------------------------------------------------

export function findAnchor(analyzer: AnalyzerResult, grid: BarGrid): number {
  const first = analyzer.segments.find((s) => !/^start$/i.test(s.label) && s.endMs - s.startMs > 500)
    ?? analyzer.segments[0]
  return first ? Math.max(0, msToBar(grid, first.startMs)) : 0
}

// --- boundary assignment (the DP) --------------------------------------------

const ANALYZER_KINDS: Record<string, SectionKind> = {
  start: 'intro', intro: 'intro',
  end: 'outro', outro: 'outro',
  break: 'inst', inst: 'inst',
  verse: 'verse', chorus: 'chorus', bridge: 'bridge', solo: 'solo',
}

export function analyzerKindOf(label: string): SectionKind {
  return ANALYZER_KINDS[label.toLowerCase()] ?? 'other'
}

function compatible(a: SectionKind, b: SectionKind): boolean {
  if (a === b) return true
  if (a === 'other' || b === 'other') return true
  const instish = new Set<SectionKind>(['inst', 'solo', 'intro', 'outro'])
  return instish.has(a) && instish.has(b)
}

export interface Placement {
  startBar: number
  endBar: number
  snapped: boolean
  /** actual/predicted span. */
  r: number
}

interface Candidate {
  bar: number
  /** Kind of the segment STARTING here (what follows the boundary). */
  startsKind: SectionKind | null
  /** Kind of the segment ENDING here (what the boundary closes). */
  endsKind: SectionKind | null
}

const DEAD_RECKON_COST = 0.9
/** An elastic section's written length is a GUESS (players vamp intros and
 * solos) — trusting it over a nearby analyzer boundary must cost extra, or
 * a short written intro dead-reckons cheap and shifts the whole song early
 * (the Gravity failure: 8 written intro bars vs ~18 played). */
const DEAD_RECKON_COST_ELASTIC = 1.3
const FILL_COST_PER_BAR = 0.03
const NEXT_KIND_BONUS = 0.25
/** An EXACT label match on the segment a boundary closes ("the analyzer's
 * 'intro' ends exactly here, and so does the sheet's intro") is the
 * strongest boundary evidence there is — it settles Gravity's chorus-vs-
 * verse-shift tie in favor of the lyrics' truth. Compatible-but-inexact
 * (solo vs inst) is worth much less. */
const THIS_KIND_EXACT_BONUS = 0.4
const THIS_KIND_BONUS = 0.15

/**
 * Choose each section's end: snap to an analyzer boundary (cost |log2 r|,
 * minus label-agreement bonuses) or dead-reckon the written length (flat
 * cost). Globally minimized — a snap that looks poor locally often wins by
 * making the NEXT section land perfectly — with unclaimed candidates free
 * (that IS the over-segmentation handling) and synthesized tail time
 * penalized per bar so stretching written material is preferred.
 */
export function assignBoundaries(
  plans: SectionPlan[], grid: BarGrid, analyzer: AnalyzerResult, anchorBar: number,
): Placement[] {
  const candidates: Candidate[] = []
  const seen = new Set<number>()
  for (let i = 0; i < analyzer.segments.length; i++) {
    const seg = analyzer.segments[i]
    for (const [ms, isStart] of [[seg.startMs, true], [seg.endMs, false]] as [number, boolean][]) {
      const bar = msToBar(grid, ms)
      if (bar <= anchorBar || bar > grid.barCount) continue
      if (!seen.has(bar)) {
        seen.add(bar)
        candidates.push({ bar, startsKind: null, endsKind: null })
      }
      const c = candidates.find((x) => x.bar === bar)!
      if (isStart) c.startsKind = analyzerKindOf(seg.label)
      else c.endsKind = analyzerKindOf(seg.label)
    }
  }
  candidates.sort((a, b) => a.bar - b.bar)

  const memo = new Map<string, { cost: number; endBar: number; snapped: boolean } | null>()

  function best(i: number, startBar: number): { cost: number; endBar: number; snapped: boolean } | null {
    if (i >= plans.length) return { cost: (grid.barCount - startBar) * FILL_COST_PER_BAR, endBar: startBar, snapped: false }
    const key = `${i}:${startBar}`
    if (memo.has(key)) return memo.get(key)!
    const plan = plans[i]
    const [rLo, rHi] = plan.elastic ? [0.4, 4.0] : [0.55, 2.0]
    const options: { end: number; cost: number; snapped: boolean; r: number }[] = []

    // Dead-reckon the written length.
    const reckoned = Math.min(grid.barCount, startBar + Math.max(1, Math.round(plan.rawBars)))
    if (reckoned > startBar) {
      options.push({
        end: reckoned,
        cost: plan.elastic ? DEAD_RECKON_COST_ELASTIC : DEAD_RECKON_COST,
        snapped: false,
        r: 1,
      })
    }

    // Snap to nearby analyzer boundaries (up to 3 best-fitting).
    const inGate = candidates
      .filter((c) => c.bar > startBar)
      .map((c) => ({ c, r: (c.bar - startBar) / Math.max(1, plan.rawBars) }))
      .filter(({ r }) => r >= rLo && r <= rHi)
      .sort((a, b) => Math.abs(Math.log2(a.r)) - Math.abs(Math.log2(b.r)))
      .slice(0, 3)
    for (const { c, r } of inGate) {
      let cost = Math.abs(Math.log2(r))
      const nextKind = plans[i + 1]?.kind
      if (nextKind && c.startsKind && compatible(c.startsKind, nextKind)) cost -= NEXT_KIND_BONUS
      if (c.endsKind === plan.kind) cost -= THIS_KIND_EXACT_BONUS
      else if (c.endsKind && compatible(c.endsKind, plan.kind)) cost -= THIS_KIND_BONUS
      options.push({ end: c.bar, cost: Math.max(0, cost), snapped: true, r })
    }

    let result: { cost: number; endBar: number; snapped: boolean } | null = null
    for (const opt of options) {
      const rest = best(i + 1, opt.end)
      if (!rest) continue
      const total = opt.cost + rest.cost
      if (!result || total < result.cost) result = { cost: total, endBar: opt.end, snapped: opt.snapped }
    }
    memo.set(key, result)
    return result
  }

  const placements: Placement[] = []
  let at = anchorBar
  for (let i = 0; i < plans.length; i++) {
    const step = best(i, at)
    if (!step) {
      // Out of room — pin the remainder to the last bar.
      placements.push({ startBar: at, endBar: grid.barCount, snapped: false, r: 1 })
      at = grid.barCount
      continue
    }
    placements.push({
      startBar: at,
      endBar: step.endBar,
      snapped: step.snapped,
      r: (step.endBar - at) / Math.max(1, plans[i].rawBars),
    })
    at = step.endBar
  }
  return placements
}

// --- chord placement ---------------------------------------------------------

export interface LaidChord {
  symbol: string
  raw: string
  parseable: boolean
  beatIndex: number
  sectionIndex: number
  synthesized?: boolean
}

/** Distribute a section's beats to its lines ∝ rawBars (largest remainder,
 * min 2 beats), then place each line's chords by character-offset fraction,
 * pulled onto downbeats when within a beat. */
export function layChords(plan: SectionPlan, place: Placement, grid: BarGrid, sectionIndex: number): LaidChord[] {
  const startBeat = barToBeat(grid, place.startBar)
  const endBeat = barToBeat(grid, place.endBar)
  const totalBeats = endBeat - startBeat
  if (totalBeats <= 0 || plan.lines.length === 0) return []

  const rawTotal = plan.lines.reduce((s, l) => s + l.rawBars, 0) || 1
  const shares = plan.lines.map((l) => (l.rawBars / rawTotal) * totalBeats)
  const beatsPerLine = shares.map((s) => Math.max(plan.lines.length * 2 <= totalBeats ? 2 : 1, Math.floor(s)))
  let leftover = totalBeats - beatsPerLine.reduce((a, b) => a + b, 0)
  const order = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (leftover <= 0) break
    beatsPerLine[i] += 1
    leftover -= 1
  }
  // Any residual (negative leftover impossible by floor; positive spent) —
  // trim overshoot from the end.
  let acc = beatsPerLine.reduce((a, b) => a + b, 0)
  for (let i = beatsPerLine.length - 1; acc > totalBeats && i >= 0; i--) {
    const trim = Math.min(beatsPerLine[i] - 1, acc - totalBeats)
    beatsPerLine[i] -= trim
    acc -= trim
  }

  const downbeats = new Set(grid.barStartBeat)
  const out: LaidChord[] = []
  let lineStart = startBeat
  for (let li = 0; li < plan.lines.length; li++) {
    const line = plan.lines[li]
    const span = beatsPerLine[li]
    const effLen = Math.max(line.chordLineLen, line.lyricLen, 1)
    line.chords.forEach((ch) => {
      let beat = ch.col <= 1
        ? lineStart
        : lineStart + Math.round((ch.col / effLen) * span)
      // Downbeat pull: changes live on bar lines far more often than not.
      for (const d of [beat, beat - 1, beat + 1]) {
        if (downbeats.has(d) && Math.abs(d - beat) <= 1) { beat = d; break }
      }
      beat = Math.max(lineStart, Math.min(lineStart + span - 1, beat))
      const prev = out[out.length - 1]
      if (prev && prev.sectionIndex === sectionIndex && beat <= prev.beatIndex) beat = prev.beatIndex + 1
      if (beat >= endBeat) return
      out.push({
        symbol: ch.symbol, raw: ch.raw, parseable: ch.parseable,
        beatIndex: beat, sectionIndex, synthesized: line.synthesized,
      })
    })
    lineStart += span
  }
  return out
}

// --- the whole layout --------------------------------------------------------

export interface LayoutSection {
  label: string
  kind: SectionKind
  ordinal: number
  startMs: number
  endMs: number
  synthesized?: boolean
}

export interface LayoutResult {
  sections: LayoutSection[]
  chords: LaidChord[]
  sectionAlignConfidence: number
  unit: number
  anchorBar: number
  warnings: string[]
}

export function layout(
  sheet: UgSection[], analyzer: AnalyzerResult, fallbackTonic: string | null,
): LayoutResult {
  const warnings: string[] = []
  const grid = buildBarGrid(analyzer)
  let plans = expandSheet(sheet, fallbackTonic)
  if (plans.length === 0 || grid.barCount === 0) {
    return { sections: [], chords: [], sectionAlignConfidence: 0, unit: 1, anchorBar: 0, warnings: ['nothing to lay out'] }
  }

  const anchorBar = findAnchor(analyzer, grid)

  // A record that opens with unwritten music (sheet starts at Verse 1 but
  // the band vamps an intro): synthesize a small elastic intro holding the
  // first written chord, and let the DP find its real length.
  if (plans[0].kind !== 'intro') {
    const firstChord = plans[0].lines[0]?.chords[0]
    if (firstChord) {
      plans = [{
        label: 'Intro',
        kind: 'intro',
        ordinal: 1,
        lines: [{ chords: [{ ...firstChord, col: 0 }], lyricLen: 0, chordLineLen: 1, rawBars: 0, synthesized: true }],
        rawBars: 0,
        elastic: true,
        openEnded: false,
        synthesized: true,
      }, ...plans]
    }
  }

  const slots = countSlots(plans)
  const { unit, compressed } = estimateUnit(slots, grid.barCount - anchorBar, hasDoubledBareRun(plans))
  if (compressed) warnings.push('the chart writes more chords than the record has bars — timing compressed; tap to fix')
  assignRawBars(plans, unit)
  // The synthesized intro's written length is a guess, not sheet data.
  if (plans[0].synthesized) { plans[0].rawBars = 4; plans[0].lines[0].rawBars = 4 }

  const placements = assignBoundaries(plans, grid, analyzer, anchorBar)

  const chords: LaidChord[] = []
  plans.forEach((p, i) => chords.push(...layChords(p, placements[i], grid, i)))

  // Tail fill: written material exhausted before the record ends — vamp the
  // designated (or last) body to the final beat.
  const lastEndBar = placements[placements.length - 1]?.endBar ?? anchorBar
  let fillBars = 0
  if (grid.barCount - lastEndBar >= 2) {
    fillBars = grid.barCount - lastEndBar
    const source = plans.find((p) => p.openEnded) ?? plans[plans.length - 1]
    const vampLine = [...source.lines].reverse().find((l) => l.chords.length > 0)
    if (vampLine) {
      const li = plans.length - 1
      const perChord = Math.max(1, Math.round(unit * (grid.barStartBeat[1] ? grid.barStartBeat[1] - grid.barStartBeat[0] : 4)))
      let beat = barToBeat(grid, lastEndBar)
      const endBeat = grid.beats.length
      let k = 0
      while (beat < endBeat) {
        const ch = vampLine.chords[k % vampLine.chords.length]
        chords.push({
          symbol: ch.symbol, raw: ch.raw, parseable: ch.parseable,
          beatIndex: beat, sectionIndex: li, synthesized: true,
        })
        beat += perChord
        k++
      }
      placements[placements.length - 1].endBar = grid.barCount
      if (fillBars > 8) warnings.push('the chart covers less of the record than usual — the tail vamps the last written part; tap to fix if it drifts')
    }
  }

  const sections: LayoutSection[] = plans.map((p, i) => ({
    label: p.label,
    kind: p.kind,
    ordinal: p.ordinal,
    startMs: Math.round(barToMs(grid, placements[i].startBar)),
    endMs: Math.round(i + 1 < plans.length ? barToMs(grid, placements[i + 1].startBar) : barToMs(grid, placements[i].endBar)),
    synthesized: p.synthesized,
  }))

  // Confidence: how much the record's own boundaries corroborated the sheet.
  const realPlans = plans.filter((p) => !p.synthesized)
  const snapped = placements.filter((pl, i) => !plans[i].synthesized && pl.snapped)
  const snapRate = realPlans.length > 0 ? snapped.length / realPlans.length : 0
  const writtenCoverage = grid.barCount > anchorBar
    ? Math.max(0, grid.barCount - anchorBar - fillBars) / (grid.barCount - anchorBar)
    : 0
  const sectionAlignConfidence = Math.min(1, 0.65 * snapRate + 0.35 * writtenCoverage)
  if (sectionAlignConfidence < 0.5) {
    warnings.push('the sheet and the recording disagree a lot — timing may be rough; tap to fix')
  }

  return { sections, chords, sectionAlignConfidence, unit, anchorBar, warnings }
}
