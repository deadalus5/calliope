// E2E Song Lab check: play the 12-bar and confirm chord changes advance,
// the master bus never clips (and isn't silent), chord changes land on the
// beat grid, and fills mark the form. Optional --bounce records 8 bars to
// a webm for a human-listening spot check.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const out = process.argv[2] ?? 'shots'
const bounce = process.argv.includes('--bounce')

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

async function fail(msg) {
  console.error('FAIL:', msg)
  await page.screenshot({ path: `${out}/05-songlab-FAIL.png` }).catch(() => {})
  await browser.close()
  process.exit(1)
}

// Task 12: count-in now defaults on, so a bare click-play would start the
// music ~1 bar later than this script's grid/peak checks expect. Seed the
// pref off before any app code runs rather than padding the polling budget.
await page.addInitScript(() => {
  localStorage.setItem('calliope:app-prefs', JSON.stringify({ state: { micMode: 'on', countIn: false }, version: 0 }))
})

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('button:has-text("Song Lab")')
await page.click('button:has-text("play")')

// Poll chord text + peakDb + accumulating chordEvents together: 250ms
// cadence, up to 30s, stop once we've seen >=3 distinct chords AND
// collected >=3 same-pass-neighbor grid pairs.
const seen = new Set()
let maxPeak = -Infinity
let chordEvents = []
let songDebug = null

function gridPairCount(events) {
  let n = 0
  for (let i = 1; i < events.length; i++) {
    if (events[i].index === events[i - 1].index + 1) n++
  }
  return n
}

for (let i = 0; i < 120; i++) {
  const c = await page.locator('.songlab-chord').textContent()
  if (c && c !== '—') seen.add(c)
  const dbg = await page.evaluate(() => {
    const g = window.__calliope || {}
    return {
      peak: typeof g.peakDb === 'function' ? g.peakDb() : undefined,
      chordEvents: g.chordEvents ?? [],
      songDebug: g.songDebug ?? null,
    }
  })
  if (typeof dbg.peak === 'number' && Number.isFinite(dbg.peak)) maxPeak = Math.max(maxPeak, dbg.peak)
  chordEvents = dbg.chordEvents
  songDebug = dbg.songDebug
  if (seen.size >= 3 && gridPairCount(chordEvents) >= 3) break
  await page.waitForTimeout(250)
}

await page.screenshot({ path: `${out}/05-songlab.png` })

if (seen.size < 3) await fail(`only saw ${seen.size} distinct chords: ${[...seen].join(' ')}`)
if (!songDebug) await fail('__calliope.songDebug never appeared')

// 1. Peak check: limiter holds (<-0.5dBFS) but audio actually flowed (>-35dBFS).
console.log('peak dBFS (max observed):', maxPeak.toFixed(2))
if (!(maxPeak < -0.5)) await fail(`peak too hot: ${maxPeak.toFixed(2)} dBFS (limiter not holding)`)
if (!(maxPeak > -35)) await fail(`peak too quiet: ${maxPeak.toFixed(2)} dBFS (audio didn't flow)`)

// 2. Grid check: chord-change deltas match the timeline's durationBeats,
// for consecutive same-pass event pairs.
const pairs = []
for (let i = 1; i < chordEvents.length; i++) {
  const cur = chordEvents[i - 1]
  const next = chordEvents[i]
  if (next.index === cur.index + 1) pairs.push([cur, next])
}
console.log('grid pairs collected:', pairs.length)
if (pairs.length < 3) await fail(`only collected ${pairs.length} same-pass grid pairs (need >=3)`)
const TOLERANCE = 0.010
let maxGridErr = 0
for (const [cur, next] of pairs) {
  const expected = (songDebug.timeline[cur.index].durationBeats * 60) / songDebug.bpm
  const observed = next.audioTime - cur.audioTime
  const err = Math.abs(observed - expected)
  maxGridErr = Math.max(maxGridErr, err)
  if (err > TOLERANCE) {
    await fail(
      `grid mismatch at index ${cur.index}->${next.index}: expected ${expected.toFixed(4)}s, observed ${observed.toFixed(4)}s (err ${err.toFixed(4)}s > ${TOLERANCE}s)`,
    )
  }
}
console.log('grid max error (s):', maxGridErr.toFixed(4))

// 3. Form check: fills mark the form (blues-12-standard bakes fillEveryBars
// 4 over 4 passes — statically guaranteed >=1 fill).
console.log('songDebug.stats:', songDebug.stats)
if (!(songDebug.stats.fills >= 1)) await fail(`no fills counted: ${JSON.stringify(songDebug.stats)}`)

console.log('chords seen:', [...seen].join(' '))
console.log('errors:', errors.length ? errors : 'none')

// 4. Optional bounce: record 8 bars for a human-listening spot check.
if (bounce) {
  await page.evaluate(() => window.__calliope.startRecording())
  const bars = 8
  const waitSec = (bars * songDebug.beatsPerBar * 60) / songDebug.bpm
  await page.waitForTimeout(waitSec * 1000 + 300)
  const b64 = await page.evaluate(() => window.__calliope.stopRecording())
  const buf = Buffer.from(b64, 'base64')
  const path = `${out}/songlab-${songDebug.progressionId}.webm`
  writeFileSync(path, buf)
  console.log('bounce written:', path, `${buf.length} bytes`)
  if (!(buf.length > 20 * 1024)) await fail(`bounce too small: ${buf.length} bytes`)
}

await browser.close()
