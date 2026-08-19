import {
  degreeOf, inferKey, inferSectionKeys, modeById, parseChordSymbol, pcName,
  type PitchClass, type WeightedChord,
} from '../../src/music-core'
import {
  SONGMAP_VERSION, type Provenance, type SectionKind, type SongKey, type SongMap,
  type SongMapChord, type SongSection,
} from '../../src/integrations/spotify/songmap'
import { analyzerKindOf, layout, nearestBeatIndex } from './layout'
import type { AnalyzerResult, UgChart } from './types'

/**
 * Fusion: the SHEET owns the form (section order + chord sequence + relative
 * timing — laid onto the beat grid by layout.ts/SHEETLAY), the analyzer owns
 * the clock, and key/mode inference runs over the laid chords. Pure —
 * fixture-tested without network, yt-dlp, or Python.
 */

export { analyzerKindOf, nearestBeatIndex }

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

const KIND_DISPLAY: Record<SectionKind, string> = {
  intro: 'INTRO', verse: 'V', chorus: 'CH', bridge: 'BR',
  solo: 'SOLO', inst: 'INST', outro: 'OUTRO', other: 'PART',
}

/** Tonic symbol for riff holds when no chord has sounded yet. */
function fallbackTonic(ug: UgChart, analyzer: AnalyzerResult): string | null {
  if (ug.tonalityName) {
    const m = /^([A-Ga-g][#b]*)\s*(m|min|minor)?$/.exec(ug.tonalityName.trim())
    if (m) return `${m[1]}${m[2] ? 'm' : ''}`
  }
  if (analyzer.chromaKey) {
    const root = ((analyzer.chromaKey.root % 12) + 12) % 12
    return `${pcName(root as PitchClass, root as PitchClass)}${analyzer.chromaKey.minor ? 'm' : ''}`
  }
  return null
}

// --- the fuser --------------------------------------------------------------------

export function fuse(input: FuseInput): SongMap {
  const { ug, analyzer } = input
  const warnings: string[] = []

  const beats = analyzer.beatsMs
  const downbeatIndices = analyzer.downbeatsMs
    .map((ms) => nearestBeatIndex(beats, ms))
    .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k)
  const beatsPerBar = Math.max(1, ...analyzer.beatPositions)

  // --- lay the sheet onto the grid ---------------------------------------
  const laid = layout(ug.sections, analyzer, fallbackTonic(ug, analyzer))
  warnings.push(...laid.warnings)
  for (const c of laid.chords) {
    if (!c.parseable) {
      warnings.push(`chord "${c.raw}" isn't in the app's vocabulary — shown as written, no fretboard tones`)
    }
  }

  // Sections out, in SHEET order with sheet identity — display labels via
  // the same convention as before (V1, CH2, INST 2 when a kind repeats).
  const kindCount = new Map<SectionKind, number>()
  for (const s of laid.sections) kindCount.set(s.kind, (kindCount.get(s.kind) ?? 0) + 1)
  const sections: SongSection[] = laid.sections.map((s, i) => {
    const display = KIND_DISPLAY[s.kind]
    const label = s.kind === 'verse' || s.kind === 'chorus'
      ? `${display}${s.ordinal}`
      : (kindCount.get(s.kind) ?? 1) > 1 ? `${display} ${s.ordinal}` : display
    return {
      id: `s${i}`,
      label,
      kind: s.kind,
      ordinal: s.ordinal,
      startMs: s.startMs,
      endMs: s.endMs,
      ...(s.synthesized ? { synthesized: true } : {}),
    }
  })

  const chords: SongMapChord[] = laid.chords.map((c) => ({
    symbol: c.symbol,
    beatIndex: c.beatIndex,
    ms: Math.round(beats[Math.min(c.beatIndex, beats.length - 1)]),
    durationBeats: 0, // filled below
    sectionId: `s${c.sectionIndex}`,
    rootDegree: 0, // filled after key inference
  }))
  chords.sort((a, b) => a.beatIndex - b.beatIndex)
  for (let i = 0; i < chords.length; i++) {
    const nextBeat = i + 1 < chords.length ? chords[i + 1].beatIndex : beats.length
    chords[i].durationBeats = Math.max(1, nextBeat - chords[i].beatIndex)
  }

  // --- key inference over the laid chords --------------------------------
  const bySection = new Map<string, SongMapChord[]>()
  for (const c of chords) {
    const list = bySection.get(c.sectionId) ?? []
    list.push(c)
    bySection.set(c.sectionId, list)
  }
  // Cap each occurrence's key-evidence weight at two bars: durationBeats is
  // gap-to-next-change, so a chord held before a sparse stretch otherwise
  // casts hundreds of votes and drags the tonic with it.
  const weightCap = 2 * beatsPerBar
  const weighted: WeightedChord[] = []
  for (const [sectionId, list] of bySection) {
    void sectionId
    list.forEach((c, i) => {
      try {
        weighted.push({
          chord: parseChordSymbol(c.symbol),
          weightBeats: Math.min(weightCap, c.durationBeats),
          sectionStart: i === 0,
          sectionEnd: i === list.length - 1,
        })
      } catch { /* unparseable — carries no key evidence */ }
    })
  }
  const totalCappedWeight = weighted.reduce((s, w) => s + w.weightBeats, 0)
  const inferred = inferKey({ chords: weighted }, {
    tonalityName: ug.tonalityName,
    capo: ug.capo,
    audioKey: analyzer.chromaKey
      ? {
          root: (((analyzer.chromaKey.root % 12) + 12) % 12) as PitchClass,
          minor: analyzer.chromaKey.minor,
          strength: analyzer.chromaKey.strength,
        }
      : null,
    chordCoverage: beats.length > 0 ? Math.min(1, totalCappedWeight / beats.length) : 1,
  })
  const key: SongKey = { ...inferred }
  // Guard: an inference bug must never emit a modeId the app can't render.
  try { modeById(key.modeId) } catch { key.modeId = key.skeleton === 'minor' ? 'aeolian' : 'ionian' }

  const perSectionInputs = sections.map((s) => ({
    chords: (bySection.get(s.id) ?? []).flatMap((c, i, arr): WeightedChord[] => {
      try {
        return [{
          chord: parseChordSymbol(c.symbol),
          weightBeats: Math.min(weightCap, c.durationBeats),
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
      fusion: { fusedAt: input.now, sectionAlignConfidence: laid.sectionAlignConfidence, warnings },
    },
  }
}
