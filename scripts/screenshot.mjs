// Dev utility: drive the app headlessly and capture screenshots.
// Usage: node scripts/screenshot.mjs <outdir>
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto('http://127.0.0.1:5173')
await page.waitForSelector('text=Calliope')
await page.screenshot({ path: `${out}/01-gate.png` })
await page.click('button:has-text("Pick up the guitar")')
await page.waitForSelector('text=skeleton + colors')
await page.screenshot({ path: `${out}/02-explore.png` })
await page.click('button:has-text("all")')
await page.selectOption('select >> nth=1', 'dorian')
await page.screenshot({ path: `${out}/03-all-dorian.png` })
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
