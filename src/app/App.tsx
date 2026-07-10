import { useState } from 'react'
import { startAudio } from '../audio/context'
import { ExploreView } from './views/ExploreView'
import './tokens.css'
import './app.css'

/**
 * Shell: start gate (browsers need a gesture before audio), then module
 * navigation. Modules register here as they land in later phases.
 */

type ModuleId = 'explore'

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'explore', label: 'Explore the Map' },
]

export default function App() {
  const [ready, setReady] = useState(false)
  const [module, setModule] = useState<ModuleId>('explore')

  if (!ready) {
    return (
      <div className="start-gate">
        <h1>Calliope</h1>
        <p>
          Music theory built on the map you already own — the pentatonic shapes,
          the E and A anchors, and your ear.
        </p>
        <button
          className="primary"
          onClick={async () => {
            await startAudio()
            setReady(true)
          }}
        >
          Pick up the guitar
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Calliope</h1>
        <span className="app-tagline">skeleton + colors</span>
      </header>

      <nav className="app-nav">
        {MODULES.map((m) => (
          <button
            key={m.id}
            className={module === m.id ? 'active' : ''}
            onClick={() => setModule(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>

      {module === 'explore' && <ExploreView />}
    </div>
  )
}
