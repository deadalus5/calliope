import { FILLS } from './fills'
import type { DrumSpec, GrooveSpec } from './types'

/**
 * Drum arranger. Pure function of (bars, groove, beatsPerBar, rng, barOffset)
 * — no Tone, no DOM, no Math.random.
 *
 * `barOffset` lets Task 8 call this once per baked pass
 * (`barOffset = pass * bars`) and have fills/ride phases continue across
 * passes: every positional decision below keys off
 * `formBar = barOffset + localBar`. Output `atBeat`s are LOCAL — relative to
 * THIS call's bar 0 — regardless of barOffset.
 *
 * Continuation contract for Task 8: this function only emits the
 * crash-after-fill for fills that fired *within* a call. If a fill fires on
 * the very last local bar of a call, the crash for the bar that follows (the
 * first bar of the next pass) is Task 8's job — detect it by checking
 * whether any event in the final local bar (atBeat >= (bars - 1) *
 * beatsPerBar) has `fill: true`, and if so seed the next call's first bar
 * with a crash the way this function does internally.
 *
 * Determinism: rng is drawn in a FIXED per-bar order regardless of outcome
 * (draw-then-decide) — the four ornament draws happen every bar, and the
 * fill fire-roll happens on every candidate bar — so identical args always
 * produce a deep-equal result.
 */
export function arrangeDrums(
  bars: number,
  groove: GrooveSpec,
  beatsPerBar: number,
  rng: () => number,
  barOffset = 0,
): DrumSpec[] {
  if (beatsPerBar !== 4) return arrangeTimekeepingOnly(bars, groove, beatsPerBar)

  const out: DrumSpec[] = []
  const fillEveryBars = groove.fillEveryBars
  const isShortForm = fillEveryBars > 0 && bars < fillEveryBars
  let fillFiredPrevBar = false

  for (let localBar = 0; localBar < bars; localBar++) {
    const formBar = barOffset + localBar
    const barStart = localBar * beatsPerBar
    const barEvents: DrumSpec[] = []
    const ridePhaseActive = !!groove.ridePhase && formBar % 16 >= 8 && formBar % 16 <= 15

    // --- fixed-order rng draws for this bar ---------------------------------
    const rGhostP = rng()
    const rGhostPos = rng()
    const rOpenHat = rng()
    const rKickAnd = rng()

    const isCandidate = fillEveryBars > 0 && (isShortForm ? localBar === bars - 1 : (formBar + 1) % fillEveryBars === 0)
    let fires = false
    let fragIdx = -1
    if (isCandidate) {
      const rFire = rng()
      const forcedAlways = !isShortForm && (formBar + 1) % (2 * fillEveryBars) === 0
      fires = forcedAlways || rFire < 0.5
      if (fires) {
        const rFrag = rng()
        fragIdx = Math.min(FILLS.length - 1, Math.floor(rFrag * FILLS.length))
      }
    }

    // --- crash carried from a fill that fired in the previous bar ----------
    if (fillFiredPrevBar) {
      barEvents.push({ atBeat: barStart, art: 'crash', vel: 0.9 })
    }

    // --- timekeeping voice ---------------------------------------------------
    const slotEvents: DrumSpec[] = []
    for (let slot = 0; slot < 8; slot++) {
      slotEvents.push({
        atBeat: barStart + slot * 0.5,
        art: ridePhaseActive ? 'ride' : 'hat-closed',
        vel: groove.hatVel[slot],
      })
    }
    if (ridePhaseActive) {
      barEvents.push({ atBeat: barStart + 1, art: 'hat-pedal', vel: 0.5 })
      barEvents.push({ atBeat: barStart + 3, art: 'hat-pedal', vel: 0.5 })
    }
    barEvents.push(...slotEvents)

    // --- kick -----------------------------------------------------------------
    barEvents.push({ atBeat: barStart + 0, art: 'kick', vel: 1.0 })
    if (!groove.halftime) {
      barEvents.push({ atBeat: barStart + 2, art: 'kick', vel: 0.85 })
    }

    // --- snare ------------------------------------------------------------------
    if (groove.halftime) {
      barEvents.push({ atBeat: barStart + 2, art: 'snare', vel: 0.9 })
    } else {
      barEvents.push({ atBeat: barStart + 1, art: 'snare', vel: 0.9 })
      barEvents.push({ atBeat: barStart + 3, art: 'snare', vel: 0.9 })
    }

    if (!fires) {
      // --- ornaments (skipped entirely in fill-replaced windows) -----------
      if (rGhostP < groove.ornaments.ghostSnareP) {
        const pos = rGhostPos < 0.5 ? 1.75 : 3.75
        barEvents.push({ atBeat: barStart + pos, art: 'snare', vel: 0.22 })
      }
      if (rOpenHat < groove.ornaments.openHatP && formBar % 4 === 3 && !ridePhaseActive) {
        // slotEvents[7] is the 3.5 timekeeping event — replace in place.
        slotEvents[7].art = 'hat-open'
        slotEvents[7].vel = 0.6
      }
      if (rKickAnd < groove.ornaments.kickAndP) {
        barEvents.push({ atBeat: barStart + 2.5, art: 'kick', vel: 0.7 })
      }
    } else {
      // --- fill: wipe the last beat's base events, splice the fragment in ---
      const kept = barEvents.filter((e) => e.atBeat < barStart + 3)
      barEvents.length = 0
      barEvents.push(...kept)
      const frag = FILLS[fragIdx]
      for (const fe of frag) {
        barEvents.push({ atBeat: barStart + 3 + fe.atBeat, art: fe.art, vel: fe.vel, fill: true })
      }
    }

    fillFiredPrevBar = fires
    out.push(...barEvents)
  }

  return out
}

/**
 * Non-4/4 guard: plain timekeeping only (hat 8ths + kick 0/"2-ish" + snare
 * backbeat on the remaining integer beats) — no ornaments, no fills, no
 * crashes. Never throws regardless of beatsPerBar.
 */
function arrangeTimekeepingOnly(bars: number, groove: GrooveSpec, beatsPerBar: number): DrumSpec[] {
  const out: DrumSpec[] = []
  const kickBeat2 = beatsPerBar > 2 ? Math.round(beatsPerBar / 2) : -1
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * beatsPerBar
    for (let slot = 0; slot < beatsPerBar * 2; slot++) {
      out.push({ atBeat: barStart + slot * 0.5, art: 'hat-closed', vel: groove.hatVel[slot % 8] })
    }
    out.push({ atBeat: barStart + 0, art: 'kick', vel: 1.0 })
    if (kickBeat2 > 0 && kickBeat2 < beatsPerBar) {
      out.push({ atBeat: barStart + kickBeat2, art: 'kick', vel: 0.85 })
    }
    for (let beat = 1; beat < beatsPerBar; beat++) {
      if (beat === kickBeat2) continue
      out.push({ atBeat: barStart + beat, art: 'snare', vel: 0.9 })
    }
  }
  return out
}
