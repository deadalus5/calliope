import type { UgChart, UgVersionInfo } from './types'

/**
 * Chart auto-pick policy — pure (the fetcher is injected, so this is
 * testable without got-scraping or the network).
 */

export interface FetchedTab {
  chart: UgChart
  /** Raw js-store JSON, cached to disk so parser fixes re-run offline. */
  rawStore: unknown
}

export type TabFetcher = (url: string, cookie?: string) => Promise<FetchedTab>

/** Community-version quality: rating weighted by vote volume. */
export function versionScore(v: UgVersionInfo): number {
  return v.rating * Math.log10(v.votes + 10)
}

/**
 * The user's rule: fully automatic. An Official chart is picked when its
 * content is actually fetchable (every Official gets a try before giving up
 * on them); otherwise the top-scored community chart is fetched outright —
 * the picker is a re-pick affordance in the app, never a gate. `fallbackReason`
 * records what happened for the provenance panel.
 */
export async function autoPickTab(
  versions: UgVersionInfo[],
  cookie: string | undefined,
  fetcher: TabFetcher,
): Promise<{ tab: FetchedTab; fallbackReason?: string }> {
  let officialFailure: string | undefined
  for (const official of versions.filter((v) => /official/i.test(v.type))) {
    try {
      return { tab: await fetcher(official.url, cookie) }
    } catch (e) {
      // Not embeddable (Pro viewer payload, cookie missing/expired) — try
      // the next Official before falling back to the community charts.
      officialFailure = `Official chart not fetchable: ${(e as Error).message}`
    }
  }
  const community = versions
    .filter((v) => /^chords$/i.test(v.type))
    .sort((a, b) => versionScore(b) - versionScore(a))
  if (community.length === 0) {
    throw new Error(officialFailure ?? 'no Chords versions found for this song on UG')
  }
  // A single dead tab page shouldn't sink the song — try the top few.
  let communityFailure: Error | null = null
  for (const v of community.slice(0, 3)) {
    try {
      const tab = await fetcher(v.url, cookie)
      return { tab, fallbackReason: officialFailure ?? 'auto-picked the top community chart' }
    } catch (e) {
      communityFailure = e as Error
    }
  }
  throw communityFailure ?? new Error('no fetchable Chords version found on UG')
}
