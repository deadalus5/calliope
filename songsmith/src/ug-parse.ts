import { chordSymbol, normalizePc, parseChordSymbol } from '../../src/music-core'
import type { SectionKind, UgVoicing } from '../../src/integrations/spotify/songmap'
import type { SheetChord, SheetLine, UgChart, UgChordToken, UgSection, UgVersionInfo } from './types'

/**
 * Pure parsing of Ultimate Guitar pages. Every UG page embeds its data as
 * JSON in `<div class="js-store" data-content="...">`; this module extracts
 * and walks that JSON — no DOM, no network — so markup drift is fixable
 * against cached fixtures without re-scraping.
 */

/** Decode the handful of HTML entities UG uses in data-content. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** Pull the js-store JSON out of a UG page. Throws with a recognizable
 * message when the page isn't shaped like UG anymore (or is a challenge page). */
export function extractJsStore(html: string): unknown {
  const m = /<div[^>]+class="js-store"[^>]+data-content="([^"]*)"/.exec(html)
  if (!m) throw new Error('no js-store div found — UG markup changed or a challenge page was served')
  try {
    return JSON.parse(decodeEntities(m[1]))
  } catch {
    throw new Error('js-store data-content did not parse as JSON')
  }
}

// --- section header normalization ------------------------------------------

const KIND_PATTERNS: [RegExp, SectionKind][] = [
  [/pre[\s-]?chorus/i, 'other'], // before 'chorus' so it doesn't match as chorus
  [/intro/i, 'intro'],
  [/outro|ending|coda/i, 'outro'],
  [/chorus|refrain/i, 'chorus'],
  [/verse/i, 'verse'],
  [/bridge|middle\s*(8|eight)/i, 'bridge'],
  [/solo|lead/i, 'solo'],
  [/instrumental|interlude|break|riff|jam/i, 'inst'],
]

export function sectionKindOf(label: string): SectionKind {
  for (const [re, kind] of KIND_PATTERNS) if (re.test(label)) return kind
  return 'other'
}

/** 'Verse 2' -> 2; otherwise next unseen ordinal for the kind. */
function ordinalOf(label: string, kind: SectionKind, seen: Map<SectionKind, number>): number {
  const m = /(\d+)/.exec(label)
  if (m) {
    const n = Number(m[1])
    seen.set(kind, Math.max(seen.get(kind) ?? 0, n))
    return n
  }
  const next = (seen.get(kind) ?? 0) + 1
  seen.set(kind, next)
  return next
}

// --- chord symbol normalization ---------------------------------------------

/** UG spellings music-core doesn't use, mapped onto its vocabulary. */
const SUFFIX_ALIASES: [RegExp, string][] = [
  [/^maj$/i, ''],
  [/^M$/, ''],
  [/^min$/i, 'm'],
  [/^mi$/i, 'm'],
  [/^-$/, 'm'],
  [/^M7$/, 'maj7'],
  [/^Maj7$/, 'maj7'],
  [/^7M$/, 'maj7'],
  [/^sus$/i, 'sus4'],
  [/^2$/, 'sus2'],
  [/^4$/, 'sus4'],
  [/^o$/, 'dim'],
  [/^°$/, 'dim'],
  [/^o7$/, 'dim7'],
  [/^ø$/, 'm7b5'],
  [/^ø7$/, 'm7b5'],
  [/^m7-5$/, 'm7b5'],
  [/^\+$/, 'aug'],
  [/^add2$/i, 'add9'],
  [/^madd2$/i, 'madd9'],
  [/^7\(#9\)$/, '7#9'],
  [/^7\(b9\)$/, '7b9'],
]

/** Rewrite a UG symbol into music-core vocabulary where possible. */
export function normalizeUgSymbol(raw: string): string {
  const m = /^([A-Ga-g][#b]*)([^/]*)(\/[A-Ga-g][#b]*)?$/.exec(raw.trim())
  if (!m) return raw.trim()
  const [, root, suffix, bass] = m
  let normSuffix = suffix
  for (const [re, replacement] of SUFFIX_ALIASES) {
    if (re.test(suffix)) { normSuffix = replacement; break }
  }
  return `${root}${normSuffix}${bass ?? ''}`
}

/** Transpose a symbol up by `semis` (capo -> concert). Unparseable symbols
 * come back unchanged. */
export function transposeSymbol(symbol: string, semis: number): string {
  if (semis === 0) return symbol
  try {
    const c = parseChordSymbol(symbol)
    const t = { ...c, root: normalizePc(c.root + semis) }
    if (c.bass !== undefined) t.bass = normalizePc(c.bass + semis)
    return chordSymbol(t, t.root)
  } catch {
    return symbol
  }
}

function toToken(raw: string, capo: number): UgChordToken {
  const normalized = normalizeUgSymbol(raw)
  const concert = transposeSymbol(normalized, capo)
  let parseable = true
  try { parseChordSymbol(concert) } catch { parseable = false }
  return { symbol: concert, raw, parseable }
}

// --- the sheet content -------------------------------------------------------

const CH_RE = /\[ch\]([^[]*)\[\/ch\]/g

/** A raw line's chords with their columns in the DE-TAGGED line, plus the
 * de-tagged visible text. */
function chordsWithCols(rawLine: string, capo: number): { chords: SheetChord[]; text: string } {
  const chords: SheetChord[] = []
  let text = ''
  let last = 0
  CH_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CH_RE.exec(rawLine)) !== null) {
    text += rawLine.slice(last, m.index)
    const raw = m[1].trim()
    if (raw) chords.push({ ...toToken(raw, capo), col: text.length })
    text += m[1]
    last = m.index + m[0].length
  }
  text += rawLine.slice(last)
  return { chords, text: text.replace(/\s+$/, '') }
}

/** End-of-line repeat marker: 'x2' / '× 3', optionally inside a closing
 * paren. Anchored so fret grids ('x 5') and spellings ('x68676') don't hit. */
function lineRepeat(text: string): number | undefined {
  const m = /(?:^|[\s)])[x×]\s?([2-9])\s*\)?\s*$/i.exec(text)
  return m ? Number(m[1]) : undefined
}

/** A named-riff mention: 'Riff 1', 'Riff 1 x2' (chordless harmonic event). */
function riffMention(text: string): { ref: string; repeat?: number } | null {
  const m = /^\s*(riff\s*\d+)\s*(?:[x×]\s?([2-9]))?\s*$/i.exec(text)
  return m ? { ref: m[1].toLowerCase(), repeat: m[2] ? Number(m[2]) : undefined } : null
}

/** Chord-dictionary / fret-spelling line: '[ch]Am7[/ch] : 5x5550' or
 * '[ch]A[/ch] = (5-x-7-6-5-x)' — voicing notation, not music. */
function isChordDictionaryLine(residue: string): boolean {
  return /[:=]/.test(residue) && /\d/.test(residue)
}

/** A 6-string tab-staff line: 'e|---7-5---|', 'Bb|---0h2---|'. */
function isTabStaffLine(text: string): boolean {
  return /^\s*[eEbBgGdDaA][b#]?\|/.test(text)
}

/** Bracketed lines that are NOT section headers: prose instructions and
 * fret diagrams. They become annotations on the CURRENT section instead. */
function isProseHeader(label: string): boolean {
  if (/\d\s+\d/.test(label)) return true // '[Cm  8 10 10 888]' fret diagram
  if (label.length > 32) return true
  return /\b(plays?|uses?|says?|following|progression|breakdown|continually|except)\b/i.test(label)
}

/** 'play the same progression for the following 2 verses' → 2. */
function playSameForNext(text: string): number | undefined {
  const m = /same\s+(?:progression|chords|thing).*?(?:following|next)\s+(\d+|two|three|four)/i.exec(text)
  if (!m) return undefined
  const words: Record<string, number> = { two: 2, three: 3, four: 4 }
  return words[m[1].toLowerCase()] ?? Number(m[1])
}

/** 'Repeat Riff 1 and fade' / 'repeat till end' → open-ended tail. */
function isOpenEndedRepeat(text: string): boolean {
  return /repeat.*(and fade|to fade|till (the )?end|until (the )?end|to end)/i.test(text)
}

/**
 * Walk wiki_tab content LINE-WISE. `[Verse 1]`-style headers open sections;
 * `[tab]…[/tab]` blocks pair a chord line with its lyric line (219/220 of
 * the real-world corpus — the atom of the format); bare `[ch]` lines are
 * chord runs; chord columns, line repeats, riff mentions, and prose repeat
 * instructions are preserved — they're the sheet's own timing notation.
 * Chord dictionaries, fret diagrams, and prose "headers" are rejected as
 * music but mined for annotations.
 */
export function parseSheet(content: string, capo: number): UgSection[] {
  const sections: UgSection[] = []
  const seen = new Map<SectionKind, number>()
  let current: UgSection | null = null
  let discard = false // inside a [Chords] dictionary section

  const push = (label: string) => {
    const kind = sectionKindOf(label)
    current = { label, kind, ordinal: ordinalOf(label, kind, seen), chords: [], lines: [] }
    sections.push(current)
    discard = false
  }

  const addLine = (line: SheetLine) => {
    if (discard || line.chords.length === 0 && !line.riffRef) return
    if (!current) push('Intro')
    current!.lines.push(line)
    current!.chords.push(...line.chords.map(({ col: _col, ...token }) => token))
  }

  const handleHeader = (label: string, remainder: string) => {
    if (/^chords?$/i.test(label)) { discard = true; return }
    if (isProseHeader(label)) {
      // Annotation, not a section: mine it, keep the current section open.
      if (current) {
        const n = playSameForNext(label)
        if (n) current.playSameForNext = n
        if (isOpenEndedRepeat(label)) current.openEnded = true
      }
      return
    }
    push(label)
    const rep = lineRepeat(remainder)
    if (rep && current) current.repeat = rep
  }

  // Track [tab] blocks across lines; inside one, the first chord line and
  // the first following non-staff line form a pair.
  let inTab = false
  let pendingChordLine: { chords: SheetChord[]; text: string } | null = null

  const flushPending = () => {
    if (!pendingChordLine) return
    addLine({
      kind: 'run',
      chords: pendingChordLine.chords,
      lyricLen: 0,
      chordLineLen: pendingChordLine.text.length,
      repeat: lineRepeat(pendingChordLine.text),
    })
    pendingChordLine = null
  }

  for (const rawLine of content.split('\n')) {
    let line = rawLine.replace(/\r$/, '')
    const opens = /\[tab\]/i.test(line)
    const closes = /\[\/tab\]/i.test(line)
    line = line.replace(/\[\/?tab\]/gi, '')
    if (opens) { flushPending(); inTab = true }

    const headerMatch = /^\s*\[([^\]\r\n]+)\]\s*(.*)$/.exec(line)
    if (headerMatch && !/^\/?ch$/i.test(headerMatch[1].trim())) {
      flushPending()
      handleHeader(headerMatch[1].trim(), headerMatch[2])
      if (closes) inTab = false
      continue
    }

    const { chords, text } = chordsWithCols(line, capo)
    if (chords.length > 0) {
      if (isChordDictionaryLine(text.replace(/[A-Ga-g][#b]?[^\s:=]*/g, '').trim()) && /[:=]/.test(text)) {
        // '[ch]Am7[/ch] : 5x5550' — voicing notation, not music.
        if (closes) inTab = false
        continue
      }
      flushPending()
      if (inTab) {
        pendingChordLine = { chords, text }
      } else {
        addLine({ kind: 'run', chords, lyricLen: 0, chordLineLen: text.length, repeat: lineRepeat(text) })
      }
    } else if (text.trim().length > 0) {
      const riff = riffMention(text)
      if (riff) {
        flushPending()
        addLine({ kind: 'run', chords: [], lyricLen: 0, chordLineLen: text.length, riffRef: riff.ref, repeat: riff.repeat })
      } else if (pendingChordLine && !isTabStaffLine(text)) {
        // The lyric line under a pending chord line: a pair.
        addLine({
          kind: 'pair',
          chords: pendingChordLine.chords,
          lyricLen: text.length,
          chordLineLen: pendingChordLine.text.length,
          repeat: lineRepeat(text) ?? lineRepeat(pendingChordLine.text),
        })
        pendingChordLine = null
      } else {
        // Prose: mine annotations ('play the same…', 'repeat and fade').
        // (Local read: TS can't track closure writes to `current`.)
        const cur = current as UgSection | null
        if (cur) {
          const n = playSameForNext(text)
          if (n) cur.playSameForNext = n
          if (isOpenEndedRepeat(text)) cur.openEnded = true
        }
      }
    }

    if (closes) { flushPending(); inTab = false }
  }
  flushPending()

  // Empty sections are KEPT: a bare '[Verse 2]' header relies on the layout
  // hydrating it from the first same-kind section — dropping it would lose
  // the form. Only never-musical bracket noise was filtered above.
  return sections
}

// --- js-store walkers --------------------------------------------------------

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Standard-tuning open-string MIDI, low E → high e. */
const OPEN_MIDI = [40, 45, 50, 55, 59, 64]
/** UG's applicature `notes` are MIDI − 12 (verified against real charts:
 * G low-E 3rd fret = MIDI 43 arrives as 31). */
const UG_NOTE_OFFSET = 12

/** Absolute sounding frets (low→high) from the voicing's `notes` — immune
 * to UG's base-fret conventions. Null when notes are absent/implausible. */
function absoluteFretsFromNotes(v: unknown): number[] | null {
  const notes = get(v, ['notes'])
  if (!Array.isArray(notes) || notes.length !== 6 || !notes.every((n) => typeof n === 'number')) return null
  // UG lists strings high-e first; flip to the app's low→high convention.
  const lowFirst = [...(notes as number[])].reverse()
  const frets = lowFirst.map((n, i) => (n < 0 ? -1 : n + UG_NOTE_OFFSET - OPEN_MIDI[i]))
  return frets.every((f) => f === -1 || (f >= 0 && f <= 24)) ? frets : null
}

function parseApplicature(raw: unknown, capo: number): Record<string, UgVoicing[]> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: Record<string, UgVoicing[]> = {}
  for (const [symbol, variants] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(variants)) continue
    const voicings: UgVoicing[] = []
    for (const v of variants) {
      let frets = absoluteFretsFromNotes(v)
      if (!frets) {
        const rawFrets = get(v, ['frets'])
        if (!Array.isArray(rawFrets) || rawFrets.length !== 6 || !rawFrets.every((f) => typeof f === 'number')) continue
        // Fallback path: flip high-e-first to low→high and add the capo —
        // the symbol keys are transposed to concert pitch, so the frets
        // must sound in concert too (an open string rings AT the capo).
        frets = [...(rawFrets as number[])].reverse().map((f) => (f < 0 ? -1 : f + capo))
      }
      const fretted = frets.filter((f) => f > 0)
      voicings.push({ frets, baseFret: fretted.length > 0 ? Math.min(...fretted) : 1 })
    }
    if (voicings.length > 0) out[transposeSymbol(normalizeUgSymbol(symbol), capo)] = voicings
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Parse a UG tab page (already-extracted js-store JSON) into a UgChart. */
export function parseTabPage(store: unknown, url: string): UgChart {
  const tab = get(store, ['store', 'page', 'data', 'tab'])
  const tabView = get(store, ['store', 'page', 'data', 'tab_view'])
  const content = get(tabView, ['wiki_tab', 'content'])
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('tab page has no chord content (Official/Pro viewer payload?)')
  }
  const capo = num(get(tabView, ['meta', 'capo']), 0)
  const tonality = get(tab, ['tonality_name'])
  const type = get(tab, ['type'])
  const sections = parseSheet(content, capo)
  if (sections.every((s) => s.chords.length === 0)) {
    throw new Error('tab page content contained no [ch] chord markers')
  }
  return {
    tabId: num(get(tab, ['id'])),
    url,
    versionLabel: `v${num(get(tab, ['version']), 1)} by ${String(get(tab, ['username']) ?? 'unknown')}`,
    rating: num(get(tab, ['rating'])),
    votes: num(get(tab, ['votes'])),
    capo,
    tonalityName: typeof tonality === 'string' && tonality.length > 0 ? tonality : null,
    official: typeof type === 'string' && /official/i.test(type),
    sections,
    voicings: parseApplicature(get(tabView, ['applicature']), capo),
  }
}

/** Parse a UG search results page (js-store JSON) into version candidates. */
export function parseSearchPage(store: unknown): UgVersionInfo[] {
  const results = get(store, ['store', 'page', 'data', 'results'])
  if (!Array.isArray(results)) return []
  const out: UgVersionInfo[] = []
  for (const r of results) {
    const type = get(r, ['type'])
    if (typeof type !== 'string' || !/^(chords|official)$/i.test(type)) continue
    const urlRaw = get(r, ['tab_url'])
    if (typeof urlRaw !== 'string') continue
    const tonality = get(r, ['tonality_name'])
    out.push({
      tabId: num(get(r, ['id'])),
      url: urlRaw,
      versionLabel: `${String(get(r, ['song_name']) ?? '')} — ${String(get(r, ['artist_name']) ?? '')} (v${num(get(r, ['version']), 1)})`,
      type,
      rating: num(get(r, ['rating'])),
      votes: num(get(r, ['votes'])),
      tonalityName: typeof tonality === 'string' && tonality.length > 0 ? tonality : null,
      capo: null,
    })
  }
  return out
}
