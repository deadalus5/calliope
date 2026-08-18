import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { analyzerVersion, runAnalyzer, toAnalyzerResult } from './analyze'
import { downloadAudio, MATCH_THRESHOLD, searchCandidates, videoIdFromUrl } from './audio'
import { TrackCache } from './cache'
import { PACKAGE_ROOT, type SongsmithConfig } from './config'
import { fuse } from './fuse'
import { autoPickTab } from './pick'
import { applyRefinement, buildRefineRequest, type RefineResponse } from './refine'
import { statusFromDisk, type JobStatus, type Stage, type TrackParams } from './status'
import { extractJsStore, parseTabPage } from './ug-parse'
import { fetchTab, searchUg } from './ug'
import type { AnalyzerResult, AudioMatch, UgChart } from './types'
import type { SongMap } from '../../src/integrations/spotify/songmap'

/**
 * The pipeline: ug -> audio -> analyze -> fuse, one job at a time (the
 * analyzer saturates the machine anyway). Every stage's output is cached, so
 * a re-run after a pick or an error only does the missing work.
 */

export { statusFromDisk }
export type { JobStatus, Stage, TrackParams }

interface JobState {
  running: boolean
  current: JobStatus
  params: TrackParams
}

const HINTS: [RegExp, string][] = [
  [/ENOENT.*yt-dlp|yt-dlp.*ENOENT/i, 'yt-dlp not found — brew install yt-dlp'],
  [/analyzer not installed/i, 'run songsmith/setup.sh once to build the Python venv'],
  [/librosa|refine_chroma|No module named/i, 'the refiner needs librosa — re-run songsmith/setup.sh once'],
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

  /** The map a reader should get: refined when present, else the fused one. */
  private bestMap(cache: TrackCache): SongMap | null {
    return cache.readJson<SongMap>('songmap.refined.json') ?? cache.readJson<SongMap>('songmap.json')
  }

  /** Current state for a track; starts the pipeline if nothing exists yet. */
  request(params: TrackParams): JobStatus {
    const cache = new TrackCache(this.config.cacheDir, params.trackUri)
    const job = this.jobs.get(params.trackUri)
    if (job?.running) return job.current
    // Not running: the disk is the truth — a durable error or pending pick
    // must not silently restart the pipeline (retry/pick are the way out).
    const disk = statusFromDisk(cache.readMeta(), this.bestMap(cache))
    if (disk) return disk
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
    const job = this.jobs.get(trackUri)
    if (job?.running) return job.current
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    return statusFromDisk(cache.readMeta(), this.bestMap(cache)) ?? job?.current ?? null
  }

  /** Chroma-refine an already-fused map. Non-destructive: writes
   * songmap.refined.json beside the original, or nothing when the gate
   * refuses — a refine failure never costs a working map. */
  refine(trackUri: string, params?: TrackParams): JobStatus {
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    const p = params ?? this.paramsOf(trackUri, cache)
    if (!p) return { status: 'error', stage: 'refine', message: 'unknown track — request the songmap first' }
    const already = cache.readJson<SongMap>('songmap.refined.json')
    if (already) return { status: 'ready', songmap: already }
    const fused = cache.readJson<SongMap>('songmap.json')
    if (!fused) return { status: 'error', stage: 'refine', message: 'no Song Map to refine yet' }
    if (!cache.has('audio.m4a')) return { status: 'error', stage: 'refine', message: 'no cached audio for this song — redo it first' }
    const existing = this.jobs.get(trackUri)
    if (existing?.running) return existing.current
    const state: JobState = {
      running: true,
      current: { status: 'working', stage: 'refine', detail: 'listening closer — lining chords up with the chroma…' },
      params: p,
    }
    this.jobs.set(trackUri, state)
    this.enqueue(() => this.runRefine(state, cache, fused))
    return state.current
  }

  private async runRefine(state: JobState, cache: TrackCache, fused: SongMap): Promise<void> {
    try {
      const req = buildRefineRequest(fused, cache.path('audio.m4a'))
      cache.writeJson('refine-request.json', req)
      const py = join(this.config.venvDir, 'bin', 'python')
      const script = join(PACKAGE_ROOT, 'py', 'refine_chroma.py')
      const { stdout } = await execa(py, [script, cache.path('refine-request.json')], { timeout: 300_000 })
      const lines = stdout.trim().split('\n')
      const res = JSON.parse(lines[lines.length - 1]) as RefineResponse
      if (res.error) throw new Error(res.error)
      const refined = applyRefinement(fused, res, new Date().toISOString())
      if (refined) cache.writeJson('songmap.refined.json', refined)
      // Gate refused ⇒ the fused timing stands; either way the reader gets
      // a ready map and the badge tells the user which one.
      state.current = { status: 'ready', songmap: refined ?? fused }
      state.running = false
    } catch (e) {
      // Deliberately NOT written to meta.lastError: a refine failure must
      // never turn a working song into a durable error state.
      const message = (e as Error).message
      console.error(`refine failed for ${state.params.trackUri}: ${message.slice(0, 300)}`)
      state.current = { status: 'error', stage: 'refine', message, hint: hintFor(message) }
      state.running = false
    }
  }

  /** Track identity from memory or the persisted meta (post-restart picks). */
  private paramsOf(trackUri: string, cache: TrackCache): TrackParams | null {
    const inMem = this.jobs.get(trackUri)?.params
    if (inMem) return inMem
    const saved = cache.readMeta().params
    return saved
      ? { trackUri, trackName: saved.trackName, artistName: saved.artistName, durationMs: saved.durationMs }
      : null
  }

  /** Apply a user pick (UG version or YouTube URL) and re-run what's needed. */
  pick(trackUri: string, choice: { tabId?: number; youtubeUrl?: string }): JobStatus {
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    const params = this.paramsOf(trackUri, cache)
    if (!params) return { status: 'error', stage: 'ug', message: 'unknown track — request the songmap first' }
    const meta = cache.readMeta()
    meta.lastError = undefined
    if (choice.tabId !== undefined) {
      meta.chosenTabId = choice.tabId
      meta.pendingVersions = undefined
      cache.remove('songmap.json') // chart changed; analysis cache survives
      cache.remove('songmap.refined.json')
    }
    if (choice.youtubeUrl !== undefined) {
      const id = videoIdFromUrl(choice.youtubeUrl)
      if (!id) return { status: 'error', stage: 'audio', message: 'that does not look like a YouTube URL' }
      meta.chosenVideoId = id
      meta.pendingAudio = undefined
      cache.remove('audio.m4a')
      cache.remove('allin1.json')
      cache.remove('songmap.json')
      cache.remove('songmap.refined.json')
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

  /**
   * Cache-bust a stage and re-run. 'retry' busts nothing — it clears the
   * durable error and re-runs the pipeline, which skips every cached stage,
   * so a transient failure (UG hiccup, network) costs no repeated work.
   */
  reanalyze(trackUri: string, stage: Stage | 'all' | 'retry', params?: TrackParams): JobStatus {
    const cache = new TrackCache(this.config.cacheDir, trackUri)
    const p = params ?? this.paramsOf(trackUri, cache)
    if (!p) return { status: 'error', stage: 'ug', message: 'unknown track — request the songmap first' }
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
    if (stage !== 'retry') {
      cache.remove('songmap.json')
      cache.remove('songmap.refined.json')
    }
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
      const meta = cache.readMeta()
      meta.trackUri = params.trackUri
      meta.params = { trackName: params.trackName, artistName: params.artistName, durationMs: params.durationMs }
      meta.lastError = undefined
      cache.writeMeta(meta)

      // --- Stage: UG chart -------------------------------------------------
      this.setStage(state, 'ug', 'finding the chart on Ultimate Guitar…')
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
        const picked = await autoPickTab(versions, this.config.ugCookie, fetchTab)
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
            videoId: meta.chosenVideoId, videoTitle: 'user-picked', channel: '',
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
        analyzerName: 'allin1',
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
