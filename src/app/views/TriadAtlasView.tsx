import { useMemo, useState } from 'react'
import { playChord, playMidi } from '../../audio/audition'
import { Fretboard } from '../../fretboard/Fretboard'
import { gripLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  PC, chord, chordPcs, coordToMidi, degreeLabel, degreeOf, pcName,
  triadGrips, STRING_SET_NAMES,
  type PitchClass, type StringSet, type TriadGrip,
} from '../../music-core'
import { TriadPractice } from './TriadPractice'
import './triadatlas.css'

/**
 * Triad Atlas — triads as fragments of the chords he already owns.
 * Atlas tab: pick a triad and a string set; every close-voiced grip is laid
 * out as an inversion ladder up the neck, hung from his E/A anchor roots.
 * Practice tab: the metronome-driven shape cycler.
 */

const ROOTS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]
const QUALITIES = [
  { id: 'maj', label: 'major' },
  { id: 'min', label: 'minor' },
  { id: 'dim', label: 'dim' },
  { id: 'sus4', label: 'sus4' },
  { id: 'sus2', label: 'sus2' },
]
const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion']
const INVERSION_HINTS = ['root on the bottom', '3rd on the bottom', '5th on the bottom']

export function TriadAtlasView() {
  const [tab, setTab] = useState<'atlas' | 'practice'>('atlas')
  return (
    <div>
      <div className="app-nav" style={{ marginTop: 0 }}>
        <button className={tab === 'atlas' ? 'active' : ''} onClick={() => setTab('atlas')}>explore shapes</button>
        <button className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')}>practice (metronome)</button>
      </div>
      {tab === 'atlas' ? <Atlas /> : <TriadPractice />}
    </div>
  )
}

function Atlas() {
  const [root, setRoot] = useState<PitchClass>(PC.A)
  const [qualityId, setQualityId] = useState('maj')
  const [stringSet, setStringSet] = useState<StringSet>(2)
  const [selected, setSelected] = useState(0)

  const triad = useMemo(() => chord(pcName(root, root), qualityId), [root, qualityId])
  const grips = useMemo(() => triadGrips(triad, stringSet), [triad, stringSet])
  const grip = grips[Math.min(selected, grips.length - 1)] as TriadGrip | undefined

  const layers = useMemo(() => {
    const out: FretboardLayer[] = []
    // anchors: everywhere the chord root lives on his two known strings
    out.push({
      id: 'anchor-roots',
      zIndex: 8,
      markers: [0, 1].flatMap((s) =>
        Array.from({ length: 18 }, (_, f) => ({ string: s, fret: f }))
          .filter((c) => degreeOf(coordToMidi(c) % 12, root) === 0)
          .map((coord) => ({ coord, role: 'root' as const, label: pcName(root, root) })),
      ),
    })
    // the ladder, ghosted; the chosen grip, lit
    for (const [i, g] of grips.entries()) {
      if (g === grip) continue
      out.push({
        id: `ghost-grip-${i}`,
        zIndex: 15,
        markers: g.coords.map((coord, j) => ({
          coord, role: 'ghost' as const, label: degreeLabel(degreeOf(g.pcs[j], root)),
        })),
      })
    }
    if (grip) out.push(gripLayer(grip, root, `grip-${selected}`))
    return out
  }, [grips, grip, root, selected])

  return (
    <div>
      <div className="panel">
        <div className="controls">
          <div className="control-group">
            <span className="control-label">Triad</span>
            <select value={root} onChange={(e) => { setRoot(Number(e.target.value)); setSelected(0) }}>
              {ROOTS.map((r) => <option key={r} value={r}>{pcName(r, r)}</option>)}
            </select>
            <div className="seg">
              {QUALITIES.map((q) => (
                <button key={q.id} className={qualityId === q.id ? 'active' : ''} onClick={() => { setQualityId(q.id); setSelected(0) }}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span className="control-label">Strings</span>
            <div className="seg">
              {([0, 1, 2, 3] as StringSet[]).map((s) => (
                <button key={s} className={stringSet === s ? 'active' : ''} onClick={() => { setStringSet(s); setSelected(0) }}>
                  {STRING_SET_NAMES[s].split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ladder">
          {grips.map((g, i) => (
            <button
              key={i}
              className={`ladder-step${g === grip ? ' active' : ''}`}
              onClick={() => {
                setSelected(i)
                playChord(g.coords.map(coordToMidi))
              }}
            >
              <span className="ladder-inv">{INVERSION_NAMES[g.inversion]}</span>
              <span className="ladder-fret mono">frets {g.minFret}–{g.maxFret}</span>
              <span className="ladder-hint">{INVERSION_HINTS[g.inversion]}</span>
            </button>
          ))}
        </div>

        <p className="vibe-line">
          Same three notes — {chordPcs(triad).map((pc) => pcName(pc, root)).join(', ')} — reshuffled up the neck.
          Click a step to hear it; the gold {pcName(root, root)}s on your E and A strings are the anchors it hangs from.
        </p>

        <Fretboard
          layers={layers}
          keyRoot={root}
          onNoteClick={(c) => playMidi(coordToMidi(c))}
        />
      </div>


    </div>
  )
}

