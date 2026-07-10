// E2E no-mic check: mirrors verify-eargym.mjs's shape, but proves the
// OPPOSITE path — with micMode flipped to 'off', the mic is never touched
// (getUserMedia call count stays 0) and the Ear Gym "find" drill is still
// fully playable by tapping the answer on the fretboard.
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'shots'

const browser = await chromium.launch()
// Deliberately NOT granting the 'microphone' permission — no-mic mode must
// never need it, and the getUserMedia wrapper below would reject anyway.
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))

async function fail(msg) {
  console.error('FAIL:', msg)
  await page.screenshot({ path: `${out}/08-nomic-FAIL.png` }).catch(() => {})
  await browser.close()
  process.exit(1)
}

// 1. Count + reject every getUserMedia call, whoever makes it.
await page.addInitScript(() => {
  window.__gumCalls = 0
  navigator.mediaDevices.getUserMedia = async () => {
    window.__gumCalls++
    throw new DOMException('denied for no-mic E2E', 'NotAllowedError')
  }
})

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')

// 2. Gate in, flip the global toggle to no-mic, then open Ear Gym.
await page.click('button:has-text("no mic")')
await page.click('nav button:has-text("Ear Gym")')

// 3. Sing needs the mic — its mode button must be disabled in no-mic mode.
const singDisabled = await page.locator('button:has-text("name → sing")').isDisabled()
if (!singDisabled) await fail('sing-mode button is not disabled in no-mic mode')

// Start a find round (mic-free — the button never awaits a mic grab here).
await page.click('button:has-text("start")')

// Wait for the round to arm (phase flips prompt -> listen) and read the
// exact target pitch class off the view's E2E debug surface — deterministic,
// no guessing which fret to click.
let targetPc = null
for (let i = 0; i < 40; i++) {
  const dbg = await page.evaluate(() => window.__calliope ?? {})
  if (dbg.eargymPhase === 'listen' && typeof dbg.eargymTargetPc === 'number') {
    targetPc = dbg.eargymTargetPc
    break
  }
  await page.waitForTimeout(200)
}
if (targetPc === null) await fail('round never reached "listen" phase with a target pc')

// 4. Answer by tapping the correct board note. Resolve one on-neck location
// for that pitch class via the same music-core function the app uses (vite
// serves the module in dev), then click the marker rendered there.
const coord = await page.evaluate(async (pc) => {
  const mc = await import('/src/music-core/index.ts')
  const coords = mc.coordsForPc(pc)
  return coords[0] ?? null
}, targetPc)
if (!coord) await fail(`coordsForPc(${targetPc}) returned no locations`)

const marker = page.locator(`.fb-marker[data-string="${coord.string}"][data-fret="${coord.fret}"]`).first()
await marker.waitFor({ state: 'visible', timeout: 5000 })
await marker.click()

// Assert the scoreboard incremented.
let final = ''
for (let i = 0; i < 30; i++) {
  final = (await page.locator('.gym-score').textContent()).trim()
  const hits = Number(final.split('/')[0])
  if (hits >= 1) break
  await page.waitForTimeout(200)
}
const hits = Number(final.split('/')[0])
if (!(hits >= 1)) await fail(`scoreboard never incremented: "${final}"`)

await page.screenshot({ path: `${out}/08-nomic.png` })

// Assert zero getUserMedia calls across the whole flow.
const gumCalls = await page.evaluate(() => window.__gumCalls)
console.log('scoreboard:', final)
console.log('gumCalls:', gumCalls)
if (gumCalls !== 0) await fail(`getUserMedia was called ${gumCalls} time(s) in no-mic mode`)

// Assert a Dexie attempt row logged detail === 'tap' (skill-model
// segmentability: tap vs mic data must stay distinguishable).
const tapAttempts = await page.evaluate(async () => {
  const { db } = await import('/src/state/db.ts')
  const rows = await db.attempts.toArray()
  return rows.filter((r) => r.detail === 'tap').length
})
console.log('tap attempts logged:', tapAttempts)
if (!(tapAttempts >= 1)) await fail('no Dexie attempt row with detail === "tap"')

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)

await browser.close()
