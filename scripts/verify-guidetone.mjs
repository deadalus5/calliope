// E2E Song Lab guide-tone drill check: fake mic sings the current live
// window's target pitch class (read off __calliope.guideTone) only while a
// window is open, silent otherwise — mirrors verify-eargym.mjs/verify-sing.mjs's
// getUserMedia-patch pattern. Flow: gate -> Song Lab -> enable guide tones
// (starts mic calibration silently) -> play -> wait through several windows
// -> assert Dexie logged 'chordtone' attempts with detail 'guide', at least
// one correct, and no console errors.
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'shots'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['microphone'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))

async function fail(msg) {
  console.error('FAIL:', msg)
  await page.screenshot({ path: `${out}/09-guidetone-FAIL.png` }).catch(() => {})
  await browser.close()
  process.exit(1)
}

// Count-in off (keeps the flow's timing simple, same rationale as
// verify-songlab.mjs); mic stays on (default) since this drill needs it.
await page.addInitScript(() => {
  localStorage.setItem('calliope:app-prefs', JSON.stringify({ state: { micMode: 'on', countIn: false }, version: 0 }))
})

// The synthetic mic: silent until a guide-tone window opens (per
// __calliope.guideTone.windowOpen), then sings the window's exact target
// pitch class (__calliope.guideTone.targetPc) in a comfortable guitar
// octave. Silence between windows forces a fresh onset->lock cycle each
// time (NoteTracker only emits 'lock' on a NEW stable note, not a held one),
// which is exactly what a real re-picked guide tone would produce.
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

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('nav button:has-text("Song Lab")')

// Enable guide tones BEFORE play — starts the mic calibration silently
// while there's nothing to duck yet.
await page.click('button:has-text("guide tones")')
for (let i = 0; i < 30; i++) {
  if (await page.evaluate(() => !!globalThis.__fakeToneCtx)) break
  await page.waitForTimeout(100)
}
if (!(await page.evaluate(() => !!globalThis.__fakeToneCtx))) await fail('guide-tone toggle never grabbed the mic')
await page.evaluate(() => globalThis.__fakeToneCtx?.resume())

await page.click('button:has-text("play")')

// Poll Dexie until at least 3 'chordtone'/'guide' attempts have logged (i.e.
// several answer windows have resolved), or give up after a generous budget.
let guideAttempts = []
for (let i = 0; i < 150; i++) {
  guideAttempts = await page.evaluate(async () => {
    const { db } = await import('/src/state/db.ts')
    const rows = await db.attempts.toArray()
    return rows.filter((r) => r.drill === 'chordtone' && r.detail === 'guide')
  })
  if (guideAttempts.length >= 3) break
  await page.waitForTimeout(500)
}

await page.screenshot({ path: `${out}/09-guidetone.png` })

console.log('guide-tone attempts logged:', guideAttempts.length)
console.log('correct:', guideAttempts.filter((a) => a.correct).length)
if (!(guideAttempts.length >= 2)) await fail(`only ${guideAttempts.length} chordtone/guide attempts logged (need >=2)`)
if (!(guideAttempts.some((a) => a.correct))) await fail('no correct chordtone/guide attempt logged')

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)

await browser.close()
