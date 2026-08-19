import type { SectionKind, UgVoicing } from '../../src/integrations/spotify/songmap'

/** One chord occurrence in a UG sheet, in written order (repeats included). */
export interface UgChordToken {
  /** Concert-pitch symbol after capo adjustment (best effort). */
  symbol: string
  /** As written on the sheet. */
  raw: string
  /** False when the symbol isn't in music-core's vocabulary — kept anyway. */
  parseable: boolean
}

/** A chord with its character column in the (de-tagged) chord line — the
 * sheet's own timing notation: where over the lyric the change lands. */
export interface SheetChord extends UgChordToken {
  col: number
}

export interface SheetLine {
  /** 'pair' = chord line + its lyric line ([tab] block); 'run' = bare chord
   * line (intros/instrumentals) or a riff reference. */
  kind: 'pair' | 'run'
  chords: SheetChord[]
  /** Visible length of the lyric line (0 for runs). */
  lyricLen: number
  /** Visible length of the de-tagged chord line. */
  chordLineLen: number
  /** Written repeat on this line ('x2'). */
  repeat?: number
  /** The line is a named-riff mention ('Riff 1') with no chords of its own —
   * layout turns it into a hold. */
  riffRef?: string
}

export interface UgSection {
  /** Header as written: 'Verse 1', 'Guitar Solo'. */
  label: string
  kind: SectionKind
  /** 1-based per kind, in sheet order. */
  ordinal: number
  /** Flat as-written chord sequence (derived from lines; repeats NOT
   * expanded — expansion is the layout's job). */
  chords: UgChordToken[]
  /** The sheet's own structure, in order. */
  lines: SheetLine[]
  /** Section-level written repeat ('x2' after the body). */
  repeat?: number
  /** 'play the same progression for the following N verses'. */
  playSameForNext?: number
  /** 'Repeat … and fade' — open-ended tail annotation. */
  openEnded?: boolean
}

export interface UgChart {
  tabId: number
  url: string
  versionLabel: string
  rating: number
  votes: number
  capo: number
  /** As written on the sheet (shape key when capo'd) — concert normalization
   * happens in key inference, which gets the capo alongside. */
  tonalityName: string | null
  official: boolean
  sections: UgSection[]
  voicings?: Record<string, UgVoicing[]>
}

export interface UgVersionInfo {
  tabId: number
  url: string
  versionLabel: string
  type: string
  rating: number
  votes: number
  tonalityName: string | null
  capo: number | null
}

/** allin1 output, already converted to ms. */
export interface AnalyzerResult {
  bpm: number
  beatsMs: number[]
  downbeatsMs: number[]
  /** 1-based position of each beat within its bar; max = beats per bar. */
  beatPositions: number[]
  segments: { startMs: number; endMs: number; label: string }[]
  /** Audio-measured key prior (py/key_chroma.py) — riff songs whose sheets
   * barely write chords need the record itself to vote. */
  chromaKey?: { root: number; minor: boolean; strength: number }
}

export interface AudioMatch {
  videoId: string
  videoTitle: string
  channel: string
  durationMs: number
  matchScore: number
}
