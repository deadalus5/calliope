import {
  degreeOf, inferKey, inferSectionKeys, modeById, parseChordSymbol,
  type WeightedChord,
} from '../../src/music-core'
import {
  SONGMAP_VERSION, type Provenance, type SectionKind, type SongKey, type SongMap,
  type SongMapChord, type SongSection,
} from '../../src/integrations/spotify/songmap'
import type { AnalyzerResult, UgChart, UgSection } from './types'

/**
 * Fusion: UG owns the names and the chord sequences, the analyzer owns the
 * clock (beat grid + section boundaries). This module marries them into a
 * SongMap. Pure — fixture-tested without network, yt-dlp, or Python.
 */

export interface FuseInput {
  trackUri: string
  trackName: string
  artistName: string
  durationMs: number
  ug: UgChart
  analyzer: AnalyzerResult
  audio: Provenance['audio']
  analyzerName: string
  analyzerVersion: string
  /** ISO timestamp — passed in so fusion stays deterministic. */
  now: string
}

// --- label normalization ------------------------------------------------------

/** allin1's segment vocabulary -> the SongMap kind enum. */
const ANALYZER_KINDS: Record<string, SectionKind> = {
  start: 'intro', intro: 'intro',
  end: 'outro', outro: 'outro',
  break: 'inst', inst: 'inst',
  verse: 'verse', chorus: 'chorus', bridge: 'bridge', solo: 'solo',
}

export function analyzerKindOf(label: string): SectionKind {
  return ANALYZER_KINDS[label.toLowerCase()] ?? 'other'
}

const KIND_DISPLAY: Record<SectionKind, string> = {
  intro: 'INTRO', verse: 'V', chorus: 'CH', bridge: 'BR',
  solo: 'SOLO', inst: 'INST', outro: 'OUTRO', other: 'PART',
}

// --- alignment -----------------------------------------------------------------

interface AlignedSegment {
  startMs: number
  endMs: number
  kind: SectionKind
  ug: UgSection | null
  kindMatched: boolean
}

function compatible(a: SectionKind, b: SectionKind): boolean {
  if (a === b) return true
  if (a === 'other' || b === 'other') return true
  const instish = new Set<SectionKind>(['inst', 'solo', 'intro', 'outro'])
  return instish.has(a) && instish.has(b)
}

/**
 * In-order greedy alignment with one-step lookahead on both sides. The
 * analyzer's boundaries are authoritative — every analyzer segment produces
 * an output section; UG sections attach to them in order.
 */
export function alignSections(analyzer: AnalyzerResult, ugSections: UgSection[]): AlignedSegment[] {
  const out: AlignedSegment[] = []
  let j = 0
  for (let i = 0; i < analyzer.segments.length; i++) {
    const seg = analyzer.segments[i]
    const kind = analyzerKindOf(seg.label)
    const base = { startMs: seg.startMs, endMs: seg.endMs, kind }

    if (j >= ugSections.length) {
      out.push({ ...base, ug: null, kindMatched: false })
      continue
    }
    if (compatible(kind, ugSections[j].kind)) {
      out.push({ ...base, ug: ugSections[j], kindMatched: kind === ugSections[j].kind })
      j++
      continue
    }
    // Analyzer heard a segment UG never wrote (e.g. an inst break): if the
    // NEXT analyzer segment matches the current UG section, hold UG here.
    const nextSeg = analyzer.segments[i + 1]
    if (nextSeg && compatible(analyzerKindOf(nextSeg.label), ugSections[j].kind)) {
      out.push({ ...base, ug: null, kindMatched: false })
      continue
    }
    // UG wrote a section the analyzer merged away: skip the UG section and
    // try the next one.
    if (j + 1 < ugSections.length && compatible(kind, ugSections[j + 1].kind)) {
      j++
      out.push({ ...base, ug: ugSections[j], kindMatched: kind === ugSections[j].kind })
      j++
      continue
    }
    // No agreement either way — trust the order.
    out.push({ ...base, ug: ugSections[j], kindMatched: false })
    j++
  }
  return out
}

// --- chord distribution ----------------------------------------------------------

/** Beat indices of downbeats inside [startMs, endMs). */
function downbeatsWithin(analyzer: AnalyzerResult, beatIndexOfMs: Map<number, number>, startMs: number, endMs: number): number[] {
  const out: number[] = []
  for (const ms of analyzer.downbeatsMs) {
    if (ms >= startMs && ms < endMs) {
      const idx = beatIndexOfMs.get(ms)
      if (idx !== undefined) out.push(idx)
    }
  }
  return out
}

/**
 * Distribute n chords across the section's downbeats (falling back to plain
 * beats when a section has more chords than bars). Chords land ON grid
 * points in phase-1 fusion; sub-beat placement is the refine/tap layer's job.
 */
export function distributeChords(slots: number[], n: number): number[] {
  if (n === 0 || slots.length === 0) return []
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(slots[Math.min(slots.length - 1, Math.floor((i * slots.length) / n))])
  }
  // Monotonic non-decreasing by construction; collapse accidental duplicates
  // by nudging forward one slot when possible so two chords never share a beat.
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) {
      const slotPos = slots.indexOf(out[i - 1])
      out[i] = slotPos + 1 < slots.length ? slots[slotPos + 1] : out[i - 1]
    }
  }
  return out
}

// --- the fuser --------------------------------------------------------------------

export function fuse(input: FuseInput): SongMap {
  const { ug, analyzer } = input
  const warnings: string[] = []

  // Beat grid bookkeeping.
  const beats = analyzer.beatsMs
  const beatIndexOfMs = new Map<number, number>()
  beats.forEach((ms, i) => beatIndexOfMs.set(ms, i))
  const downbeatIndices = analyzer.downbeatsMs
    .map((ms) => beatIndexOfMs.get(ms))
    .filter((i): i is number => i !== undefined)
  const beatsPerBar = Math.max(1, ...analyzer.beatPositions)

  // UG sections with no chords inherit the earlier same-kind section's
  // sequence (sheets write a verse's changes once).
  const chordsByKind = new Map<SectionKind, UgSection>()
  const hydrated: UgSection[] = ug.sections.map((s) => {
    if (s.chords.length > 0) {
      if (!chordsByKind.has(s.kind)) chordsByKind.set(s.kind, s)
      return s
    }
    const donor = chordsByKind.get(s.kind)
    return donor ? { ...s, chords: donor.chords } : s
  })

  const aligned = alignSections(analyzer, hydrated)
  const matched = aligned.filter((a) => a.kindMatched).length
  const sectionAlignConfidence = aligned.length === 0 ? 0 : matched / aligned.length
  if (sectionAlignConfidence < 0.6) {
    warnings.push('section labels from the sheet and the recording disagree a lot — timing may be rough; tap to fix')
  }

  // Duration sanity: a UG section whose chord count implies a wildly
  // different length than its segment got is worth flagging.
  for (const a of aligned) {
    if (!a.ug || a.ug.chords.length === 0) continue
    const bars = downbeatsWithin(analyzer, beatIndexOfMs, a.startMs, a.endMs).length
    if (bars > 0 && a.ug.chords.length > bars * beatsPerBar) {
      warnings.push(`"${a.ug.label}" has more chords (${a.ug.chords.length}) than beats in its segment — chords compressed`)
    }
  }

  // Sections out: analyzer boundaries, UG names. Ordinals re-assigned in
  // output order per kind (corrections key on these).
  const sections: SongSection[] = []
  const ordinalSeen = new Map<SectionKind, number>()
  const kindCount = new Map<SectionKind, number>()
  for (const a of aligned) kindCount.set(a.kind, (kindCount.get(a.kind) ?? 0) + 1)
  aligned.forEach((a, i) => {
    const ordinal = (ordinalSeen.get(a.kind) ?? 0) + 1
    ordinalSeen.set(a.kind, ordinal)
    const display = KIND_DISPLAY[a.kind]
    const label = a.kind === 'verse' || a.kind === 'chorus'
      ? `${display}${ordinal}`
      : (kindCount.get(a.kind) ?? 1) > 1 ? `${display} ${ordinal}` : display
    sections.push({
      id: `s${i}`,
      label,
      kind: a.kind,
      ordinal,
      startMs: Math.round(a.startMs),
      endMs: Math.round(a.endMs),
    })
  })

  // Chords: distribute each aligned section's sequence over its downbeats.
  const chords: SongMapChord[] = []
  aligned.forEach((a, i) => {
    if (!a.ug || a.ug.chords.length === 0) return
    let slots = downbeatsWithin(analyzer, beatIndexOfMs, a.startMs, a.endMs)
    if (a.ug.chords.length > slots.length) {
      // More chords than bars — use every beat in the segment instead.
      slots = []
      for (let b = 0; b < beats.length; b++) {
        if (beats[b] >= a.startMs && beats[b] < a.endMs) slots.push(b)
      }
    }
    const placed = distributeChords(slots, a.ug.chords.length)
    a.ug.chords.forEach((token, k) => {
      if (k >= placed.length) return
      // Drop a chord landing on the same beat as the previous one (can only
      // happen when a segment is shorter than its chord list).
      const prev = chords[chords.length - 1]
      if (prev && prev.beatIndex >= placed[k] && prev.sectionId === `s${i}`) return
      chords.push({
        symbol: token.symbol,
        beatIndex: placed[k],
        ms: Math.round(beats[placed[k]]),
        durationBeats: 0, // filled below
        sectionId: `s${i}`,
        rootDegree: 0, // filled after key inference
      })
      if (!token.parseable) {
        warnings.push(`chord "${token.raw}" isn't in the app's vocabulary — shown as written, no fretboard tones`)
      }
    })
  })
  chords.sort((a, b) => a.beatIndex - b.beatIndex)
  for (let i = 0; i < chords.length; i++) {
    const nextBeat = i + 1 < chords.length ? chords[i + 1].beatIndex : beats.length
    chords[i].durationBeats = Math.max(1, nextBeat - chords[i].beatIndex)
  }

  // Key inference over the placed chords, then per-section overrides.
  const bySection = new Map<string, SongMapChord[]>()
  for (const c of chords) {
    const list = bySection.get(c.sectionId) ?? []
    list.push(c)
    bySection.set(c.sectionId, list)
  }
  const weighted: WeightedChord[] = []
  for (const [sectionId, list] of bySection) {
    void sectionId
    list.forEach((c, i) => {
      try {
        weighted.push({
          chord: parseChordSymbol(c.symbol),
          weightBeats: c.durationBeats,
          sectionStart: i === 0,
          sectionEnd: i === list.length - 1,
        })
      } catch { /* unparseable — carries no key evidence */ }
    })
  }
  const inferred = inferKey({ chords: weighted }, { tonalityName: ug.tonalityName, capo: ug.capo })
  const key: SongKey = { ...inferred }
  // Guard: an inference bug must never emit a modeId the app can't render.
  try { modeById(key.modeId) } catch { key.modeId = key.skeleton === 'minor' ? 'aeolian' : 'ionian' }

  const perSectionInputs = sections.map((s) => ({
    chords: (bySection.get(s.id) ?? []).flatMap((c, i, arr): WeightedChord[] => {
      try {
        return [{
          chord: parseChordSymbol(c.symbol),
          weightBeats: c.durationBeats,
          sectionStart: i === 0,
          sectionEnd: i === arr.length - 1,
        }]
      } catch { return [] }
    }),
  }))
  inferSectionKeys(perSectionInputs, inferred).forEach((override, i) => {
    if (override) sections[i].keyOverride = { ...override }
  })

  // Root degrees for grid labels (relative to the section's key when overridden).
  const sectionById = new Map(sections.map((s) => [s.id, s]))
  for (const c of chords) {
    try {
      const root = parseChordSymbol(c.symbol).root
      const secKey = sectionById.get(c.sectionId)?.keyOverride ?? key
      c.rootDegree = degreeOf(root, secKey.root)
    } catch { c.rootDegree = 0 }
  }

  if (chords.length === 0) {
    warnings.push('no chords could be placed — the sheet and the recording may not be the same arrangement')
  }

  return {
    version: SONGMAP_VERSION,
    trackUri: input.trackUri,
    trackName: input.trackName,
    artistName: input.artistName,
    durationMs: input.durationMs,
    key,
    sections,
    tempo: { bpm: analyzer.bpm, meter: { beatsPerBar, beatUnit: 4 } },
    beats: beats.map(Math.round),
    downbeatIndices,
    chords,
    voicings: ug.voicings,
    provenance: {
      ug: {
        tabId: ug.tabId,
        url: ug.url,
        versionLabel: ug.versionLabel,
        rating: ug.rating,
        votes: ug.votes,
        capo: ug.capo,
        tonalityName: ug.tonalityName,
        official: ug.official,
      },
      audio: input.audio,
      analyzer: { name: input.analyzerName, version: input.analyzerVersion },
      fusion: { fusedAt: input.now, sectionAlignConfidence, warnings },
    },
  }
}
