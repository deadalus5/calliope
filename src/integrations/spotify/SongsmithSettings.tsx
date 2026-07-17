import { useEffect, useState } from 'react'
import { getSongsmithUrl, setSongsmithUrl, sidecarHealth, type SidecarHealth } from './songsmith-client'

/**
 * Sidecar hookup: the URL of the songsmith service on the Mac mini, with a
 * live health readout. Machine-local config — deliberately not in backups.
 */
export function SongsmithSettings({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(getSongsmithUrl() ?? 'http://127.0.0.1:8765')
  const [health, setHealth] = useState<SidecarHealth | null | 'checking'>('checking')

  const check = async (candidate: string) => {
    setHealth('checking')
    setSongsmithUrl(candidate)
    setHealth(await sidecarHealth())
  }

  useEffect(() => {
    if (getSongsmithUrl()) void sidecarHealth().then(setHealth)
    else setHealth(null)
  }, [])

  return (
    <div className="panel">
      <h3>Songsmith (the Mac mini)</h3>
      <p className="dim">
        Songsmith looks up the chords, hears out the beat, and hands the Jam Room a Song Map.
        Run <span className="mono">songsmith/setup.sh</span> once on the mini, then <span className="mono">npm start</span>.
      </p>
      <div className="controls">
        <input
          className="spotify-input mono"
          placeholder="http://127.0.0.1:8765"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void check(url) }}
        />
        <button className="primary" onClick={() => void check(url)}>save & check</button>
        <button onClick={onClose}>done</button>
      </div>
      {health === 'checking' && <p className="dim">checking…</p>}
      {health === null && <p className="dim">✗ not reachable — cached songs still work; new songs fall back to hand-tapped charts</p>}
      {health !== null && health !== 'checking' && (
        <p className="dim">
          ✓ connected · yt-dlp {health.ytdlpVersion ?? 'MISSING'} · analyzer {health.analyzerOk ? 'ready' : 'NOT INSTALLED (run setup.sh)'}
          · UG cookie {health.ugCookie ? 'set (Official charts on)' : 'not set (community charts)'}
          · {health.cacheCount} songs learned
        </p>
      )}
    </div>
  )
}
