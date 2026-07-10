import { useEffect, useMemo, useRef, useState } from 'react'
import { sequencer, type ChordChangeEvent } from '../../audio/sequencer'
import { playMidi } from '../../audio/audition'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordToneLayer, modeColorLayer, skeletonLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  PC, PROGRESSIONS, buildTimeline, coordToMidi, modeById, normalizePc, pcName,
  progressionById, totalBars,
  type PitchClass, type TimelineEvent,
} from '../../music-core'
import './songlab.css'

/**
 * Song Lab: the band plays changes he knows; the fretboard names what his
 * hands already follow by feel. Skeleton stays underneath; each chord's
 * tones light up as ember inside it; the mode's color notes pulse blue.
 */

const KEYS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]

export function SongLabView() {
  const [progId, setProgId] = useState('blues-12-standard')
  const [key, setKey] = useState<PitchClass>(PC.A)
  const [tempo, setTempo] = useState<number>(progressionById('blues-12-standard').defaultTempo)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState<ChordChangeEvent | null>(null)
  const [beat, setBeat] = useState<{ bar: number; beat: number } | null>(null)
  const [showColors, setShowColors] = useState(true)

  const prog = useMemo(() => progressionById(progId), [progId])
  const mode = useMemo(() => modeById(prog.scaleHint.modeId), [prog])
  const scaleRoot = useMemo(
    () => normalizePc(key + prog.scaleHint.rootOffset),
    [key, prog],
  )

  // (Re)load the sequencer when song/key changes.
  useEffect(() => {
    const wasPlaying = sequencer.playing
    sequencer.load(prog, key, tempo)
    setCurrent(null)
    setBeat(null)
    if (wasPlaying) sequencer.play()
    // tempo intentionally not a dep: slider has its own effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prog, key])

  useEffect(() => { sequencer.setTempo(tempo) }, [tempo])

  useEffect(() => {
    const unsubChord = sequencer.onChordChange(setCurrent)
    const unsubBeat = sequencer.onBeat((bar, b) => setBeat({ bar, beat: b }))
    return () => {
      unsubChord()
      unsubBeat()
      sequencer.stop()
      setPlaying(false)
    }
  }, [])

  // The same timeline the sequencer builds, computed purely for display.
  const timeline = useMemo(() => buildTimeline(prog, key), [prog, key])
  const bars = useMemo(() => totalBars(prog), [prog])

  // Precompute a fretboard layer per timeline event (chord change = pointer swap).
  const chordLayers = useMemo(
    () => timeline.map((ev) => chordToneLayer(ev.chord, key)),
    [timeline, key],
  )

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(scaleRoot, mode.skeleton, 'all')]
    if (showColors) out.push(modeColorLayer(scaleRoot, mode))
    if (current && chordLayers[current.index]) out.push(chordLayers[current.index])
    return out
  }, [scaleRoot, mode, showColors, current, chordLayers])

  return (
    <div>
      <div className="panel">
        <div className="controls">
          <div className="control-group">
            <span className="control-label">Song</span>
            <select
              value={progId}
              onChange={(e) => {
                const p = progressionById(e.target.value)
                setProgId(e.target.value)
                setKey(p.defaultKey)
                setTempo(p.defaultTempo)
              }}
            >
              {PROGRESSIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.artistHint ? ` — ${p.artistHint}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="control-group">
            <span className="control-label">Key</span>
            <select value={key} onChange={(e) => setKey(Number(e.target.value))}>
              {KEYS.map((k) => <option key={k} value={k}>{pcName(k, k)}</option>)}
            </select>
          </div>
          <div className="control-group">
            <span className="control-label">Tempo</span>
            <input
              type="range" min={45} max={160} value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
            />
            <span className="mono dim">{tempo}</span>
          </div>
          <button
            className="primary"
            onClick={() => {
              if (sequencer.playing) { sequencer.pause(); setPlaying(false) }
              else { sequencer.play(); setPlaying(true) }
            }}
          >
            {playing ? 'pause' : 'play'}
          </button>
          <button onClick={() => { sequencer.stop(); setPlaying(false); setCurrent(null); setBeat(null) }}>
            stop
          </button>
          <button className={showColors ? 'active' : ''} onClick={() => setShowColors(!showColors)}>
            mode colors
          </button>
        </div>

        <p className="vibe-line">“{prog.description}”</p>

        <ChordChart events={timeline} bars={bars} current={current} beat={beat} keyRoot={key} />

        <div className="songlab-now">
          <span className="songlab-chord">{current ? current.event.symbol : '—'}</span>
          <span className="dim">
            {mode.name} colors on the {mode.skeleton} pentatonic skeleton, key of {pcName(scaleRoot, scaleRoot)}
          </span>
        </div>

        <Fretboard layers={layers} keyRoot={key} onNoteClick={(c) => playMidi(coordToMidi(c))} />
      </div>
    </div>
  )
}

function ChordChart({ events, bars, current, beat, keyRoot }: {
  events: TimelineEvent[]
  bars: number
  current: ChordChangeEvent | null
  beat: { bar: number; beat: number } | null
  keyRoot: PitchClass
}) {
  void keyRoot
  const barCells = useRef<HTMLDivElement>(null)
  const perBar: TimelineEvent[][] = Array.from({ length: bars }, () => [])
  for (const ev of events) perBar[ev.bar]?.push(ev)
  // carry sustained chords into empty bars
  let last: TimelineEvent | undefined
  const display = perBar.map((cell) => {
    if (cell.length === 0 && last) return { events: [], carried: last }
    if (cell.length > 0) last = cell[cell.length - 1]
    return { events: cell, carried: undefined }
  })

  return (
    <div className="chart" ref={barCells}>
      {display.map((cell, bar) => {
        const active = current && (beat?.bar ?? current.event.bar) === bar
        return (
          <div key={bar} className={`chart-bar${active ? ' active' : ''}`}>
            {cell.events.length > 0
              ? cell.events.map((ev, i) => <span key={i} className="chart-chord">{ev.symbol}</span>)
              : <span className="chart-chord carried">%</span>}
            {active && beat && (
              <span className="chart-beats">
                {Array.from({ length: 4 }, (_, i) => (
                  <i key={i} className={i <= beat.beat ? 'on' : ''} />
                ))}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
