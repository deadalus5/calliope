// E2E for the Triad Atlas view. Mirrors verify-chords.mjs's shape: attach to
// the running dev server and assert the board carries ONLY the grips — no root
// anchors on the low E / A strings (the stray-note regression), with the
// default D–G–B string set keeping strings 0–1 completely empty.
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

// Strings 0 (low E) and 1 (A) must be bare: grips live on the chosen 3-string
// set (default D–G–B) and no anchor layer paints there anymore.
async function expectBareAnchorStrings(what) {
  for (const s of [0, 1]) {
    const n = await page.locator(`.fb-marker[data-string="${s}"]`).count()
    if (n > 0) await fail(`${n} stray marker[s] on string ${s} (${what})`)
  }
}

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')

await page.click('nav button:has-text("Triad Atlas")')

// Default state: A major on D–G–B. The lit grip + ghost ladder must be the
// only markers — in particular nothing on the low E or A strings.
await page.locator('.fb-marker').first().waitFor({ timeout: 5000 }).catch(() => fail('no grip markers rendered'))
const total = await page.locator('.fb-marker').count()
if (total < 3) await fail(`expected a lit grip plus ghosts, saw ${total} markers`)
await expectBareAnchorStrings('root A, D–G–B set')
await shot('13-triads-a.png')

// Root G: still nothing on the anchor strings, at any fret.
await page.selectOption('.control-group:has(.control-label:text("Triad")) select', '7')
await page.waitForTimeout(300)
await expectBareAnchorStrings('root G, D–G–B set')
await shot('13-triads-g.png')

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)

await browser.close()
console.log('verify-triads: all good')
