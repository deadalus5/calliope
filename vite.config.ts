/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Server bound to 127.0.0.1 (not localhost): Spotify's OAuth redirect
// allowlist accepts loopback IP literals only.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    // songsmith/ is the Mac-mini sidecar — its pure modules (ug-parse, fuse)
    // are tested here alongside the app since they share music-core.
    include: ['src/**/*.test.{ts,tsx}', 'songsmith/src/**/*.test.ts'],
  },
})
