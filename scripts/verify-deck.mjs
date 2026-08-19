// Verify the practice deck against the stubbed Jam Room: mode toggle pauses
// the record, the deck's ctx-derived clock drives the chord grid with no
// Spotify clock at all, BPM-tied slow-down actually slows song time, the
// native section loop wraps, and corrections work on the deck transport.
// The "sidecar" serves generated silent WAVs per rate (the deck's math is
// clock-derived, not sample-derived, so silence is enough).
// Usage: node scripts/verify-deck.mjs <outdir>
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

/** Silent 16-bit mono WAV of the given length — decodeAudioData-ready. */
function wavSilence(seconds) {
  const sr = 8000
  const n = Math.round(sr * seconds)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  return buf
}

const FAKE_SDK = `
(() => {
  const clock = {
    track: null, paused: true, offset: 0, startedAt: 0,
    play(t) { this.track = t; this.paused = false; this.offset = 0; this.startedAt = performance.now() },
    pos() {
      if (!this.track) return 0
      const p = this.paused ? this.offset : this.offset + (performance.now() - this.startedAt)
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
  if (url.pathname.startsWith('/audio/')) {
    const rate = Number(url.searchParams.get('rate') ?? '1')
    if (route.request().method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'Accept-Ranges': 'bytes' }, body: '' })
    }
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wavSilence(64 / rate) })
  }
  if (url.pathname === '/songmap') return route.fulfill({ json: { status: 'ready', songmap: fixtureSongMap() } })
  return route.fulfill({ json: { ok: true, ytdlpVersion: 'x', analyzerOk: true, analyzerVersion: '1.1.0', ugCookie: false, cacheCount: 1 } })
})

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('nav button:has-text("Jam Room")')
await page.click('button:has-text("open the jam room")')
await page.waitForSelector('input[placeholder*="search a song"]')
await page.fill('input[placeholder*="search a song"]', 'rollin river')
await page.keyboard.press('Enter')
await page.click(`.spotify-hits button:has-text("${TRACK.name}")`)
await page.waitForSelector('.songmap-sections', { timeout: 10_000 })

// --- Enter the deck -----------------------------------------------------
await page.waitForSelector('.songmap-modepanel', { timeout: 5000 })
await page.click('.songmap-modepanel button:has-text("practice deck")')
await page.waitForSelector('.songmap-deckplay', { timeout: 10_000 })
const spotifyPaused = await page.evaluate(() => window.__fakeClock.paused)
if (!spotifyPaused) fail('entering the deck did not pause the record')
else console.log('OK: deck mode pauses the record (never two renditions)')

// --- Deck clock drives the grid ----------------------------------------
await page.click('.songmap-deckplay')
await page.waitForTimeout(500)
const pos = () => page.evaluate(() => window.__calliope.deck.positionMs())
const p1 = await pos()
await page.waitForTimeout(2000)
const p2 = await pos()
const d1 = p2 - p1
if (!(d1 > 1600 && d1 < 2400)) fail(`deck position advanced ${d1}ms over 2s at 1× (expected ~2000)`)
else console.log(`OK: deck clock runs (Δ ${Math.round(d1)}ms over 2s at 1×)`)
const activeChip = await page.locator('.songmap-chordchip.active').count()
if (activeChip === 0) fail('no active chord chip under the deck clock')
else console.log('OK: chord grid follows the deck clock (no Spotify clock involved)')
await page.screenshot({ path: `${out}/deck-1-playing.png` })

// --- BPM-tied slow-down --------------------------------------------------
for (let i = 0; i < 4; i++) {
  await page.waitForSelector('.songmap-deck button:has-text("−5"):not([disabled])', { timeout: 8000 })
  await page.click('.songmap-deck button:has-text("−5")')
}
await page.waitForSelector('.songmap-deckbpm:has-text("100 bpm")', { timeout: 10_000 })
await page.waitForTimeout(400)
const p3 = await pos()
await page.waitForTimeout(2000)
const p4 = await pos()
const d2 = p4 - p3
// 100 of 120 bpm ⇒ rate 0.83: ~1667ms of song per 2s of wall clock.
if (!(d2 > 1400 && d2 < 1900)) fail(`deck position advanced ${d2}ms over 2s at 100bpm (expected ~1667)`)
else console.log(`OK: 100 bpm of 120 slows song time (Δ ${Math.round(d2)}ms over 2s)`)
await page.screenshot({ path: `${out}/deck-2-slow.png` })

// --- Native section loop -------------------------------------------------
// Jump near CH1's end (A@36000 runs to 40000), arm the loop, and watch the
// position wrap back into the section.
await page.click('.songmap-section:has-text("CH1")')
await page.waitForSelector('.songmap-section.active:has-text("CH1")', { timeout: 4000 })
await page.click('.songmap-sectionwrap:has(.songmap-section.active) .songmap-loopbtn')
await page.evaluate(() => window.__calliope.deck.positionMs()) // settle
await page.click('.songmap-gridsection:nth-child(3) .songmap-chipwrap:nth-child(4) .songmap-chordchip') // A @ 36000
const samples = []
for (let i = 0; i < 22; i++) {
  samples.push(await pos())
  await page.waitForTimeout(300)
}
const wrapped = samples.some((v, i) => i > 0 && v < samples[i - 1] - 3000)
const inBounds = samples.every((v) => v >= 23_500 && v < 40_500)
if (!wrapped) fail(`loop never wrapped (samples ${samples.map(Math.round).join(',')})`)
else console.log('OK: native loop wraps back into CH1')
if (!inBounds) fail(`loop let the playhead escape CH1 (${samples.map(Math.round).join(',')})`)
else console.log('OK: playhead stays inside the looped section')
await page.screenshot({ path: `${out}/deck-3-loop.png` })

// --- Corrections ride the deck transport --------------------------------
await page.click('.songmap-deckplay') // pause: deck position freezes exactly
await page.click('.songmap-fixbtn')
await page.waitForSelector('.songmap-tapbtn', { timeout: 3000 })
await page.click('.songmap-tapbtn')
const readout = await page.textContent('.songmap-tapreadout').catch(() => null)
if (!readout || !readout.includes('chorus 1')) fail(`deck-mode tap readout: ${readout}`)
else console.log(`OK: corrections tap works on the deck transport (${readout.trim()})`)

console.log('errors:', errors.length ? errors : 'none')
if (errors.length) process.exitCode = 1
await browser.close()
