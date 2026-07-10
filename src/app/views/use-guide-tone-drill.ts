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
  toggle(): void
}

const THIRDS = new Set([3, 4])
const SEVENTHS = new Set([10, 11])
const SUS = new Set([2, 5])

interface PickedTarget { interval: number; label: string }

/** Alternates 3rd/7th focus per chord change; falls back gracefully when the
 *  upcoming chord doesn't have the preferred tone (no 7th -> 3rd; a sus
 *  chord with neither triad third -> its sus tone). */
function pickTargetInterval(intervals: number[], preferSeventh: boolean): PickedTarget | null {
  const third = intervals.find((i) => THIRDS.has(i))
  const seventh = intervals.find((i) => SEVENTHS.has(i))
  const sus = intervals.find((i) => SUS.has(i))
  const order = preferSeventh ? [seventh, third, sus] : [third, sus, seventh]
  for (const interval of order) {
    if (interval === undefined) continue
    const label = SEVENTHS.has(interval) ? '7th' : THIRDS.has(interval) ? '3rd' : interval === 2 ? 'sus2' : 'sus4'
    return { interval, label }
  }
  return null
}

interface LiveWindow {
  targetPc: PitchClass
  tNext: number // audio-clock time the next chord actually sounds
  matched: boolean
  progId: string | undefined
  closeTimer: ReturnType<typeof setTimeout>
  lockUnsub: () => void
}

export function useGuideToneDrill(key: PitchClass): GuideToneState {
  const [active, setActive] = useState(false)
  const [upcoming, setUpcoming] = useState<GuideToneState['upcoming']>(null)
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null)
  const [tally, setTally] = useState({ hits: 0, total: 0 })
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

  /** Tear down whatever window is currently open (duck + listener), logging
   *  a miss if nothing matched yet and the song hasn't changed underneath
   *  it. Always unducks — if we ramped the bus down, we must ramp it back
   *  regardless of whether the attempt is still meaningful to log. */
  const closeLiveWindow = useCallback(() => {
    const win = liveWindowRef.current
    if (!win) return
    clearTimeout(win.closeTimer)
    win.lockUnsub()
    liveWindowRef.current = null
    unduckBacking(audioNow())
    exposeDebug({ guideTone: { targetPc: win.targetPc, windowOpen: false } })
    if (!win.matched && win.progId === sequencer.progression?.id) {
      void recordAttempt({
        ts: Date.now(), drill: 'chordtone', degree: degreeOf(win.targetPc, keyRef.current), key: keyRef.current,
        correct: false, latencyMs: 0, detail: 'guide',
      })
      setLastResult('miss')
      setTally((t) => ({ hits: t.hits, total: t.total + 1 }))
    }
  }, [])

  const handleWindowOpen = useCallback((targetPc: PitchClass, tNext: number, windowCloseAt: number, progId: string | undefined) => {
    openTimerRef.current = null
    // The drill may have been switched off, or the song swapped underneath
    // this pending window, while it was in flight — skip silently: no duck,
    // no attempt, no stale live-window state left behind.
    if (!activeRef.current) return
    if (!sequencer.playing || sequencer.progression?.id !== progId) return
    // Defensive only: given the >=1-bar chord-duration invariant this
    // shouldn't happen, but never leave two windows' duck/listener state
    // stacked if it does.
    if (liveWindowRef.current) closeLiveWindow()

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
    const closeTimer = setTimeout(() => closeLiveWindow(), Math.max(0, (windowCloseAt - audioNow()) * 1000))
    liveWindowRef.current = { targetPc, tNext, matched: false, progId, closeTimer, lockUnsub }
    duckBacking(audioNow())
    exposeDebug({ guideTone: { targetPc, windowOpen: true } })
  }, [closeLiveWindow])

  const onChordChange = useCallback((e: ChordChangeEvent) => {
    // A new chord change always supersedes a not-yet-opened window from the
    // previous one (stale windows die) — the already-open live window (if
    // any) is untouched here; it owns its own close timer.
    clearOpenSchedule()
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
    const openDelayMs = Math.max(0, (windowOpenAt - audioNow()) * 1000)
    openTimerRef.current = setTimeout(
      () => handleWindowOpen(targetPc, tNext, windowCloseAt, progId),
      openDelayMs,
    )
  }, [clearOpenSchedule, handleWindowOpen])

  const teardown = useCallback(() => {
    chordUnsubRef.current?.()
    chordUnsubRef.current = null
    clearOpenSchedule()
    if (liveWindowRef.current) closeLiveWindow()
    noteTracker.stop()
    stopPitchEngine()
    activeRef.current = false
    setActive(false)
    setUpcoming(null)
    setLastResult(null)
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

  return { active, upcoming, lastResult, tally, toggle }
}
