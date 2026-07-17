import { useState } from 'react'
import type { AudioCandidate, UgVersionChoice } from './songsmith-client'

/**
 * Rendered when the sidecar needs a human ear: no Official chart on UG
 * (pick a community version), or no confident YouTube match (pick the
 * recording, or paste a URL).
 */
export function VersionPicker({ versions, audioCandidates, onPickTab, onPickUrl }: {
  versions?: UgVersionChoice[]
  audioCandidates?: AudioCandidate[]
  onPickTab: (tabId: number) => void
  onPickUrl: (url: string) => void
}) {
  const [url, setUrl] = useState('')

  return (
    <div className="panel">
      {versions && versions.length > 0 && (
        <>
          <h3>Pick the chart</h3>
          <p className="dim">No Official chart on UG for this one — these are the top community versions.</p>
          <div className="songmap-versions">
            {versions.map((v) => (
              <button key={v.tabId} onClick={() => onPickTab(v.tabId)}>
                {v.versionLabel}
                <span className="dim"> · ★{v.rating.toFixed(1)} ({v.votes} votes){v.tonalityName ? ` · in ${v.tonalityName}` : ''}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {audioCandidates && (
        <>
          <h3>Pick the recording</h3>
          <p className="dim">
            None of these clearly matched the Spotify track (length is the big tell). Pick one, or paste a
            YouTube link to the right recording.
          </p>
          <div className="songmap-versions">
            {audioCandidates.map((c) => (
              <button key={c.videoId} onClick={() => onPickUrl(`https://www.youtube.com/watch?v=${c.videoId}`)}>
                {c.videoTitle}
                <span className="dim"> · {c.channel} · {Math.round(c.durationMs / 1000)}s · match {(c.matchScore * 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
          <div className="controls">
            <input
              className="spotify-input mono"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="primary" disabled={!url.trim()} onClick={() => onPickUrl(url.trim())}>
              use this recording
            </button>
          </div>
        </>
      )}
    </div>
  )
}
