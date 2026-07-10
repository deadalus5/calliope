import { useEffect, useState } from 'react'
import { DEGREE_LABELS, PC, pcName, type PitchClass } from '../../music-core'
import { allCells, attemptCount } from '../../state/db'
import type { DrillType, SkillCell } from '../../state/skill-model'
import './stats.css'

/**
 * The dark-spot map: accuracy per degree × key, straight from practice
 * history. Blank cells are unexplored; dark red is where the work is.
 */

const KEYS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]
const DEGREES = Array.from({ length: 12 }, (_, i) => i)
const DRILLS: { id: DrillType; label: string }[] = [
  { id: 'find', label: 'hear → find' },
  { id: 'sing', label: 'name → sing' },
  { id: 'color', label: 'color hunts' },
]

export function StatsView() {
  const [cells, setCells] = useState<SkillCell[]>([])
  const [total, setTotal] = useState(0)
  const [drill, setDrill] = useState<DrillType>('find')

  useEffect(() => {
    void allCells().then(setCells)
    void attemptCount().then(setTotal)
  }, [])

  const byKey = new Map(cells.filter((c) => c.drill === drill).map((c) => [`${c.degree}:${c.key}`, c]))

  return (
    <div className="panel">
      <div className="controls">
        <span className="control-label">Dark-spot map</span>
        <div className="seg">
          {DRILLS.map((d) => (
            <button key={d.id} className={drill === d.id ? 'active' : ''} onClick={() => setDrill(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        <span className="mono dim" style={{ marginLeft: 'auto' }}>{total} attempts logged</span>
      </div>

      <div className="heat">
        <div className="heat-row">
          <span className="heat-label" />
          {DEGREES.map((d) => <span key={d} className="heat-label mono">{DEGREE_LABELS[d]}</span>)}
        </div>
        {KEYS.map((k) => (
          <div key={k} className="heat-row">
            <span className="heat-label mono">{pcName(k, k)}</span>
            {DEGREES.map((d) => {
              const cell = byKey.get(`${d}:${k}`)
              const acc = cell?.ewmaAcc
              const style = acc === undefined
                ? undefined
                : { background: heatColor(acc), borderColor: 'transparent' }
              return (
                <span key={d} className="heat-cell" style={style} title={
                  cell ? `${(acc! * 100).toFixed(0)}% · ${cell.n} tries · ${(cell.ewmaLatMs / 1000).toFixed(1)}s` : 'unexplored'
                }>
                  {cell && cell.n > 0 ? Math.round(cell.ewmaAcc * 100) : ''}
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <p className="dim" style={{ fontSize: 13 }}>
        Numbers are rolling accuracy. Empty squares haven’t been visited — the Ear Gym’s
        picker already leans toward whatever here looks worst.
      </p>
    </div>
  )
}

function heatColor(acc: number): string {
  // dark red (weak) → brass (strong)
  const r = Math.round(120 + (201 - 120) * acc)
  const g = Math.round(45 + (169 - 45) * acc)
  const b = Math.round(40 + (106 - 40) * acc)
  return `rgba(${r}, ${g}, ${b}, ${0.35 + 0.4 * acc})`
}
