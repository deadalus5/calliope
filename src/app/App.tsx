import { useState } from 'react'
import { startAudio } from '../audio/context'
import { ExploreView } from './views/ExploreView'
import { SingView } from './views/SingView'
import { SongLabView } from './views/SongLabView'
import { EarGymView } from './views/EarGymView'
import { TriadAtlasView } from './views/TriadAtlasView'
import { ModalColorsView } from './views/ModalColorsView'
import { StatsView } from './views/StatsView'
import './tokens.css'
import './app.css'

/**
 * Shell: start gate (browsers need a gesture before audio), then modules.
 * Views own their audio/mic lifecycles and stop them on unmount, so
 * switching modules always lands in a quiet room.
 */

type ModuleId = 'explore' | 'sing' | 'eargym' | 'triads' | 'modes' | 'songlab' | 'stats'

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'explore', label: 'Explore the Map' },
  { id: 'sing', label: 'Name What You Sing' },
  { id: 'eargym', label: 'Ear Gym' },
  { id: 'triads', label: 'Triad Atlas' },
  { id: 'modes', label: 'Modal Colors' },
  { id: 'songlab', label: 'Song Lab' },
  { id: 'stats', label: 'Dark Spots' },
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
      {module === 'sing' && <SingView />}
      {module === 'eargym' && <EarGymView />}
      {module === 'triads' && <TriadAtlasView />}
      {module === 'modes' && <ModalColorsView />}
      {module === 'songlab' && <SongLabView />}
      {module === 'stats' && <StatsView />}
    </div>
  )
}
