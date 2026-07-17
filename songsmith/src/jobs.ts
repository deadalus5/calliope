import { mkdirSync } from 'node:fs'
import { analyzerVersion, runAnalyzer, toAnalyzerResult } from './analyze'
import { downloadAudio, MATCH_THRESHOLD, searchCandidates, videoIdFromUrl } from './audio'
import { TrackCache } from './cache'
import type { SongsmithConfig } from './config'
import { fuse } from './fuse'
import { extractJsStore, parseTabPage } from './ug-parse'
import { autoPickTab, fetchTab, searchUg } from './ug'
import type { AnalyzerResult, AudioMatch, UgChart, UgVersionInfo } from './types'
import type { SongMap } from '../../src/integrations/spotify/songmap'

/**
 * The pipeline: ug -> audio -> analyze -> fuse, one job at a time (the
 * analyzer saturates the machine anyway). Every stage's output is cached, so
 * a re-run after a pick or an error only does the missing work.
 */

export type Stage = 'ug' | 'audio' | 'analyze' | 'fuse'

export type JobStatus =
  | { status: 'ready'; songmap: SongMap }
  | { status: 'working'; stage: Stage; detail: string }
  | { status: 'pick'; versions?: UgVersionInfo[]; audioCandidates?: AudioMatch[] }
  | { status: 'error'; stage: Stage; message: string; hint?: string }

export interface TrackParams {
  trackUri: string
  trackName: string
  artistName: string
  durationMs: number
}

interface JobState {
  running: boolean
  current: JobStatus
  params: TrackParams
}

const HINTS: [RegExp, string][] = [
  [/ENOENT.*yt-dlp|yt-dlp.*ENOENT/i, 'yt-dlp not found — brew install yt-dlp'],
  [/analyzer not installed/i, 'run songsmith/setup.sh once to build the Python venv'],
  [/js-store/i, 'UG may have served a challenge page — try again in a minute'],
  [/no Chords versions/i, 'no usable chart on UG — the manual tap chart still works'],
  [/no chord content/i, 'the Official chart needs a logged-in UG Pro cookie in songsmith/config.json'],
]

function hintFor(message: string): string | undefined {
  for (const [re, hint] of HINTS) if (re.test(message)) return hint
  return undefined
}

export class JobRunner {
  private jobs = new Map<string, JobState>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private config: SongsmithConfig) {}

  /** Current state for a track; starts the pipeline if nothing exists yet. */
  request(params: TrackParams): JobStatus {
    const cache = new TrackCache(this.config.cacheDir, params.trackUri)
    const existing = cache.readJson<SongMap>('songmap.json')
    if (existing) return { status: 'ready', songmap: existing }

    const job = this.jobs.get(params.trackUri)
    if (job) return job.current

    const state: JobState = {
      running: true,
      current: { status: 'working', stage: 'ug', detail: 'finding the chart…' },
      params,
    }
    this.jobs.set(params.trackUri, state)
    this.enqueue(() => this.run(state, cache))
    return state.current
  }

  status(trackUri: string): JobStatus | null {
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    const existing = cache.readJson<SongMap>('songmap.json')
    if (existing) return { status: 'ready', songmap: existing }
    return this.jobs.get(trackUri)?.current ?? null
  }

  /** Apply a user pick (UG version or YouTube URL) and re-run what's needed. */
  pick(trackUri: string, choice: { tabId?: number; youtubeUrl?: string }): JobStatus {
    const job = this.jobs.get(trackUri)
    const params = job?.params
    if (!params) return { status: 'error', stage: 'ug', message: 'no active job for this track — request the songmap first' }
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    const meta = cache.readMeta()
    if (choice.tabId !== undefined) {
      meta.chosenTabId = choice.tabId
      meta.pendingVersions = undefined
      cache.remove('songmap.json') // chart changed; analysis cache survives
    }
    if (choice.youtubeUrl !== undefined) {
      const id = videoIdFromUrl(choice.youtubeUrl)
      if (!id) return { status: 'error', stage: 'audio', message: 'that does not look like a YouTube URL' }
      meta.chosenVideoId = id
      meta.pendingAudio = undefined
      cache.remove('audio.m4a')
      cache.remove('allin1.json')
      cache.remove('songmap.json')
    }
    cache.writeMeta(meta)
    const state: JobState = {
      running: true,
      current: { status: 'working', stage: 'ug', detail: 'starting over with your pick…' },
      params,
    }
    this.jobs.set(trackUri, state)
    this.enqueue(() => this.run(state, cache))
    return state.current
  }

  /** Cache-bust a stage and re-run. */
  reanalyze(trackUri: string, stage: Stage | 'all', params?: TrackParams): JobStatus {
    const job = this.jobs.get(trackUri)
    const p = params ?? job?.params
    if (!p) return { status: 'error', stage: 'ug', message: 'unknown track — request the songmap first' }
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    if (stage === 'ug' || stage === 'all') {
      const meta = cache.readMeta()
      if (meta.chosenTabId) cache.remove(`ug-${meta.chosenTabId}.json`)
      meta.chosenTabId = undefined
      cache.writeMeta(meta)
    }
    if (stage === 'audio' || stage === 'all') {
      cache.remove('audio.m4a')
      cache.remove('allin1.json')
    }
    if (stage === 'analyze' || stage === 'all') cache.remove('allin1.json')
    cache.remove('songmap.json')
    const state: JobState = {
      running: true,
      current: { status: 'working', stage: 'ug', detail: 'redoing…' },
      params: p,
    }
    this.jobs.set(trackUri, state)
    this.enqueue(() => this.run(state, cache))
    return state.current
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work, work)
  }

  private setStage(state: JobState, stage: Stage, detail: string): void {
    state.current = { status: 'working', stage, detail }
  }

  private async run(state: JobState, cache: TrackCache): Promise<void> {
    const { params } = state
    let stage: Stage = 'ug'
    try {
      cache.ensureDir()

      // --- Stage: UG chart -------------------------------------------------
      this.setStage(state, 'ug', 'finding the chart on Ultimate Guitar…')
      const meta = cache.readMeta()
      meta.trackUri = params.trackUri
      let chart: UgChart
      let fallbackReason: string | undefined
      const cachedRaw = meta.chosenTabId ? cache.readJson<{ url: string; store: unknown }>(`ug-${meta.chosenTabId}.json`) : null
      if (cachedRaw) {
        chart = parseTabPage(cachedRaw.store, cachedRaw.url)
      } else if (meta.chosenTabId) {
        const versions = await searchUg(params.artistName, params.trackName, this.config.ugCookie)
        const v = versions.find((x) => x.tabId === meta.chosenTabId)
        if (!v) throw new Error(`picked tab ${meta.chosenTabId} not found in UG search results`)
        const fetched = await fetchTab(v.url, this.config.ugCookie)
        chart = fetched.chart
        cache.writeJson(`ug-${chart.tabId}.json`, { url: v.url, store: fetched.rawStore })
      } else {
        const versions = await searchUg(params.artistName, params.trackName, this.config.ugCookie)
        const picked = await autoPickTab(versions, this.config.ugCookie)
        if ('choices' in picked) {
          meta.pendingVersions = picked.choices
          cache.writeMeta(meta)
          state.current = { status: 'pick', versions: picked.choices }
          state.running = false
          return
        }
        chart = picked.tab.chart
        fallbackReason = picked.fallbackReason
        meta.chosenTabId = chart.tabId
        cache.writeJson(`ug-${chart.tabId}.json`, { url: chart.url, store: picked.tab.rawStore })
      }
      cache.writeMeta(meta)

      // --- Stage: audio ----------------------------------------------------
      stage = 'audio'
      let audioProv: AudioMatch
      const savedAudio = cache.readJson<AudioMatch>('audio-match.json')
      if (savedAudio && cache.has('audio.m4a')) {
        audioProv = savedAudio
      } else {
        this.setStage(state, 'audio', 'finding the recording…')
        if (meta.chosenVideoId) {
          audioProv = {
            videoId: String(meta.chosenVideoId), videoTitle: 'user-picked', channel: '',
            durationMs: params.durationMs, matchScore: 1,
          }
        } else {
          const candidates = await searchCandidates(this.config.ytdlpPath, {
            artist: params.artistName, title: params.trackName, durationMs: params.durationMs,
          })
          if (candidates.length === 0 || candidates[0].matchScore < MATCH_THRESHOLD) {
            meta.pendingAudio = candidates.slice(0, 6)
            cache.writeMeta(meta)
            state.current = { status: 'pick', audioCandidates: candidates.slice(0, 6) }
            state.running = false
            return
          }
          audioProv = candidates[0]
        }
        this.setStage(state, 'audio', `fetching audio (${audioProv.videoTitle.slice(0, 60)})…`)
        await downloadAudio(this.config.ytdlpPath, audioProv.videoId, cache.path('audio.m4a'))
        cache.writeJson('audio-match.json', audioProv)
      }

      // --- Stage: analyze ----------------------------------------------------
      stage = 'analyze'
      let analyzer = cache.readJson<AnalyzerResult>('allin1.json')
      if (!analyzer) {
        this.setStage(state, 'analyze', 'listening for the beat (1–2 minutes)…')
        const outDir = cache.path('allin1-out')
        mkdirSync(outDir, { recursive: true })
        analyzer = await runAnalyzer(this.config, cache.path('audio.m4a'), outDir)
        cache.writeJson('allin1.json', analyzer)
      }

      // --- Stage: fuse -------------------------------------------------------
      stage = 'fuse'
      this.setStage(state, 'fuse', 'fusing chart and recording…')
      const version = await analyzerVersion(this.config)
      const songmap = fuse({
        trackUri: params.trackUri,
        trackName: params.trackName,
        artistName: params.artistName,
        durationMs: params.durationMs,
        ug: chart,
        analyzer,
        audio: {
          source: 'youtube',
          videoId: audioProv.videoId,
          videoTitle: audioProv.videoTitle,
          durationMs: audioProv.durationMs,
          matchScore: audioProv.matchScore,
        },
        analyzerName: this.config.analyzer === 'mlx' ? 'all-in-one-mlx' : 'allin1',
        analyzerVersion: version,
        now: new Date().toISOString(),
      })
      if (fallbackReason) songmap.provenance.ug.fallbackReason = fallbackReason
      cache.writeJson('songmap.json', songmap)
      state.current = { status: 'ready', songmap }
      state.running = false
    } catch (e) {
      const message = (e as Error).message
      const meta = cache.readMeta()
      meta.lastError = { stage, message, hint: hintFor(message) }
      cache.writeMeta(meta)
      state.current = { status: 'error', stage, message, hint: hintFor(message) }
      state.running = false
    }
  }
}

export { extractJsStore, toAnalyzerResult } // re-exported for tests/tools
