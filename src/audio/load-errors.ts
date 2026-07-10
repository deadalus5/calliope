/**
 * Pure callback registry for sample-load failures. Lives in audio/ so
 * samples.ts / drum-voice.ts can report a missing/failed file without
 * importing state/ (audio/ imports only music-core + sibling audio
 * modules — see CLAUDE.md, same rule Task 11 enforced for pitch/).
 * App.tsx (which *can* import state/) subscribes and turns reports into
 * toasts.
 */

const listeners = new Set<(what: string) => void>()
// Remembers every name reported so far, so a listener that subscribes late
// (e.g. after App.tsx re-mounts) still sees failures that happened before it
// attached.
const reported: string[] = []

export function reportLoadError(what: string): void {
  reported.push(what)
  for (const l of listeners) l(what)
}

export function onLoadError(l: (what: string) => void): () => void {
  listeners.add(l)
  for (const what of reported) l(what)
  return () => {
    listeners.delete(l)
  }
}
