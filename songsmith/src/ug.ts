import { gotScraping } from 'got-scraping'
import { extractJsStore, parseSearchPage, parseTabPage } from './ug-parse'
import type { UgChart, UgVersionInfo } from './types'

/**
 * Ultimate Guitar over the wire. got-scraping generates browser-plausible
 * headers (the Cloudflare problem); parsing is all in ug-parse.ts against
 * the embedded js-store JSON. One user, low volume — be a polite client.
 */

const SEARCH_URL = 'https://www.ultimate-guitar.com/search.php'

async function fetchHtml(url: string, cookie?: string): Promise<string> {
  const res = await gotScraping({
    url,
    headers: cookie ? { cookie } : undefined,
    timeout: { request: 20_000 },
  })
  if (res.statusCode !== 200) {
    throw new Error(`UG returned HTTP ${res.statusCode} for ${url}`)
  }
  return res.body
}

export async function searchUg(artist: string, title: string, cookie?: string): Promise<UgVersionInfo[]> {
  const url = `${SEARCH_URL}?search_type=title&value=${encodeURIComponent(`${artist} ${title}`)}`
  const html = await fetchHtml(url, cookie)
  return parseSearchPage(extractJsStore(html))
}

export interface FetchedTab {
  chart: UgChart
  /** Raw js-store JSON, cached to disk so parser fixes re-run offline. */
  rawStore: unknown
}

export async function fetchTab(url: string, cookie?: string): Promise<FetchedTab> {
  const html = await fetchHtml(url, cookie)
  const rawStore = extractJsStore(html)
  return { chart: parseTabPage(rawStore, url), rawStore }
}

/** Community-version quality: rating weighted by vote volume. */
export function versionScore(v: UgVersionInfo): number {
  return v.rating * Math.log10(v.votes + 10)
}

/**
 * The user's rule: an Official chart is auto-picked when its content is
 * actually fetchable; otherwise the caller shows the community versions.
 * Returns either a fetched tab or the choices to surface.
 */
export async function autoPickTab(
  versions: UgVersionInfo[],
  cookie?: string,
): Promise<{ tab: FetchedTab; fallbackReason?: string } | { choices: UgVersionInfo[] }> {
  const officials = versions.filter((v) => /official/i.test(v.type))
  for (const official of officials) {
    try {
      return { tab: await fetchTab(official.url, cookie) }
    } catch (e) {
      // Official exists but isn't embeddable (Pro viewer payload, cookie
      // missing/expired) — fall through to the community list.
      const reason = `Official chart not fetchable: ${(e as Error).message}`
      const community = versions
        .filter((v) => /^chords$/i.test(v.type))
        .sort((a, b) => versionScore(b) - versionScore(a))
      if (community.length > 0) {
        const tab = await fetchTab(community[0].url, cookie)
        return { tab, fallbackReason: reason }
      }
      throw new Error(reason)
    }
  }
  const community = versions
    .filter((v) => /^chords$/i.test(v.type))
    .sort((a, b) => versionScore(b) - versionScore(a))
  if (community.length === 0) throw new Error('no Chords versions found for this song on UG')
  return { choices: community.slice(0, 8) }
}
