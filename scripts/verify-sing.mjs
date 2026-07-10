// E2E pitch pipeline check: patch getUserMedia with a synthetic tone (A 220Hz)
// that starts AFTER the calibration window, then verify pin + degree readout.
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, permissions: ['microphone'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext()
    const osc = ac.createOscillator()
    osc.frequency.value = 220
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0, ac.currentTime)
    gain.gain.setValueAtTime(0.25, ac.currentTime + 1.5) // silent through calibration
    const dest = ac.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    globalThis.__fakeToneCtx = ac
    return dest.stream
  }
})

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('button:has-text("Name What You Sing")')
await page.click('button:has-text("tuner panel")')
await page.click('button:has-text("start the mic")')
await page.evaluate(() => globalThis.__fakeToneCtx?.resume())

let seen = null
for (let i = 0; i < 40; i++) {
  const txt = await page.locator('.tuner').textContent()
  if (txt && !txt.includes('midi —')) { seen = txt; break }
  await page.waitForTimeout(250)
}
const degree = await page.locator('.sing-readout').textContent()
await page.screenshot({ path: `${out}/04-sing.png` })
console.log('tuner:', seen ?? 'NONE in 10s')
console.log('readout:', degree)
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
