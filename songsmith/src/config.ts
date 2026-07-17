import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Songsmith config. `config.json` next to package.json is user-local (it can
 * hold the UG session cookie) and gitignored; `config.example.json` documents
 * the shape. Everything has a default so a bare checkout still starts.
 */

export interface SongsmithConfig {
  port: number
  corsOrigins: string[]
  cacheDir: string
  /** Ultimate Guitar session cookie — needed only for Official charts. */
  ugCookie?: string
  /** 'allin1' (stock CLI) or 'mlx' (all-in-one-mlx port). */
  analyzer: 'allin1' | 'mlx'
  ytdlpPath: string
  /** Python venv the analyzer lives in (from setup.sh). */
  venvDir: string
}

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function loadConfig(): SongsmithConfig {
  const defaults: SongsmithConfig = {
    port: 8765,
    // The dev server and the hosted site — both may call the sidecar.
    corsOrigins: ['http://127.0.0.1:5173', 'https://deadalus5.github.io'],
    cacheDir: join(PACKAGE_ROOT, 'cache'),
    analyzer: 'allin1',
    ytdlpPath: 'yt-dlp',
    venvDir: join(PACKAGE_ROOT, '.venv'),
  }
  const path = join(PACKAGE_ROOT, 'config.json')
  if (!existsSync(path)) return defaults
  try {
    const user = JSON.parse(readFileSync(path, 'utf8')) as Partial<SongsmithConfig>
    return { ...defaults, ...user }
  } catch (e) {
    throw new Error(`songsmith/config.json is not valid JSON: ${(e as Error).message}`)
  }
}
