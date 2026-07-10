import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playMelody, playMidi } from '../../audio/audition'
import { sequencer } from '../../audio/sequencer'
import { Fretboard } from '../../fretboard/Fretboard'
import { modeColorLayer, skeletonLayer, targetLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  DEGREE_NAMES, MODES, PROGRESSIONS, coordToMidi, degreeLabel, normalizePc,
  pcName, pcOfDegree, pentatonicPosition,
  type Degree, type ModeSpec, type PitchClass,
} from '../../music-core'
import { startPitchEngine, stopPitchEngine } from '../../pitch/pitch-engine'
import { noteTracker } from '../../pitch/note-tracker'
import { calibrateNoiseFloor } from '../../pitch/calibration'
import { usePitchRound } from '../../drills/engine/use-pitch-round'
import { recordAttempt } from '../../state/db'
import './modalcolors.css'

/**
 * Modal Colors — modes as two color notes added to a shape he already owns,
 * over a vamp in the style of a song he knows. Hear the lick with and
 * without the color (A/B), then hunt the color notes live over the vamp.
 */

const VAMP_BY_MODE: Record<string, string> = {
  mixolydian: 'franklins',
  dorian: 'dorian-vamp',
  aeolian: 'blues-minor',
  ionian: 'gravity',
  lydian: 'lydian-vamp',
  phrygian: 'phrygian-vamp',
}

function vampFor(mode: ModeSpec) {
  return PROGRESSIONS.find((p) => p.id === VAMP_BY_MODE[mode.id])
    ?? PROGRESSIONS.find((p) => p.scaleHint.modeId === mode.id)
    ?? PROGRESSIONS[0]
}

/** A 8-note phrase from the skeleton (position 1), pure. */
function skeletonLick(key: PitchClass, mode: ModeSpec): number[] {
  const notes = pentatonicPosition(key, mode.skeleton, 1).notes
    .map((n) => coordToMidi(n.coord))
    .sort((a, b) => a - b)
  const contour = [4, 6, 7, 6, 8, 7, 6, 4]
  return contour.map((i) => notes[Math.min(i, notes.length - 1)])
}

/** Same phrase with two notes bent toward the mode's colors. */
function coloredLick(key: PitchClass, mode: ModeSpec): number[] {
  const lick = [...skeletonLick(key, mode)]
  const colorPcs = mode.colors.map((d) => pcOfDegree(d, key))
  const nearestColorMidi = (near: number, pc: PitchClass) => {
    let best = near
    let bestDist = 99
    for (let m = near - 6; m <= near + 6; m++) {
      if (normalizePc(m) === pc && Math.abs(m - near) < bestDist) { best = m; bestDist = Math.abs(m - near) }
    }
    return best
  }
  lick[2] = nearestColorMidi(lick[2], colorPcs[0])
  lick[5] = nearestColorMidi(lick[5], colorPcs[1])
  return lick
}

export function ModalColorsView() {
  const [modeId, setModeId] = useState('mixolydian')
  const [vampOn, setVampOn] = useState(false)
  const [hunting, setHunting] = useState(false)
  const [huntTarget, setHuntTarget] = useState<Degree | null>(null)
  const [reveal, setReveal] = useState(false)
  const [score, setScore] = useState({ hits: 0, tries: 0 })
  const micReady = useRef(false)
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mode = useMemo(() => MODES.find((m) => m.id === modeId)!, [modeId])
  const vamp = useMemo(() => vampFor(mode), [mode])
  const key = vamp.defaultKey

  const round = usePitchRound({
    timeoutMs: 12000,
    onScored: (r) => {
      if (huntTarget === null) return
      void recordAttempt({
        ts: Date.now(), drill: 'color', degree: huntTarget, key,
        correct: r.correct, latencyMs: r.latencyMs,
      })
      setScore((s) => ({ hits: s.hits + (r.correct ? 1 : 0), tries: s.tries + 1 }))
      if (r.correct) {
        setReveal(true)
        nextTimer.current = setTimeout(() => nextHunt(), 2000)
      }
    },
    onFoundAfterMiss: () => {
      setReveal(true)
      nextTimer.current = setTimeout(() => nextHunt(), 2000)
    },
  })

  useEffect(() => {
    if (round.phase === 'timeout') {
      setReveal(true)
      nextTimer.current = setTimeout(() => nextHunt(), 2400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.phase])

  // stop everything when leaving or switching modes
  useEffect(() => () => {
    sequencer.stop()
    noteTracker.stop()
    stopPitchEngine()
    if (nextTimer.current) clearTimeout(nextTimer.current)
  }, [])

  const startVamp = useCallback(() => {
    sequencer.load(vamp, key)
    sequencer.play()
    setVampOn(true)
  }, [vamp, key])

  const stopVamp = useCallback(() => {
    sequencer.stop()
    setVampOn(false)
  }, [])

  const nextHunt = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current)
    setReveal(false)
    // alternate between the two colors, slight random
    const degree = mode.colors[Math.random() < 0.5 ? 0 : 1]
    setHuntTarget(degree)
    round.arm(pcOfDegree(degree, key))
  }, [mode, key, round])

  const beginHunt = useCallback(async () => {
    if (!micReady.current) {
      try {
        await startPitchEngine()
        await calibrateNoiseFloor(0.8)
        noteTracker.start()
        micReady.current = true
      } catch {
        return // no mic — hunt can't run
      }
    }
    setScore({ hits: 0, tries: 0 })
    setHunting(true)
    if (!sequencer.playing) startVamp()
    nextHunt()
  }, [nextHunt, startVamp])

  const endHunt = useCallback(() => {
    setHunting(false)
    setHuntTarget(null)
    setReveal(false)
    round.toIdle()
    if (nextTimer.current) clearTimeout(nextTimer.current)
  }, [round])

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [
      skeletonLayer(key, mode.skeleton, 'all'),
      modeColorLayer(key, mode),
    ]
    if (hunting && huntTarget !== null && reveal) {
      out.push(targetLayer(pcOfDegree(huntTarget, key), key, true))
    }
    return out
  }, [key, mode, hunting, huntTarget, reveal])

  return (
    <div>
      <div className="mode-cards">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-card${m.id === modeId ? ' active' : ''}`}
            onClick={() => { setModeId(m.id); stopVamp(); endHunt() }}
          >
            <span className="mode-card-name">{m.name}</span>
            <span className="mode-card-formula mono">
              {m.skeleton} pent + {m.colors.map((c) => degreeLabel(c, m.labelOverride)).join(' + ')}
            </span>
            <span className="mode-card-songs">{m.songRefs[0]}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        <p className="vibe-line">“{mode.vibe}”</p>
        <div className="controls">
          <span className="mono dim">
            vamp: {vamp.name} · key of {pcName(key, key)}
          </span>
          {vampOn
            ? <button onClick={stopVamp}>stop vamp</button>
            : <button className="primary" onClick={startVamp}>play the vamp</button>}
          <button onClick={() => playMelody(skeletonLick(key, mode), 300)}>
            lick A — skeleton only
          </button>
          <button onClick={() => playMelody(coloredLick(key, mode), 300)}>
            lick B — with the colors
          </button>
          {hunting
            ? <button onClick={endHunt}>end hunt</button>
            : <button onClick={beginHunt}>hunt the colors (mic)</button>}
        </div>

        {hunting && (
          <div className={`gym-status gym-${round.phase}`}>
            <span className="gym-phase">
              {round.phase === 'listen' && huntTarget !== null
                ? `play the ${degreeLabel(huntTarget, mode.labelOverride)} — ${DEGREE_NAMES[huntTarget]}`
                : round.phase === 'hit' ? 'that’s the color'
                : round.phase === 'miss' ? 'not that one — listen for the rub'
                : round.phase === 'timeout' && huntTarget !== null
                  ? `it was ${pcName(pcOfDegree(huntTarget, key), key)} — see it glowing`
                : '…'}
            </span>
            <span className="gym-score mono">
              <b className="good">{score.hits}</b> / {score.tries}
            </span>
          </div>
        )}

        <Fretboard layers={layers} keyRoot={key} onNoteClick={(c) => playMidi(coordToMidi(c))} />
      </div>
    </div>
  )
}
