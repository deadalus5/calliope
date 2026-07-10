// E2E Song Lab check: play the 12-bar and confirm chord changes advance.
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('button:has-text("Song Lab")')
await page.click('button:has-text("play")')
const seen = new Set()
for (let i = 0; i < 60; i++) {
  const c = await page.locator('.songlab-chord').textContent()
  if (c && c !== '—') seen.add(c)
  if (seen.size >= 3) break
  await page.waitForTimeout(500)
}
await page.screenshot({ path: `${out}/05-songlab.png` })
console.log('chords seen:', [...seen].join(' '))
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
