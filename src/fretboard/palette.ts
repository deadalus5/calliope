import type { Degree } from '../music-core'

/**
 * Degree → color, two switchable schemes, both validated (CVD-separation,
 * chroma floor, 3:1 contrast on the black board; every marker also carries
 * a text label, so identity is never color-alone).
 *
 * rainbow:  one distinct hue per degree. The leading tone (7) is a pale tint
 *           of the root's gold — it *looks* like "almost home".
 * families: hue = musical function. Root gold; 3rds coral; 5th teal;
 *           b5 blue-violet; 7ths violet; whole steps (2/4/6) sky;
 *           the dark half-steps (b2/b6) rose.
 */

export type ColorMode = 'families' | 'rainbow'

export const RAINBOW: Record<Degree, string> = {
  0: '#FFC94D', 1: '#FF6FA5', 2: '#5AC8FA', 3: '#FF8A3E', 4: '#8FE388', 5: '#B99CFF',
  6: '#3FE0C5', 7: '#FF6161', 8: '#6FA8FF', 9: '#D4E157', 10: '#E879F9', 11: '#FFDF8F',
}

export const FAMILIES: Record<Degree, string> = {
  0: '#FFC94D',
  1: '#E87F9F', 8: '#E87F9F', // the dark half-steps
  2: '#5FBEF5', 5: '#5FBEF5', 9: '#5FBEF5', // whole steps
  3: '#FF8A5C', 4: '#FF8A5C', // thirds
  6: '#8F9BFF', // blue note / b5
  7: '#4DD9A8', // the fifth
  10: '#C39CFF', 11: '#C39CFF', // sevenths
}

export function degreeColor(degree: Degree, mode: ColorMode): string {
  return (mode === 'rainbow' ? RAINBOW : FAMILIES)[((degree % 12) + 12) % 12]
}

export const FAMILY_LEGEND: { color: string; label: string }[] = [
  { color: '#FFC94D', label: 'root' },
  { color: '#FF8A5C', label: '3rds (b3·3)' },
  { color: '#4DD9A8', label: '5th' },
  { color: '#8F9BFF', label: 'b5 / blue note' },
  { color: '#C39CFF', label: '7ths (b7·7)' },
  { color: '#5FBEF5', label: 'steps (2·4·6)' },
  { color: '#E87F9F', label: 'b2 · b6' },
]

export const RAINBOW_LEGEND: { color: string; label: string }[] = (
  ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'] as const
).map((label, d) => ({ color: RAINBOW[d], label }))
