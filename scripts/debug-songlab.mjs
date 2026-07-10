import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 400)))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE:', m.text().slice(0, 400)))
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('button:has-text("Song Lab")')
await page.waitForTimeout(500)
const chordEl = await page.locator('.songlab-chord').count()
console.log('songlab-chord elements:', chordEl)
await page.click('button.primary:has-text("play")')
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(600)
  const c = await page.locator('.songlab-chord').textContent()
  const pos = await page.evaluate(() => globalThis.Tone ? 'tone-global' : 'no-tone')
  console.log('chord:', JSON.stringify(c), pos)
}
await page.screenshot({ path: `${out}/debug-songlab2.png` })
await browser.close()
