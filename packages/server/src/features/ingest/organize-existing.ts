import { readdir, rmdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { SongTags } from '@sonarly/shared';
import type { Config } from '../../config.js';
import { listLibraries, getLibraryById } from '../libraries/index.js';
import { getSongByPath } from '../songs/index.js';
import { getArtistByName } from '../artists/index.js';
import { getAlbumByNameAndArtist } from '../albums/index.js';
import { getOrganizePattern } from '../settings/index.js';
import { readMetadata, writeCoverArt } from '../tags/index.js';
import { buildTargetPath, moveToLibrary } from './organizer.js';
import {
  getCoverArtById,
  getAlbumCoverArtId,
  getSongCoverArtId,
  setSongCoverArtId,
} from '../cover-art/index.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface OrganizeStats {
  scanned: number;
  moved: number;
  skipped: number;
  failed: number;
}

function resolveLibraryIdForPath(db: Database.Database, filePath: string): string | undefined {
  // Match exact path or path prefix with a separator boundary so that
  // library /music does not claim files under /music2.
  const row = db.prepare(`
    SELECT id FROM libraries
    WHERE ? = path OR ? LIKE path || '/%'
    ORDER BY length(path) DESC
    LIMIT 1
  `).get(filePath, filePath) as { id: string } | undefined;
  return row?.id;
}

export async function getTargetPathForFile(
  config: Config,
  db: Database.Database,
  filePath: string,
  tags?: SongTags,
): Promise<string> {
  const meta = tags ? { tags } : await readMetadata(filePath);
  const libraryId = resolveLibraryIdForPath(db, filePath);
  const library = libraryId ? getLibraryById(db, libraryId) : undefined;
  const pattern = library?.organizePattern ?? getOrganizePattern(db, config);
  const libraryPath = library?.path ?? config.LIBRARY_PATH;
  return buildTargetPath(pattern, libraryPath, meta.tags, filePath);
}

export async function organizeSongFile(config: Config, db: Database.Database, filePath: string): Promise<string> {
  const dbSong = getSongByPath(db, filePath);
  const meta = await readMetadata(filePath);
  const targetPath = await getTargetPathForFile(config, db, filePath, meta.tags);

  if (filePath === targetPath) {
    return filePath;
  }

  const finalPath = await moveToLibrary(filePath, targetPath);

  if (dbSong) {
    db.prepare('UPDATE songs SET file_path = ? WHERE id = ?').run(finalPath, dbSong.id);
    await syncSongCoverWithAlbum(db, dbSong.id, meta.tags, finalPath);
  }

  return finalPath;
}

async function syncSongCoverWithAlbum(
  db: Database.Database,
  songId: string,
  tags: { album?: string; artist?: string | string[]; albumArtist?: string | string[] },
  filePath: string,
): Promise<void> {
  if (!tags.album) return;
  const artistName = (Array.isArray(tags.artist) ? tags.artist[0] : tags.artist)
    || (Array.isArray(tags.albumArtist) ? tags.albumArtist[0] : tags.albumArtist);
  const artist = artistName ? getArtistByName(db, artistName) : undefined;
  const album = getAlbumByNameAndArtist(db, tags.album, artist?.id);
  if (!album) return;

  const albumCoverId = getAlbumCoverArtId(db, album.id);
  if (!albumCoverId) return;
  if (getSongCoverArtId(db, songId) === albumCoverId) return;

  const coverArt = getCoverArtById(db, albumCoverId);
  if (!coverArt) return;

  await writeCoverArt(filePath, coverArt);
  setSongCoverArtId(db, songId, albumCoverId);
}

export async function organizeExistingLibrary(config: Config, db: Database.Database): Promise<OrganizeStats> {
  const stats: OrganizeStats = { scanned: 0, moved: 0, skipped: 0, failed: 0 };
  const libraries = listLibraries(db);
  const pathsToOrganize = libraries.length > 0 ? libraries.map((l) => l.path) : [config.LIBRARY_PATH];

  for (const libraryPath of pathsToOrganize) {
    for await (const filePath of walkLibraryFiles(libraryPath)) {
      stats.scanned++;
      try {
        const finalPath = await organizeSongFile(config, db, filePath);
        if (finalPath === filePath) {
          stats.skipped++;
        } else {
          stats.moved++;
        }
      } catch (err) {
        stats.failed++;
        console.error(`Organize failed for ${filePath}`, err);
      }
    }
  }

  for (const libraryPath of pathsToOrganize) {
    try {
      await cleanupEmptyDirs(libraryPath, libraryPath);
    } catch (err) {
      console.error('Failed to clean up empty directories after organizing', err);
    }
  }

  return stats;
}

export async function cleanupEmptyDirs(dir: string, root: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await cleanupEmptyDirs(join(dir, entry.name), root);
    }
  }
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  if (entries.length === 0 && dir !== root) {
    try {
      await rmdir(dir);
    } catch {}
  }
}

export async function* walkLibraryFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkLibraryFiles(fullPath);
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}
