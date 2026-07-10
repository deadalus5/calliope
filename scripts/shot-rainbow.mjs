import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('button:has-text("per-degree")')
await page.click('button:has-text("all")')
await page.selectOption('select >> nth=1', 'dorian')
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/09-rainbow.png` })
await browser.close()
