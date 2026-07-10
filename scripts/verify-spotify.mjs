// Verify Jam Room setup flow + PKCE URL construction (no real account).
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shots'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')
await page.click('nav button:has-text("Jam Room")')
await page.waitForSelector('text=Jam Room setup')
await page.screenshot({ path: `${out}/08-spotify-setup.png` })
await page.fill('input[placeholder="paste Client ID"]', 'test-client-id-123')
await page.click('button:has-text("save")')
// page reloads; go back through the gate
await page.click('button:has-text("Pick up the guitar")')
await page.click('nav button:has-text("Jam Room")')
await page.waitForSelector('button:has-text("log in with Spotify")')
// intercept the OAuth navigation
let authUrl = null
await page.route('https://accounts.spotify.com/**', (route) => {
  authUrl = route.request().url()
  route.abort()
})
await page.click('button:has-text("log in with Spotify")')
await page.waitForTimeout(1200)
if (authUrl) {
  const u = new URL(authUrl)
  console.log('auth host+path:', u.host + u.pathname)
  console.log('client_id:', u.searchParams.get('client_id'))
  console.log('redirect_uri:', u.searchParams.get('redirect_uri'))
  console.log('challenge method:', u.searchParams.get('code_challenge_method'),
    '| challenge length:', (u.searchParams.get('code_challenge') ?? '').length)
} else {
  console.log('NO AUTH NAVIGATION CAPTURED')
}
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
