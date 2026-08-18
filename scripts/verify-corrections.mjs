// Verify Tap 2.0 corrections, section looping, and the learned-song library
// against the stubbed Jam Room (fake SDK clock + fixture sidecar, same
// approach as verify-jamroom.mjs). The tap test pauses the fake clock so the
// position estimate is frozen and the applied offset is exactly predictable.
// Usage: node scripts/verify-corrections.mjs <outdir>
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

// Fake SDK with a RUNTIME-ADJUSTABLE clock rate: taps need 1× (precision),
// loop wraps want 8× (speed).
const FAKE_SDK = `
(() => {
  window.__clockRate = 1
  const clock = {
    track: null, paused: true, offset: 0, startedAt: 0,
    play(t) { this.track = t; this.paused = false; this.offset = 0; this.startedAt = performance.now() },
    pos() {
      if (!this.track) return 0
      const p = this.paused ? this.offset : this.offset + (performance.now() - this.startedAt) * window.__clockRate
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
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
const fail = (msg) => { console.log(`FAIL: ${msg}`); process.exitCode = 1 }

await page.addInitScript(() => {
  localStorage.setItem('spotify:clientId', 'verify-client')
  localStorage.setItem('spotify:refreshToken', 'verify-refresh')
  localStorage.setItem('spotify:accessToken', 'verify-access')
  localStorage.setItem('spotify:expiresAt', String(Date.now() + 3_600_000))
  localStorage.setItem('spotify:songsmithUrl', 'http://127.0.0.1:8765')
})
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
await page.route('http://127.0.0.1:8765/**', (route) => {
  const url = new URL(route.request().url())
  if (url.pathname === '/songmap') return route.fulfill({ json: { status: 'ready', songmap: fixtureSongMap() } })
  return route.fulfill({ json: { ok: true, ytdlpVersion: 'x', analyzerOk: true, analyzerVersion: '1.1.0', ugCookie: false, cacheCount: 1 } })
})

async function openJamRoom() {
  await page.click('button:has-text("Pick up the guitar")')
  await page.click('nav button:has-text("Jam Room")')
  await page.click('button:has-text("open the jam room")')
  await page.waitForSelector('input[placeholder*="search a song"]')
}

await page.goto('http://127.0.0.1:5173')
await openJamRoom()
await page.fill('input[placeholder*="search a song"]', 'rollin river')
await page.keyboard.press('Enter')
await page.click(`.spotify-hits button:has-text("${TRACK.name}")`)
await page.waitForSelector('.songmap-sections', { timeout: 10_000 })

// --- Tap 2.0 -----------------------------------------------------------
await page.click('.songmap-fixbtn')
await page.waitForSelector('.songmap-tapbtn', { timeout: 3000 })
const nudgeCount = await page.locator('.songmap-nudge').count()
if (nudgeCount === 0) fail('no nudge affordances on chips while fix-timing is open')
else console.log(`OK: fix-timing opens (nudges × ${nudgeCount})`)

// Land just before CH1's change at 24000, let ~350ms of song elapse at 1×,
// pause — the position estimate freezes, so the tap's delta is exact.
await page.evaluate(() => window.__fakeClock.seek(23_900))
await page.waitForTimeout(450)
await page.evaluate(() => window.__fakeClock.toggle())
await page.waitForTimeout(400) // a paused poll lands; estimate frozen
const frozen = await page.evaluate(() => window.__fakeClock.pos())
await page.click('.songmap-tapbtn')
const expected = Math.round(frozen - 24_000)
console.log(`note: tapped at frozen ${frozen.toFixed(0)}ms (expect chorus offset ${expected}ms)`)

const readout = await page.textContent('.songmap-tapreadout').catch(() => null)
if (!readout || !readout.includes('chorus 1')) fail(`tap readout: ${readout}`)
else console.log(`OK: tap readout "${readout.trim()}"`)

// Persisted (debounced 800ms) to the songcorrections table with the
// structural key.
await page.waitForTimeout(1400)
const savedOffset = await page.evaluate((uri) => new Promise((resolve) => {
  const req = indexedDB.open('calliope')
  req.onsuccess = () => {
    try {
      const get = req.result.transaction('songcorrections', 'readonly').objectStore('songcorrections').get(uri)
      get.onsuccess = () => resolve(get.result?.data?.sectionOffsets?.['chorus:1'] ?? null)
      get.onerror = () => resolve(null)
    } catch { resolve(null) }
  }
  req.onerror = () => resolve(null)
}), TRACK.uri)
if (savedOffset !== expected) fail(`persisted chorus offset ${savedOffset}, expected ${expected}`)
else console.log(`OK: tap persisted as sectionOffsets["chorus:1"] = ${savedOffset}ms`)

// A CH1 section click now seeks to the corrected start.
await page.click('.songmap-section:has-text("CH1")')
await page.waitForTimeout(300)
const seeks = await page.evaluate(() => window.__seeks)
const lastSeek = seeks[seeks.length - 1]
if (Math.abs(lastSeek - (24_000 + expected)) > 2) fail(`CH1 seek went to ${lastSeek}, expected ${24_000 + expected}`)
else console.log(`OK: section seek honors the tap (${lastSeek}ms)`)
await page.screenshot({ path: `${out}/corrections-1-tap.png` })
await page.click('.songmap-fixbtn') // close the bar

// --- Section loop ------------------------------------------------------
// Speed the clock up and loop CH1: expect repeated seeks back to its start.
await page.evaluate((start) => {
  window.__clockRate = 8
  window.__fakeClock.seek(start + 20)
  if (window.__fakeClock.paused) window.__fakeClock.toggle()
}, 24_000 + expected)
await page.waitForSelector('.songmap-loopbtn', { timeout: 4000 })
const seeksBeforeLoop = (await page.evaluate(() => window.__seeks)).length
await page.click('.songmap-loopbtn')
await page.waitForTimeout(5500) // CH1 = 16s of song = 2s real per pass at 8×
const loopSeeks = (await page.evaluate(() => window.__seeks))
  .slice(seeksBeforeLoop)
  .filter((ms) => Math.abs(ms - (24_000 + expected)) < 200)
if (loopSeeks.length < 2) fail(`section loop wrapped ${loopSeeks.length}× (wanted ≥2)`)
else console.log(`OK: CH1 loop wrapped ${loopSeeks.length}× back to ${24_000 + expected}ms`)
await page.screenshot({ path: `${out}/corrections-2-loop.png` })

// --- Learned-song library ----------------------------------------------
await page.reload()
await openJamRoom()
await page.waitForSelector('.songmap-library', { timeout: 5000 })
const row = await page.textContent('.songmap-libplay')
if (!row?.includes(TRACK.name) || !/mixolydian/.test(row)) fail(`library row: ${row}`)
else console.log(`OK: library lists "${TRACK.name}" with its key headline`)
await page.screenshot({ path: `${out}/corrections-3-library.png` })
await page.click('.songmap-libplay')
await page.waitForSelector('.spotify-now', { timeout: 5000 })
await page.waitForSelector('.songmap-sections', { timeout: 5000 })
console.log('OK: library row starts playback and the follower lands')

console.log('errors:', errors.length ? errors : 'none')
if (errors.length) process.exitCode = 1
await browser.close()
