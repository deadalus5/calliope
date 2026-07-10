import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '../fretboard/palette'

/** Global fretboard display preferences, persisted across sessions. */

export type LabelStyle = 'degree' | 'letter' | 'none'

interface BoardPrefs {
  colorMode: ColorMode
  labelStyle: LabelStyle
  showLegend: boolean
  setColorMode: (m: ColorMode) => void
  setLabelStyle: (s: LabelStyle) => void
  toggleLegend: () => void
}

export const useBoardPrefs = create<BoardPrefs>()(
  persist(
    (set) => ({
      colorMode: 'families',
      labelStyle: 'degree',
      showLegend: true,
      setColorMode: (colorMode) => set({ colorMode }),
      setLabelStyle: (labelStyle) => set({ labelStyle }),
      toggleLegend: () => set((s) => ({ showLegend: !s.showLegend })),
    }),
    { name: 'calliope:board-prefs' },
  ),
)
