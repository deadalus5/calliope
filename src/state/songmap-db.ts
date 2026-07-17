import { db, type JsonDoc } from './db'

/**
 * Untyped persistence for Song Maps + correction overlays. Deliberately
 * knows nothing about their shape (that lives in integrations/spotify/
 * songmap.ts) — this module only moves JSON documents in and out of Dexie.
 */

export async function getSongMapDoc(trackUri: string): Promise<JsonDoc | undefined> {
  return db.songmaps.get(trackUri)
}

export async function putSongMapDoc(trackUri: string, data: unknown): Promise<void> {
  await db.songmaps.put({ trackUri, updatedAt: Date.now(), data })
}

export async function deleteSongMapDoc(trackUri: string): Promise<void> {
  await db.songmaps.delete(trackUri)
}

export async function getCorrectionsDoc(trackUri: string): Promise<JsonDoc | undefined> {
  return db.songcorrections.get(trackUri)
}

export async function putCorrectionsDoc(trackUri: string, data: unknown): Promise<void> {
  await db.songcorrections.put({ trackUri, updatedAt: Date.now(), data })
}

export async function songMapCount(): Promise<number> {
  return db.songmaps.count()
}
