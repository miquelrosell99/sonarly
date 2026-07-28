import { mkdir, unlink, rename, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { DuplicateStrategy } from '@sonarly/shared';
import type { AudioMetadata } from '../tags/index.js';
import { ensureArtist } from '../artists/index.js';
import { getAlbumByNameAndArtist } from '../albums/index.js';
import { getSongArtistIds } from '../songs/index.js';
import { persistSong } from '../library/scanner.js';

export interface SongIdentity {
  title: string;
  albumId?: string;
  artistIds: string[];
}

export function resolveSongIdentity(
  db: Database.Database,
  meta: AudioMetadata,
): SongIdentity | undefined {
  const title = meta.tags.title?.trim();
  if (!title) return undefined;

  const artistNames = meta.artists ?? (meta.tags.artist ? [meta.tags.artist] : undefined);
  if (!artistNames?.length) return undefined;

  const artistIds = artistNames.map((name) => ensureArtist(db, name));
  const primaryArtistId = artistIds[0];
  const albumId = meta.tags.album
    ? getAlbumByNameAndArtist(db, meta.tags.album, primaryArtistId)?.id
    : undefined;

  return { title, albumId, artistIds };
}

export function findExistingSongByIdentity(
  db: Database.Database,
  identity: SongIdentity,
  libraryId?: string,
): { id: string; filePath: string; mtime: number; checksum: string } | undefined {
  const libraryFilter = libraryId ? 'AND library_id = ?' : '';
  const params: (string | null)[] = [identity.title];
  if (identity.albumId) {
    params.push(identity.albumId);
  } else {
    params.push(null);
  }
  if (libraryId) {
    params.push(libraryId);
  }

  const rows = db.prepare(`
    SELECT id, file_path, mtime, checksum
    FROM songs
    WHERE active = 1
      AND LOWER(title) = LOWER(?)
      AND album_id IS ?
      ${libraryFilter}
  `).all(...params) as { id: string; file_path: string; mtime: number; checksum: string }[];

  const target = new Set(identity.artistIds);
  for (const row of rows) {
    const existingIds = getSongArtistIds(db, row.id);
    if (sameArtistSet(existingIds, target)) {
      return { id: row.id, filePath: row.file_path, mtime: row.mtime, checksum: row.checksum };
    }
  }
  return undefined;
}

function sameArtistSet(a: string[], b: Set<string>): boolean {
  if (a.length !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export interface DuplicateResolution {
  existingId: string;
  finalPath?: string;
}

export async function handleDuplicateSong(
  db: Database.Database,
  sourcePath: string,
  targetPath: string,
  meta: AudioMetadata,
  mtime: number,
  checksum: string,
  libraryId: string | undefined,
  strategy: DuplicateStrategy,
): Promise<DuplicateResolution | undefined> {
  const identity = resolveSongIdentity(db, meta);
  if (!identity) return undefined;

  const existing = findExistingSongByIdentity(db, identity, libraryId);
  if (!existing) return undefined;

  switch (strategy) {
    case 'replace_file_and_metadata':
      return replaceFileAndMetadata(db, sourcePath, targetPath, existing, meta, mtime, checksum, libraryId, false);
    case 'keep_file_replace_metadata':
      return keepFileReplaceMetadata(db, sourcePath, existing, meta, libraryId);
    case 'replace_file_aggregate_metadata':
      return replaceFileAndMetadata(db, sourcePath, targetPath, existing, meta, mtime, checksum, libraryId, true);
    case 'keep_file_aggregate_metadata':
      return keepFileReplaceMetadata(db, sourcePath, existing, meta, libraryId, true);
    default:
      return undefined;
  }
}

async function replaceFileAndMetadata(
  db: Database.Database,
  sourcePath: string,
  targetPath: string,
  existing: { id: string; filePath: string },
  meta: AudioMetadata,
  mtime: number,
  checksum: string,
  libraryId: string | undefined,
  aggregate: boolean,
): Promise<DuplicateResolution> {
  await mkdir(dirname(targetPath), { recursive: true });

  await moveFile(sourcePath, targetPath);

  if (targetPath !== existing.filePath) {
    try {
      await unlink(existing.filePath);
    } catch {
      // Old file may already be gone or on a different device.
    }
  }

  await persistSong(db, targetPath, meta, mtime, checksum, libraryId, existing.id, {
    aggregate,
  });

  return { existingId: existing.id, finalPath: targetPath };
}

async function keepFileReplaceMetadata(
  db: Database.Database,
  sourcePath: string,
  existing: { id: string; filePath: string; mtime: number; checksum: string },
  meta: AudioMetadata,
  libraryId: string | undefined,
  aggregate = false,
): Promise<DuplicateResolution> {
  await persistSong(db, existing.filePath, meta, existing.mtime, existing.checksum, libraryId, existing.id, {
    aggregate,
    keepCoverArt: true,
  });

  try {
    await unlink(sourcePath);
  } catch {
    // Ignore cleanup failure; the ingest folder will be reprocessed otherwise.
  }

  return { existingId: existing.id };
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath);
  } catch (err) {
    if (isExdev(err)) {
      await copyFile(sourcePath, targetPath);
      await unlink(sourcePath);
    } else {
      throw err;
    }
  }
}

function isExdev(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EXDEV';
}
