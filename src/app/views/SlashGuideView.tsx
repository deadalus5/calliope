import { useMemo } from 'react'
import { playChordAt, playMidi } from '../../audio/audition'
import * as Tone from 'tone'
import { Fretboard } from '../../fretboard/Fretboard'
import { gripLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  chordPcs, coordToMidi, identifyChord, normalizePc, parseChordSymbol, pcName,
  triadGrips, type Chord, type FretCoord, type PitchClass,
} from '../../music-core'
import './slashguide.css'

/**
 * Slash Chords — a reference guide built on the two strings he knows.
 * The whole trick: right of the slash = a bass note on the E or A string
 * (he can name every one), left of the slash = a triad shape stacked above
 * it. Every example renders the real grip and plays it.
 */

/** Find the bass on the low E (preferred) or A string, low on the neck. */
function bassCoord(pc: PitchClass): FretCoord {
  const onE = normalizePc(pc - 4) // low E open = E
  if (onE <= 8) return { string: 0, fret: onE }
  return { string: 1, fret: normalizePc(pc - 9) } // A string
}

/** The triad grip on D-G-B nearest the bass fret (the practical grab). */
function gripNear(triad: Chord, fret: number) {
  const grips = triadGrips(triad, 2)
  if (grips.length === 0) return undefined
  return grips.reduce((a, b) => (Math.abs(a.minFret - fret) <= Math.abs(b.minFret - fret) ? a : b))
}

interface Example {
  symbol: string
  why: string
}

interface Group {
  title: string
  blurb: string
  examples: Example[]
}

const GROUPS: Group[] = [
  {
    title: 'Walking bass lines',
    blurb: 'The bass walks down (or up) one scale step at a time while the chords barely move. The slash chord is the stepping stone — a major chord with its 3rd in the bass.',
    examples: [
      { symbol: 'D/F#', why: 'the classic bridge in G: G → D/F# → Em walks the bass G–F#–E' },
      { symbol: 'G/B', why: 'in C: C → G/B → Am walks C–B–A' },
      { symbol: 'A/C#', why: 'in D: D → A/C# → Bm walks D–C#–B' },
    ],
  },
  {
    title: 'The pretty inversions',
    blurb: 'Same chord, 3rd in the bass — softer and more vocal than root position. Neo-soul lives here.',
    examples: [
      { symbol: 'C/E', why: 'C major that floats instead of sitting' },
      { symbol: 'F/A', why: 'F without the barre — and it sounds better' },
      { symbol: 'E/G#', why: 'the soul move into A minor territory' },
    ],
  },
  {
    title: 'Planted pedals',
    blurb: '5th in the bass, or a bass note that refuses to move while chords change over it. Feels anchored, suspended, waiting.',
    examples: [
      { symbol: 'C/G', why: 'C planted on a G bass — the "campfire ending" sound' },
      { symbol: 'D/A', why: 'D over its 5th; let the open A ring and move shapes above it' },
      { symbol: 'G/D', why: 'the suspended-air verse chord' },
    ],
  },
  {
    title: 'Color slashes',
    blurb: 'The bass is NOT in the chord — that rub IS the sound. These are whole moods with two fingers.',
    examples: [
      { symbol: 'D/C', why: 'Lydian float: a D triad shimmering over C' },
      { symbol: 'F/G', why: 'the gospel V: play it before C and feel church' },
      { symbol: 'Am/D', why: 'instant Dorian funk vamp — D bass, Am triad riffing' },
    ],
  },
]

function ExampleCard({ ex }: { ex: Example }) {
  const parsed = useMemo(() => parseChordSymbol(ex.symbol), [ex.symbol])
  const bass = parsed.bass ?? parsed.root
  const bc = bassCoord(bass)
  const triad: Chord = useMemo(() => ({ root: parsed.root, quality: parsed.quality }), [parsed])
  const grip = useMemo(() => gripNear(triad, bc.fret), [triad, bc.fret])
  const names = useMemo(
    () => identifyChord(chordPcs(triad), bass).map((n) => n.symbol).filter((s) => s !== ex.symbol),
    [triad, bass, ex.symbol],
  )

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [{
      id: 'bass',
      zIndex: 20,
      markers: [{ coord: bc, role: 'root', label: pcName(bass, parsed.root), ring: true, degree: 0 }],
    }]
    if (grip) out.push(gripLayer(grip, bass, 'grip'))
    return out
  }, [bc, bass, grip, parsed.root])

  const maxFret = Math.max(7, (grip?.maxFret ?? 5) + 2, bc.fret + 2)

  return (
    <div className="slash-card">
      <div className="slash-card-head">
        <button
          className="slash-card-name"
          title="hear it"
          onClick={() => grip && playChordAt([coordToMidi(bc), ...grip.coords.map(coordToMidi)], Tone.now(), 45)}
        >
          {ex.symbol} ▸
        </button>
        {names[0] && <span className="mono faint">= {names[0]}</span>}
      </div>
      <p className="slash-card-why">{ex.why}</p>
      <Fretboard
        layers={layers}
        keyRoot={bass}
        maxFret={maxFret}
        height={150}
        onNoteClick={(c) => playMidi(coordToMidi(c))}
      />
      <p className="slash-card-recipe mono">
        bass: {pcName(bass, parsed.root)} on {bc.string === 0 ? 'low E' : 'A'} fret {bc.fret} ·
        shape: {pcName(parsed.root, parsed.root)}{parsed.quality.id === 'min' ? 'm' : parsed.quality.id === 'dim' ? '°' : ''} triad on D-G-B
      </p>
    </div>
  )
}

export function SlashGuideView() {
  return (
    <div>
      <div className="panel slash-intro">
        <h2>Slash chords, using only what you already know</h2>
        <p>
          A slash chord is two jobs split across your hands’ knowledge:
          <b> right of the slash = a bass note</b> — it lives on your low E or A string,
          and you can already name every fret there.
          <b> Left of the slash = a triad shape</b> — grab any voicing of that chord on the
          strings above the bass. That’s the whole system. No new theory, just stacking.
        </p>
        <ol className="slash-steps">
          <li><b>Find the bass.</b> D/F# → find F# — low E string, fret 2. Done.</li>
          <li><b>Stack the shape.</b> A D-major triad on the D-G-B strings near that fret (the Atlas has them all).</li>
          <li><b>Listen to what the bass does.</b> Inside the chord = smooth inversion. Outside it = color and tension.</li>
        </ol>
        <p className="dim">
          Every card below is playable — click the name to hear it, click any dot to hear the note.
          Gold ringed dot = the bass on your anchor string.
        </p>
      </div>

      {GROUPS.map((g) => (
        <div className="panel" key={g.title}>
          <h3 className="slash-group-title">{g.title}</h3>
          <p className="slash-group-blurb">{g.blurb}</p>
          <div className="slash-cards">
            {g.examples.map((ex) => <ExampleCard key={ex.symbol} ex={ex} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
