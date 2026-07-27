import Database from 'better-sqlite3';
import { fetchArtistMetadata } from './musicbrainz.js';
import { updateArtistMetadata, updateArtistMusicBrainzIds } from './repository.js';

export interface ArtistMetadataSyncStats {
  scanned: number;
  updated: number;
  failed: number;
}

export interface SyncMissingArtistMetadataOptions {
  limit?: number;
  refetchExisting?: boolean;
}

export async function syncMissingArtistMetadata(
  db: Database.Database,
  options: SyncMissingArtistMetadataOptions = {},
): Promise<ArtistMetadataSyncStats> {
  const stats: ArtistMetadataSyncStats = { scanned: 0, updated: 0, failed: 0 };

  let sql = `
    SELECT id, name, musicbrainz_artist_ids FROM artists
    WHERE active = 1 AND name != '' AND name IS NOT NULL
  `;
  if (!options.refetchExisting) {
    sql += " AND (external_urls IS NULL OR external_urls = '')";
  }
  sql += ' ORDER BY name';
  if (options.limit) {
    sql += ' LIMIT ?';
  }

  const rows = (options.limit
    ? db.prepare(sql).all(options.limit)
    : db.prepare(sql).all()) as {
    id: string;
    name: string;
    musicbrainz_artist_ids: string | null;
  }[];

  for (const row of rows) {
    stats.scanned++;
    try {
      const existingIds = row.musicbrainz_artist_ids ? (JSON.parse(row.musicbrainz_artist_ids) as string[]) : undefined;
      const metadata = await fetchArtistMetadata(row.name, existingIds);
      if (!metadata) continue;

      updateArtistMetadata(db, row.id, {
        bio: metadata.bio,
        externalUrls: Object.keys(metadata.externalUrls).length > 0 ? metadata.externalUrls : undefined,
      });

      if (existingIds === undefined || !existingIds.includes(metadata.musicBrainzId)) {
        updateArtistMusicBrainzIds(db, row.id, existingIds ? [...existingIds, metadata.musicBrainzId] : [metadata.musicBrainzId]);
      }

      stats.updated++;
    } catch (err) {
      stats.failed++;
      console.error(`Artist metadata lookup failed for "${row.name}":`, err);
    }
  }

  return stats;
}
