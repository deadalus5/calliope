// Walk every module, screenshot each, collect console errors.
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
for (const [name, slug] of [['Ear Gym', 'eargym'], ['Triad Atlas', 'triads'], ['Modal Colors', 'modes'], ['Dark Spots', 'stats']]) {
  await page.click(`nav button:has-text("${name}")`)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/06-${slug}.png` })
}
// exercise triad ladder click (audible + selection)
await page.click('nav button:has-text("Triad Atlas")')
await page.waitForTimeout(400)
const steps = await page.locator('.ladder-step').count()
if (steps > 1) await page.locator('.ladder-step').nth(1).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/06-triads-selected.png` })
console.log('ladder steps:', steps)
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
