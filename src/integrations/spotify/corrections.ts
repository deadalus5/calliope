import {
  beatIndexAtMs, beatMs, chordAtMs, chordCorrectionKey, nextChordAfter,
  sectionCorrectionKey,
  type ResolvedTiming, type SongMap, type SongSection, type TapRecord, type UserCorrections,
} from './songmap'

/**
 * Tap 2.0: taps are CORRECTIONS, not authoring. Every transform here is pure
 * and immutable — the caller owns state and persistence — and writes only the
 * structural keys (kind:ordinal[:chordIdx]) so everything survives a
 * re-analysis that hands out fresh section ids. Tap history is append-only
 * and never pruned; resets zero the derived maps, never the taps.
 */

export interface TapResult {
  corrections: UserCorrections
  record: TapRecord
}

function sectionOfChord(map: SongMap, chordIndex: number): SongSection | null {
  const id = map.chords[chordIndex]?.sectionId
  return map.sections.find((s) => s.id === id) ?? null
}

/** Position of a chord within its section — mirrors resolveTiming's walk. */
function chordIdxInSection(map: SongMap, chordIndex: number): number {
  const sectionId = map.chords[chordIndex].sectionId
  let n = 0
  for (let i = 0; i < chordIndex; i++) if (map.chords[i].sectionId === sectionId) n++
  return n
}

/**
 * One tap = "the change is NOW". The tap attaches to the nearer of the
 * sounding chord and the upcoming one (people tap late about as often as
 * they tap early), and shifts that chord's whole section by the delta —
 * accumulating, so successive taps converge. A tap more than a bar away
 * from any change is ignored (null): it's noise, not a correction.
 */
export function applyTap(
  c: UserCorrections,
  map: SongMap,
  resolved: ResolvedTiming,
  tapMs: number,
  nowTs: number,
): TapResult | null {
  const at = chordAtMs(resolved, tapMs)
  const next = nextChordAfter(resolved, tapMs)
  const candidates = [at, next].filter((i) => i !== -1)
  if (candidates.length === 0) return null
  const target = candidates
    .map((i) => ({ i, delta: tapMs - resolved.chords[i].ms }))
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]
  const oneBar = map.tempo.meter.beatsPerBar * beatMs(map)
  if (Math.abs(target.delta) > oneBar) return null

  const section = sectionOfChord(map, resolved.chords[target.i].chordIndex)
  if (!section) return null
  const key = sectionCorrectionKey(section.kind, section.ordinal)
  const record: TapRecord = {
    ts: nowTs,
    atMs: tapMs,
    snappedBeatIndex: beatIndexAtMs(map, tapMs),
    scope: { kind: section.kind, ordinal: section.ordinal },
    appliedOffsetMs: Math.round(target.delta),
  }
  return {
    corrections: {
      ...c,
      sectionOffsets: { ...c.sectionOffsets, [key]: (c.sectionOffsets[key] ?? 0) + record.appliedOffsetMs },
      taps: [...c.taps, record],
    },
    record,
  }
}

/** Nudge one chord by ±half a beat (relative to its section-shifted spot). */
export function nudgeChord(c: UserCorrections, map: SongMap, chordIndex: number, dir: -1 | 1): UserCorrections {
  const section = sectionOfChord(map, chordIndex)
  if (!section) return c
  const key = chordCorrectionKey(section.kind, section.ordinal, chordIdxInSection(map, chordIndex))
  return { ...c, chordNudges: { ...c.chordNudges, [key]: (c.chordNudges[key] ?? 0) + dir * 0.5 } }
}

export function shiftSection(c: UserCorrections, map: SongMap, sectionIndex: number, deltaMs: number): UserCorrections {
  const s = map.sections[sectionIndex]
  if (!s) return c
  const key = sectionCorrectionKey(s.kind, s.ordinal)
  return { ...c, sectionOffsets: { ...c.sectionOffsets, [key]: (c.sectionOffsets[key] ?? 0) + deltaMs } }
}

export function setGlobalOffset(c: UserCorrections, ms: number): UserCorrections {
  return { ...c, globalOffsetMs: Math.round(ms) }
}

/** Zero one section's offset and every chord nudge inside it. */
export function resetSection(c: UserCorrections, map: SongMap, sectionIndex: number): UserCorrections {
  const s = map.sections[sectionIndex]
  if (!s) return c
  const key = sectionCorrectionKey(s.kind, s.ordinal)
  const prefix = `${key}:`
  const sectionOffsets = { ...c.sectionOffsets }
  delete sectionOffsets[key]
  const chordNudges: Record<string, number> = {}
  for (const [k, v] of Object.entries(c.chordNudges)) if (!k.startsWith(prefix)) chordNudges[k] = v
  return { ...c, sectionOffsets, chordNudges }
}

/** Zero every derived offset. Tap history and version picks are kept —
 * "reset" means "back to the map's timing", not "forget what I taught it". */
export function resetTiming(c: UserCorrections): UserCorrections {
  return { ...c, globalOffsetMs: 0, sectionOffsets: {}, chordNudges: {} }
}

/** True when any offset/nudge is in effect (drives the reset affordances). */
export function hasTimingEdits(c: UserCorrections): boolean {
  return c.globalOffsetMs !== 0
    || Object.values(c.sectionOffsets).some((v) => v !== 0)
    || Object.values(c.chordNudges).some((v) => v !== 0)
}
