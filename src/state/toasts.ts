import { create } from 'zustand'

/**
 * Shared toast/banner surface. Non-persisted, callable from outside React
 * (e.g. a catch block in an audio/pitch module) via `showToast`.
 */

export interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

interface ToastStoreState {
  toasts: Toast[]
}

const MAX_TOASTS = 3
const AUTO_DISMISS_MS = 6000

// Exported (not just the hook) so tests can read/reset the stack directly
// without mounting a component.
export const useToastStore = create<ToastStoreState>(() => ({ toasts: [] }))

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function clearTimer(id: number): void {
  const t = timers.get(id)
  if (t !== undefined) {
    clearTimeout(t)
    timers.delete(id)
  }
}

function scheduleAutoDismiss(id: number): void {
  clearTimer(id)
  timers.set(
    id,
    setTimeout(() => dismissToast(id), AUTO_DISMISS_MS),
  )
}

/** Show a toast. Callable from anywhere, including outside React. */
export function showToast(t: { message: string; action?: Toast['action'] }): void {
  const { toasts } = useToastStore.getState()
  const existing = toasts.find((x) => x.message === t.message)
  if (existing) {
    // Dedupe: refresh the timer on the toast already showing rather than
    // stacking a duplicate.
    scheduleAutoDismiss(existing.id)
    return
  }

  const id = nextId++
  let next = [...toasts, { id, message: t.message, action: t.action }]
  if (next.length > MAX_TOASTS) {
    const dropped = next.slice(0, next.length - MAX_TOASTS)
    for (const d of dropped) clearTimer(d.id)
    next = next.slice(next.length - MAX_TOASTS)
  }
  useToastStore.setState({ toasts: next })
  scheduleAutoDismiss(id)
}

export function dismissToast(id: number): void {
  clearTimer(id)
  useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

/** Hook for ToastHost to subscribe to the live stack. */
export function useToasts(): Toast[] {
  return useToastStore((s) => s.toasts)
}
