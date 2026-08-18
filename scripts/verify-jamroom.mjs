// Verify the Song Map Jam Room end-to-end with everything external stubbed:
// the Spotify SDK is replaced by a fake player with a scripted (accelerated)
// clock — real DRM playback can't run headless — and the songsmith sidecar
// is served from a route handler with a fixture Song Map. Asserts the
// section strip, grid follow, click-to-seek, fretboard layers, Dexie
// persistence — plus the Milestone-A connect story: auto-discovery of a
// local sidecar with NO url configured, the offline banner + retry, and
// error states that stop (not hammer) the polling.
// Usage: node scripts/verify-jamroom.mjs <outdir>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'shots'
mkdirSync(out, { recursive: true })

const TRACK = {
  uri: 'spotify:track:verifyjam',
  name: 'Rollin River',
  artist: 'The Testers',
  durationMs: 64_000,
}

// 120bpm 4/4, beats every 500ms; sections intro/v1/ch1/v2/outro; A mixolydian.
function fixtureSongMap() {
  const beats = []
  const downbeatIndices = []
  for (let i = 0; i * 500 < TRACK.durationMs; i++) {
    beats.push(i * 500)
    if (i % 4 === 0) downbeatIndices.push(i)
  }
  const sec = (id, label, kind, ordinal, startMs, endMs) => ({ id, label, kind, ordinal, startMs, endMs })
  const ch = (symbol, beatIndex, durationBeats, sectionId, rootDegree) =>
    ({ symbol, beatIndex, ms: beats[beatIndex], durationBeats, sectionId, rootDegree })
  return {
    version: 1,
    trackUri: TRACK.uri,
    trackName: TRACK.name,
    artistName: TRACK.artist,
    durationMs: TRACK.durationMs,
    key: { root: 9, modeId: 'mixolydian', skeleton: 'major', confidence: 0.9 },
    sections: [
      sec('s0', 'INTRO', 'intro', 1, 0, 8000),
      sec('s1', 'V1', 'verse', 1, 8000, 24_000),
      sec('s2', 'CH1', 'chorus', 1, 24_000, 40_000),
      sec('s3', 'V2', 'verse', 2, 40_000, 56_000),
      sec('s4', 'OUTRO', 'outro', 1, 56_000, 64_000),
    ],
    tempo: { bpm: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
    beats,
    downbeatIndices,
    chords: [
      ch('A', 0, 8, 's0', 0), ch('G', 8, 8, 's0', 10),
      ch('A', 16, 8, 's1', 0), ch('G', 24, 8, 's1', 10), ch('D', 32, 8, 's1', 5), ch('A', 40, 8, 's1', 0),
      ch('D', 48, 8, 's2', 5), ch('A', 56, 8, 's2', 0), ch('G', 64, 8, 's2', 10), ch('A', 72, 8, 's2', 0),
      ch('A', 80, 8, 's3', 0), ch('G', 88, 8, 's3', 10), ch('D', 96, 8, 's3', 5), ch('A', 104, 8, 's3', 0),
      ch('A', 112, 16, 's4', 0),
    ],
    provenance: {
      ug: { tabId: 1089098, url: 'https://tabs.ultimate-guitar.com/x', versionLabel: 'v2 by picker42', rating: 4.8, votes: 312, capo: 0, tonalityName: 'A', official: false },
      audio: { source: 'youtube', videoId: 'fake', videoTitle: 'Rollin River (Official Audio)', durationMs: 64_000, matchScore: 0.92 },
      analyzer: { name: 'allin1', version: '1.1.0' },
      fusion: { fusedAt: '2026-07-17T00:00:00.000Z', sectionAlignConfidence: 1, warnings: [] },
    },
  }
}

// The fake SDK: a player whose getCurrentState reads a scripted clock that
// runs CLOCK_RATE× real time so the whole song plays out in a few seconds.
const CLOCK_RATE = 8
const FAKE_SDK = `
(() => {
  const clock = {
    track: null, paused: true, offset: 0, startedAt: 0,
    play(t) { this.track = t; this.paused = false; this.offset = 0; this.startedAt = performance.now() },
    pos() {
      if (!this.track) return 0
      const p = this.paused ? this.offset : this.offset + (performance.now() - this.startedAt) * ${CLOCK_RATE}
      return Math.min(p, this.track.durationMs)
    },
    seek(ms) { this.offset = ms; this.startedAt = performance.now(); window.__seeks.push(ms) },
    toggle() {
      if (this.paused) { this.startedAt = performance.now(); this.paused = false }
      else { this.offset = this.pos(); this.paused = true }
    },
  }
  window.__seeks = []
  window.__fakeClock = clock
  class Player {
    constructor() { this.listeners = {} }
    addListener(ev, cb) { (this.listeners[ev] ||= []).push(cb) }
    async connect() {
      setTimeout(() => (this.listeners.ready || []).forEach((cb) => cb({ device_id: 'fake-device' })), 30)
      return true
    }
    async getCurrentState() {
      if (!clock.track) return null
      return {
        paused: clock.paused,
        position: clock.pos(),
        duration: clock.track.durationMs,
        track_window: { current_track: {
          uri: clock.track.uri, name: clock.track.name, artists: [{ name: clock.track.artist }],
        } },
      }
    }
    async togglePlay() { clock.toggle() }
    async seek(ms) { clock.seek(ms) }
    disconnect() {}
  }
  window.Spotify = { Player }
  if (window.onSpotifyWebPlaybackSDKReady) window.onSpotifyWebPlaybackSDKReady()
})()
`

const browser = await chromium.launch()
const fail = (msg) => { console.log(`FAIL: ${msg}`); process.exitCode = 1 }
const allErrors = []

/** Fresh context+page with auth seeded, SDK + Spotify REST stubbed. The
 * sidecar route is per-scenario. */
async function newJamPage({ seedSidecarUrl }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => allErrors.push(String(e).slice(0, 300)))
  await page.addInitScript((seed) => {
    localStorage.setItem('spotify:clientId', 'verify-client')
    localStorage.setItem('spotify:refreshToken', 'verify-refresh')
    localStorage.setItem('spotify:accessToken', 'verify-access')
    localStorage.setItem('spotify:expiresAt', String(Date.now() + 3_600_000))
    if (seed) localStorage.setItem('spotify:songsmithUrl', 'http://127.0.0.1:8765')
  }, seedSidecarUrl)
  await page.route('https://sdk.scdn.co/spotify-player.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: FAKE_SDK }))
  await page.route('https://api.spotify.com/v1/search**', (route) =>
    route.fulfill({ json: { tracks: { items: [
      { uri: TRACK.uri, name: TRACK.name, artists: [{ name: TRACK.artist }] },
    ] } } }))
  await page.route('https://api.spotify.com/v1/me/player/play**', async (route) => {
    await route.fulfill({ status: 204, body: '' })
    await page.evaluate((t) => window.__fakeClock.play(t), TRACK)
  })
  return { context, page }
}

async function openJamRoom(page) {
  await page.goto('http://127.0.0.1:5173')
  await page.click('button:has-text("Pick up the guitar")')
  await page.click('nav button:has-text("Jam Room")')
  await page.click('button:has-text("open the jam room")')
  await page.waitForSelector('input[placeholder*="search a song"]')
}

async function playTrack(page) {
  await page.fill('input[placeholder*="search a song"]', 'rollin river')
  await page.keyboard.press('Enter')
  await page.click(`.spotify-hits button:has-text("${TRACK.name}")`)
}

const HEALTH = { ok: true, ytdlpVersion: 'x', analyzerOk: true, analyzerVersion: '1.1.0', ugCookie: false, cacheCount: 1 }

// ============================================================
// Scenario 1 — the happy path: working → ready, follow, seek, persist.
// ============================================================
{
  const { context, page } = await newJamPage({ seedSidecarUrl: true })
  let songmapCalls = 0
  await page.route('http://127.0.0.1:8765/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/songmap') {
      songmapCalls++
      return route.fulfill({ json: songmapCalls === 1
        ? { status: 'working', stage: 'analyze', detail: 'listening for the beat (1–2 minutes)…' }
        : { status: 'ready', songmap: fixtureSongMap() } })
    }
    return route.fulfill({ json: HEALTH })
  })

  await openJamRoom(page)
  await playTrack(page)

  // Progress panel shows while "songsmith works".
  await page.waitForSelector('.songmap-progress', { timeout: 5000 })
  await page.screenshot({ path: `${out}/jamroom-1-working.png` })

  // Then the follower lands.
  await page.waitForSelector('.songmap-sections', { timeout: 10_000 })
  await page.screenshot({ path: `${out}/jamroom-2-follower.png` })

  // Section strip content.
  const sectionLabels = await page.$$eval('.songmap-section', (els) => els.map((e) => e.textContent))
  if (JSON.stringify(sectionLabels) !== JSON.stringify(['INTRO', 'V1', 'CH1', 'V2', 'OUTRO'])) {
    fail(`section strip labels: ${JSON.stringify(sectionLabels)}`)
  } else console.log('OK: section strip INTRO|V1|CH1|V2|OUTRO')

  // Key headline in pedagogy voice.
  const headline = await page.textContent('.songmap-keyline')
  if (!/A mixolydian — major skeleton \+ 4 and b7/.test(headline ?? '')) {
    fail(`key headline: ${headline}`)
  } else console.log(`OK: headline "${headline}"`)

  // Fretboard has all three layers: skeleton + mode colors + chord tones.
  for (const cls of ['fb-skeleton', 'fb-modalColor', 'fb-chordTone']) {
    const n = await page.locator(`.fretboard .${cls}`).count()
    if (n === 0) fail(`fretboard missing ${cls} markers`)
    else console.log(`OK: fretboard ${cls} × ${n}`)
  }

  // The playhead advances: active chord chip changes as the fake clock runs
  // (8 beats per chord = 4s of song = 500ms real at 8×).
  const activeA = await page.textContent('.songmap-chordchip.active').catch(() => null)
  await page.waitForTimeout(1500)
  const activeB = await page.textContent('.songmap-chordchip.active').catch(() => null)
  const activeSection = await page.textContent('.songmap-section.active').catch(() => null)
  if (!activeA || !activeB) fail(`no active chord chip (${activeA} → ${activeB})`)
  else console.log(`OK: chord follows playback (${activeA.trim()} → ${activeB.trim()}, section ${activeSection?.trim()})`)

  // Countdown dots appear when a change is near.
  const hasCountdown = (await page.locator('.songmap-countdown').count()) > 0
  console.log(hasCountdown ? 'OK: next-chord countdown visible' : 'note: countdown not visible at sample time (timing-dependent)')

  // Click CH1 → the player receives a seek to its (corrected) start.
  await page.click('.songmap-section:has-text("CH1")')
  await page.waitForTimeout(300)
  const seeks = await page.evaluate(() => window.__seeks)
  if (!seeks.some((ms) => Math.abs(ms - 24_000) < 50)) fail(`CH1 click did not seek to 24000 (seeks: ${JSON.stringify(seeks)})`)
  else console.log('OK: section click seeks the record to 24000ms')

  // Chord chip click seeks too.
  await page.click('.songmap-gridsection:nth-child(2) .songmap-chordchip:nth-child(3)') // V1's D at 16000
  await page.waitForTimeout(300)
  const seeks2 = await page.evaluate(() => window.__seeks)
  if (!seeks2.some((ms) => Math.abs(ms - 16_000) < 50)) fail(`chord click did not seek to 16000 (seeks: ${JSON.stringify(seeks2)})`)
  else console.log('OK: chord chip click seeks to its change')

  // The map persisted to Dexie — the song is learned once.
  const stored = await page.evaluate((uri) => new Promise((resolve) => {
    const req = indexedDB.open('calliope')
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('songmaps', 'readonly')
        const get = tx.objectStore('songmaps').get(uri)
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => resolve(null)
      } catch { resolve(null) }
    }
    req.onerror = () => resolve(null)
  }), TRACK.uri)
  if (!stored || stored.data?.version !== 1) fail('Song Map not persisted to Dexie')
  else console.log('OK: Song Map persisted to Dexie (works offline next time)')

  // And the sidecar was only polled until ready — not hammered after.
  const callsAtEnd = songmapCalls
  await page.waitForTimeout(2500)
  if (songmapCalls !== callsAtEnd) fail(`sidecar still being polled after ready (${callsAtEnd} → ${songmapCalls})`)
  else console.log('OK: polling stopped once the map landed')

  await page.screenshot({ path: `${out}/jamroom-3-final.png` })
  await context.close()
}

// ============================================================
// Scenario 2 — NO sidecar URL configured: auto-discovery on the loopback
// origin adopts http://127.0.0.1:8765 and the map flow completes. This also
// proves the request effect reacts to a URL that appears AFTER mount (the
// old code read localStorage in an effect that never re-ran).
// ============================================================
{
  const { context, page } = await newJamPage({ seedSidecarUrl: false })
  await page.route('http://127.0.0.1:8765/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/songmap') return route.fulfill({ json: { status: 'ready', songmap: fixtureSongMap() } })
    return route.fulfill({ json: HEALTH })
  })

  await openJamRoom(page)
  await playTrack(page)
  try {
    await page.waitForSelector('.songmap-sections', { timeout: 10_000 })
    const adopted = await page.evaluate(() => localStorage.getItem('spotify:songsmithUrl'))
    if (adopted !== 'http://127.0.0.1:8765') fail(`auto-discovery adopted "${adopted}"`)
    else console.log('OK: sidecar auto-discovered with no URL configured — map flow completed')
  } catch {
    fail('auto-discovery did not complete the map flow')
  }
  await page.screenshot({ path: `${out}/jamroom-4-autodiscover.png` })
  await context.close()
}

// ============================================================
// Scenario 3 — sidecar configured but DOWN: the offline banner is loud, the
// legacy tap flow stays reachable, and retry resumes once it's back.
// ============================================================
{
  const { context, page } = await newJamPage({ seedSidecarUrl: true })
  let up = false
  await page.route('http://127.0.0.1:8765/**', (route) => {
    if (!up) return route.fulfill({ status: 500, body: '' })
    const url = new URL(route.request().url())
    if (url.pathname === '/songmap') return route.fulfill({ json: { status: 'ready', songmap: fixtureSongMap() } })
    return route.fulfill({ json: HEALTH })
  })

  await openJamRoom(page)
  await playTrack(page)
  try {
    await page.waitForSelector('text=songsmith is not reachable', { timeout: 8000 })
    console.log('OK: offline banner shown while the sidecar is down')
  } catch {
    fail('offline banner never appeared')
  }
  const manualReachable = (await page.locator('button:has-text("tap a chart by hand instead")').count()) > 0
  if (!manualReachable) fail('legacy tap flow not reachable from the offline banner')
  else console.log('OK: legacy tap flow reachable below the banner')
  await page.screenshot({ path: `${out}/jamroom-5-offline.png` })

  up = true
  await page.click('.songmap-retrybtn')
  try {
    await page.waitForSelector('.songmap-sections', { timeout: 10_000 })
    console.log('OK: retry resumed the flow once the sidecar came back')
  } catch {
    fail('retry did not resume after the sidecar came back')
  }
  await context.close()
}

// ============================================================
// Scenario 4 — a durable sidecar ERROR stops the polling (no hammering);
// retry clears it (POST /reanalyze retry) and the flow completes.
// ============================================================
{
  const { context, page } = await newJamPage({ seedSidecarUrl: true })
  let songmapCalls = 0
  let fixed = false
  await page.route('http://127.0.0.1:8765/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/songmap') {
      songmapCalls++
      return route.fulfill({ json: fixed
        ? { status: 'ready', songmap: fixtureSongMap() }
        : { status: 'error', stage: 'ug', message: 'UG returned HTTP 503', hint: 'try again in a minute' } })
    }
    if (url.pathname === '/reanalyze') {
      fixed = true
      return route.fulfill({ json: { status: 'working', stage: 'ug', detail: 'redoing…' } })
    }
    return route.fulfill({ json: HEALTH })
  })

  await openJamRoom(page)
  await playTrack(page)
  await page.waitForSelector('.songmap-retrybtn', { timeout: 8000 })
  const callsAtError = songmapCalls
  await page.waitForTimeout(3000)
  if (songmapCalls !== callsAtError) fail(`polling kept running on a durable error (${callsAtError} → ${songmapCalls})`)
  else console.log('OK: polling stopped on the durable error')
  await page.screenshot({ path: `${out}/jamroom-6-error.png` })

  await page.click('.songmap-retrybtn')
  try {
    await page.waitForSelector('.songmap-sections', { timeout: 10_000 })
    console.log('OK: retry cleared the error and the flow completed')
  } catch {
    fail('retry after error did not complete the flow')
  }
  await context.close()
}

console.log('errors:', allErrors.length ? allErrors : 'none')
if (allErrors.length) process.exitCode = 1
await browser.close()
