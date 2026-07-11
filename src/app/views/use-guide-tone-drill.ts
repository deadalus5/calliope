import { useCallback, useEffect, useRef, useState } from 'react'
import { sequencer, type ChordChangeEvent } from '../../audio/sequencer'
import { duckBacking, unduckBacking } from '../../audio/instruments'
import { audioNow } from '../../audio/context'
import { exposeDebug } from '../../audio/debug'
import { startPitchEngine, stopPitchEngine } from '../../pitch/pitch-engine'
import { noteTracker } from '../../pitch/note-tracker'
import { calibrateNoiseFloor } from '../../pitch/calibration'
import { reportMicFailure } from '../mic-errors'
import { recordAttempt } from '../../state/db'
import { useAppPrefs } from '../../state/app-prefs'
import { degreeOf, normalizePc, type PitchClass } from '../../music-core'
import { pickTargetInterval } from './guide-tone-target'

/**
 * Guide-tone drill for Song Lab: while the band plays, pearl the upcoming
 * chord's 3rd or 7th (alternating) a bar early, then score whether the
 * first matching mic lock lands inside a one-beat-either-side window
 * around the change. Logs to the adaptive model under drill 'chordtone'.
 *
 * Lifecycle discipline (the #1 review risk on this class of feature, per
 * Task 11): every timer/subscription lives in a ref and is torn down on
 * toggle-off, unmount, AND mic-mode flipping off mid-session. A window
 * scheduled with plain setTimeout runs on the wall clock, independent of
 * Tone.Transport — so every fire point re-checks `activeRef` and
 * `sequencer.playing`/`sequencer.progression` before touching the duck bus
 * or logging an attempt, or a stale continuation could duck the band or
 * score a "guide" attempt for a session that already ended or a song that
 * already changed underneath it.
 */

export interface GuideToneState {
  active: boolean
  upcoming: { symbol: string; targetPc: PitchClass; targetLabel: string } | null
  lastResult: 'hit' | 'miss' | null
  tally: { hits: number; total: number }
  /** True while an A/B loop is set — the drill pauses (see module doc) and the HUD should
   *  say why nothing is being asked. */
  loopPaused: boolean
  toggle(): void
}

interface LiveWindow {
  targetPc: PitchClass
  tNext: number // audio-clock time the next chord actually sounds
  matched: boolean
  progId: string | undefined
  generation: number
  closeTimer: ReturnType<typeof setTimeout>
  lockUnsub: () => void
}

export function useGuideToneDrill(key: PitchClass): GuideToneState {
  const [active, setActive] = useState(false)
  const [upcoming, setUpcoming] = useState<GuideToneState['upcoming']>(null)
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null)
  const [tally, setTally] = useState({ hits: 0, total: 0 })
  const [loopPaused, setLoopPaused] = useState(false)
  const micMode = useAppPrefs((s) => s.micMode)

  // `key` can change while the drill is live (song/key pickers stay live in
  // Song Lab); onChordChange and the lock listener are plain callbacks
  // registered once at toggle-on, so they read this ref rather than closing
  // over a stale `key` prop value.
  const keyRef = useRef(key)
  keyRef.current = key

  const activeRef = useRef(false)
  const disposedRef = useRef(false)
  const startingRef = useRef(false)
  // A toggle-off click that lands while the mic grab is still in flight
  // (startingRef true) can't cancel the in-flight promise directly — this
  // flag lets beginMic's post-await checks notice the user already backed
  // out, so a session doesn't snap on right after being told to stop.
  const cancelStartRef = useRef(false)
  const alternationRef = useRef(false)
  const chordUnsubRef = useRef<(() => void) | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveWindowRef = useRef<LiveWindow | null>(null)

  const clearOpenSchedule = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])

  /** Tear down whatever window is currently open (duck + listener). Always
   *  unducks — if we ramped the bus down, we must ramp it back regardless
   *  of why we're closing.
   *
   *  `score`: only the window's own closeTimer firing naturally passes
   *  true — that is the sole path allowed to log a miss. Every abort path
   *  (toggle-off, unmount, mic-mode flip, superseded window) passes false:
   *  an aborted window is not evidence he missed the note, and logging it
   *  would poison the EWMA with phantom misses (the fabricated-attempt
   *  failure mode Task 11 hit). Even a natural close only scores if the
   *  transport is STILL playing and the song hasn't changed — windows run
   *  on the wall clock via setTimeout, decoupled from Tone.Transport, so a
   *  Song Lab pause/stop mid-window would otherwise let the close fire
   *  against a silent band (or, after pause-then-resume, out of sync with
   *  the delayed chord change) and log a miss he never had a chance to
   *  answer. A paused-through window is simply abandoned, unscored.
   *
   *  Also abort-not-score if an A/B loop is active (a seek/loop always
   *  accompanies this in Song Lab, and the window's wall-clock close is
   *  otherwise decoupled from the reposition) or if the sequencer's load
   *  generation has moved on since the window opened (a key change reloads
   *  with the SAME progression object/id, so id equality alone can't catch
   *  it — the target pitch class was computed against the old key). */
  const closeLiveWindow = useCallback((score: boolean) => {
    const win = liveWindowRef.current
    if (!win) return
    clearTimeout(win.closeTimer)
    win.lockUnsub()
    liveWindowRef.current = null
    unduckBacking(audioNow())
    exposeDebug({ guideTone: { targetPc: win.targetPc, windowOpen: false } })
    if (
      score && !win.matched && sequencer.playing && !sequencer.loopActive
      && win.progId === sequencer.progression?.id && win.generation === sequencer.generation
    ) {
      void recordAttempt({
        ts: Date.now(), drill: 'chordtone', degree: degreeOf(win.targetPc, keyRef.current), key: keyRef.current,
        correct: false, latencyMs: 0, detail: 'guide',
      })
      setLastResult('miss')
      setTally((t) => ({ hits: t.hits, total: t.total + 1 }))
    }
  }, [])

  const handleWindowOpen = useCallback((
    targetPc: PitchClass, tNext: number, windowCloseAt: number, progId: string | undefined, generation: number,
  ) => {
    openTimerRef.current = null
    // The drill may have been switched off, or the song swapped underneath
    // this pending window, while it was in flight — skip silently: no duck,
    // no attempt, no stale live-window state left behind. Same for a loop
    // that came in (or a key change bumping the generation) while this
    // window was pending its open delay.
    if (!activeRef.current) return
    if (!sequencer.playing || sequencer.progression?.id !== progId) return
    if (sequencer.loopActive || generation !== sequencer.generation) return
    // Defensive only: given the >=1-bar chord-duration invariant this
    // shouldn't happen, but never leave two windows' duck/listener state
    // stacked if it does. Superseded window = aborted, not scored.
    if (liveWindowRef.current) closeLiveWindow(false)

    const lockUnsub = noteTracker.on((e) => {
      if (e.type !== 'lock') return
      const win = liveWindowRef.current
      if (!win || win.matched || e.pitch.pc !== win.targetPc) return // wrong note: keep listening
      win.matched = true
      const latencyMs = Math.max(0, (e.pitch.t - win.tNext) * 1000)
      void recordAttempt({
        ts: Date.now(), drill: 'chordtone', degree: degreeOf(win.targetPc, keyRef.current), key: keyRef.current,
        correct: true, latencyMs, detail: 'guide',
      })
      setLastResult('hit')
      setTally((t) => ({ hits: t.hits + 1, total: t.total + 1 }))
    })
    // The natural close is the ONLY scoring close (score: true) — and even
    // it re-checks playing/progId inside closeLiveWindow at fire time.
    const closeTimer = setTimeout(() => closeLiveWindow(true), Math.max(0, (windowCloseAt - audioNow()) * 1000))
    liveWindowRef.current = { targetPc, tNext, matched: false, progId, generation, closeTimer, lockUnsub }
    duckBacking(audioNow())
    exposeDebug({ guideTone: { targetPc, windowOpen: true } })
  }, [closeLiveWindow])

  const onChordChange = useCallback((e: ChordChangeEvent) => {
    // A new chord change always supersedes a not-yet-opened window from the
    // previous one (stale windows die) — the already-open live window (if
    // any) is untouched here; it owns its own close timer.
    clearOpenSchedule()
    // Guard against the Task 15 review bug: at an A/B loop wrap, the next
    // audible chord is the LOOP START's, not timeline[index+1] — rather than
    // special-casing loop math, the drill simply pauses (no new windows)
    // while a loop is set, and drops anything already pending. Polling here
    // (every chord change) is enough per the Task 16 review: the window
    // this guards against never spans more than one chord change anyway.
    if (sequencer.loopActive) {
      if (liveWindowRef.current) closeLiveWindow(false)
      setUpcoming(null)
      setLoopPaused(true)
      return
    }
    setLoopPaused(false)
    const timeline = sequencer.events
    if (timeline.length === 0) return
    const nextEvent = timeline[(e.index + 1) % timeline.length]
    const preferSeventh = alternationRef.current
    alternationRef.current = !alternationRef.current
    const picked = pickTargetInterval(nextEvent.chord.quality.intervals, preferSeventh)
    if (!picked) {
      setUpcoming(null)
      return
    }
    const targetPc = normalizePc(nextEvent.chord.root + picked.interval)
    setUpcoming({ symbol: nextEvent.symbol, targetPc, targetLabel: picked.label })

    const beatSec = 60 / sequencer.tempo
    const tNext = e.audioTime + e.event.durationBeats * beatSec
    const windowOpenAt = tNext - beatSec
    const windowCloseAt = tNext + beatSec
    const progId = sequencer.progression?.id
    const generation = sequencer.generation
    const openDelayMs = Math.max(0, (windowOpenAt - audioNow()) * 1000)
    openTimerRef.current = setTimeout(
      () => handleWindowOpen(targetPc, tNext, windowCloseAt, progId, generation),
      openDelayMs,
    )
  }, [clearOpenSchedule, handleWindowOpen, closeLiveWindow])

  const teardown = useCallback(() => {
    chordUnsubRef.current?.()
    chordUnsubRef.current = null
    clearOpenSchedule()
    // Teardown never scores: the session ending mid-window must not log a
    // phantom miss (it still unducks and releases the lock listener).
    if (liveWindowRef.current) closeLiveWindow(false)
    noteTracker.stop()
    stopPitchEngine()
    activeRef.current = false
    setActive(false)
    setUpcoming(null)
    setLastResult(null)
    setLoopPaused(false)
    exposeDebug({ guideTone: { targetPc: null, windowOpen: false } })
  }, [clearOpenSchedule, closeLiveWindow])

  const beginMic = useCallback(async () => {
    if (startingRef.current) return
    startingRef.current = true
    cancelStartRef.current = false
    const cancelled = () => disposedRef.current || cancelStartRef.current || useAppPrefs.getState().micMode !== 'on'
    try {
      await startPitchEngine()
      if (cancelled()) { stopPitchEngine(); return }
      await calibrateNoiseFloor(0.8)
      if (cancelled()) { stopPitchEngine(); return }
      noteTracker.start()
    } catch (err) {
      if (!disposedRef.current) reportMicFailure(err)
      return
    } finally {
      startingRef.current = false
    }
    if (cancelled()) { noteTracker.stop(); stopPitchEngine(); return }
    alternationRef.current = false // fresh session always starts on the 3rd
    setTally({ hits: 0, total: 0 })
    setLastResult(null)
    setUpcoming(null)
    setLoopPaused(false)
    activeRef.current = true
    setActive(true)
    chordUnsubRef.current = sequencer.onChordChange(onChordChange)
  }, [onChordChange])

  const toggle = useCallback(() => {
    if (activeRef.current) {
      teardown()
      return
    }
    if (startingRef.current) {
      // Turn-off click landed mid-grab: nothing to tear down yet (not
      // active), just cancel the in-flight start so it doesn't snap on.
      cancelStartRef.current = true
      return
    }
    if (useAppPrefs.getState().micMode !== 'on') return // caller guards the button too
    void beginMic()
  }, [teardown, beginMic])

  // Unmount: full teardown, mirroring Ear Gym's mount-effect discipline —
  // disposedRef is reset here (not just set in cleanup) so StrictMode's
  // dev-time mount->cleanup->mount cycle can't leave it stuck true.
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      if (activeRef.current) teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A live drill session has no meaning without the mic — if the global
  // pref flips off mid-session, end it cleanly (same discipline as Ear
  // Gym's mode fallback).
  useEffect(() => {
    if (micMode === 'off' && activeRef.current) teardown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micMode])

  return { active, upcoming, lastResult, tally, loopPaused, toggle }
}
