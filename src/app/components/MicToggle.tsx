import { useAppPrefs } from '../../state/app-prefs'
import { stopPitchEngine } from '../../pitch/pitch-engine'
import { noteTracker } from '../../pitch/note-tracker'
import '../../fretboard/board-options.css'

/**
 * Global mic on/off toggle. Rendered adjacent to <BoardOptions /> in the
 * app shell — same segmented-control look, but this lives at the app layer
 * (not fretboard/) because fretboard/ may not import pitch/.
 */
export function MicToggle() {
  const micMode = useAppPrefs((s) => s.micMode)
  const setMicMode = useAppPrefs((s) => s.setMicMode)

  return (
    <div className="board-options">
      <div className="board-options-row">
        <span className="control-label">Mic</span>
        <div className="seg">
          <button className={micMode === 'on' ? 'active' : ''} onClick={() => setMicMode('on')}>
            🎤 mic on
          </button>
          <button
            className={micMode === 'off' ? 'active' : ''}
            onClick={() => {
              setMicMode('off')
              // Kill a live engine immediately rather than waiting for the
              // next view-level effect to notice the pref flip.
              stopPitchEngine()
              noteTracker.stop()
            }}
          >
            no mic
          </button>
        </div>
      </div>
    </div>
  )
}
