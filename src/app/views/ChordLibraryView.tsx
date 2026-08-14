import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playChord, playMelody, playMidi } from '../../audio/audition'
import { exposeDebug } from '../../audio/debug'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordShapeLayer, skeletonLayer } from '../../fretboard/build-layers'
import type { FretboardLayer, NoteMarker } from '../../fretboard/layers'
import { degreeColor } from '../../fretboard/palette'
import { useBoardPrefs } from '../../state/board-prefs'
import { useChordLink } from '../../state/chord-link'
import {
  FLAVOR_GROUPS, PC, chordSymbol, coordToMidi, coordToPc, coordsForPc, degreeLabel,
  displayString, findVoicings, instantiateTemplate, loreFor, pcName, qualityById,
  shapeDifficulty, templatesFor,
  type ChordShape, type FretCoord, type PitchClass,
} from '../../music-core'
import './chordlibrary.css'

/**
 * Chord Library — every chord as a grip hung from a root he can name.
 * Three ways in, all landing in the same place: pick a root (buttons or tap
 * the board — the tap also picks the string and the neighborhood), pick a
 * flavor (the shape shows immediately, floating, and snaps when a root
 * arrives), or both. The rail below cycles every playable possibility,
 * easiest first. Labels/colors follow the global board options, so degrees,
 * letters, or blank dots are one click away.
 */

const ROOTS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e']
const FLAVOR_IDS = FLAVOR_GROUPS.flatMap((g) => g.ids)

// The full voicing list stays cyclable (▶), but only this many cards render —
// 173 buttons for "G7 anywhere" is noise, the two dozen easiest are the menu.
const RAIL_MAX = 24

function easeDots(difficulty: number): string {
  const n = difficulty <= 1.5 ? 5 : difficulty <= 3 ? 4 : difficulty <= 4.5 ? 3 : difficulty <= 6.5 ? 2 : 1
  return '●'.repeat(n) + '○'.repeat(5 - n)
}

export function ChordLibraryView() {
  const [root, setRoot] = useState<PitchClass | null>(null)
  const [qualityId, setQualityId] = useState<string | null>(null)
  const [rootString, setRootString] = useState<number | null>(null)
  const [nearFret, setNearFret] = useState<number | null>(null)
  const [shapeIndex, setShapeIndex] = useState(0)
  const [showPent, setShowPent] = useState(false)
  const colorMode = useBoardPrefs((s) => s.colorMode)
  // A specific form was chosen before the root existed — select it once the
  // voicing list regenerates, so the shape he was looking at is the one that
  // snaps into place.
  const pendingFrets = useRef<string | null>(null)

  useEffect(() => {
    const link = useChordLink.getState().consume()
    if (!link || link.target !== 'chordlib') return
    const qid = link.qualityId === 'maj7no5' ? 'maj7' : link.qualityId
    setRoot(link.root)
    setQualityId(qid)
    if (link.coords?.length) {
      // Anchor on the pick that actually carries the root (a slash chord's
      // lowest note is the bass, not the root). nearFret is always safe — it
      // only biases the sort — but rootString is a hard filter, and some
      // strings can't anchor this chord at all (nothing can root a 4-note
      // grip on the high e). Only pin the string when it yields shapes.
      const byMidi = [...link.coords].sort((a, b) => coordToMidi(a) - coordToMidi(b))
      const anchor = byMidi.find((c) => coordToPc(c) === link.root) ?? byMidi[0]
      setNearFret(anchor.fret)
      const anchored = findVoicings({ root: link.root, qualityId: qid, rootString: anchor.string })
      setRootString(anchored.length > 0 ? anchor.string : null)
    }
  }, [])

  const mode = root !== null && qualityId !== null ? 'full'
    : root !== null ? 'rootOnly'
    : qualityId !== null ? 'flavorOnly'
    : 'idle'

  const voicings = useMemo(() => {
    if (root === null || qualityId === null) return []
    return findVoicings({
      root, qualityId,
      rootString: rootString ?? undefined,
      nearFret: nearFret ?? undefined,
    })
  }, [root, qualityId, rootString, nearFret])

  // Flavor-first browsing: movable forms previewed on A until a root lands.
  // The root-string filter applies here too, so the buttons stay honest.
  const templatePairs = useMemo(() => {
    if (mode !== 'flavorOnly' || qualityId === null) return []
    return templatesFor(qualityId)
      .filter((t) => rootString === null || t.rootString === rootString)
      .flatMap((template) => {
        const shape = instantiateTemplate(template, PC.A)[0]
        return shape !== undefined ? [{ template, shape }] : []
      })
  }, [mode, qualityId, rootString])

  // Root-first browsing: every flavor with its best grip on this root.
  const flavorBest = useMemo(() => {
    if (mode !== 'rootOnly' || root === null) return []
    return FLAVOR_IDS.flatMap((id) => {
      const shape = findVoicings({
        root, qualityId: id,
        rootString: rootString ?? undefined,
        nearFret: nearFret ?? undefined,
      })[0]
      return shape !== undefined ? [{ id, shape }] : []
    })
  }, [mode, root, rootString, nearFret])

  useEffect(() => {
    if (pendingFrets.current === null) return
    const i = voicings.findIndex((v) => v.frets.join(',') === pendingFrets.current)
    pendingFrets.current = null
    if (i >= 0) setShapeIndex(i)
  }, [voicings])

  const railShapes = mode === 'full' ? voicings : templatePairs.map((p) => p.shape)
  const shape: ChordShape | undefined =
    railShapes.length > 0 ? railShapes[Math.min(shapeIndex, railShapes.length - 1)] : undefined
  const quality = qualityId !== null ? qualityById(qualityId) : null
  const lore = qualityId !== null ? loreFor(qualityId) : undefined
  const symbol = root !== null && quality !== null
    ? chordSymbol({ root, quality }, root)
    : quality !== null ? (quality.suffix || 'maj') : null
  const boardKey = root ?? (mode === 'flavorOnly' ? PC.A : PC.C)

  const pickRoot = useCallback((pc: PitchClass, str?: number, fret?: number) => {
    if (mode === 'flavorOnly' && templatePairs.length > 0) {
      // Honor the previewed form: snap IT to the new root (nearest octave to
      // any tapped fret) and derive the string/fret filters from the adopted
      // shape itself, so the staged frets are guaranteed to exist in the
      // regenerated, rootString-filtered voicing list.
      const pair = templatePairs[Math.min(shapeIndex, templatePairs.length - 1)]
      const moved = instantiateTemplate(pair.template, pc)
      if (moved.length > 0) {
        const adopted = fret === undefined
          ? moved[0]
          : moved.reduce((a, b) =>
              Math.abs(a.frets[a.rootString] - fret) <= Math.abs(b.frets[b.rootString] - fret) ? a : b)
        pendingFrets.current = adopted.frets.join(',')
        setRoot(pc)
        setRootString(adopted.rootString)
        setNearFret(adopted.frets[adopted.rootString])
        setShapeIndex(0)
        return
      }
    }
    setRoot(pc)
    if (str !== undefined) setRootString(str)
    if (fret !== undefined) setNearFret(fret)
    setShapeIndex(0)
  }, [mode, templatePairs, shapeIndex])

  const pickFlavor = useCallback((id: string) => {
    setQualityId((prev) => (prev === id ? null : id))
    setShapeIndex(0)
  }, [])

  const stepFlavor = useCallback((dir: 1 | -1) => {
    const at = qualityId === null ? -1 : FLAVOR_IDS.indexOf(qualityId)
    const next = at < 0 ? (dir === 1 ? 0 : FLAVOR_IDS.length - 1) : (at + dir + FLAVOR_IDS.length) % FLAVOR_IDS.length
    setQualityId(FLAVOR_IDS[next])
    setShapeIndex(0)
  }, [qualityId])

  const stepShape = useCallback((dir: 1 | -1) => {
    if (mode === 'rootOnly') { stepFlavor(dir); return }
    const n = railShapes.length
    if (n === 0) return
    // Side effects stay out of the setState updater — StrictMode runs
    // updaters twice in dev, which double-strummed the audition.
    const next = (Math.min(shapeIndex, n - 1) + dir + n) % n
    setShapeIndex(next)
    const s = railShapes[next]
    if (s !== undefined) playChord(s.midis, 45)
  }, [mode, railShapes, stepFlavor, shapeIndex])

  const handleBoardClick = useCallback((c: FretCoord) => {
    playMidi(coordToMidi(c))
    const onShape = shape?.coords.some((sc) => sc.string === c.string && sc.fret === c.fret) ?? false
    if (onShape && mode === 'full') return // tapping the grip just sounds it
    pickRoot(coordToPc(c), c.string, c.fret)
  }, [shape, mode, pickRoot])

  const layers = useMemo(() => {
    const out: FretboardLayer[] = []
    if (showPent && root !== null && quality !== null) {
      out.push(skeletonLayer(root, quality.intervals.includes(3) ? 'minor' : 'major', 'all'))
    }
    if (root !== null) {
      // E/A anchor roots only while browsing — once a grip is up, the board is the grip's notes alone
      if (shape === undefined) {
        out.push({
          id: `cl-anchors-${root}`,
          zIndex: 8,
          markers: coordsForPc(root)
            .filter((c) => c.string <= 1 && c.fret < 12)
            .map((coord): NoteMarker => ({ coord, role: 'root', label: pcName(root, root), degree: 0 })),
        })
      }
      if (mode === 'rootOnly') {
        out.push({
          id: `cl-root-everywhere-${root}`,
          zIndex: 12,
          markers: coordsForPc(root)
            .filter((c) => c.string > 1)
            .map((coord): NoteMarker => ({ coord, role: 'ghost', label: degreeLabel(0), degree: 0 })),
        })
      }
    }
    if (shape !== undefined) {
      out.push(chordShapeLayer(
        shape,
        `cl-shape-${shape.frets.join('.')}-${mode}`,
        { unanchored: mode === 'flavorOnly' },
      ))
    }
    return out
  }, [showPent, root, quality, mode, shape])

  useEffect(() => {
    exposeDebug({
      chordLibMode: mode,
      chordLibSymbol: mode === 'full' ? symbol : null,
      chordLibFrets: shape !== undefined ? shape.frets : null,
      chordLibRootString: shape !== undefined ? shape.rootString : null,
      chordLibCount: mode === 'rootOnly' ? flavorBest.length : railShapes.length,
      chordLibSource: shape?.source ?? null,
    })
  }, [mode, symbol, shape, railShapes.length, flavorBest.length])

  const railCount = mode === 'rootOnly' ? flavorBest.length : railShapes.length
  const railTitle = mode === 'full' ? `shapes for ${symbol}`
    : mode === 'flavorOnly' ? `${symbol} forms (previewing on A)`
    : mode === 'rootOnly' ? `chords on ${pcName(root ?? 0, root ?? 0)}`
    : 'shapes'

  return (
    <div>
      {mode === 'idle' && (
        <div className="panel cl-intro">
          <h2>Every chord, hung from a note you can name</h2>
          <p>
            Three ways in. <b>Pick a root</b> below (or tap any note on the board — that also
            picks the string and the spot). <b>Pick a flavor</b> and the shape appears right away,
            floating, then snaps into place when the root lands. Or both, and cycle every playable
            grip — easiest first. Degrees, letters, or blank dots: the board options above switch it.
          </p>
        </div>
      )}

      <div className="panel">
        <div className="controls">
          <span className="control-label">Root</span>
          {root !== null && (
            <button onClick={() => { setRoot(null); setNearFret(null); setShapeIndex(0) }}>clear</button>
          )}
        </div>
        <div className="cl-roots">
          {ROOTS.map((pc) => (
            <button
              key={pc}
              data-pc={pc}
              className={`cl-root${root === pc ? ' active' : ''}`}
              onClick={() => pickRoot(pc)}
            >
              {pcName(pc, pc)}
            </button>
          ))}
        </div>

        <div className="controls">
          <span className="control-label">Root string</span>
          <div className="cl-strings">
            <button
              data-string="any"
              className={rootString === null ? 'active' : ''}
              onClick={() => { setRootString(null); setShapeIndex(0) }}
            >
              any
            </button>
            {[0, 1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                data-string={s}
                className={`cl-string${s <= 1 ? ' cl-string-anchor' : ''}${rootString === s ? ' active' : ''}`}
                disabled={s === 5}
                title={s === 5
                  ? 'a grip anchors on its lowest sounding string — a root on the 1st leaves nothing to stack'
                  : undefined}
                onClick={() => { setRootString(s); setNearFret(null); setShapeIndex(0) }}
              >
                <span className="cl-string-num">{displayString(s)}</span>
                <span className="cl-string-name">{STRING_NAMES[s]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="controls">
          <span className="control-label">Flavor</span>
          <div className="cl-rail-nav">
            <button title="previous flavor" onClick={() => stepFlavor(-1)}>‹</button>
            <button title="next flavor" onClick={() => stepFlavor(1)}>›</button>
          </div>
          {qualityId !== null && <button onClick={() => { setQualityId(null); setShapeIndex(0) }}>clear</button>}
        </div>
        {FLAVOR_GROUPS.map((g) => (
          <div className="cl-group" key={g.name}>
            <div className="cl-group-name">{g.name}</div>
            <div className="cl-flavors">
              {g.ids.map((id) => {
                const q = qualityById(id)
                return (
                  <button
                    key={id}
                    data-quality={id}
                    className={`cl-flavor${qualityId === id ? ' active' : ''}`}
                    onClick={() => pickFlavor(id)}
                  >
                    <span className="cl-flavor-sym">
                      {root !== null ? chordSymbol({ root, quality: q }, root) : (q.suffix || 'maj')}
                    </span>
                    <span className="cl-flavor-formula mono">
                      {q.intervals.map((d) => degreeLabel(d)).join(' ')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {mode !== 'idle' && (
        <div className="panel">
          <div className="cl-rail-head">
            <span className="cl-rail-title">{railTitle}</span>
            <div className="cl-rail-nav">
              <button title="previous" onClick={() => stepShape(-1)}>◀</button>
              <button title="next" onClick={() => stepShape(1)}>▶</button>
            </div>
            <span className="cl-rail-count mono">
              {mode === 'rootOnly'
                ? `${railCount} flavors`
                : railCount > 0 ? `${Math.min(shapeIndex, railCount - 1) + 1} / ${railCount}` : '0'}
            </span>
          </div>

          <div className="cl-rail">
            {mode === 'rootOnly'
              ? flavorBest.map(({ id, shape: s }) => (
                  <button
                    key={id}
                    data-quality={id}
                    className="cl-shape"
                    onClick={() => { pickFlavor(id); playChord(s.midis, 45) }}
                  >
                    <span className="cl-shape-name">
                      {chordSymbol({ root: root ?? 0, quality: qualityById(id) }, root ?? 0)}
                    </span>
                    <span className="cl-shape-frets mono">
                      {s.frets.map((f) => (f < 0 ? 'x' : f)).join('-')}
                    </span>
                    <span className="cl-shape-ease">{easeDots(shapeDifficulty(s))}</span>
                  </button>
                ))
              : railShapes.slice(0, RAIL_MAX).map((s, i) => (
                  <button
                    key={`${s.frets.join('.')}-${i}`}
                    className={`cl-shape${s === shape ? ' active' : ''}`}
                    onClick={() => { setShapeIndex(i); playChord(s.midis, 45) }}
                  >
                    <span className="cl-shape-name">
                      {s.label}{s.source === 'curated' ? '' : ` · fret ${Math.max(s.baseFret, 1)}`}
                    </span>
                    <span className="cl-shape-frets mono">
                      {s.frets.map((f) => (f < 0 ? 'x' : f)).join('-')}
                    </span>
                    <span className="cl-shape-ease">{easeDots(shapeDifficulty(s))}</span>
                  </button>
                ))}
            {mode !== 'rootOnly' && railShapes.length > RAIL_MAX && (
              <span className="cl-rail-more">
                +{railShapes.length - RAIL_MAX} more up the neck — ▶ walks them all, or narrow by root string
              </span>
            )}
            {mode === 'full' && railShapes.length === 0 && (
              <span className="cl-rail-more">
                no {symbol} grip puts the root on string{' '}
                {rootString !== null ? `${displayString(rootString)} (${STRING_NAMES[rootString]})` : 'that string'} —
                a grip hangs from its lowest string, so try “any” or strings 6–4
              </span>
            )}
            {mode === 'flavorOnly' && railShapes.length === 0 && (
              <span className="cl-rail-more">
                no movable {symbol} form anchors on that string — try “any”, or pick a root and
                every playable grip appears
              </span>
            )}
            {mode === 'rootOnly' && flavorBest.length === 0 && (
              <span className="cl-rail-more">
                no grips put the root there — a grip hangs from its lowest string, so try “any” or strings 6–4
              </span>
            )}
          </div>

          {shape !== undefined && symbol !== null && (
            <div className="cl-readout">
              <span className="cl-main">{mode === 'flavorOnly' ? `${symbol} shape` : symbol}</span>
              <span className="cl-sub">
                {shape.label} · root on string {displayString(shape.rootString)} ({STRING_NAMES[shape.rootString]})
                {shape.barre !== undefined ? ' · barre' : ''}
                {shape.omitted.length > 0 ? ` · no ${shape.omitted.map((d) => degreeLabel(d)).join(', ')}` : ''}
              </span>
            </div>
          )}

          <div className="cl-actions">
            <button disabled={shape === undefined} onClick={() => shape !== undefined && playChord(shape.midis, 45)}>
              strum ▸
            </button>
            <button disabled={shape === undefined} onClick={() => shape !== undefined && playMelody(shape.midis, 280)}>
              arpeggiate ▸
            </button>
            <button
              className={showPent ? 'active' : ''}
              disabled={root === null || qualityId === null}
              title={root === null || qualityId === null ? 'needs a root and a flavor' : undefined}
              onClick={() => setShowPent((v) => !v)}
            >
              pentatonic skeleton
            </button>
            <button
              disabled={mode !== 'full' || shape === undefined}
              title={mode !== 'full' || shape === undefined ? 'needs a root and a flavor' : undefined}
              onClick={() => {
                if (mode !== 'full' || shape === undefined || root === null || qualityId === null) return
                useChordLink.getState().send({ target: 'chordfinder', root, qualityId, coords: shape.coords })
              }}
            >
              open in finder →
            </button>
          </div>

          <p className="vibe-line">
            {mode === 'full'
              ? (shape !== undefined
                  ? `Tap the grip to hear each note; tap anywhere else to re-hang ${symbol} from that root.`
                  : `No ${symbol} grips put the root there — set root string back to any, or root it on E, A, or D.`)
              : mode === 'flavorOnly'
                ? (shape !== undefined
                    ? 'This is the shape. Pick a root — buttons or any tap on the board — and it snaps there.'
                    : 'No movable form anchors on that string — set root string to any, or pick a root and every playable grip appears.')
                : 'Tap a flavor (or ▶) to hear every chord this root can carry.'}
          </p>

          <Fretboard layers={layers} keyRoot={boardKey} onNoteClick={handleBoardClick} />
        </div>
      )}

      {quality !== null && lore !== undefined && (
        <div className="panel cl-lore">
          <div className="cl-chips">
            {quality.intervals.map((d) => (
              <span className="cl-chip" key={d}>
                <i style={{ background: degreeColor(d, colorMode) }} />
                {degreeLabel(d)}
              </span>
            ))}
            {shape?.omitted.map((d) => (
              <span className="cl-chip cl-chip-off" key={`off-${d}`}>
                <i style={{ background: degreeColor(d, colorMode) }} />
                {degreeLabel(d)} omitted in this grip
              </span>
            ))}
          </div>
          <p className="cl-lore-row"><span className="cl-lore-label">sound</span>{lore.color}</p>
          <p className="cl-lore-row"><span className="cl-lore-label">build</span>{lore.build}</p>
          <p className="cl-lore-row"><span className="cl-lore-label">pull</span>{lore.pull}</p>
          <p className="cl-lore-row"><span className="cl-lore-label">heard on</span>{lore.uses.join(' · ')}</p>
          <div className="cl-next">
            {lore.nextMoves.map((m) => <span className="cl-next-chip" key={m}>{m}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}
