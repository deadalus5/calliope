// E2E: guide-tone drill over a RECORD (the Jam Room's Song Map), stubbed
// Spotify SDK at real-time (1×) so mic windows run on the wall clock, fake
// mic sings each open window's target (the verify-guidetone.mjs pattern).
// Asserts: attempts log with detail 'guide-record', at least one correct,
// section keyOverride attribution, the player gets ducked/unducked, and a
// section loop pauses the drill. Usage: node scripts/verify-jamdrill.mjs <outdir>
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

// 120bpm 4/4; chords every 8 beats (4s real time at 1×); CH1 modulates to D
// mixolydian so section-key attribution is observable in the logged rows.
function fixtureSongMap() {
  const beats = []
  const downbeatIndices = []
  for (let i = 0; i * 500 < TRACK.durationMs; i++) {
    beats.push(i * 500)
    if (i % 4 === 0) downbeatIndices.push(i)
  }
  const sec = (id, label, kind, ordinal, startMs, endMs, keyOverride) =>
    ({ id, label, kind, ordinal, startMs, endMs, ...(keyOverride ? { keyOverride } : {}) })
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
      sec('s2', 'CH1', 'chorus', 1, 24_000, 40_000, { root: 2, modeId: 'mixolydian', skeleton: 'major', confidence: 0.9 }),
      sec('s3', 'V2', 'verse', 2, 40_000, 56_000),
      sec('s4', 'OUTRO', 'outro', 1, 56_000, 64_000),
    ],
    tempo: { bpm: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
    beats,
    downbeatIndices,
    chords: [
      ch('A7', 0, 8, 's0', 0), ch('G7', 8, 8, 's0', 10),
      ch('A7', 16, 8, 's1', 0), ch('G7', 24, 8, 's1', 10), ch('D7', 32, 8, 's1', 5), ch('A7', 40, 8, 's1', 0),
      ch('D7', 48, 8, 's2', 5), ch('A7', 56, 8, 's2', 0), ch('G7', 64, 8, 's2', 10), ch('A7', 72, 8, 's2', 0),
      ch('A7', 80, 8, 's3', 0), ch('G7', 88, 8, 's3', 10), ch('D7', 96, 8, 's3', 5), ch('A7', 104, 8, 's3', 0),
      ch('A7', 112, 16, 's4', 0),
    ],
    provenance: {
      ug: { tabId: 1089098, url: 'https://tabs.ultimate-guitar.com/x', versionLabel: 'v2 by picker42', rating: 4.8, votes: 312, capo: 0, tonalityName: 'A', official: false },
      audio: { source: 'youtube', videoId: 'fake', videoTitle: 'Rollin River (Official Audio)', durationMs: 64_000, matchScore: 0.92 },
      analyzer: { name: 'allin1', version: '1.1.0' },
      fusion: { fusedAt: '2026-07-17T00:00:00.000Z', sectionAlignConfidence: 1, warnings: [] },
    },
  }
}

// Fake SDK: 1× clock (windows must run in real time for the mic), records
// setVolume calls so ducking is observable.
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
  window.__volumes = []
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
    async setVolume(v) { window.__volumes.push(v) }
    disconnect() {}
  }
  window.Spotify = { Player }
  if (window.onSpotifyWebPlaybackSDKReady) window.onSpotifyWebPlaybackSDKReady()
})()
`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, permissions: ['microphone'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
// The deck's audio HEAD probe 404s BY DESIGN here (this scenario is
// record-mode only) — the browser logs that failed load; it's not an error.
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (/404/.test(m.text())) return
  errors.push(m.text().slice(0, 200))
})

async function fail(msg) {
  console.error('FAIL:', msg)
  await page.screenshot({ path: `${out}/jamdrill-FAIL.png` }).catch(() => {})
  await browser.close()
  process.exit(1)
}

await page.addInitScript(() => {
  localStorage.setItem('calliope:app-prefs', JSON.stringify({ state: { micMode: 'on', countIn: false }, version: 0 }))
  localStorage.setItem('spotify:clientId', 'verify-client')
  localStorage.setItem('spotify:refreshToken', 'verify-refresh')
  localStorage.setItem('spotify:accessToken', 'verify-access')
  localStorage.setItem('spotify:expiresAt', String(Date.now() + 3_600_000))
  localStorage.setItem('spotify:songsmithUrl', 'http://127.0.0.1:8765')
})

// Synthetic mic (verify-guidetone.mjs pattern): silent until a window opens,
// then sings the exact target pc; silence between windows forces fresh locks.
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0, ac.currentTime)
    osc.frequency.setValueAtTime(220, ac.currentTime)
    osc.connect(gain)
    const dest = ac.createMediaStreamDestination()
    gain.connect(dest)
    osc.start()
    globalThis.__fakeToneCtx = ac

    const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12)
    let wasOpen = false
    setInterval(() => {
      const gt = (globalThis.__calliope || {}).guideTone
      const open = !!(gt && gt.windowOpen && typeof gt.targetPc === 'number')
      if (open) {
        osc.frequency.setValueAtTime(midiToFreq(48 + gt.targetPc), ac.currentTime)
        if (!wasOpen) gain.gain.setValueAtTime(0.22, ac.currentTime)
      } else if (wasOpen) {
        gain.gain.setValueAtTime(0, ac.currentTime)
      }
      wasOpen = open
    }, 60)
    return dest.stream
  }
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
  if (url.pathname.startsWith('/audio/')) return route.fulfill({ status: 404, body: '' }) // record mode only
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

// Enable guide tones — mic calibration runs silently while the record plays.
await page.waitForSelector('.songmap-guidebtn', { timeout: 5000 })
await page.click('.songmap-guidebtn')
for (let i = 0; i < 30; i++) {
  if (await page.evaluate(() => !!globalThis.__fakeToneCtx)) break
  await page.waitForTimeout(100)
}
if (!(await page.evaluate(() => !!globalThis.__fakeToneCtx))) await fail('guide-tone toggle never grabbed the mic')
await page.evaluate(() => globalThis.__fakeToneCtx?.resume())
await page.waitForSelector('.songmap-guidehud', { timeout: 5000 })
console.log('OK: drill armed over the record')

// Windows resolve every ~4s (one chord = 8 beats at 120bpm, 1×). Wait for
// at least 2 logged attempts with the record tag, one of them correct.
let rows = []
for (let i = 0; i < 90; i++) {
  rows = await page.evaluate(async () => {
    const { db } = await import('/src/state/db.ts')
    const all = await db.attempts.toArray()
    return all.filter((r) => r.drill === 'chordtone' && r.detail === 'guide-record')
  })
  if (rows.length >= 2 && rows.some((r) => r.correct)) break
  await page.waitForTimeout(500)
}
await page.screenshot({ path: `${out}/jamdrill-1-live.png` })
console.log('guide-record attempts:', rows.length, '| correct:', rows.filter((r) => r.correct).length)
if (rows.length < 2) await fail(`only ${rows.length} guide-record attempts logged`)
if (!rows.some((r) => r.correct)) await fail('no correct guide-record attempt')

// Key attribution: every row is keyed to its section (A=9, or CH1's D=2).
const badKeys = rows.filter((r) => r.key !== 9 && r.key !== 2)
if (badKeys.length) await fail(`attempts keyed outside {A, D}: ${JSON.stringify(badKeys.map((r) => r.key))}`)
console.log(`OK: attempts keyed per section (${[...new Set(rows.map((r) => r.key))].join(',')})`)

// Ducking rode the player's volume, and every duck got its restore. Wait
// for the live window (if any) to close first — mid-window the last ramp is
// legitimately the duck.
for (let i = 0; i < 40; i++) {
  const open = await page.evaluate(() => !!(globalThis.__calliope || {}).guideTone?.windowOpen)
  if (!open) break
  await page.waitForTimeout(200)
}
const vols = await page.evaluate(() => window.__volumes)
if (!vols.includes(0.35)) await fail(`player never ducked (volumes: ${JSON.stringify(vols)})`)
const ducks = vols.filter((v) => v === 0.35).length
const restores = vols.filter((v) => v === 0.9).length
if (restores < ducks) await fail(`ducks without restores (volumes: ${JSON.stringify(vols)})`)
console.log(`OK: record ducks in the answer window and restores (${ducks} duck/restore pairs)`)

// A section loop pauses the drill (no windows over a wrap).
await page.click('.songmap-section:has-text("V1")')
await page.waitForSelector('.songmap-section.active:has-text("V1")', { timeout: 4000 })
await page.click('.songmap-sectionwrap:has(.songmap-section.active) .songmap-loopbtn')
try {
  await page.waitForSelector('text=looping — guide tones pause', { timeout: 8000 })
  console.log('OK: loop pauses the drill (HUD says why)')
} catch {
  await fail('drill did not pause under a section loop')
}
await page.screenshot({ path: `${out}/jamdrill-2-looppaused.png` })

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)
await browser.close()
