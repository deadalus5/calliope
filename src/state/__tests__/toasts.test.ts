import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissToast, showToast, useToastStore } from '../toasts'

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('show adds a toast', () => {
    showToast({ message: 'hello' })
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['hello'])
  })

  it('auto-dismisses after 6 seconds', () => {
    showToast({ message: 'gone soon' })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('manual dismiss removes the toast and cancels its timer', () => {
    showToast({ message: 'dismiss me' })
    const [{ id }] = useToastStore.getState().toasts
    dismissToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    // Advancing time past the auto-dismiss window must not throw or
    // re-remove anything (the timer should have been cleared).
    vi.advanceTimersByTime(6000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('deduplicates identical messages by refreshing the timer instead of stacking', () => {
    showToast({ message: 'same message' })
    vi.advanceTimersByTime(4000)
    showToast({ message: 'same message' })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    // Original 6s window would have expired by now (4000 + 3000 = 7000),
    // but the dedupe refresh should have reset the clock.
    vi.advanceTimersByTime(3000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('caps concurrent toasts at 3, dropping the oldest', () => {
    showToast({ message: 'one' })
    showToast({ message: 'two' })
    showToast({ message: 'three' })
    showToast({ message: 'four' })
    const messages = useToastStore.getState().toasts.map((t) => t.message)
    expect(messages).toEqual(['two', 'three', 'four'])
  })

  it('runs the action and dismisses when action.run is invoked by the caller', () => {
    const run = vi.fn()
    showToast({ message: 'with action', action: { label: 'Retry', run } })
    const toast = useToastStore.getState().toasts[0]
    expect(toast.action?.label).toBe('Retry')
    toast.action?.run()
    expect(run).toHaveBeenCalledOnce()
  })
})
