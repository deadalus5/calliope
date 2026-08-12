// E2E for the Playground view. Mirrors verify-chords.mjs's shape: attach to
// the running dev server, read the __calliope debug surface, and walk the
// acceptance flow — two default pentatonic layers overlapping, every shared-
// note style, the show filters, hand-built shapes with the saved-shape
// library, and the calliope:playground persistence across a reload.
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
  await page.screenshot({ path: `${out}/11-playground-FAIL.png` }).catch(() => {})
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

// Success-path screenshots wait out the 120ms button transitions first.
async function shot(name) {
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${out}/${name}` })
}

// Click a bare-board position: map viewBox coords to client space.
// NB: the Playground runs a 22-fret neck (PLAYGROUND_MAX_FRET) — the layout
// here must match or clicks land between frets.
async function boardClick(string, fret) {
  const pos = await page.evaluate(async ({ string, fret }) => {
    const { makeLayout } = await import('/src/fretboard/layout.ts')
    const l = makeLayout(1180, 250, 22)
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
await page.click('nav button:has-text("Playground")')

// ---------- Fresh defaults: two pentatonic layers, ring overlap ----------
let dbg = await waitDbg(
  (d) =>
    Array.isArray(d.playgroundLayers)
    && d.playgroundLayers.length === 2
    && d.playgroundLayers.every((l) => l.kind === 'pentatonic')
    && d.playgroundOverlap?.style === 'ring',
  'two default pentatonic layers with ring overlap',
)
const sharedCount = dbg.playgroundOverlap.sharedCount
if (!(sharedCount > 0)) await fail(`expected shared notes on the default stack, got ${sharedCount}`)
console.log('default layers:', dbg.playgroundLayers.map((l) => l.noteCount).join('+'), 'notes,', sharedCount, 'shared')

const markerCount = await page.locator('.pg-marker').count()
if (markerCount === 0) await fail('no playground markers rendered')
// The Playground neck runs to fret 22 — pentatonic notes must live up there.
const highFret = await page.locator('.pg-marker[data-fret="22"]').count()
if (highFret === 0) await fail('no markers at fret 22 — extended neck missing')
const sharedDom = await page.locator('.pg-marker.pg-shared').count()
if (sharedDom !== sharedCount) {
  await fail(`shared markers in DOM (${sharedDom}) != sharedCount (${sharedCount})`)
}
await shot('11-playground-ring.png')

// ---------- Overlap styles: split (wedges), third (its own swatch row) ----------
await page.click('.pg-overlap button:has-text("split")')
await waitDbg((d) => d.playgroundOverlap?.style === 'split', 'split overlap style')
const wedges = await page.locator('.pg-wedge').count()
if (wedges !== sharedCount * 2) {
  await fail(`expected ${sharedCount * 2} wedges for two-layer split, got ${wedges}`)
}
await shot('11-playground-split.png')

await page.click('.pg-overlap button:has-text("third colour")')
await waitDbg((d) => d.playgroundOverlap?.style === 'third', 'third-colour overlap style')
const pickerVisible = await page.locator('.pg-shared-picker .pg-swatch').count()
if (pickerVisible === 0) await fail('third-colour swatch picker did not appear')
await shot('11-playground-third.png')

// ---------- Show filters ----------
await page.click('.pg-filter button:has-text("shared only")')
await waitDbg((d) => d.playgroundFilter === 'shared', 'shared-only filter')
const sharedOnly = await page.locator('.pg-marker').count()
if (sharedOnly !== sharedCount) {
  await fail(`shared-only should show ${sharedCount} markers, got ${sharedOnly}`)
}
await shot('11-playground-shared-only.png')
await page.click('.pg-filter button:has-text("all")')
await waitDbg((d) => d.playgroundFilter === 'all', 'filter back to all')

// ---------- Shape building: tap notes onto a new shape layer ----------
await page.click('button:has-text("+ shape")')
dbg = await waitDbg(
  (d) =>
    d.playgroundLayers?.length === 3
    && d.playgroundLayers[0].kind === 'shape'
    && d.playgroundEditing === d.playgroundLayers[0].id,
  'new shape layer armed for editing',
)

await boardClick(2, 5)
await waitDbg((d) => d.playgroundLayers?.[0]?.noteCount === 1, 'first shape note placed')
const placed = await page.locator('.pg-marker[data-string="2"][data-fret="5"]').count()
if (placed < 1) await fail('no marker at string 2 fret 5 after shape tap')

await boardClick(2, 5) // tap again = let it go
await waitDbg((d) => d.playgroundLayers?.[0]?.noteCount === 0, 'shape note toggled back off')

// Shape taps land beyond the shared board's 17th fret too.
await boardClick(2, 20)
await waitDbg((d) => d.playgroundLayers?.[0]?.noteCount === 1, 'shape note placed at fret 20')
const highPlaced = await page.locator('.pg-marker[data-string="2"][data-fret="20"]').count()
if (highPlaced < 1) await fail('no marker at string 2 fret 20 after extended-neck tap')
await boardClick(2, 20)
await waitDbg((d) => d.playgroundLayers?.[0]?.noteCount === 0, 'fret-20 note toggled back off')

await boardClick(2, 5)
await boardClick(3, 5)
await waitDbg((d) => d.playgroundLayers?.[0]?.noteCount === 2, 'two shape notes placed')
await shot('11-playground-shape.png')

// ---------- Save to the library ----------
await page.click('.pg-card button:has-text("save to library")')
await page.fill('.pg-save-name', 'riff one')
await page.click('.pg-save button:has-text("save")')
dbg = await waitDbg(
  (d) => d.playgroundSavedShapes?.length === 1 && d.playgroundSavedShapes[0].name === 'riff one',
  'shape saved to the library',
)
console.log('saved shape:', dbg.playgroundSavedShapes[0].name, `(${dbg.playgroundSavedShapes[0].notes} notes)`)

// Disarm edit mode so taps after the reload audition instead of editing.
await page.click('.pg-edit-toggle')
await waitDbg((d) => d.playgroundEditing === null, 'edit mode released')

// ---------- Persistence: the whole board survives a reload ----------
await page.reload()
await page.click('button:has-text("Pick up the guitar")')
await page.click('nav button:has-text("Playground")')
dbg = await waitDbg(
  (d) =>
    d.playgroundLayers?.length === 3
    && d.playgroundLayers[0].kind === 'shape'
    && d.playgroundLayers[0].noteCount === 2
    && d.playgroundSavedShapes?.length === 1
    && d.playgroundOverlap?.style === 'third',
  'layers, shape notes, library and overlap style all restored after reload',
)
console.log('after reload:', dbg.playgroundLayers.length, 'layers,', dbg.playgroundSavedShapes.length, 'saved shape(s), style', dbg.playgroundOverlap.style)
await shot('11-playground-restored.png')

// ---------- Audition path must not error ----------
await page.locator('.pg-marker[data-string="2"][data-fret="5"]').click()
await page.waitForTimeout(400)

console.log('errors:', errors.length ? [...new Set(errors)] : 'none')
if (errors.length) await fail(`console/page errors: ${[...new Set(errors)].join(' | ')}`)

await browser.close()
console.log('verify-playground: all good')
