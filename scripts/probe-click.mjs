import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.waitForSelector('.fretboard')
// single pointer click on one marker
const marker = page.locator('.fb-marker').first()
await marker.click()
await page.waitForTimeout(300)
let n = await page.evaluate(() => globalThis.__auditionCount ?? 0)
console.log('after 1 marker click, playMidi calls:', n)
// click bare wood once
await page.mouse.click(700, 460)
await page.waitForTimeout(300)
n = await page.evaluate(() => globalThis.__auditionCount ?? 0)
console.log('after 1 more bare-board click, playMidi calls:', n)
await browser.close()
