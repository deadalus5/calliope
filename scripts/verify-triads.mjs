// E2E for the Triad Atlas view's anchor roots. Mirrors verify-chords.mjs's
// shape: attach to the running dev server and assert the E/A root anchors
// appear once per string, lowest octave only — the phantom octave-up marker
// (e.g. root A also lit at low-E 17 and A 12) is the regression this pins.
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'shots'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))

async function fail(msg) {
  console.error('FAIL:', msg)
  await page.screenshot({ path: `${out}/13-triads-FAIL.png` }).catch(() => {})
  await browser.close()
  process.exit(1)
}

async function shot(name) {
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${out}/${name}` })
}

const marker = (s, f) => page.locator(`.fb-marker[data-string="${s}"][data-fret="${f}"]`)

async function expectAnchor(s, f, what) {
  await marker(s, f).first().waitFor({ timeout: 5000 }).catch(() => fail(`missing anchor: ${what} (string ${s} fret ${f})`))
}

async function expectAbsent(s, f, what) {
  const n = await marker(s, f).count()
  if (n > 0) await fail(`phantom octave-up marker: ${what} (string ${s} fret ${f}, ${n} marker[s])`)
}

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')

await page.click('nav button:has-text("Triad Atlas")')

// Default state: root A on the atlas tab. Anchors live at low-E 5 and open A —
// and nowhere else on those two strings (grips never touch them here: the
// default string set is D/G/B and MAX_GRIP_FRET keeps grips off fret 17).
await expectAnchor(0, 5, 'root A on the low E')
await expectAnchor(1, 0, 'root A open A string')
await expectAbsent(0, 17, 'A an octave up on the low E')
await expectAbsent(1, 12, 'A an octave up on the A string')
await shot('13-triads-anchors-a.png')

// Root G: anchor at low-E 3, and fret 15 must stay dark.
await page.selectOption('.control-group:has(.control-label:text("Triad")) select', '7')
await expectAnchor(0, 3, 'root G on the low E')
await expectAnchor(1, 10, 'root G on the A string')
await expectAbsent(0, 15, 'G an octave up on the low E')
await shot('13-triads-anchors-g.png')

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)

await browser.close()
console.log('verify-triads: all good')
