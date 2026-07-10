/**
 * Spotify Authorization Code + PKCE, fully client-side (no secret, no
 * backend). The user supplies their own Client ID from the Spotify
 * Developer Dashboard; the app must be registered with redirect URI
 *   http://127.0.0.1:5173/callback
 * (Spotify no longer accepts "localhost" — the loopback IP is required.)
 */

const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state'

export const REDIRECT_URI = 'http://127.0.0.1:5173/callback'

const LS = {
  clientId: 'spotify:clientId',
  verifier: 'spotify:verifier',
  access: 'spotify:accessToken',
  refresh: 'spotify:refreshToken',
  expires: 'spotify:expiresAt',
}

export function getClientId(): string | null {
  return localStorage.getItem(LS.clientId)
}

export function setClientId(id: string): void {
  localStorage.setItem(LS.clientId, id.trim())
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return new Uint8Array(digest)
}

/** Kick off login: builds the PKCE URL and navigates to Spotify. */
export async function beginLogin(): Promise<void> {
  const clientId = getClientId()
  if (!clientId) throw new Error('Set a Spotify Client ID first')
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  localStorage.setItem(LS.verifier, verifier)
  const challenge = b64url(await sha256(verifier))
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  window.location.href = `https://accounts.spotify.com/authorize?${params}`
}

async function tokenRequest(body: URLSearchParams): Promise<boolean> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) return false
  const json = await res.json()
  localStorage.setItem(LS.access, json.access_token)
  if (json.refresh_token) localStorage.setItem(LS.refresh, json.refresh_token)
  localStorage.setItem(LS.expires, String(Date.now() + json.expires_in * 1000))
  return true
}

/** Call on app load: if the URL is the OAuth callback, finish the exchange. */
export async function handleCallback(): Promise<boolean> {
  if (window.location.pathname !== '/callback') return false
  const code = new URLSearchParams(window.location.search).get('code')
  const verifier = localStorage.getItem(LS.verifier)
  const clientId = getClientId()
  if (!code || !verifier || !clientId) return false
  const ok = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  }))
  window.history.replaceState({}, '', '/')
  return ok
}

export async function getAccessToken(): Promise<string | null> {
  const access = localStorage.getItem(LS.access)
  const expires = Number(localStorage.getItem(LS.expires) ?? 0)
  if (access && Date.now() < expires - 30_000) return access
  const refresh = localStorage.getItem(LS.refresh)
  const clientId = getClientId()
  if (!refresh || !clientId) return null
  const ok = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: clientId,
  }))
  return ok ? localStorage.getItem(LS.access) : null
}

export function loggedIn(): boolean {
  return localStorage.getItem(LS.refresh) !== null
}

export function logout(): void {
  localStorage.removeItem(LS.access)
  localStorage.removeItem(LS.refresh)
  localStorage.removeItem(LS.expires)
}
