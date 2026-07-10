import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA install/offline support — PROD only. The dev server (127.0.0.1:5173)
// must never register this: Spotify's OAuth /callback round-trips through
// the dev server too, and a service worker there would be one more thing
// that could intercept it. See public/sw.js for the callback early-return.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.debug('[sw] registration failed', err)
    })
  })
}
