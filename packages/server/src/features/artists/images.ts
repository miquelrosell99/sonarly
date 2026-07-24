import Database from 'better-sqlite3';

interface DeezerArtist {
  id: number;
  name: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
}

interface DeezerSearchResult {
  data?: DeezerArtist[];
}

const FETCH_TIMEOUT_MS = 10_000;
const RATE_LIMIT_DELAY_MS = 200;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchArtistImageUrl(artistName: string): Promise<string | undefined> {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Deezer API returned ${response.status}`);
  }
  const json = (await response.json()) as DeezerSearchResult;
  const artist = json.data?.[0];
  if (!artist) return undefined;
  return artist.picture_xl ?? artist.picture_big ?? artist.picture_medium ?? artist.picture_small ?? artist.picture;
}

export interface ArtistImageSyncStats {
  scanned: number;
  updated: number;
  failed: number;
}

export async function syncMissingArtistImages(
  db: Database.Database,
  options: { limit?: number; refetchExisting?: boolean } = {},
): Promise<ArtistImageSyncStats> {
  const stats: ArtistImageSyncStats = { scanned: 0, updated: 0, failed: 0 };

  let sql = `
    SELECT id, name FROM artists
    WHERE active = 1 AND name != '' AND name IS NOT NULL
  `;
  if (!options.refetchExisting) {
    sql += " AND (artist_image_url IS NULL OR artist_image_url = '')";
  }
  sql += ' ORDER BY name';
  if (options.limit) {
    sql += ' LIMIT ?';
  }

  const rows = (options.limit
    ? db.prepare(sql).all(options.limit)
    : db.prepare(sql).all()) as { id: string; name: string }[];

  const updateStmt = db.prepare('UPDATE artists SET artist_image_url = ? WHERE id = ?');

  for (const row of rows) {
    stats.scanned++;
    try {
      const imageUrl = await fetchArtistImageUrl(row.name);
      if (imageUrl) {
        updateStmt.run(imageUrl, row.id);
        stats.updated++;
      }
      if (RATE_LIMIT_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }
    } catch (err) {
      stats.failed++;
      console.error(`Artist image lookup failed for "${row.name}":`, err);
    }
  }

  return stats;
}
