import { useBoardPrefs } from '../state/board-prefs'
import { FAMILY_LEGEND, RAINBOW_LEGEND } from './palette'
import './board-options.css'

/**
 * Global fretboard display controls: color scheme, label style, legend.
 * Rendered once in the shell — every board in the app follows it.
 */
export function BoardOptions() {
  const { colorMode, labelStyle, showLegend, setColorMode, setLabelStyle, toggleLegend } = useBoardPrefs()
  const legend = colorMode === 'families' ? FAMILY_LEGEND : RAINBOW_LEGEND

  return (
    <div className="board-options">
      <div className="board-options-row">
        <span className="control-label">Colors</span>
        <div className="seg">
          <button className={colorMode === 'families' ? 'active' : ''} onClick={() => setColorMode('families')}>
            families
          </button>
          <button className={colorMode === 'rainbow' ? 'active' : ''} onClick={() => setColorMode('rainbow')}>
            per-degree
          </button>
        </div>
        <span className="control-label">Labels</span>
        <div className="seg">
          {(['degree', 'letter', 'none'] as const).map((s) => (
            <button key={s} className={labelStyle === s ? 'active' : ''} onClick={() => setLabelStyle(s)}>
              {s}
            </button>
          ))}
        </div>
        <button className={showLegend ? 'active' : ''} onClick={toggleLegend}>legend</button>
      </div>
      {showLegend && (
        <div className="board-legend">
          {legend.map((l) => (
            <span key={l.label} className="board-legend-item">
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
