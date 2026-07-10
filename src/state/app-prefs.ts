import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Global app preferences, persisted across sessions. */

export type MicMode = 'on' | 'off'

interface AppPrefsState {
  micMode: MicMode
  countIn: boolean
  setMicMode: (m: MicMode) => void
  setCountIn: (v: boolean) => void
}

export const useAppPrefs = create<AppPrefsState>()(
  persist(
    (set) => ({
      micMode: 'on',
      countIn: true,
      setMicMode: (micMode) => set({ micMode }),
      setCountIn: (countIn) => set({ countIn }),
    }),
    { name: 'calliope:app-prefs' },
  ),
)
