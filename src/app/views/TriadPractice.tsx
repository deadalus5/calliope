import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { playChordAt, playMidi } from '../../audio/audition'
import { getBand } from '../../audio/instruments'
import { Fretboard } from '../../fretboard/Fretboard'
import { gripLayer } from '../../fretboard/build-layers'
import type { FretboardLayer, NoteMarker } from '../../fretboard/layers'
import {
  PROGRESSIONS, buildTimeline, chord, coordToMidi, degreeLabel, degreeOf, pcName,
  progressionById, qualityById, triadGrips,
  type Chord, type PitchClass, type StringSet, type TriadGrip,
} from '../../music-core'
import './triadpractice.css'

/**
 * Triad Practice — a metronome-driven teleprompter. Shapes cycle on a count
 * you set; the current grip is lit, the next one is ghosted so your hand can
 * get there early. Orders: up the ladder, same-shape across string sets,
 * random, or following a song's changes with nearest-grip voice leading.
 */

type Order = 'ladder' | 'across' | 'random' | 'changes'

const ORDER_LABELS: Record<Order, string> = {
  ladder: 'up the ladder',
  across: 'across string sets',
  random: 'random',
  changes: 'follow changes',
}

const INVERSION_NAMES = ['root pos', '1st inv', '2nd inv']

interface Step {
  grip: TriadGrip
  chordLabel: string
  keyRoot: PitchClass
}

/** Deterministic shuffle (seeded) so a session's random order is stable. */
function shuffled<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Reduce any chord to its triad (first three tones). */
function toTriad(c: Chord): Chord {
  const iv = c.quality.intervals
  const third = iv[1] ?? 4
  const fifth = iv[2] ?? 7
  const q = third === 3 ? (fifth === 6 ? 'dim' : 'min') : fifth === 8 ? 'aug' : third === 5 ? 'sus4' : third === 2 ? 'sus2' : 'maj'
  return chord(pcName(c.root, c.root), q)
}

function buildSteps(
  root: PitchClass, qualityId: string, stringSet: StringSet, order: Order, progId: string,
): Step[] {
  const triad = chord(pcName(root, root), qualityId)
  const label = (g: TriadGrip) => `${pcName(root, root)}${qualityId === 'maj' ? '' : qualityId === 'min' ? 'm' : qualityId} — ${INVERSION_NAMES[g.inversion]}`
  if (order === 'ladder') {
    return triadGrips(triad, stringSet).map((grip) => ({ grip, chordLabel: label(grip), keyRoot: root }))
  }
  if (order === 'across') {
    const bySet = ([0, 1, 2, 3] as StringSet[]).flatMap((s) => {
      const grips = triadGrips(triad, s)
      return [0, 1, 2].map((inv) => grips.find((g) => g.inversion === inv)).filter(Boolean) as TriadGrip[]
    })
    // group by inversion: same shape idea traveling across sets
    const grouped = [0, 1, 2].flatMap((inv) => bySet.filter((g) => g.inversion === inv))
    return grouped.map((grip) => ({ grip, chordLabel: label(grip), keyRoot: root }))
  }
  if (order === 'random') {
    const all = ([0, 1, 2, 3] as StringSet[]).flatMap((s) => triadGrips(triad, s))
      .filter((g) => g.maxFret <= 13)
    return shuffled(all, root * 7 + stringSet + 13).map((grip) => ({ grip, chordLabel: label(grip), keyRoot: root }))
  }
  // changes: nearest grip per chord of the progression, on the chosen set
  const prog = progressionById(progId)
  const timeline = buildTimeline(prog, prog.defaultKey)
  const steps: Step[] = []
  let lastFret = 5
  for (const ev of timeline) {
    const t = toTriad(ev.chord)
    const grips = triadGrips(t, stringSet).filter((g) => g.maxFret <= 14)
    if (grips.length === 0) continue
    const nearest = grips.reduce((a, b) =>
      Math.abs(a.minFret - lastFret) <= Math.abs(b.minFret - lastFret) ? a : b)
    lastFret = nearest.minFret
    steps.push({
      grip: nearest,
      chordLabel: `${ev.symbol} — ${INVERSION_NAMES[nearest.inversion]}`,
      keyRoot: prog.defaultKey,
    })
  }
  return steps
}

const ROOTS: PitchClass[] = [4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3]
const QUALITY_OPTIONS = ['maj', 'min', 'dim', 'sus4', 'sus2']
const SET_LABELS = ['E-A-D', 'A-D-G', 'D-G-B', 'G-B-e']

export function TriadPractice() {
  const [root, setRoot] = useState<PitchClass>(9)
  const [qualityId, setQualityId] = useState('maj')
  const [stringSet, setStringSet] = useState<StringSet>(2)
  const [order, setOrder] = useState<Order>('ladder')
  const [progId, setProgId] = useState('waiting')
  const [tempo, setTempo] = useState(70)
  const [beatsPer, setBeatsPer] = useState(4)
  const [strum, setStrum] = useState(true)
  const [running, setRunning] = useState(false)
  const [idx, setIdx] = useState(0)
  const [countIn, setCountIn] = useState(false)
  const loop = useRef<Tone.Loop | null>(null)
  const clickSeq = useRef<Tone.Sequence | null>(null)
  const stepIdx = useRef(0)

  const steps = useMemo(
    () => buildSteps(root, qualityId, stringSet, order, progId),
    [root, qualityId, stringSet, order, progId],
  )

  const stop = useCallback(() => {
    loop.current?.dispose()
    clickSeq.current?.dispose()
    loop.current = null
    clickSeq.current = null
    Tone.getTransport().stop()
    Tone.getTransport().position = 0
    setRunning(false)
    setCountIn(false)
    setIdx(0)
    stepIdx.current = 0
  }, [])

  useEffect(() => () => stop(), [stop])
  useEffect(() => { if (running) stop() /* config changed mid-run */ }, [steps]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { Tone.getTransport().bpm.value = tempo }, [tempo])

  const start = useCallback(async () => {
    if (steps.length === 0) return
    stop()
    // make sure no other view's parts are still scheduled on the transport
    const { sequencer } = await import('../../audio/sequencer')
    sequencer.dispose()
    const t = Tone.getTransport()
    t.bpm.value = tempo
    t.swing = 0
    t.loop = false
    stepIdx.current = 0
    setIdx(0)
    setRunning(true)
    setCountIn(true)

    const band = getBand()
    // metronome quarters, accented on the shape change
    let beat = 0
    clickSeq.current = new Tone.Sequence(
      (time) => {
        const accent = beat % beatsPer === 0
        band.hat.trigger(time, accent ? 1 : 0.4)
        if (accent) band.kick.trigger(time, 0.5)
        beat++
      },
      [0], '4n',
    ).start(0)

    // shapes begin after a one-bar count-in
    const interval = ({ 2: '2n', 4: '1m', 8: '2m' } as Record<number, string>)[beatsPer] ?? '1m'
    loop.current = new Tone.Loop((time) => {
      const i = stepIdx.current % steps.length
      const step = steps[i]
      if (strum) playChordAt(step.grip.coords.map(coordToMidi), time)
      Tone.getDraw().schedule(() => {
        setCountIn(false)
        setIdx(i)
      }, time)
      stepIdx.current++
    }, interval).start('1m')

    t.start()
  }, [steps, tempo, beatsPer, strum, stop])

  const current = steps[idx]
  const next = steps[(idx + 1) % Math.max(1, steps.length)]

  const layers = useMemo(() => {
    if (!current) return []
    const out: FretboardLayer[] = [gripLayer(current.grip, current.keyRoot, `now-${idx}`)]
    if (next && next !== current) {
      out.push({
        id: `next-${idx}`,
        zIndex: 30,
        markers: next.grip.coords.map((coord, i): NoteMarker => ({
          coord,
          role: 'ghost',
          label: degreeLabel(degreeOf(next.grip.pcs[i], next.keyRoot)),
          degree: degreeOf(next.grip.pcs[i], next.keyRoot),
        })),
      })
    }
    return out
  }, [current, next, idx])

  return (
    <div className="panel">
      <div className="controls">
        {order !== 'changes' && (
          <>
            <div className="control-group">
              <span className="control-label">Triad</span>
              <select value={root} onChange={(e) => setRoot(Number(e.target.value))}>
                {ROOTS.map((r) => <option key={r} value={r}>{pcName(r, r)}</option>)}
              </select>
              <select value={qualityId} onChange={(e) => setQualityId(e.target.value)}>
                {QUALITY_OPTIONS.map((q) => <option key={q} value={q}>{qualityById(q).displayName}</option>)}
              </select>
            </div>
          </>
        )}
        {order === 'changes' && (
          <div className="control-group">
            <span className="control-label">Song</span>
            <select value={progId} onChange={(e) => setProgId(e.target.value)}>
              {PROGRESSIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        {order !== 'across' && order !== 'random' && (
          <div className="control-group">
            <span className="control-label">Strings</span>
            <div className="seg">
              {([0, 1, 2, 3] as StringSet[]).map((s) => (
                <button key={s} className={stringSet === s ? 'active' : ''} onClick={() => setStringSet(s)}>
                  {SET_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="control-group">
          <span className="control-label">Order</span>
          <div className="seg">
            {(Object.keys(ORDER_LABELS) as Order[]).map((o) => (
              <button key={o} className={order === o ? 'active' : ''} onClick={() => setOrder(o)}>
                {ORDER_LABELS[o]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="control-group">
          <span className="control-label">Tempo</span>
          <input type="range" min={40} max={140} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
          <span className="mono dim">{tempo}</span>
        </div>
        <div className="control-group">
          <span className="control-label">Beats/shape</span>
          <div className="seg">
            {[2, 4, 8].map((b) => (
              <button key={b} className={beatsPer === b ? 'active' : ''} onClick={() => setBeatsPer(b)}>{b}</button>
            ))}
          </div>
        </div>
        <button className={strum ? 'active' : ''} onClick={() => setStrum(!strum)}>strum shapes</button>
        {running
          ? <button onClick={stop}>stop</button>
          : <button className="primary" onClick={start}>start practicing</button>}
        <span className="mono dim">{steps.length} shapes in the cycle</span>
      </div>

      <div className="tp-prompter">
        {running && countIn && <span className="tp-countin">count-in…</span>}
        {current && !countIn && (
          <>
            <span className="tp-now">{current.chordLabel}</span>
            <span className="tp-frets mono">frets {current.grip.minFret}–{current.grip.maxFret}</span>
            {next && next !== current && (
              <span className="tp-next dim">next: {next.chordLabel} @ {next.grip.minFret}</span>
            )}
          </>
        )}
        {!running && <span className="dim">shapes cycle on the beat — the ghost dots are where your hand goes next</span>}
      </div>

      <Fretboard layers={layers} keyRoot={current?.keyRoot ?? root} onNoteClick={(c) => playMidi(coordToMidi(c))} />
    </div>
  )
}
