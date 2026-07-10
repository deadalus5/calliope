/**
 * E2E introspection surface. Everything the verify-*.mjs scripts read lives
 * under globalThis.__calliope — this is the one place that touches it, so
 * every producer (mixer, sequencer) merges in rather than clobbering.
 */

interface CalliopeDebug {
  __calliope?: Record<string, unknown>
}

/** Merge fields into globalThis.__calliope (E2E introspection surface). */
export function exposeDebug(patch: Record<string, unknown>): void {
  const g = globalThis as CalliopeDebug
  g.__calliope = { ...g.__calliope, ...patch }
}
