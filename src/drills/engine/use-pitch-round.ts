import { useCallback, useEffect, useRef, useState } from 'react'
import { audioNow } from '../../audio/context'
import { noteTracker } from '../../pitch/note-tracker'
import type { PitchClass } from '../../music-core'

/**
 * One call-and-response round, mic-verified and octave-agnostic:
 * prompt → listen (first locked note scores) → reveal → onScored.
 * The caller owns prompting sounds and target selection; this hook owns
 * timing, mic scoring, and phase state.
 */

export type RoundPhase = 'idle' | 'prompt' | 'listen' | 'hit' | 'miss' | 'timeout'

export interface RoundResult {
  correct: boolean
  latencyMs: number
  heardPc: PitchClass | null
}

interface UseRoundOpts {
  timeoutMs?: number
  /** Keep listening after a wrong first note until correct or timeout. */
  huntUntilCorrect?: boolean
  onScored: (r: RoundResult) => void
  onFoundAfterMiss?: () => void
}

export function usePitchRound({ timeoutMs = 9000, huntUntilCorrect = true, onScored, onFoundAfterMiss }: UseRoundOpts) {
  const [phase, setPhase] = useState<RoundPhase>('idle')
  const [heard, setHeard] = useState<PitchClass | null>(null)
  const target = useRef<PitchClass | null>(null)
  const armAt = useRef(0)
  const scored = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsub = useRef<(() => void) | null>(null)

  // Callbacks live in refs so arm() stays stable across renders.
  const onScoredRef = useRef(onScored)
  onScoredRef.current = onScored
  const onFoundRef = useRef(onFoundAfterMiss)
  onFoundRef.current = onFoundAfterMiss

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    unsub.current?.()
    unsub.current = null
  }, [])

  useEffect(() => () => clear(), [clear])

  /** Enter listening: called once the prompt has finished sounding. */
  const arm = useCallback((targetPc: PitchClass) => {
    clear()
    target.current = targetPc
    scored.current = false
    setHeard(null)
    setPhase('listen')
    armAt.current = audioNow()
    unsub.current = noteTracker.on((e) => {
      if (e.type !== 'lock' || target.current === null) return
      const pc = e.pitch.pc
      setHeard(pc)
      const correct = pc === target.current
      if (!scored.current) {
        scored.current = true
        const latencyMs = Math.max(0, (e.pitch.t - armAt.current) * 1000)
        onScoredRef.current({ correct, latencyMs: correct ? latencyMs : 0, heardPc: pc })
        if (correct) {
          setPhase('hit')
          clear()
        } else {
          setPhase('miss')
          if (!huntUntilCorrect) clear()
        }
      } else if (correct) {
        // found it after the miss — end the hunt
        clear()
        onFoundRef.current?.()
        setPhase('hit')
      }
    })
    timer.current = setTimeout(() => {
      if (!scored.current) {
        scored.current = true
        onScoredRef.current({ correct: false, latencyMs: 0, heardPc: null })
      }
      clear()
      setPhase('timeout')
    }, timeoutMs)
  }, [clear, huntUntilCorrect, timeoutMs])

  const toPrompt = useCallback(() => { clear(); setPhase('prompt') }, [clear])
  const toIdle = useCallback(() => { clear(); setPhase('idle') }, [clear])

  return { phase, heard, arm, toPrompt, toIdle }
}
