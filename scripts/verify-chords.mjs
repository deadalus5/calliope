// E2E for the Chord Library + Chord Finder views. Mirrors verify-nomic.mjs's
// shape: attach to the running dev server, read the __calliope debug surface,
// assert the user's own acceptance flow (G → G5 → Gsus2 as notes land), the
// library's root/flavor/board-click anchoring, and the two-way handoff.
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'shots'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))

async function fail(msg) {
  console.error('FAIL:', msg)
  await page.screenshot({ path: `${out}/09-chords-FAIL.png` }).catch(() => {})
  await browser.close()
  process.exit(1)
}

async function waitDbg(pred, what) {
  for (let i = 0; i < 50; i++) {
    const dbg = await page.evaluate(() => window.__calliope ?? {})
    if (pred(dbg)) return dbg
    await page.waitForTimeout(150)
  }
  return fail(`timeout waiting for ${what}`)
}

// Success-path screenshots wait out the 120ms button transitions first, so
// the visual record shows settled states, not mid-fade phantoms.
async function shot(name) {
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${out}/${name}` })
}

// Click a bare-board position: map viewBox coords to client space.
async function boardClick(string, fret) {
  const pos = await page.evaluate(async ({ string, fret }) => {
    const { makeLayout } = await import('/src/fretboard/layout.ts')
    const l = makeLayout(1180, 250, 17)
    const svg = document.querySelector('svg.fretboard')
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    return {
      x: r.left + (l.noteX(fret) / vb.width) * r.width,
      y: r.top + (l.stringY(string) / vb.height) * r.height,
    }
  }, { string, fret })
  if (!pos) return fail(`no fretboard svg for board click ${string}:${fret}`)
  await page.mouse.click(pos.x, pos.y)
}

await page.goto('http://127.0.0.1:5173')
await page.click('button:has-text("Pick up the guitar")')

// ---------- Chord Library ----------
await page.click('nav button:has-text("Chord Library")')
await shot('09-chordlib-idle.png')

// Root first: G. The rail becomes "every chord this root can carry".
await page.click('.cl-root[data-pc="7"]')
const rootOnly = await waitDbg(
  (d) => d.chordLibMode === 'rootOnly' && d.chordLibCount >= 20,
  'rootOnly mode with the flavor wall',
)
console.log('rootOnly flavors:', rootOnly.chordLibCount)

// Flavor lands: G7, easiest grip first — the open G7 is expected on top.
await page.click('.cl-flavor[data-quality="dom7"]')
let dbg = await waitDbg((d) => d.chordLibSymbol === 'G7', 'G7 selected')
if (!Array.isArray(dbg.chordLibFrets)) await fail('no frets published for G7')
console.log('G7 top shape:', dbg.chordLibFrets.join(','), 'source:', dbg.chordLibSource)

// Every sounding string of the shape must be a rendered marker.
for (let s = 0; s < 6; s++) {
  const f = dbg.chordLibFrets[s]
  if (f < 0) continue
  const n = await page.locator(`.fb-marker[data-string="${s}"][data-fret="${f}"]`).count()
  if (n < 1) await fail(`no marker at string ${s} fret ${f} for G7 shape`)
}
// ...and nothing that isn't the shape: no octave-up phantom on the low E, and
// no stray root anchor on the A string (open G7 doesn't touch fret 10).
const phantom = await page.locator('.fb-marker[data-string="0"][data-fret="15"]').count()
if (phantom > 0) await fail(`phantom octave-up root anchor at low E fret 15 (${phantom} marker[s])`)
const stray = await page.locator('.fb-marker[data-string="1"][data-fret="10"]').count()
if (stray > 0) await fail(`stray root anchor at A string fret 10 while the open G7 grip is up (${stray} marker[s])`)
await shot('09-chordlib-g7.png')

// Root-string choice: anchor G7 on the A string.
await page.click('.cl-string[data-string="1"]')
dbg = await waitDbg(
  (d) => d.chordLibSymbol === 'G7' && d.chordLibRootString === 1,
  'G7 re-anchored on the A string',
)

// Board-click anchoring: tap G at A-string fret 10 — same root, exact spot,
// and the served grip must be the verified A-shape barre, never a computed hybrid.
await boardClick(1, 10)
dbg = await waitDbg(
  (d) => d.chordLibSymbol === 'G7' && Array.isArray(d.chordLibFrets) && d.chordLibFrets[1] === 10,
  'board-click anchored the root at A string fret 10',
)
if (dbg.chordLibSource !== 'curated') await fail(`anchored G7 is ${dbg.chordLibSource}, expected curated`)
if (dbg.chordLibFrets.join(',') !== '-1,10,12,10,12,10') {
  await fail(`anchored G7 is ${dbg.chordLibFrets.join(',')}, expected the A-shape barre -1,10,12,10,12,10`)
}
console.log('anchored shape:', dbg.chordLibFrets.join(','), 'source:', dbg.chordLibSource)
await shot('09-chordlib-anchored.png')

// Flavor-first flow: clear the root — the shape stays visible, floating.
await page.click('.controls:has(.control-label:text("Root")) button:has-text("clear")')
dbg = await waitDbg(
  (d) => d.chordLibMode === 'flavorOnly' && Array.isArray(d.chordLibFrets),
  'flavor-only preview shape',
)

// ...then the root snaps it into place: Eb7.
await page.click('.cl-root[data-pc="3"]')
dbg = await waitDbg((d) => d.chordLibSymbol === 'Eb7', 'shape snapped to Eb')
console.log('snapped to:', dbg.chordLibSymbol, dbg.chordLibFrets.join(','))
await shot('09-chordlib-snapped.png')

// Strum is wired (audition path — just must not error).
await page.click('button:has-text("strum ▸")')
await page.waitForTimeout(400)

// Handoff: send the grip to the Finder; it must read the same chord back.
await page.click('button:has-text("open in finder")')
dbg = await waitDbg((d) => d.chordFinderSymbol === 'Eb7', 'finder read the handed-off grip as Eb7')
await shot('09-finder-handoff.png')

// ---------- Chord Finder: the user's own acceptance flow ----------
await page.click('button:has-text("clear")')
await waitDbg((d) => d.chordFinderKind === 'empty', 'finder cleared')

await boardClick(0, 3) // G on the low E
dbg = await waitDbg((d) => d.chordFinderKind === 'note' && d.chordFinderSymbol === 'G', 'single note G')

await boardClick(1, 5) // D on the A string
dbg = await waitDbg((d) => d.chordFinderSymbol === 'G5', 'G + D reads G5')
if (dbg.chordFinderKind !== 'interval') await fail(`G+D kind: ${dbg.chordFinderKind}`)

await boardClick(3, 2) // A on the G string
dbg = await waitDbg((d) => d.chordFinderSymbol === 'Gsus2', 'G + D + A reads Gsus2')
const alt = await page.locator('.cf-alt[data-symbol="Dsus4/G"]').count()
if (alt < 1) await fail('alternate reading Dsus4/G not offered')
await shot('09-finder-gsus2.png')

// Handoff back: Gsus2 shapes in the library.
await page.click('button:has-text("shapes for this")')
dbg = await waitDbg((d) => d.chordLibSymbol === 'Gsus2', 'library opened on Gsus2')
console.log('library received:', dbg.chordLibSymbol)
await shot('09-roundtrip.png')

// ---------- Regression: a top-string chord handoff must not empty the rail.
// A D triad living on the G/B/e strings can't anchor a full grip on its own
// lowest string — the library must fall back to an unfiltered, nearFret-
// biased list instead of showing "0 shapes".
await page.click('nav button:has-text("Chord Finder")')
// Fresh mount: the earlier handoff was consumed, so the finder starts empty
// (its clear button is rightly disabled — nothing to click).
await waitDbg((d) => d.chordFinderKind === 'empty', 'freshly mounted finder is empty')
await boardClick(3, 11) // F#
await boardClick(4, 3) // D
await boardClick(5, 5) // A
dbg = await waitDbg((d) => d.chordFinderSymbol === 'D', 'top-string D triad reads D')
await page.click('button:has-text("shapes for this")')
dbg = await waitDbg(
  (d) => d.chordLibSymbol === 'D' && d.chordLibCount > 0 && Array.isArray(d.chordLibFrets),
  'library shows shapes for the top-string D (anchor falls back gracefully)',
)
console.log('top-string handoff shapes:', dbg.chordLibCount)
await shot('09-topstring-handoff.png')

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)

await browser.close()
console.log('verify-chords: all good')
