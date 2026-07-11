import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playMidi } from '../../audio/audition'
import { startDrone, stopDrone } from '../../audio/drone'
import { exposeDebug } from '../../audio/debug'
import { Fretboard } from '../../fretboard/Fretboard'
import { skeletonLayer, targetLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  DEGREE_LABELS, DEGREE_NAMES, PC, PENTATONIC_DEGREES, coordToMidi, degreeLabel,
  degreeOf, modeById, normalizePc, pcName, pcOfDegree,
  type Degree, type FretCoord, type PentatonicKind, type PitchClass,
} from '../../music-core'
import { startPitchEngine, stopPitchEngine } from '../../pitch/pitch-engine'
import { noteTracker } from '../../pitch/note-tracker'
import { calibrateNoiseFloor } from '../../pitch/calibration'
import { reportMicFailure } from '../mic-errors'
import { usePitchRound } from '../../drills/engine/use-pitch-round'
import { loadCells, recordAttempt } from '../../state/db'
import { sampleCell } from '../../state/skill-model'
import { useAppPrefs } from '../../state/app-prefs'
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
  const [starting, setStarting] = useState(false)
  const micMode = useAppPrefs((s) => s.micMode)
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The prompt->arm delay. Held in a ref so end() can clear it: a pending
  // arm() firing after the session ended would start a phantom round over
  // a stopped UI, whose timeout would chain startRound() forever and log
  // fabricated misses into the EWMA.
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Session liveness for startRound's async continuation: if end() races
  // the loadCells await, clearing armTimer isn't enough (it hasn't been set
  // yet) — the resume must bail instead of re-arming a dead session.
  const runningRef = useRef(false)
  // Guards for begin()'s async mic grab: startingRef blocks a double-click
  // double-getUserMedia race; disposedRef cancels post-await work after
  // unmount (mirrors the old mount-effect's `cancelled` pattern).
  const startingRef = useRef(false)
  const disposedRef = useRef(false)

  const round = usePitchRound({
    onScored: (r) => {
      if (target === null) return
      void recordAttempt({
        ts: Date.now(), drill: mode, degree: target, key,
        correct: r.correct, latencyMs: r.latencyMs,
        detail: r.via === 'tap' ? 'tap' : undefined,
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

  // Opening the view never grabs the mic — that only happens on "begin",
  // and only when micMode is 'on'. Unmount still tears everything down.
  // disposedRef is reset in the effect body (not just set in cleanup) so
  // StrictMode's dev-time mount->cleanup->mount cycle doesn't leave it
  // stuck true on the surviving instance.
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      runningRef.current = false
      noteTracker.stop()
      stopPitchEngine()
      stopDrone()
      if (nextTimer.current) clearTimeout(nextTimer.current)
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [])

  // A session must run start-to-finish on one input path: a no-mic round
  // has no engine to score with, and a mic round loses tap answering. If
  // the global pref flips EITHER direction mid-session, end it cleanly and
  // let him restart on the right path — end() -> round.toIdle() clears the
  // round timer and listener before they can fire, so the aborted round
  // logs nothing (no spurious miss into the EWMA). Sing additionally falls
  // back to find when the mic goes away.
  useEffect(() => {
    if (micMode === 'off' && mode === 'sing') setMode('find')
    if (running) end()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micMode])

  useEffect(() => {
    // The running guard is belt-and-braces: even if a stray arm() slipped
    // past a stopped session, its timeout must not chain a new round.
    if (round.phase === 'timeout' && running) {
      setReveal(true)
      nextTimer.current = setTimeout(() => startRound(), 2400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.phase])

  // E2E introspection only (verify-nomic.mjs): the deterministic target pc
  // for the active round, so a tap-answer script can find and click it
  // without guessing.
  useEffect(() => {
    exposeDebug({
      eargymTargetPc: target !== null ? pcOfDegree(target, key) : null,
      eargymPhase: round.phase,
      eargymHits: stats.hits,
    })
  }, [target, key, round.phase, stats.hits])

  const startRound = useCallback(async () => {
    if (nextTimer.current) clearTimeout(nextTimer.current)
    if (armTimer.current) clearTimeout(armTimer.current)
    setReveal(false)
    round.toPrompt()
    const degrees = degreePool(pool, kind)
    const cells = await loadCells(mode, key, degrees)
    if (!runningRef.current) return // session ended while we awaited
    const cell = sampleCell(cells, Date.now())
    const degree = cell.degree
    setTarget(degree)
    const pc = pcOfDegree(degree, key)
    // No-mic sessions only ever run "find" (sing falls back above), and
    // their unanswered-timeout attempts must carry detail:'tap' like a
    // scored tap does — arm() takes the active input mode explicitly
    // rather than assuming mic.
    const via = micMode === 'off' ? 'tap' : 'mic'
    if (mode === 'find') {
      playMidi(promptMidi(pc))
      // arm once the prompt note has spoken
      armTimer.current = setTimeout(() => round.arm(pc, via), 700)
    } else {
      // sing mode: name the degree, replay the root as reference
      playMidi(promptMidi(key))
      armTimer.current = setTimeout(() => round.arm(pc, via), 900)
    }
  }, [round, pool, kind, mode, key, micMode])

  const begin = useCallback(async () => {
    if (micMode === 'on') {
      if (startingRef.current) return // mic grab already in flight
      startingRef.current = true
      setStarting(true)
      // Cancelled if the view unmounted or the pref flipped off while a
      // mic promise was pending; stop whatever we started.
      const cancelled = () => disposedRef.current || useAppPrefs.getState().micMode !== 'on'
      try {
        await startPitchEngine()
        if (cancelled()) { stopPitchEngine(); return }
        await calibrateNoiseFloor(0.8)
        if (cancelled()) { stopPitchEngine(); return }
        noteTracker.start()
      } catch (err) {
        if (!disposedRef.current) reportMicFailure(err)
        return // don't silently pretend the round runs mic-scored
      } finally {
        startingRef.current = false
        if (!disposedRef.current) setStarting(false)
      }
    }
    if (disposedRef.current) return
    runningRef.current = true
    setRunning(true)
    setStats({ hits: 0, misses: 0, streak: 0, lastLatMs: 0 })
    startDrone(key)
    void startRound()
  }, [key, startRound, micMode])

  const end = useCallback(() => {
    runningRef.current = false
    setRunning(false)
    setTarget(null)
    setReveal(false)
    round.toIdle()
    stopDrone()
    if (nextTimer.current) clearTimeout(nextTimer.current)
    // A pending prompt->arm must die with the session, or it would arm a
    // phantom round after end() (mic flip or mode/pool/key change during
    // the prompt phase) and chain fabricated timeout misses.
    if (armTimer.current) clearTimeout(armTimer.current)
  }, [round])

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(key, kind, 'all')]
    if (target !== null && reveal) out.push(targetLayer(pcOfDegree(target, key), key, true))
    return out
  }, [key, kind, target, reveal])

  // No-mic mode's answer path: a fretboard tap is a first-class answer for
  // "find". Never offered when micMode is 'on' — keeps mic-mode data
  // comparable and preserves the board's normal audition-on-click behavior.
  const noMicFind = micMode === 'off' && mode === 'find'
  const tapAnswerable = noMicFind && (round.phase === 'listen' || round.phase === 'miss')
  const handleNoteClick = useCallback((c: FretCoord) => {
    if (tapAnswerable) {
      round.answer(normalizePc(coordToMidi(c)))
      return
    }
    if (!running) playMidi(coordToMidi(c))
  }, [tapAnswerable, running, round])

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
              <button
                className={mode === 'sing' ? 'active' : ''}
                disabled={micMode === 'off'}
                title={micMode === 'off' ? "needs the mic — you're in no-mic mode" : undefined}
                onClick={() => { setMode('sing'); if (running) end() }}
              >
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
            : (
              <button className="primary" disabled={starting} onClick={begin}>
                {starting ? 'starting…' : 'start'}
              </button>
            )}
        </div>

        {noMicFind && (
          <p className="gym-hint dim">no-mic: tap your answer on the board</p>
        )}

        <div className={`gym-status gym-${round.phase}`}>
          <span className="gym-phase">{phaseText[round.phase]}</span>
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

        <Fretboard layers={layers} keyRoot={key} onNoteClick={handleNoteClick} />
      </div>
    </div>
  )
}
