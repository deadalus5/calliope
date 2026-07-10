// Calliope service worker — plain JS, no build step (same convention as
// pitch-processor.js: served as-is from public/, never bundled). Registered
// from src/main.tsx ONLY in production; the dev server (127.0.0.1:5173,
// where Spotify's OAuth /callback must round-trip untouched) never loads
// this file at all — see the PROD-only registration guard.
//
// Bump this on any change to the cached shell/strategy — old caches are
// deleted in `activate`.
const CACHE_VERSION = 'calliope-v2'
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

// The app shell: small, known-at-build-time files. Hashed Vite bundles
// (JS/CSS under /assets/) are NOT enumerated here — they're runtime-cached
// on first fetch instead, so this list never goes stale across a build.
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  // Per-item add (not addAll): addAll is all-or-nothing, so a single
  // missing shell file would silently brick the whole install. A failed
  // item just degrades — it gets runtime-cached on first successful fetch.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.debug('[sw] precache skipped', url, err)
          }),
        ),
      ),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Never intercept non-GET (OAuth token POSTs, etc.) — let the browser
  // handle them natively.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // HARD CONSTRAINT: never touch the Spotify OAuth callback, and never
  // touch cross-origin requests (Spotify's own API/auth calls). Both fall
  // straight through to the network with no respondWith.
  if (url.pathname === '/callback' || url.origin !== location.origin) return

  // Samples and hashed build assets: cache-first, fill the runtime cache
  // on first request. These are content-addressed or effectively static,
  // so a stale cache entry is never wrong.
  if (url.pathname.startsWith('/samples/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy))
          }
          return res
        })
      }),
    )
    return
  }

  // Everything else same-origin GET (the shell, navigations): network-first
  // so the practice-room UI is always fresh when online, falling back to
  // whatever's cached — and falling back to the cached shell page for
  // navigations specifically, so offline reload still opens the app.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
        }
        return res
      })
      .catch(() =>
        caches.match(request).then(async (cached) => {
          if (cached) return cached
          if (request.mode === 'navigate') {
            const shell = await caches.match('/index.html')
            if (shell) return shell
          }
          // Never resolve respondWith with undefined — hand back a real
          // (failed) Response so the request pipeline stays well-formed.
          return new Response('', { status: 504, statusText: 'offline' })
        }),
      ),
  )
})
