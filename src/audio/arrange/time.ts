/**
 * Pure conversion from an arranger's absolute float beat (quarter-note
 * units, 0 = form start) to a Tone.js 'bars:quarters:sixteenths' transport
 * time string. No Tone import — this is arithmetic only, so the sequencer
 * (Task 8) can bake all four passes' event times up front and hand plain
 * strings to Tone.Part.
 */
export function beatToTime(atBeat: number, beatsPerBar: number): string {
  const bar = Math.floor(atBeat / beatsPerBar)
  const beat = Math.floor(atBeat) % beatsPerBar
  const sixteenths = (atBeat % 1) * 4
  return `${bar}:${beat}:${sixteenths}`
}
