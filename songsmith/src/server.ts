import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { execa } from 'execa'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { analyzerVersion } from './analyze'
import { TrackCache } from './cache'
import { loadConfig } from './config'
import { JobRunner, type Stage } from './jobs'
import { fetchLyrics } from './lyrics'
import { versionScore } from './pick'
import { ensureRateRender, parseRange, quantizeRate } from './serve-audio'
import { searchUg } from './ug'

/**
 * Songsmith — Calliope's Mac-mini sidecar. One instance, one user. The app
 * polls GET /songmap until it's ready; everything else is plumbing around
 * the job pipeline in jobs.ts.
 */

const config = loadConfig()
const jobs = new JobRunner(config)
const app = new Hono()

// Chrome's Private Network Access: a public HTTPS page (the GitHub Pages
// site) calling a private/tailnet address sends a preflight asking for this
// header. Answer it, or the browser drops the request before CORS even runs.
app.use('*', async (c, next) => {
  await next()
  if (c.req.method === 'OPTIONS' && c.req.header('access-control-request-private-network') === 'true') {
    c.res.headers.set('Access-Control-Allow-Private-Network', 'true')
  }
})
app.use('*', cors({
  origin: config.corsOrigins,
  allowHeaders: ['Content-Type', 'Range'],
  exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}))

app.get('/health', async (c) => {
  let ytdlpVersion: string | null = null
  try {
    const { stdout } = await execa(config.ytdlpPath, ['--version'], { timeout: 10_000 })
    ytdlpVersion = stdout.trim()
  } catch { /* stays null */ }
  const analyzer = await analyzerVersion(config)
  let cacheCount = 0
  try { cacheCount = readdirSync(config.cacheDir).length } catch { /* no cache yet */ }
  return c.json({
    ok: true,
    ytdlpVersion,
    analyzerOk: analyzer !== 'unknown',
    analyzerVersion: analyzer,
    ugCookie: Boolean(config.ugCookie),
    cacheCount,
  })
})

app.get('/songmap', (c) => {
  const trackUri = c.req.query('uri')
  const artist = c.req.query('artist')
  const title = c.req.query('title')
  const durationMs = Number(c.req.query('durationMs'))
  if (!trackUri) return c.json({ status: 'error', stage: 'ug', message: 'missing uri' }, 400)
  // Poll path: an active or finished job answers without full params.
  const existing = jobs.status(trackUri)
  if (existing) return c.json(existing)
  if (!artist || !title || !Number.isFinite(durationMs)) {
    return c.json({ status: 'error', stage: 'ug', message: 'missing artist/title/durationMs' }, 400)
  }
  return c.json(jobs.request({ trackUri, trackName: title, artistName: artist, durationMs }))
})

app.get('/versions', async (c) => {
  const artist = c.req.query('artist')
  const title = c.req.query('title')
  if (!artist || !title) return c.json({ message: 'missing artist/title' }, 400)
  try {
    const versions = await searchUg(artist, title, config.ugCookie)
    versions.sort((a, b) => versionScore(b) - versionScore(a))
    return c.json({ versions: versions.slice(0, 12) })
  } catch (e) {
    return c.json({ message: (e as Error).message }, 502)
  }
})

app.post('/pick', async (c) => {
  const body = await c.req.json<{ uri?: string; tabId?: number; youtubeUrl?: string }>()
  if (!body.uri) return c.json({ message: 'missing uri' }, 400)
  return c.json(jobs.pick(body.uri, { tabId: body.tabId, youtubeUrl: body.youtubeUrl }))
})

// Synced lyrics (LRCLIB), cache-first — fetched here so the app never
// fights CORS; runs outside the job queue (milliseconds, not minutes).
app.get('/lyrics', async (c) => {
  const uri = c.req.query('uri')
  const artist = c.req.query('artist')
  const title = c.req.query('title')
  const durationMs = Number(c.req.query('durationMs'))
  if (!uri || !artist || !title || !Number.isFinite(durationMs)) {
    return c.json({ message: 'missing uri/artist/title/durationMs' }, 400)
  }
  const cache = new TrackCache(config.cacheDir, uri)
  const cached = cache.readJson<object>('lyrics.json')
  if (cached) return c.json(cached)
  const doc = await fetchLyrics({ artistName: artist, trackName: title, durationMs })
  cache.writeJson('lyrics.json', doc)
  return c.json(doc)
})

// The practice deck's audio: cached analysis download, atempo renders per
// speed, range requests honored. One user on a LAN — whole-file reads are
// simpler than streams and plenty fast for ≤10MB files.
app.on(['GET', 'HEAD'], '/audio/:trackId', async (c) => {
  const rate = quantizeRate(c.req.query('rate'))
  if (rate === null) return c.json({ message: 'rate out of range (0.5–1.25)' }, 400)
  const cache = new TrackCache(config.cacheDir, c.req.param('trackId'))
  if (!cache.has('audio.m4a')) return c.json({ message: 'no cached audio for this track' }, 404)
  let path: string
  try {
    path = await ensureRateRender(cache, rate)
  } catch (e) {
    return c.json({ message: `render failed: ${(e as Error).message.slice(0, 200)}` }, 500)
  }
  const size = statSync(path).size
  const range = parseRange(c.req.header('range'), size)
  const base: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'audio/mp4',
  }
  if (range === 'invalid') {
    return c.body(null, 416, { ...base, 'Content-Range': `bytes */${size}` })
  }
  const isHead = c.req.method === 'HEAD'
  if (range) {
    const headers = {
      ...base,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(range.end - range.start + 1),
    }
    if (isHead) return c.body(null, 206, headers)
    return c.body(readFileSync(path).subarray(range.start, range.end + 1), 206, headers)
  }
  const headers = { ...base, 'Content-Length': String(size) }
  if (isHead) return c.body(null, 200, headers)
  return c.body(readFileSync(path), 200, headers)
})

app.post('/refine', async (c) => {
  const body = await c.req.json<{ uri?: string; artist?: string; title?: string; durationMs?: number }>()
  if (!body.uri) return c.json({ message: 'missing uri' }, 400)
  const params = body.artist && body.title && Number.isFinite(body.durationMs)
    ? { trackUri: body.uri, trackName: body.title, artistName: body.artist, durationMs: body.durationMs! }
    : undefined
  return c.json(jobs.refine(body.uri, params))
})

app.post('/reanalyze', async (c) => {
  const body = await c.req.json<{
    uri?: string
    stage?: Stage | 'all' | 'retry'
    artist?: string
    title?: string
    durationMs?: number
  }>()
  if (!body.uri) return c.json({ message: 'missing uri' }, 400)
  const params = body.artist && body.title && Number.isFinite(body.durationMs)
    ? { trackUri: body.uri, trackName: body.title, artistName: body.artist, durationMs: body.durationMs! }
    : undefined
  return c.json(jobs.reanalyze(body.uri, body.stage ?? 'all', params))
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`songsmith listening on http://127.0.0.1:${info.port}`)
  console.log(`cache: ${config.cacheDir}`)
  console.log(`UG cookie: ${config.ugCookie ? 'configured' : 'not set (community charts only)'}`)
})
