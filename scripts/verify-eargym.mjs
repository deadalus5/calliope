// E2E Ear Gym check: fake mic cycles pentatonic notes; rounds must score
// misses, then hit on the matching note, reveal, and advance.
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, permissions: ['microphone'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    // silent for calibration, then cycle A C D E G (220, 261.6, 293.7, 329.6, 392)
    gain.gain.setValueAtTime(0, ac.currentTime)
    gain.gain.setValueAtTime(0.25, ac.currentTime + 2)
    const freqs = [220, 261.63, 293.66, 329.63, 392]
    for (let i = 0; i < 40; i++) {
      osc.frequency.setValueAtTime(freqs[i % 5], ac.currentTime + 2 + i * 1.4)
      // brief dip between notes so the tracker re-locks
      gain.gain.setValueAtTime(0.0, ac.currentTime + 2 + i * 1.4)
      gain.gain.setValueAtTime(0.25, ac.currentTime + 2.15 + i * 1.4)
    }
    const dest = ac.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    globalThis.__fakeToneCtx = ac
    return dest.stream
  }
})
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('nav button:has-text("Ear Gym")')
await page.evaluate(() => globalThis.__fakeToneCtx?.resume())
await page.waitForTimeout(1200)
await page.click('button:has-text("start")')
// watch the scoreboard until at least 2 hits registered (or 40s)
let final = ''
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(500)
  final = await page.locator('.gym-score').textContent()
  const hits = Number(final.trim().split('/')[0])
  if (hits >= 2) break
}
await page.screenshot({ path: `${out}/07-eargym-live.png` })
console.log('scoreboard:', final.trim())
console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
await browser.close()
