# Changelog — Audio Overhaul (July 2026)

## The band sounds real now

- **Real drums.** The old three-file drum machine is gone. The kit is now a real recorded acoustic kit (Salamander Drumkit) with soft and hard hits for every drum and several different recordings per hit — so no two hi-hat notes sound identical, and playing harder actually changes the tone, not just the volume. Includes kick, snare, cross-stick, closed/open/pedal hi-hat, ride, ride bell, crash, and two toms.
- **A proper mix.** The band now plays through a real mixing chain: each instrument gets its own channel and EQ, the drums share a room reverb, and a master limiter stops anything from clipping — you can turn it up.
- **The drummer plays the form.** Fills every 4 or 8 bars, a crash on the bar after a fill, and switches between hi-hat and ride every 8 bars. You can hear where bar 1 is with your eyes closed.
- **The groove is human.** Each player sits in their own pocket (the snare lays back, the bass pushes or relaxes depending on the style) instead of everything landing on a robotic grid.
- **No more loop fatigue.** The arrangement is generated four different ways and laid end to end, so the band plays for about four times the song form before anything literally repeats.
- **Count-in.** Four stick clicks before the band comes in (can be turned off).

## Every song got its own arrangement

Previously all the non-blues songs shared one identical backing pattern. Now:

- **12-bar blues (both)** — classic boogie bassline (the 1-3-5-6-b7 sound) with Charleston piano stabs and a swung kit.
- **Minor blues** — slow walking bass and laid-back comping.
- **Grateful Dead songs** (Franklin's, Fire on the Mountain, Scarlet, Sugaree) — driving straight-eighths feel with rhythmic piano strums.
- **Gravity / Slow Dancing** — halftime slow-soul feel with sustained piano pads.
- **Waiting on the World to Change** — pop-soul groove.
- **Neo-Soul Vamp** — sparse, behind-the-beat stabs that anticipate the next chord.
- **Dorian / Lydian / Phrygian vamps** — hypnotic pedal-bass grooves.

## The notes are actually right

- Fixed: the bass used to play a major 6th over minor chords. It doesn't anymore.
- Fixed: over slash chords (like the D/C in the Lydian vamp) the bass now plays the actual chord tones — the F# color note the song exists to teach is finally in the bassline.
- The piano now voice-leads: each chord moves the fewest fingers from the last one instead of jumping around, keeps the 3rd and 7th in every voicing, and never plays two notes smashed a half-step together.
- Walking basslines now resolve properly into the next chord instead of leaving leading tones hanging.

## New: no-mic mode

- A global **mic on / no mic** toggle (next to the board options, remembered between sessions). When it's off, the app never touches your microphone — guaranteed.
- **Ear Gym still works without the mic**: answer by tapping the note on the fretboard instead of playing it.
- Features that genuinely need a mic (the sing game, Modal Colors' hunt) turn themselves off with a clear note about why.
- All mic problems (denied permission, no device) now show one consistent message with a one-click "go no-mic" button — no more silent failures.

## New: guide-tone drill in Song Lab

- Turn it on and the board pearls the 3rd (or 7th) of the *upcoming* chord one bar early. Land that note within a beat of the change and it counts as a hit; the band ducks so you can hear yourself.
- Results feed the adaptive practice engine, so the stats now show which *chord changes* you can't navigate yet.

## Song Lab practice controls

- **Mute / solo / volume for each instrument** — kill the bass and walk it yourself, or run drums-only.
- **A/B loop**: click two bars on the chart to loop just that section; click again to clear.
- **Spacebar** plays and pauses.
- **Count-in toggle** in the transport row.

## The app is more of an app now

- **Installable (PWA)** — add it to your dock/home screen; it loads fully offline.
- **The screen stays awake** while the band is playing — no more dead screen on the music stand mid-song.
- **Backup and restore**: one button in Stats exports all your practice history and settings to a single file; import it on any machine (Spotify login is deliberately excluded from backups).
- **Failure messages**: if a sample file ever fails to load, you get a toast and a retry button instead of a silently missing band member.

## Under the hood (for future reference)

- All arrangement logic moved into a pure, seeded, heavily-tested module (`src/audio/arrange/` — 240 unit tests project-wide now).
- The Song Lab verification script now checks for clipping, chord-change timing accuracy, and fills — and can record an 8-bar audio bounce for listening checks (`--bounce`).
- New verification scripts cover no-mic mode and the guide-tone drill end to end.
- CLAUDE.md was rewritten to describe the new architecture.
