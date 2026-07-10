// Full iteration-2 verification: every view, practice cycler, song lab.
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1050 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
// Song Lab with new visuals, playing
await page.click('nav button:has-text("Song Lab")')
await page.click('button.primary:has-text("play")')
await page.waitForTimeout(4500)
await page.screenshot({ path: `${out}/10-songlab-v2.png` })
await page.click('button:has-text("stop")')
// Triad practice: start cycling, verify prompter advances
await page.click('nav button:has-text("Triad Atlas")')
await page.click('button:has-text("practice (metronome)")')
await page.click('button:has-text("start practicing")')
const seen = new Set()
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400)
  const t = await page.locator('.tp-now').textContent().catch(() => null)
  if (t) seen.add(t)
  if (seen.size >= 3) break
}
await page.screenshot({ path: `${out}/11-triad-practice.png` })
await page.click('button:has-text("stop")')
console.log('practice shapes seen:', seen.size, [...seen].slice(0, 3).join(' | '))
// Slash guide
await page.click('nav button:has-text("Slash Chords")')
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/12-slash-guide.png`, fullPage: true })
console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
await browser.close()
