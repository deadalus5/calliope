import { chordSymbol, normalizePc, parseChordSymbol } from '../../src/music-core'
import type { SectionKind, UgVoicing } from '../../src/integrations/spotify/songmap'
import type { UgChart, UgChordToken, UgSection, UgVersionInfo } from './types'

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

/**
 * Walk wiki_tab content: `[Verse 1]`-style headers open sections, `[ch]X[/ch]`
 * tokens are chords in written order. Chords before any header land in an
 * implicit first section.
 */
export function parseSheet(content: string, capo: number): UgSection[] {
  const sections: UgSection[] = []
  const seen = new Map<SectionKind, number>()
  let current: UgSection | null = null

  const push = (label: string) => {
    const kind = sectionKindOf(label)
    current = { label, kind, ordinal: ordinalOf(label, kind, seen), chords: [] }
    sections.push(current)
  }

  // Split into header / chord tokens, in document order.
  const re = /\[(?:(ch)\]([^[]*)\[\/ch\]|([^\][\r\n]+)\])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m[1] === 'ch') {
      const raw = m[2].trim()
      if (!raw) continue
      if (!current) push('Intro')
      current!.chords.push(toToken(raw, capo))
    } else {
      const label = m[3].trim()
      // [tab]/[/tab] wrap lyric/chord line pairs; skip non-section brackets.
      if (/^\/?tab$/i.test(label)) continue
      push(label)
    }
  }
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

function parseApplicature(raw: unknown, capo: number): Record<string, UgVoicing[]> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: Record<string, UgVoicing[]> = {}
  for (const [symbol, variants] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(variants)) continue
    const voicings: UgVoicing[] = []
    for (const v of variants) {
      const frets = get(v, ['frets'])
      if (!Array.isArray(frets) || !frets.every((f) => typeof f === 'number')) continue
      voicings.push({ frets: frets as number[], baseFret: num(get(v, ['fret']), 1) })
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
