import { useEffect, useReducer, useState } from 'react'
import { deck, rateForBpm } from '../../audio/deck'
import type { SongMap } from './songmap'

/**
 * The practice deck's transport: play/pause plus a BPM-tied speed control —
 * the map knows the song's tempo, so the knob reads "80 bpm of 98", not a
 * percentage. Each speed is a pitch-preserving atempo render fetched from
 * the sidecar on first use (spinner while it lands).
 */

const BPM_STEP = 5

export function PracticeDeck({ map }: { map: SongMap }) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const original = Math.round(map.tempo.bpm)
  const [targetBpm, setTargetBpm] = useState(original)
  const [switching, setSwitching] = useState(false)

  // Follow play/pause/rate changes made elsewhere (mode switches, seeks).
  useEffect(() => {
    const timer = setInterval(bump, 250)
    return () => clearInterval(timer)
  }, [])

  const minBpm = Math.ceil((original * 0.5) / BPM_STEP) * BPM_STEP
  const maxBpm = Math.floor((original * 1.25) / BPM_STEP) * BPM_STEP

  const applyBpm = async (bpm: number) => {
    const clamped = Math.min(maxBpm, Math.max(minBpm, bpm))
    setTargetBpm(clamped)
    setSwitching(true)
    try {
      await deck.setRate(clamped === original ? 1 : rateForBpm(clamped, map.tempo.bpm))
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="controls songmap-deck">
      <button
        className="primary songmap-deckplay"
        onClick={() => { if (deck.playing) deck.pause(); else deck.play(); bump() }}
      >
        {deck.playing ? '❚❚' : '▶'}
      </button>
      <div className="control-group">
        <span className="control-label">tempo</span>
        <button disabled={switching || targetBpm - BPM_STEP < minBpm} onClick={() => void applyBpm(targetBpm - BPM_STEP)}>
          −{BPM_STEP}
        </button>
        <span className="mono songmap-deckbpm">
          {switching ? '…' : targetBpm} bpm
          <span className="dim"> {targetBpm === original ? '(original)' : `of ${original}`}</span>
        </span>
        <button disabled={switching || targetBpm + BPM_STEP > maxBpm} onClick={() => void applyBpm(targetBpm + BPM_STEP)}>
          +{BPM_STEP}
        </button>
        {targetBpm !== original && (
          <button disabled={switching} onClick={() => void applyBpm(original)}>original</button>
        )}
      </div>
      <span className="dim songmap-deckpos mono">
        {Math.floor(deck.positionMs() / 60_000)}:{String(Math.floor((deck.positionMs() % 60_000) / 1000)).padStart(2, '0')}
      </span>
      {deck.loopActive && <span className="dim">⟳ looping</span>}
    </div>
  )
}
