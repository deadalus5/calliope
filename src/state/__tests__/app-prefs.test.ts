import { beforeEach, describe, expect, it } from 'vitest'

// This sandbox's Node build ships an experimental global `localStorage`
// that, under jsdom, shadows jsdom's real Storage with a stub whose
// getter returns `undefined` (no --localstorage-file configured). Patch a
// real in-memory Storage onto `window` *before* importing app-prefs,
// whose Zustand `persist` store reads localStorage synchronously at
// module-eval time to hydrate. No-op wherever localStorage already works.
if (typeof window.localStorage?.setItem !== 'function') {
  class MemoryStorage implements Storage {
    private map = new Map<string, string>()
    get length() {
      return this.map.size
    }
    clear() {
      this.map.clear()
    }
    getItem(key: string) {
      return this.map.has(key) ? this.map.get(key)! : null
    }
    key(index: number) {
      return Array.from(this.map.keys())[index] ?? null
    }
    removeItem(key: string) {
      this.map.delete(key)
    }
    setItem(key: string, value: string) {
      this.map.set(key, String(value))
    }
  }
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true })
}

const { useAppPrefs } = await import('../app-prefs')

describe('app prefs', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppPrefs.setState({ micMode: 'on', countIn: true })
  })

  it('defaults to mic on and count-in on', () => {
    const { micMode, countIn } = useAppPrefs.getState()
    expect(micMode).toBe('on')
    expect(countIn).toBe(true)
  })

  it('setMicMode updates state', () => {
    useAppPrefs.getState().setMicMode('off')
    expect(useAppPrefs.getState().micMode).toBe('off')
  })

  it('setCountIn updates state', () => {
    useAppPrefs.getState().setCountIn(false)
    expect(useAppPrefs.getState().countIn).toBe(false)
  })

  it('persists under the calliope:app-prefs key', () => {
    useAppPrefs.getState().setMicMode('off')
    const raw = window.localStorage.getItem('calliope:app-prefs')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.micMode).toBe('off')
  })
})
