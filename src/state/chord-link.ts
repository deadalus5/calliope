import { create } from 'zustand'
import type { FretCoord, PitchClass } from '../music-core'

/**
 * One-shot handoff between the Chord Library and the Chord Finder:
 * "take this chord over there". App.tsx watches `pending` to switch modules;
 * the receiving view consume()s the payload on mount. Not persisted — a
 * handoff only means anything within the moment it was sent.
 */

export interface ChordLink {
  target: 'chordlib' | 'chordfinder'
  root: PitchClass
  qualityId: string
  /** Exact voicing when known — the receiving view starts from these notes. */
  coords?: FretCoord[]
}

interface ChordLinkState {
  pending: ChordLink | null
  send: (link: ChordLink) => void
  /** Returns the pending link once, then clears it (StrictMode-safe: second call is null). */
  consume: () => ChordLink | null
}

export const useChordLink = create<ChordLinkState>()((set, get) => ({
  pending: null,
  send: (link) => set({ pending: link }),
  consume: () => {
    const link = get().pending
    if (link) set({ pending: null })
    return link
  },
}))
