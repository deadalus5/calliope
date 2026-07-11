import { useEffect, useMemo, useRef, useState } from 'react'
import { useWakeLock } from '../use-wake-lock'
import { sequencer, type ChordChangeEvent } from '../../audio/sequencer'
import { playMidi } from '../../audio/audition'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordToneLayer, modeColorLayer, skeletonLayer, targetLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  PC, PROGRESSIONS, buildTimeline, coordToMidi, degreeOf, modeById, normalizePc, pcName,
  progressionById, totalBars,
  type PitchClass, type TimelineEvent,
} from '../../music-core'
import { degreeColor } from '../../fretboard/palette'
import { useBoardPrefs } from '../../state/board-prefs'
import { useAppPrefs } from '../../state/app-prefs'
import { MixerStrip } from './MixerStrip'
import { useGuideToneDrill } from './use-guide-tone-drill'
import './songlab.css'

/** A/B loop selection in form-space bars: `a` set, `b` pending until the second click. */
type LoopSel = { a: number; b?: number } | null

const INPUT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'])

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
  const [focus, setFocus] = useState<'full' | 'chord+map' | 'chord'>('chord+map')
  const [countInPending, setCountInPending] = useState(false)
  const [loopSel, setLoopSel] = useState<LoopSel>(null)
  const countInTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countIn = useAppPrefs((s) => s.countIn)
  const setCountIn = useAppPrefs((s) => s.setCountIn)
  const micMode = useAppPrefs((s) => s.micMode)
  const guideTone = useGuideToneDrill(key)
  useWakeLock(playing)

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
    // The reload already rebuilds the loop points to the full baked range —
    // just clear the UI's A/B selection and any pending count-in disable.
    setLoopSel(null)
    if (countInTimer.current) { clearTimeout(countInTimer.current); countInTimer.current = null }
    setCountInPending(false)
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
      if (countInTimer.current) clearTimeout(countInTimer.current)
      sequencer.dispose() // fully release the shared transport for other views
      setPlaying(false)
    }
  }, [])

  // Space = play/pause, unless focus is on a control that should keep the
  // keystroke (input/select/textarea/button). handlePlayPauseRef always
  // holds the latest closure so this listener can be added once on mount.
  const handlePlayPauseRef = useRef<() => void>(() => {})
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag && INPUT_TAGS.has(tag)) return
      e.preventDefault()
      handlePlayPauseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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
    const out: FretboardLayer[] = []
    if (focus !== 'chord') out.push(skeletonLayer(scaleRoot, mode.skeleton, 'all'))
    if (focus === 'full') out.push(modeColorLayer(scaleRoot, mode))
    if (current && chordLayers[current.index]) out.push(chordLayers[current.index])
    // Guide-tone drill: an extra pearl layer on top, all positions of the
    // upcoming chord's target tone. Zero overhead when the drill is off —
    // no layer, no mic, no subscriptions (use-guide-tone-drill only
    // subscribes once toggled on).
    if (guideTone.active && guideTone.upcoming) {
      out.push(targetLayer(guideTone.upcoming.targetPc, key, true))
    }
    return out
  }, [scaleRoot, mode, focus, current, chordLayers, guideTone.active, guideTone.upcoming, key])

  // Toggle play/pause. While a count-in is scheduled (countIn on, clicking
  // play from a dead stop), disable the button for beatsPerBar*60/bpm
  // seconds — Task 4's review flagged clicking play again mid count-in as
  // a double-play edge case (the count-in's drum hits + t.start() land a
  // second time). Space mirrors this exact guard.
  function handlePlayPause() {
    if (countInPending) return
    if (sequencer.playing) {
      sequencer.pause()
      setPlaying(false)
      return
    }
    const willCountIn = countIn && sequencer.atStart
    sequencer.play({ countIn })
    setPlaying(true)
    if (willCountIn) {
      const ms = (prog.timeSignature[0] * 60 / tempo) * 1000
      setCountInPending(true)
      countInTimer.current = setTimeout(() => {
        setCountInPending(false)
        countInTimer.current = null
      }, ms)
    }
  }
  handlePlayPauseRef.current = handlePlayPause

  // A/B loop by clicking chart bars: 1st click sets `a`, 2nd sets `b`
  // (swapping if reversed) and bakes the loop; a 3rd click anywhere clears.
  function handleBarClick(bar: number) {
    setLoopSel((prev) => {
      if (!prev) return { a: bar }
      if (prev.b === undefined) {
        const a = Math.min(prev.a, bar)
        const b = Math.max(prev.a, bar)
        sequencer.setLoop(a, b + 1)
        if (sequencer.positionBar < a || sequencer.positionBar >= b + 1) sequencer.seek(a)
        return { a, b }
      }
      sequencer.clearLoop()
      return null
    })
  }

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
            disabled={countInPending}
            onClick={handlePlayPause}
          >
            {playing ? 'pause' : 'play'}
          </button>
          <button
            onClick={() => {
              if (countInTimer.current) { clearTimeout(countInTimer.current); countInTimer.current = null }
              setCountInPending(false)
              sequencer.stop()
              setPlaying(false)
              setCurrent(null)
              setBeat(null)
            }}
          >
            stop
          </button>
          <label className="control-group songlab-countin">
            <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
            <span className="control-label">count-in</span>
          </label>
          <div className="control-group">
            <span className="control-label">Show</span>
            <div className="seg">
              <button className={focus === 'chord' ? 'active' : ''} onClick={() => setFocus('chord')}>
                chord only
              </button>
              <button className={focus === 'chord+map' ? 'active' : ''} onClick={() => setFocus('chord+map')}>
                chord + map
              </button>
              <button className={focus === 'full' ? 'active' : ''} onClick={() => setFocus('full')}>
                + mode colors
              </button>
            </div>
          </div>
          <button
            className={`songlab-guidetone-toggle${guideTone.active ? ' active' : ''}`}
            disabled={micMode === 'off'}
            title={micMode === 'off' ? 'needs the mic — no-mic mode is on' : undefined}
            onClick={guideTone.toggle}
          >
            guide tones
          </button>
        </div>

        <MixerStrip />

        <p className="vibe-line">“{prog.description}”</p>

        <ChordChart
          events={timeline} bars={bars} current={current} beat={beat} keyRoot={key}
          loopSel={loopSel} onBarClick={handleBarClick}
        />
        {loopSel?.b !== undefined && (
          <p className="loop-hint dim">
            loop: bars {loopSel.a + 1}–{loopSel.b + 1} (click chart to clear)
          </p>
        )}

        <div className="songlab-now">
          <ChordDisplay current={current} keyRoot={key} />
          <span className="dim">
            {mode.name} colors on the {mode.skeleton} pentatonic skeleton, key of {pcName(scaleRoot, scaleRoot)}
          </span>
        </div>

        {guideTone.active && <GuideToneHud state={guideTone} keyRoot={key} />}

        <Fretboard layers={layers} keyRoot={key} onNoteClick={(c) => playMidi(coordToMidi(c))} />
      </div>
    </div>
  )
}

/** Guide-tone drill HUD: upcoming target, last-result flash, running tally. */
function GuideToneHud({ state, keyRoot }: { state: ReturnType<typeof useGuideToneDrill>; keyRoot: PitchClass }) {
  const { upcoming, lastResult, tally, loopPaused } = state
  return (
    <div className={`songlab-guidetone-hud${lastResult ? ` flash-${lastResult}` : ''}`}>
      {loopPaused
        ? <span className="dim">guide tones pause while an A/B loop is set</span>
        : upcoming
          ? (
            <span>
              land the <b>{upcoming.targetLabel} of {upcoming.symbol}</b> — {pcName(upcoming.targetPc, keyRoot)}
            </span>
            )
          : <span className="dim">listening for the next change…</span>}
      <span className="mono songlab-guidetone-tally">
        <b className={lastResult === 'hit' ? 'good' : lastResult === 'miss' ? 'bad' : undefined}>{tally.hits}</b>
        {' / '}{tally.total}
      </span>
    </div>
  )
}

/** The big now-playing symbol, tinted by the chord root's degree color. */
function ChordDisplay({ current, keyRoot }: { current: ChordChangeEvent | null; keyRoot: PitchClass }) {
  const colorMode = useBoardPrefs((s) => s.colorMode)
  const color = current
    ? degreeColor(degreeOf(current.event.chord.root, keyRoot), colorMode)
    : 'var(--ink-faint)'
  return (
    <span className="songlab-chord" style={{ color, textShadow: current ? `0 0 18px ${color}55` : 'none' }}>
      {current ? current.event.symbol : '—'}
    </span>
  )
}

function ChordChart({ events, bars, current, beat, keyRoot, loopSel, onBarClick }: {
  events: TimelineEvent[]
  bars: number
  current: ChordChangeEvent | null
  beat: { bar: number; beat: number } | null
  keyRoot: PitchClass
  loopSel: { a: number; b?: number } | null
  onBarClick: (bar: number) => void
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
        const looped = loopSel?.b !== undefined && bar >= loopSel.a && bar <= loopSel.b
        const pending = loopSel !== null && loopSel.b === undefined && bar === loopSel.a
        const cls = [
          'chart-bar',
          active ? 'active' : '',
          looped ? 'looped' : '',
          pending ? 'loop-pending' : '',
        ].filter(Boolean).join(' ')
        return (
          <div key={bar} className={cls} onClick={() => onBarClick(bar)}>
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
