import { useEffect, useState } from 'react'
import { useSidecar } from './sidecar-store'

/**
 * Sidecar hookup: the URL of the songsmith service, with a live health
 * readout from the shared sidecar store (so saving here immediately un-gates
 * the auto-chords flow). Machine-local config — deliberately not in backups.
 */
export function SongsmithSettings({ onClose }: { onClose: () => void }) {
  const url = useSidecar((s) => s.url)
  const status = useSidecar((s) => s.status)
  const health = useSidecar((s) => s.health)
  const [draft, setDraft] = useState(url ?? 'http://127.0.0.1:8765')

  useEffect(() => {
    if (url) void useSidecar.getState().probe()
  }, [url])

  const save = () => useSidecar.getState().setUrl(draft)

  return (
    <div className="panel">
      <h3>Songsmith</h3>
      <p className="dim">
        Songsmith looks up the chords, hears out the beat, and hands the Jam Room a Song Map.
        On the machine that runs it: <span className="mono">cd songsmith && ./setup.sh</span> once,
        then <span className="mono">npm start</span> (or <span className="mono">./install-launchd.sh</span> to keep it running).
      </p>
      <div className="controls">
        <input
          className="spotify-input mono"
          placeholder="http://127.0.0.1:8765"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        />
        <button className="primary" onClick={save}>save & check</button>
        <button onClick={onClose}>done</button>
      </div>
      {status === 'checking' && <p className="dim">checking…</p>}
      {status === 'offline' && (
        <p className="dim">✗ not reachable — cached songs still work; new songs fall back to hand-tapped charts</p>
      )}
      {status === 'unknown' && !url && <p className="dim">no sidecar configured yet</p>}
      {status === 'ok' && health && (
        <p className="dim">
          ✓ connected · yt-dlp {health.ytdlpVersion ?? 'MISSING'} · analyzer {health.analyzerOk ? 'ready' : 'NOT INSTALLED (run setup.sh)'}
          · UG cookie {health.ugCookie ? 'set (Official charts on)' : 'not set (community charts)'}
          · {health.cacheCount} songs learned
        </p>
      )}
    </div>
  )
}
