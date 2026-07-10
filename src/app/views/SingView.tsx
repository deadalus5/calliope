import { useEffect, useMemo, useState } from 'react'
import { startDrone, stopDrone } from '../../audio/drone'
import { playMidi } from '../../audio/audition'
import { Fretboard } from '../../fretboard/Fretboard'
import { skeletonLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  DEGREE_LABELS, DEGREE_NAMES, PC, coordToMidi, coordsForPc, degreeLabel, degreeOf, pcName,
  type PentatonicKind, type PitchClass,
} from '../../music-core'
import { startPitchEngine, stopPitchEngine } from '../../pitch/pitch-engine'
import { noteTracker, type TrackedPitch } from '../../pitch/note-tracker'
import { calibrateNoiseFloor } from '../../pitch/calibration'
import { reportMicFailure } from '../../pitch/mic-errors'
import { useAppPrefs } from '../../state/app-prefs'
import './sing.css'

/**
 * Name What You Sing — the free half of the ear-to-hand gym. A drone holds
 * the key; whatever he sings (or plays) is pinned onto the skeleton across
 * the whole neck and named by degree, in real time. Repetition binds
 * sound ↔ degree ↔ location.
 */

const KEYS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]

export function SingView() {
  const [key, setKey] = useState<PitchClass>(PC.A)
  const [kind, setKind] = useState<PentatonicKind>('minor')
  const [micOn, setMicOn] = useState(false)
  const [droneOn, setDroneOn] = useState(false)
  const [live, setLive] = useState<TrackedPitch | null>(null)
  const [debug, setDebug] = useState(false)
  const micMode = useAppPrefs((s) => s.micMode)

  // Global mic-off flips while listening: the engine already died
  // (MicToggle stops it), so drop out of "mic on" rather than showing a
  // stuck "listening" state.
  useEffect(() => {
    if (micMode === 'off' && micOn) setMicOn(false)
  }, [micMode, micOn])

  useEffect(() => {
    if (!micOn) return
    let cancelled = false
    ;(async () => {
      try {
        await startPitchEngine()
        if (cancelled) return
        await calibrateNoiseFloor(0.8)
        noteTracker.start()
      } catch (err) {
        if (!cancelled) {
          reportMicFailure(err)
          setMicOn(false) // keep the revert — UI must not claim mic-on on failure
        }
      }
    })()
    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = noteTracker.on((e) => {
      if (e.type === 'pitch') {
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
        setLive(e.pitch)
      }
      if (e.type === 'silence') {
        // hold the last note briefly so the reveal is readable
        silenceTimer = setTimeout(() => setLive(null), 900)
      }
    })
    return () => {
      cancelled = true
      unsub()
      noteTracker.stop()
      stopPitchEngine()
      if (silenceTimer) clearTimeout(silenceTimer)
    }
  }, [micOn])

  useEffect(() => () => stopDrone(), [])

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(key, kind, 'all')]
    if (live) {
      out.push({
        id: 'live-pin',
        zIndex: 60,
        markers: coordsForPc(live.pc).map((coord) => ({
          coord,
          role: 'target' as const,
          label: degreeLabel(degreeOf(live.pc, key)),
          pulse: true,
        })),
      })
    }
    return out
  }, [key, kind, live])

  const deg = live ? degreeOf(live.pc, key) : null

  return (
    <div>
      <div className="panel">
        <div className="controls">
          <div className="control-group">
            <span className="control-label">Key</span>
            <select value={key} onChange={(e) => { setKey(Number(e.target.value)); if (droneOn) startDrone(Number(e.target.value)) }}>
              {KEYS.map((k) => <option key={k} value={k}>{pcName(k, k)}</option>)}
            </select>
          </div>
          <div className="control-group">
            <span className="control-label">Skeleton</span>
            <div className="seg">
              {(['minor', 'major'] as const).map((k) => (
                <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                  {k} pent
                </button>
              ))}
            </div>
          </div>
          <button
            className={droneOn ? 'active' : ''}
            onClick={() => {
              if (droneOn) { stopDrone(); setDroneOn(false) }
              else { startDrone(key); setDroneOn(true) }
            }}
          >
            {droneOn ? 'drone on' : 'drone off'}
          </button>
          <button
            className={micOn ? 'active' : 'primary'}
            disabled={micMode === 'off'}
            title={micMode === 'off' ? 'mic is off — flip it on in the board options above' : undefined}
            onClick={() => setMicOn(!micOn)}
          >
            {micMode === 'off' ? 'no mic (see board options)' : micOn ? 'mic listening…' : 'start the mic'}
          </button>
          <button className={debug ? 'active' : ''} onClick={() => setDebug(!debug)}>
            tuner panel
          </button>
        </div>

        <div className="sing-readout">
          {live && deg !== null ? (
            <>
              <span className="sing-degree">{DEGREE_LABELS[deg]}</span>
              <span className="sing-name">
                {DEGREE_NAMES[deg]} — {pcName(live.pc, key)}
                <span className="sing-cents mono">
                  {live.cents >= 0 ? '+' : ''}{live.cents.toFixed(0)}¢
                </span>
              </span>
            </>
          ) : (
            <span className="sing-idle">
              {micOn ? 'sing or play a note…' : 'start the mic, hold a note, watch it land on the map'}
            </span>
          )}
        </div>

        <Fretboard layers={layers} keyRoot={key} onNoteClick={(c) => playMidi(coordToMidi(c))} />

        {debug && <TunerPanel live={live} />}
      </div>
    </div>
  )
}

function TunerPanel({ live }: { live: TrackedPitch | null }) {
  return (
    <div className="tuner mono">
      <span>midi {live ? live.midiFloat.toFixed(2) : '—'}</span>
      <span>cents {live ? live.cents.toFixed(1) : '—'}</span>
      <span>clarity {live ? live.clarity.toFixed(3) : '—'}</span>
      <span>floor {noteTracker.noiseFloor.toFixed(4)}</span>
    </div>
  )
}
