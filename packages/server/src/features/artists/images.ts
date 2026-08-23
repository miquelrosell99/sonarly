import Database from 'better-sqlite3';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

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

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function getArtistImagesDir(dataDir: string): string {
  return join(dataDir, 'artist-images');
}

async function ensureArtistImagesDir(dataDir: string): Promise<void> {
  await mkdir(getArtistImagesDir(dataDir), { recursive: true });
}

function extensionFromUrl(url: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase();
  if (ext === '.jpeg' || ext === '.jpg') return '.jpg';
  if (ext === '.png') return '.png';
  if (ext === '.webp') return '.webp';
  if (ext === '.gif') return '.gif';
  return '';
}

function extensionFromResponse(response: Response, url: string): string {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType && EXTENSION_BY_CONTENT_TYPE[contentType]) {
    return EXTENSION_BY_CONTENT_TYPE[contentType];
  }
  return extensionFromUrl(url) || '.jpg';
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Sniff magic bytes so HTML error pages or other non-image content is never
// saved as an artist image.
function sniffImageFormat(buffer: Buffer): 'jpeg' | 'png' | 'gif' | 'webp' | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'gif';
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'webp';
  return undefined;
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

export interface SyncMissingArtistImagesOptions {
  limit?: number;
  refetchExisting?: boolean;
}

export async function syncMissingArtistImages(
  db: Database.Database,
  dataDir: string,
  options: SyncMissingArtistImagesOptions = {},
): Promise<ArtistImageSyncStats> {
  const stats: ArtistImageSyncStats = { scanned: 0, updated: 0, failed: 0 };

  let sql = `
    SELECT id, name, artist_image_url, artist_image_local_path FROM artists
    WHERE active = 1 AND name != '' AND name IS NOT NULL
  `;
  if (!options.refetchExisting) {
    sql += " AND (artist_image_local_path IS NULL OR artist_image_local_path = '')";
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
    artist_image_url: string | null;
    artist_image_local_path: string | null;
  }[];

  await ensureArtistImagesDir(dataDir);
  const imagesDir = getArtistImagesDir(dataDir);

  for (const row of rows) {
    stats.scanned++;
    try {
      const imageUrl = await fetchArtistImageUrl(row.name);
      if (!imageUrl) continue;

      const imageResponse = await fetchWithTimeout(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Image download returned ${imageResponse.status}`);
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      if (imageBuffer.length === 0) {
        throw new Error('Downloaded image is empty');
      }
      if (!sniffImageFormat(imageBuffer)) {
        throw new Error('Downloaded content is not a supported image');
      }

      const extension = extensionFromResponse(imageResponse, imageUrl);
      const localPath = join(imagesDir, `${row.id}${extension}`);

      // Write the new image before removing the old one so a failed write
      // cannot leave the artist without any image on disk.
      await writeFile(localPath, imageBuffer);

      if (row.artist_image_local_path && row.artist_image_local_path !== localPath) {
        try {
          await unlink(row.artist_image_local_path);
        } catch {
          // Ignore cleanup errors.
        }
      }
      db.prepare('UPDATE artists SET artist_image_url = ?, artist_image_local_path = ? WHERE id = ?').run(
        imageUrl,
        localPath,
        row.id,
      );
      stats.updated++;

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

export function getArtistImageLocalPath(db: Database.Database, artistId: string): string | undefined {
  const row = db
    .prepare('SELECT artist_image_local_path FROM artists WHERE id = ? AND active = 1')
    .get(artistId) as { artist_image_local_path: string | null } | undefined;
  return row?.artist_image_local_path ?? undefined;
}
