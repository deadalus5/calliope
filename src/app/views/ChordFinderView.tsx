import { useCallback, useEffect, useMemo, useState } from 'react'
import { playChord, playMelody, playMidi } from '../../audio/audition'
import { exposeDebug } from '../../audio/debug'
import { Fretboard } from '../../fretboard/Fretboard'
import type { FretboardLayer } from '../../fretboard/layers'
import { degreeColor } from '../../fretboard/palette'
import { useBoardPrefs } from '../../state/board-prefs'
import { useChordLink } from '../../state/chord-link'
import {
  coordToMidi, coordToPc, degreeLabel, degreeOf, displayString, identifyNotes, loreFor, pcName,
  type FretCoord, type PitchClass,
} from '../../music-core'
import './chordfinder.css'

/**
 * Chord Finder — build it, we name it. Tap notes on the board (one per
 * string, like a real hand) and after every tap the name updates: one note
 * is a note, two is an interval (or a power chord), three and up gets the
 * full ranked treatment — slash basses, missing 5ths, added colors and all.
 * Alternates re-color the degrees, because the same notes read differently
 * from a different root.
 */

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e']

export function ChordFinderView() {
  const [picks, setPicks] = useState<FretCoord[]>([])
  const [altIndex, setAltIndex] = useState(0)
  const colorMode = useBoardPrefs((s) => s.colorMode)

  useEffect(() => {
    const link = useChordLink.getState().consume()
    if (link?.target === 'chordfinder' && link.coords?.length) setPicks(link.coords)
  }, [])

  const ordered = useMemo(
    () => [...picks].sort((a, b) => coordToMidi(a) - coordToMidi(b)),
    [picks],
  )
  const bassCoord = ordered[0]
  const bassPc = bassCoord !== undefined ? coordToPc(bassCoord) : undefined
  const pcs = useMemo(() => ordered.map(coordToPc), [ordered])
  const ident = useMemo(() => identifyNotes(pcs, bassPc), [pcs, bassPc])

  useEffect(() => { setAltIndex(0) }, [picks])

  const cand = ident.candidates.length > 0
    ? ident.candidates[Math.min(altIndex, ident.candidates.length - 1)]
    : undefined
  const rootRef: PitchClass = cand?.chord.root ?? bassPc ?? 0

  const mainText = ident.kind === 'empty' ? null
    : ident.kind === 'note' ? (ident.noteName ?? '')
    : cand !== undefined ? cand.symbol
    : ident.kind === 'interval' && bassPc !== undefined
      ? `${pcName(bassPc, bassPc)} + ${ident.intervalLabel ?? 'interval'}`
      : '…not a chord yet'

  const kindText = ident.kind === 'note' ? 'single note'
    : ident.kind === 'interval' ? (ident.intervalLabel ?? 'interval')
    : ident.kind === 'chord' ? (cand === undefined ? 'keep going — or back one note off' : cand.exact ? 'chord' : 'closest read')
    : ''

  const handleBoardClick = useCallback((c: FretCoord) => {
    playMidi(coordToMidi(c))
    setPicks((prev) => {
      const held = prev.find((p) => p.string === c.string)
      if (held && held.fret === c.fret) return prev.filter((p) => p.string !== c.string)
      return [...prev.filter((p) => p.string !== c.string), c]
    })
  }, [])

  const layers = useMemo(() => {
    if (picks.length === 0) return []
    const out: FretboardLayer[] = [{
      id: `cf-picks-${picks.map((p) => `${p.string}.${p.fret}`).join('-')}-${rootRef}`,
      zIndex: 40,
      markers: picks.map((coord) => {
        const deg = degreeOf(coordToPc(coord), rootRef)
        return {
          coord,
          role: 'triad' as const,
          label: degreeLabel(deg),
          degree: deg,
          ring: bassCoord !== undefined && coord.string === bassCoord.string && coord.fret === bassCoord.fret,
        }
      }),
    }]
    return out
  }, [picks, rootRef, bassCoord])

  useEffect(() => {
    exposeDebug({
      chordFinderKind: ident.kind,
      chordFinderSymbol: mainText,
      chordFinderPcs: pcs,
      chordFinderAlts: ident.candidates.length,
    })
  }, [ident, mainText, pcs])

  const lore = cand !== undefined ? loreFor(cand.chord.quality.id) : undefined

  return (
    <div>
      <div className="panel cf-intro">
        <h2>Build it — I’ll name it</h2>
        <p>
          Tap notes on the board, <b>one per string</b>, like a hand would hold them.
          The name updates with every tap: one note is a note, two is an interval,
          three and up gets the full read — slash basses, missing 5ths, added color and all.
          Tap a held note again to let it go.
        </p>
      </div>

      <div className="panel">
        <div className="cf-readout">
          {mainText === null
            ? <span className="cf-main cf-main-dim">tap the strings…</span>
            : <span className="cf-main">{mainText}</span>}
          {kindText !== '' && <span className="cf-kind">{kindText}</span>}
        </div>

        {ordered.length > 0 && (
          <div className="cf-notes">
            {ordered.map((coord) => {
              const pc = coordToPc(coord)
              const deg = degreeOf(pc, rootRef)
              return (
                <span className="cf-note" key={`${coord.string}.${coord.fret}`}>
                  <i style={{ background: degreeColor(deg, colorMode) }} />
                  {pcName(pc, rootRef)}
                  <span className="cf-note-deg">
                    {degreeLabel(deg)} · str {displayString(coord.string)}{STRING_NAMES[coord.string]} fret {coord.fret}
                  </span>
                </span>
              )
            })}
          </div>
        )}

        {ident.candidates.length > 1 && (
          <div className="cf-alts">
            <span className="cf-alts-label">also reads as</span>
            {ident.candidates.map((c, i) => (
              <button
                key={c.symbol}
                data-symbol={c.symbol}
                className={`cf-alt${i === Math.min(altIndex, ident.candidates.length - 1) ? ' active' : ''}`}
                onClick={() => setAltIndex(i)}
              >
                {c.symbol}
              </button>
            ))}
          </div>
        )}

        <Fretboard layers={layers} keyRoot={rootRef} onNoteClick={handleBoardClick} />

        <div className="cf-actions">
          <button
            disabled={ordered.length === 0}
            onClick={() => playChord(ordered.map(coordToMidi), 45)}
          >
            strum ▸
          </button>
          <button
            disabled={ordered.length === 0}
            onClick={() => playMelody(ordered.map(coordToMidi), 280)}
          >
            arpeggiate ▸
          </button>
          <button disabled={picks.length === 0} onClick={() => setPicks([])}>clear</button>
          <button
            disabled={cand === undefined}
            title={cand === undefined ? 'needs a named chord — keep going, or back one note off' : undefined}
            onClick={() => {
              if (cand === undefined) return
              useChordLink.getState().send({
                target: 'chordlib',
                root: cand.chord.root,
                qualityId: cand.chord.quality.id,
                coords: picks,
              })
            }}
          >
            shapes for this → library
          </button>
        </div>
      </div>

      {cand !== undefined && (
        <div className="panel cf-comments">
          {cand.chord.bass !== undefined && (
            <p className="cf-comment">
              <span className="cf-comment-label">slash</span>
              A <b>{pcName(cand.chord.root, cand.chord.root)} {cand.chord.quality.displayName}</b> stacked
              over a <b>{pcName(cand.chord.bass, cand.chord.root)}</b> bass — a shape over a bass note,
              same trick as the Slash Chords page.
            </p>
          )}
          {cand.omissions.length > 0 && (
            <p className="cf-comment">
              <span className="cf-comment-label">omitted</span>
              No {cand.omissions.map((d) => degreeLabel(d)).join(', ')} — the ear fills it in,
              the name still fits.
            </p>
          )}
          {cand.additions.length > 0 && (
            <p className="cf-comment">
              <span className="cf-comment-label">extra color</span>
              Beyond the book recipe: {cand.additions.map((d) => degreeLabel(d)).join(', ')} —
              that’s the sparkle in the name’s parentheses.
            </p>
          )}
          {lore !== undefined && (
            <>
              <p className="cf-comment"><span className="cf-comment-label">sound</span>{lore.color}</p>
              <p className="cf-comment"><span className="cf-comment-label">build</span>{lore.build}</p>
              <p className="cf-comment"><span className="cf-comment-label">pull</span>{lore.pull}</p>
              <p className="cf-comment"><span className="cf-comment-label">heard on</span>{lore.uses.join(' · ')}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
