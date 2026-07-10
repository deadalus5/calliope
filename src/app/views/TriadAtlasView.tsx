import { useMemo, useState } from 'react'
import { playChord, playMidi } from '../../audio/audition'
import { Fretboard } from '../../fretboard/Fretboard'
import { gripLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  PC, chord, chordPcs, coordToMidi, degreeLabel, degreeOf, identifyChord, pcName,
  triadGrips, STRING_SET_NAMES,
  type PitchClass, type StringSet, type TriadGrip,
} from '../../music-core'
import './triadatlas.css'

/**
 * Triad Atlas — triads as fragments of the chords he already owns.
 * Pick a triad and a string set; every close-voiced grip on that set is
 * laid out as an inversion ladder up the neck. His E/A anchor roots stay
 * visible so each fragment stays tied to the barre chord it came from.
 * The slash-chord builder stacks any triad over any bass he can name.
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

      <SlashBuilder />
    </div>
  )
}

function SlashBuilder() {
  const [bass, setBass] = useState<PitchClass>(PC.Fs)
  const [triadRoot, setTriadRoot] = useState<PitchClass>(PC.D)
  const [qualityId, setQualityId] = useState('maj')

  const triad = useMemo(() => chord(pcName(triadRoot, triadRoot), qualityId), [triadRoot, qualityId])
  const names = useMemo(() => identifyChord(chordPcs(triad), bass), [triad, bass])
  const grip = useMemo(() => {
    const gs = triadGrips(triad, 2)
    return gs.find((g) => g.minFret >= 2) ?? gs[0]
  }, [triad])

  const bassMidi = 40 + ((bass - 4 + 12) % 12)

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [{
      id: 'slash-bass',
      zIndex: 20,
      markers: [{
        coord: { string: 0, fret: (bass - 4 + 12) % 12 },
        role: 'root', label: pcName(bass, bass), ring: true,
      }],
    }]
    if (grip) out.push(gripLayer(grip, triadRoot, 'slash-triad'))
    return out
  }, [bass, grip, triadRoot])

  return (
    <div className="panel">
      <h3 className="slash-title">Slash chords — a triad over a bass note you already know</h3>
      <div className="controls">
        <div className="control-group">
          <span className="control-label">Bass (low E)</span>
          <select value={bass} onChange={(e) => setBass(Number(e.target.value))}>
            {ROOTS.map((r) => <option key={r} value={r}>{pcName(r, r)}</option>)}
          </select>
        </div>
        <div className="control-group">
          <span className="control-label">Triad on top</span>
          <select value={triadRoot} onChange={(e) => setTriadRoot(Number(e.target.value))}>
            {ROOTS.map((r) => <option key={r} value={r}>{pcName(r, r)}</option>)}
          </select>
          <div className="seg">
            {QUALITIES.slice(0, 3).map((q) => (
              <button key={q.id} className={qualityId === q.id ? 'active' : ''} onClick={() => setQualityId(q.id)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <button
          className="primary"
          onClick={() => grip && playChord([bassMidi, ...grip.coords.map(coordToMidi)], 40)}
        >
          hear it
        </button>
      </div>

      <div className="slash-names">
        <span className="slash-main">
          {pcName(triadRoot, triadRoot)}{qualityId === 'min' ? 'm' : qualityId === 'dim' ? 'dim' : ''}/{pcName(bass, bass)}
        </span>
        <SlashAliases
          builtSymbol={`${pcName(triadRoot, triadRoot)}${qualityId === 'min' ? 'm' : qualityId === 'dim' ? 'dim' : ''}/${pcName(bass, bass)}`}
          names={names.map((n) => n.symbol)}
        />
      </div>

      <Fretboard layers={layers} keyRoot={bass} onNoteClick={(c) => playMidi(coordToMidi(c))} />
    </div>
  )
}

/** Alternate names for the stack, hiding ones that just repeat the slash. */
function SlashAliases({ builtSymbol, names }: { builtSymbol: string; names: string[] }) {
  const fresh = names.filter((n) => n !== builtSymbol)
  if (fresh.length === 0) {
    return <span className="slash-alias dim">no simpler name — it IS the sound</span>
  }
  return (
    <span className="slash-alias dim">
      = {fresh[0]}{fresh[1] ? ` (also ${fresh[1]})` : ''}
    </span>
  )
}
