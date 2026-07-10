import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playMidi } from '../../audio/audition'
import { startDrone, stopDrone } from '../../audio/drone'
import { Fretboard } from '../../fretboard/Fretboard'
import { skeletonLayer, targetLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  DEGREE_LABELS, DEGREE_NAMES, PC, PENTATONIC_DEGREES, coordToMidi, degreeLabel,
  degreeOf, modeById, pcName, pcOfDegree,
  type Degree, type PentatonicKind, type PitchClass,
} from '../../music-core'
import { startPitchEngine, stopPitchEngine } from '../../pitch/pitch-engine'
import { noteTracker } from '../../pitch/note-tracker'
import { calibrateNoiseFloor } from '../../pitch/calibration'
import { usePitchRound } from '../../drills/engine/use-pitch-round'
import { loadCells, recordAttempt } from '../../state/db'
import { sampleCell } from '../../state/skill-model'
import './eargym.css'

/**
 * The Ear Gym — the sing-it-then-find-it translation trainer.
 *   FIND: a note sounds over the drone; play it on the guitar. First locked
 *         note scores; latency is the metric that matters.
 *   SING: a degree is named; sing it against the drone.
 * Octave-agnostic. The adaptive model steers targets toward weak degrees.
 */

const KEYS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]

type GymMode = 'find' | 'sing'
type Pool = 'skeleton' | 'mode' | 'chromatic'

function degreePool(pool: Pool, kind: PentatonicKind): Degree[] {
  if (pool === 'skeleton') return PENTATONIC_DEGREES[kind]
  if (pool === 'mode') {
    const mode = kind === 'minor' ? modeById('dorian') : modeById('mixolydian')
    return [...PENTATONIC_DEGREES[kind], ...mode.colors].sort((a, b) => a - b)
  }
  return Array.from({ length: 12 }, (_, i) => i)
}

/** Place a pitch class in the guitar's comfortable middle register. */
function promptMidi(pc: PitchClass): number {
  const base = 52 + ((pc - 4 + 12) % 12) // E3..D#4
  return Math.random() < 0.4 ? base + 12 : base
}

export function EarGymView() {
  const [key, setKey] = useState<PitchClass>(PC.A)
  const [kind, setKind] = useState<PentatonicKind>('minor')
  const [mode, setMode] = useState<GymMode>('find')
  const [pool, setPool] = useState<Pool>('skeleton')
  const [running, setRunning] = useState(false)
  const [target, setTarget] = useState<Degree | null>(null)
  const [reveal, setReveal] = useState(false)
  const [stats, setStats] = useState({ hits: 0, misses: 0, streak: 0, lastLatMs: 0 })
  const [micError, setMicError] = useState<string | null>(null)
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const round = usePitchRound({
    onScored: (r) => {
      if (target === null) return
      void recordAttempt({
        ts: Date.now(), drill: mode, degree: target, key,
        correct: r.correct, latencyMs: r.latencyMs,
      })
      setStats((s) => ({
        hits: s.hits + (r.correct ? 1 : 0),
        misses: s.misses + (r.correct ? 0 : 1),
        streak: r.correct ? s.streak + 1 : 0,
        lastLatMs: r.correct ? r.latencyMs : s.lastLatMs,
      }))
      if (r.correct) {
        setReveal(true)
        nextTimer.current = setTimeout(() => startRound(), 1800)
      }
      // on miss: hunt continues; reveal happens on found/timeout
    },
    onFoundAfterMiss: () => {
      setReveal(true)
      nextTimer.current = setTimeout(() => startRound(), 1800)
    },
  })

  // Mic lifecycle while the gym is open.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await startPitchEngine()
        if (cancelled) return
        await calibrateNoiseFloor(0.8)
        noteTracker.start()
      } catch {
        if (!cancelled) setMicError('The Ear Gym needs the microphone — allow mic access and reload.')
      }
    })()
    return () => {
      cancelled = true
      noteTracker.stop()
      stopPitchEngine()
      stopDrone()
      if (nextTimer.current) clearTimeout(nextTimer.current)
    }
  }, [])

  useEffect(() => {
    if (round.phase === 'timeout') {
      setReveal(true)
      nextTimer.current = setTimeout(() => startRound(), 2400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.phase])

  const startRound = useCallback(async () => {
    if (nextTimer.current) clearTimeout(nextTimer.current)
    setReveal(false)
    round.toPrompt()
    const degrees = degreePool(pool, kind)
    const cells = await loadCells(mode, key, degrees)
    const cell = sampleCell(cells, Date.now())
    const degree = cell.degree
    setTarget(degree)
    const pc = pcOfDegree(degree, key)
    if (mode === 'find') {
      playMidi(promptMidi(pc))
      // arm once the prompt note has spoken
      setTimeout(() => round.arm(pc), 700)
    } else {
      // sing mode: name the degree, replay the root as reference
      playMidi(promptMidi(key))
      setTimeout(() => round.arm(pc), 900)
    }
  }, [round, pool, kind, mode, key])

  const begin = useCallback(() => {
    setRunning(true)
    setStats({ hits: 0, misses: 0, streak: 0, lastLatMs: 0 })
    startDrone(key)
    void startRound()
  }, [key, startRound])

  const end = useCallback(() => {
    setRunning(false)
    setTarget(null)
    setReveal(false)
    round.toIdle()
    stopDrone()
    if (nextTimer.current) clearTimeout(nextTimer.current)
  }, [round])

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(key, kind, 'all')]
    if (target !== null && reveal) out.push(targetLayer(pcOfDegree(target, key), key, true))
    return out
  }, [key, kind, target, reveal])

  const phaseText: Record<string, string> = {
    idle: 'press start when the guitar is in your hands',
    prompt: 'listen…',
    listen: mode === 'find' ? 'find it on the neck' : `sing the ${target !== null ? DEGREE_LABELS[target] : ''}`,
    hit: 'got it',
    miss: 'not that one — keep hunting',
    timeout: target !== null ? `it was the ${DEGREE_LABELS[target]} — ${DEGREE_NAMES[target]}` : '',
  }

  return (
    <div>
      <div className="panel">
        <div className="controls">
          <div className="control-group">
            <span className="control-label">Key</span>
            <select value={key} onChange={(e) => { setKey(Number(e.target.value)); if (running) end() }}>
              {KEYS.map((k) => <option key={k} value={k}>{pcName(k, k)}</option>)}
            </select>
          </div>
          <div className="control-group">
            <span className="control-label">Skeleton</span>
            <div className="seg">
              {(['minor', 'major'] as const).map((k) => (
                <button key={k} className={kind === k ? 'active' : ''} onClick={() => { setKind(k); if (running) end() }}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span className="control-label">Game</span>
            <div className="seg">
              <button className={mode === 'find' ? 'active' : ''} onClick={() => { setMode('find'); if (running) end() }}>
                hear → find
              </button>
              <button className={mode === 'sing' ? 'active' : ''} onClick={() => { setMode('sing'); if (running) end() }}>
                name → sing
              </button>
            </div>
          </div>
          <div className="control-group">
            <span className="control-label">Notes</span>
            <div className="seg">
              {(['skeleton', 'mode', 'chromatic'] as const).map((p) => (
                <button key={p} className={pool === p ? 'active' : ''} onClick={() => { setPool(p); if (running) end() }}>
                  {p === 'skeleton' ? 'skeleton' : p === 'mode' ? '+colors' : 'all 12'}
                </button>
              ))}
            </div>
          </div>
          {running
            ? <button onClick={end}>stop</button>
            : <button className="primary" onClick={begin}>start</button>}
        </div>

        <div className={`gym-status gym-${round.phase}`}>
          <span className="gym-phase">{micError ?? phaseText[round.phase]}</span>
          {round.phase === 'miss' && round.heard !== null && (
            <span className="gym-heard">
              you played the {degreeLabel(degreeOf(round.heard, key))} ({pcName(round.heard, key)})
            </span>
          )}
          <span className="gym-score mono">
            <b className="good">{stats.hits}</b> / {stats.hits + stats.misses}
            {stats.streak >= 3 && <span className="gym-streak"> streak {stats.streak}</span>}
            {stats.lastLatMs > 0 && <span className="dim"> · {(stats.lastLatMs / 1000).toFixed(1)}s</span>}
          </span>
        </div>

        <Fretboard layers={layers} keyRoot={key} onNoteClick={(c) => !running && playMidi(coordToMidi(c))} />
      </div>
    </div>
  )
}
