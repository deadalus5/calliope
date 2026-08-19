/**
 * Pure clock math for the practice deck. The sidecar pre-renders each speed
 * with ffmpeg atempo, so a rate-r file plays at node rate 1 and one file
 * second passes per AudioContext second: song time and file time relate by
 * the rate alone, and every conversion here is closed-form. This is what
 * makes deck-mode drill scoring exact — position and futures are pure
 * functions of ctx.currentTime, the same clock mic locks arrive on.
 */

export interface DeckAnchor {
  /** ctx.currentTime the current source node started (or re-anchored). */
  ctxT0: number
  /** File position (seconds) at that moment. */
  fileSec0: number
}

export interface FileLoop {
  startFile: number
  endFile: number
}

export function fileSecOf(songMs: number, rate: number): number {
  return songMs / 1000 / rate
}

export function songMsOf(fileSec: number, rate: number): number {
  return fileSec * rate * 1000
}

export function filePosAt(anchor: DeckAnchor, ctxNow: number): number {
  return anchor.fileSec0 + (ctxNow - anchor.ctxT0)
}

/** Where the buffer's playhead actually is under a native loop: the source
 * node wraps sample-accurately, this folds the linear anchor math to match. */
export function foldFilePos(filePos: number, loop: FileLoop | null): number {
  if (!loop || loop.endFile <= loop.startFile || filePos < loop.endFile) return filePos
  const span = loop.endFile - loop.startFile
  return loop.startFile + ((filePos - loop.startFile) % span)
}

/**
 * AudioContext time of the NEXT occurrence of a song position at/after now.
 * Under a loop, a target inside the loop that has just passed comes around
 * again next pass — drills schedule against the upcoming one.
 */
export function ctxTimeOfSongMs(
  anchor: DeckAnchor,
  ctxNow: number,
  songMs: number,
  rate: number,
  loop: FileLoop | null,
): number {
  const targetFile = fileSecOf(songMs, rate)
  const raw = filePosAt(anchor, ctxNow)
  if (!loop || loop.endFile <= loop.startFile) return ctxNow + (targetFile - raw)
  const cur = foldFilePos(raw, loop)
  let delta = targetFile - cur
  if (delta < 0 && targetFile >= loop.startFile && targetFile < loop.endFile) {
    delta += loop.endFile - loop.startFile
  }
  return ctxNow + delta
}

/** Quantized atempo rate for a target BPM: two decimals, clamped to the
 * range the sidecar will render (atempo's floor is exactly 0.5). */
export function rateForBpm(targetBpm: number, songBpm: number): number {
  if (songBpm <= 0) return 1
  const r = Math.round((targetBpm / songBpm) * 100) / 100
  return Math.min(1.25, Math.max(0.5, r))
}
