import { Suspense, lazy, useEffect, useState } from 'react'
import { startAudio } from '../audio/context'
import { ExploreView } from './views/ExploreView'
import { SingView } from './views/SingView'
import { SongLabView } from './views/SongLabView'
import { EarGymView } from './views/EarGymView'
import { TriadAtlasView } from './views/TriadAtlasView'
import { SlashGuideView } from './views/SlashGuideView'
import { ModalColorsView } from './views/ModalColorsView'
import { StatsView } from './views/StatsView'
import { BoardOptions } from '../fretboard/BoardOptions'
import './tokens.css'
import './app.css'

/**
 * Shell: start gate (browsers need a gesture before audio), then modules.
 * Views own their audio/mic lifecycles and stop them on unmount, so
 * switching modules always lands in a quiet room.
 */

type ModuleId = 'explore' | 'sing' | 'eargym' | 'triads' | 'slash' | 'modes' | 'songlab' | 'jam' | 'stats'

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'explore', label: 'Explore the Map' },
  { id: 'sing', label: 'Name What You Sing' },
  { id: 'eargym', label: 'Ear Gym' },
  { id: 'triads', label: 'Triad Atlas' },
  { id: 'slash', label: 'Slash Chords' },
  { id: 'modes', label: 'Modal Colors' },
  { id: 'songlab', label: 'Song Lab' },
  { id: 'jam', label: 'Jam Room (Spotify)' },
  { id: 'stats', label: 'Dark Spots' },
]

// Spotify stays lazy and isolated: deleting src/integrations/spotify only
// affects this import.
const SpotifyView = lazy(() =>
  import('../integrations/spotify/SpotifyView').then((m) => ({ default: m.SpotifyView })),
)

export default function App() {
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [module, setModule] = useState<ModuleId>('explore')

  // Returning from Spotify OAuth lands on /callback: finish the token
  // exchange, then open the Jam Room after the start gate.
  useEffect(() => {
    if (window.location.pathname === '/callback') {
      void import('../integrations/spotify/auth').then(async ({ handleCallback }) => {
        await handleCallback()
        setModule('jam')
      })
    }
  }, [])

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
          disabled={loading}
          onClick={async () => {
            setLoading(true)
            await startAudio()
            // decode every sample before the first note can be asked for
            const [{ warmAudition }, { getBand }, { samplesLoaded }] = await Promise.all([
              import('../audio/audition'), import('../audio/instruments'), import('../audio/samples'),
            ])
            warmAudition()
            getBand()
            await samplesLoaded()
            setReady(true)
          }}
        >
          {loading ? 'tuning up…' : 'Pick up the guitar'}
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

      {module !== 'stats' && <BoardOptions />}

      {module === 'explore' && <ExploreView />}
      {module === 'sing' && <SingView />}
      {module === 'eargym' && <EarGymView />}
      {module === 'triads' && <TriadAtlasView />}
      {module === 'slash' && <SlashGuideView />}
      {module === 'modes' && <ModalColorsView />}
      {module === 'songlab' && <SongLabView />}
      {module === 'jam' && (
        <Suspense fallback={<div className="panel dim">tuning in…</div>}>
          <SpotifyView />
        </Suspense>
      )}
      {module === 'stats' && <StatsView />}
    </div>
  )
}
