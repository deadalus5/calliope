import {
  getCorrectionsDoc, getSongMapDoc, putCorrectionsDoc, putSongMapDoc, deleteSongMapDoc,
} from '../../state/songmap-db'
import {
  emptyCorrections, migrateCorrections, migrateSongMap,
  type SongMap, type UserCorrections,
} from './songmap'

/**
 * Typed access to the Dexie-backed Song Map storage. state/songmap-db.ts
 * moves opaque JSON docs; the shape gate (migrateSongMap/migrateCorrections)
 * lives here so a stale or hand-damaged doc degrades to "no map" instead of
 * crashing the Jam Room.
 */

export async function loadSongMap(trackUri: string): Promise<SongMap | null> {
  const doc = await getSongMapDoc(trackUri)
  return doc ? migrateSongMap(doc.data) : null
}

export async function saveSongMap(map: SongMap): Promise<void> {
  await putSongMapDoc(map.trackUri, map)
}

export async function removeSongMap(trackUri: string): Promise<void> {
  await deleteSongMapDoc(trackUri)
}

export async function loadCorrections(trackUri: string): Promise<UserCorrections> {
  const doc = await getCorrectionsDoc(trackUri)
  return (doc && migrateCorrections(doc.data)) || emptyCorrections(trackUri)
}

export async function saveCorrections(c: UserCorrections): Promise<void> {
  await putCorrectionsDoc(c.trackUri, c)
}
