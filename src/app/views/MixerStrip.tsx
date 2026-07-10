import { useState } from 'react'
import { getMixer, type MixChannelId } from '../../audio/mixer'
import './mixerstrip.css'

/**
 * Practice-mode mixer strip for Song Lab: mute/solo/volume per band channel
 * ("no bass — I'll walk it", "drums only", "keys down 6"). Session-only —
 * state lives in this component and is mirrored onto the Task 3 mixer's
 * Tone.Channel instances (mute/solo) and userGain (volume) on every change.
 * Initialized from the mixer's current values on mount so remounting this
 * view mid-session doesn't reset whatever the player had dialed in.
 *
 * Tone.Channel.solo uses a global solo bus shared by every Tone.Channel/Solo
 * instance in the page — but the band's keys/bass/drums channels (mixer.ts)
 * are the only Tone.Channels anywhere in the app, so soloing here can't leak
 * into or be affected by any other view.
 */

const CHANNELS: Array<{ id: MixChannelId; label: string }> = [
  { id: 'keys', label: 'keys' },
  { id: 'bass', label: 'bass' },
  { id: 'drums', label: 'drums' },
]

interface ChannelState { mute: boolean; solo: boolean; gain: number }

function readChannel(id: MixChannelId): ChannelState {
  const mixer = getMixer()
  const ch = mixer.channel(id)
  return { mute: ch.mute, solo: ch.solo, gain: mixer.userGain(id) }
}

export function MixerStrip() {
  const [state, setState] = useState<Record<MixChannelId, ChannelState>>(() => ({
    keys: readChannel('keys'),
    bass: readChannel('bass'),
    drums: readChannel('drums'),
  }))

  function update(id: MixChannelId, patch: Partial<ChannelState>) {
    const mixer = getMixer()
    const ch = mixer.channel(id)
    if (patch.mute !== undefined) ch.mute = patch.mute
    if (patch.solo !== undefined) ch.solo = patch.solo
    if (patch.gain !== undefined) mixer.setUserGain(id, patch.gain)
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  return (
    <div className="mixer-strip">
      {CHANNELS.map(({ id, label }) => {
        const s = state[id]
        return (
          <div key={id} className="mixer-channel">
            <span className="mixer-label">{label}</span>
            <button
              className={`mixer-toggle mixer-mute${s.mute ? ' active' : ''}`}
              onClick={() => update(id, { mute: !s.mute })}
              title={`Mute ${label}`}
              aria-pressed={s.mute}
            >
              M
            </button>
            <button
              className={`mixer-toggle mixer-solo${s.solo ? ' active' : ''}`}
              onClick={() => update(id, { solo: !s.solo })}
              title={`Solo ${label}`}
              aria-pressed={s.solo}
            >
              S
            </button>
            <input
              className="mixer-slider"
              type="range"
              min={-24}
              max={6}
              step={1}
              value={s.gain}
              onChange={(e) => update(id, { gain: Number(e.target.value) })}
              aria-label={`${label} volume`}
            />
            <span className="mono dim mixer-db">{s.gain > 0 ? `+${s.gain}` : s.gain}dB</span>
          </div>
        )
      })}
    </div>
  )
}
