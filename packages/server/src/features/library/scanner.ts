import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';
import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { readTags, computeChecksum, writeCoverArt } from '../tags/index.js';
import {
  upsertSong,
  getSongById,
  getSongByPath,
  deactivateSongByPath,
  findInactiveSongByTags,
  setSongArtists,
} from '../songs/index.js';
import { ensureArtist } from '../artists/index.js';
import {
  upsertAlbum,
  getAlbumByNameAndArtist,
  setAlbumArtists,
} from '../albums/index.js';
import {
  getOrCreateGenreByName,
  setSongGenres,
  setAlbumGenres,
  getOrCreateGenreIdsByNames,
} from '../genres/index.js';
import type { Song, SongTags } from '@sonarly/shared';
import { randomUUID } from 'node:crypto';
import {
  createCoverArt,
  getCoverArtById,
  getAlbumCoverArtId,
  getSongCoverArtId,
  setAlbumCoverArtId,
  setSongCoverArtId,
} from '../cover-art/index.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface ScanFailure {
  path: string;
  error: string;
}

export interface ScanStats extends Record<string, number | ScanFailure[]> {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  moved: number;
  failed: number;
  failures: ScanFailure[];
}

function resolveLibraryId(db: Database.Database, filePath: string): string | undefined {
  const row = db.prepare(`
    SELECT id FROM libraries
    WHERE ? LIKE path || '%'
    ORDER BY length(path) DESC
    LIMIT 1
  `).get(filePath) as { id: string } | undefined;
  return row?.id;
}

export async function scanLibrary(config: Config, db: Database.Database): Promise<ScanStats> {
  const stats: ScanStats = { scanned: 0, added: 0, updated: 0, removed: 0, moved: 0, failed: 0, failures: [] };
  const foundPaths = new Set<string>();
  const checksumToSong = new Map<string, Song>();
  const movedFromPaths = new Set<string>();

  const libraryPaths = db.prepare('SELECT path FROM libraries').pluck().all() as string[];
  const pathsToScan = libraryPaths.length > 0 ? libraryPaths : [config.LIBRARY_PATH];

  for (const libraryPath of pathsToScan) {
    for await (const filePath of walkAudioFiles(libraryPath)) {
    stats.scanned++;
    foundPaths.add(filePath);
    try {
      const existing = getSongByPath(db, filePath);
      const mtime = (await stat(filePath)).mtimeMs;
      const unchanged = existing && existing.active && existing.mtime === mtime;
      const needsCover = existing ? needsCoverSync(db, existing) : false;
      const libraryId = resolveLibraryId(db, filePath);

      if (unchanged && !needsCover) continue;

      const meta = await readTags(filePath);

      if (unchanged && needsCover) {
        // File metadata is unchanged; only reconcile cover art.
        await persistSongCoverOnly(db, filePath, meta, existing!, libraryId);
        stats.updated++;
        continue;
      }

      const checksum = await computeChecksum(filePath);

      if (!existing) {
        const cached = checksumToSong.get(checksum);
        const movedFrom = (cached && !foundPaths.has(cached.filePath) ? cached : undefined)
          ?? findMovedSong(db, checksum, foundPaths)
          ?? findReplacedSong(db, meta.tags, meta.artists?.[0], meta.albumArtists?.[0]);
        if (movedFrom) {
          const song = await persistSong(db, filePath, meta, mtime, checksum, libraryId, movedFrom.id);
          checksumToSong.set(checksum, song);
          movedFromPaths.add(movedFrom.filePath);
          stats.moved++;
        } else {
          const song = await persistSong(db, filePath, meta, mtime, checksum, libraryId);
          checksumToSong.set(checksum, song);
          stats.added++;
        }
      } else {
        await persistSong(db, filePath, meta, mtime, checksum, libraryId, existing.id);
        stats.updated++;
      }
    } catch (err) {
      stats.failed++;
      const message = err instanceof Error ? err.message : String(err);
      if (stats.failures.length < 20) {
        stats.failures.push({ path: filePath, error: message });
      }
      console.error(`Scan failed for ${filePath}`, err);
      }
    }
  }

  // Deactivate missing files instead of deleting them
  const allDbPaths = db.prepare('SELECT file_path FROM songs').pluck().all() as string[];
  for (const dbPath of allDbPaths) {
    if (!foundPaths.has(dbPath) && !movedFromPaths.has(dbPath)) {
      deactivateSongByPath(db, dbPath);
      stats.removed++;
    }
  }

  recomputeAlbumAndArtistActivity(db);

  return stats;
}

async function* walkAudioFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Scanner: cannot read directory ${dir}`, err);
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkAudioFiles(fullPath);
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

function findMovedSong(db: Database.Database, checksum: string, foundPaths: Set<string>): Song | undefined {
  const rows = db.prepare('SELECT * FROM songs WHERE checksum = ?').all(checksum) as any[];
  for (const row of rows) {
    const song = { ...row, filePath: row.file_path } as Song;
    if (!foundPaths.has(song.filePath)) {
      return song;
    }
  }
  return undefined;
}

function findReplacedSong(
  db: Database.Database,
  tags: SongTags,
  firstArtist?: string,
  firstAlbumArtist?: string,
): Song | undefined {
  if (!tags.title) return undefined;
  // Resolve album/artist IDs from current DB so we match against the same entities.
  const albumId = tags.album
    ? db.prepare('SELECT id FROM albums WHERE name = ? COLLATE NOCASE').pluck().get(tags.album) as string | undefined
    : undefined;
  const artistName = firstArtist || firstAlbumArtist || tags.artist || tags.albumArtist;
  const artistId = artistName
    ? db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE').pluck().get(artistName) as string | undefined
    : undefined;
  return findInactiveSongByTags(db, tags.title, albumId, artistId);
}

async function persistSong(
  db: Database.Database,
  filePath: string,
  meta: Awaited<ReturnType<typeof readTags>>,
  mtime: number,
  checksum: string,
  libraryId: string | undefined,
  existingId?: string,
): Promise<Song> {
  const tags = meta.tags;
  const artistNames = meta.artists ?? (tags.artist ? [tags.artist] : undefined);
  const artistIds = artistNames?.length
    ? artistNames.map((name, index) =>
        ensureArtist(
          db,
          name,
          meta.musicBrainzArtistIds?.[index] ? [meta.musicBrainzArtistIds[index]] : undefined,
        ),
      )
    : undefined;
  const artistId = artistIds?.[0];
  const albumArtistNames = meta.albumArtists ?? artistNames;
  const genreNames = meta.genres ?? (tags.genre ? [tags.genre] : undefined);
  const genreIds = genreNames?.length ? getOrCreateGenreIdsByNames(db, genreNames) : undefined;
  const genreId = genreIds?.[0];
  const albumId = tags.album
    ? ensureAlbum(db, tags.album, albumArtistNames, tags.year, genreNames, genreIds, {
        musicBrainzAlbumId: meta.musicBrainzAlbumId,
        musicBrainzReleaseGroupId: meta.musicBrainzReleaseGroupId,
        musicBrainzAlbumArtistIds: meta.musicBrainzAlbumArtistIds,
        labels: meta.labels,
        catalogNumbers: meta.catalogNumbers,
        barcode: meta.barcode,
        asin: meta.asin,
        originalYear: meta.originalYear,
        compilation: meta.compilation,
        totalTracks: meta.totalTracks,
        totalDiscs: meta.totalDiscs,
      })
    : undefined;
  const id = existingId ?? randomUUID();

  // Seed the album cover from the first song that carries embedded art.
  if (albumId && meta.coverArt && !getAlbumCoverArtId(db, albumId)) {
    const coverArtId = createCoverArt(db, meta.coverArt.data, meta.coverArt.format);
    setAlbumCoverArtId(db, albumId, coverArtId);
  }

  const song: Song = {
    id,
    filePath,
    title: tags.title,
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    duration: meta.duration,
    artistId,
    albumId,
    genre: tags.genre,
    genreId,
    libraryId,
    year: tags.year,
    explicit: tags.explicit,
    coverArt: existingId ? getSongCoverArtId(db, existingId) ?? undefined : undefined,
    coverArtMissing: !meta.coverArt,
    mtime,
    checksum,
    active: true,
    bitRate: meta.format?.bitRate,
    bitsPerSample: meta.format?.bitsPerSample,
    sampleRate: meta.format?.sampleRate,
    channels: meta.format?.channels,
    bpm: meta.bpm,
    musicBrainzId: meta.musicBrainzId,
    musicBrainzTrackId: meta.musicBrainzTrackId,
    musicBrainzWorkId: meta.musicBrainzWorkId,
    musicBrainzDiscId: meta.musicBrainzDiscId,
    replayGain: meta.replayGain,
    comment: meta.comment,
    sortName: meta.sortName,
    mood: meta.mood,
    mediaType: lookup(filePath) || undefined,
    originalReleaseDate: meta.originalReleaseDate,
    releaseDate: meta.releaseDate,
    remixOf: meta.remixOf,
    displayArtist: meta.displayArtist,
    displayAlbumArtist: meta.displayAlbumArtist,
    lyrics: meta.lyrics,
    syncedLyrics: meta.syncedLyrics,
    artists: artistNames,
    composers: meta.composers,
    producers: meta.producers,
    isrcs: meta.isrcs,
    originalYear: meta.originalYear,
    originalArtist: meta.originalArtist,
    gapless: meta.gapless,
    totalTracks: meta.totalTracks,
    totalDiscs: meta.totalDiscs,
  };
  upsertSong(db, song);

  if (artistIds?.length) {
    setSongArtists(db, id, artistIds);
  }
  if (genreIds?.length) {
    setSongGenres(db, id, genreIds);
  }

  await syncSongCoverWithAlbum(db, id, albumId, filePath);

  const updated = getSongById(db, id);
  return updated ?? song;
}

async function syncSongCoverWithAlbum(
  db: Database.Database,
  songId: string,
  albumId: string | undefined,
  filePath: string,
): Promise<void> {
  if (!albumId) return;
  const albumCoverId = getAlbumCoverArtId(db, albumId);
  if (!albumCoverId) return;

  const songCoverId = getSongCoverArtId(db, songId);
  if (songCoverId === albumCoverId) return;

  const coverArt = getCoverArtById(db, albumCoverId);
  if (!coverArt) return;

  await writeCoverArt(filePath, coverArt);
  setSongCoverArtId(db, songId, albumCoverId);
}

function needsCoverSync(db: Database.Database, existing: Song): boolean {
  if (!existing.albumId) return false;
  const albumCoverId = getAlbumCoverArtId(db, existing.albumId);
  if (albumCoverId) {
    return getSongCoverArtId(db, existing.id) !== albumCoverId;
  }
  // Album has no cover. Only re-check files we haven't already confirmed lack embedded art.
  if (existing.coverArtMissing) return false;
  return true;
}

async function persistSongCoverOnly(
  db: Database.Database,
  filePath: string,
  meta: Awaited<ReturnType<typeof readTags>>,
  existing: Song,
  libraryId: string | undefined,
): Promise<void> {
  const tags = meta.tags;
  const artistNames = meta.artists ?? (tags.artist ? [tags.artist] : undefined);
  const artistIds = artistNames?.length
    ? artistNames.map((name) => ensureArtist(db, name))
    : undefined;
  const albumArtistNames = meta.albumArtists ?? artistNames;
  const genreNames = meta.genres ?? (tags.genre ? [tags.genre] : undefined);
  const genreIds = genreNames?.length ? getOrCreateGenreIdsByNames(db, genreNames) : undefined;
  const albumId = tags.album
    ? ensureAlbum(db, tags.album, albumArtistNames, tags.year, genreNames, genreIds, {})
    : undefined;

  if (albumId && meta.coverArt && !getAlbumCoverArtId(db, albumId)) {
    const coverArtId = createCoverArt(db, meta.coverArt.data, meta.coverArt.format);
    setAlbumCoverArtId(db, albumId, coverArtId);
  }

  await syncSongCoverWithAlbum(db, existing.id, albumId, filePath);

  db.prepare('UPDATE songs SET cover_art_missing = ?, library_id = ? WHERE id = ?').run(meta.coverArt ? 0 : 1, libraryId ?? null, existing.id);
}

function recomputeAlbumAndArtistActivity(db: Database.Database): void {
  db.prepare(`
    UPDATE albums
    SET active = CASE
      WHEN id IN (SELECT DISTINCT album_id FROM songs WHERE active = 1 AND album_id IS NOT NULL) THEN 1
      ELSE 0
    END
  `).run();
  db.prepare(`
    UPDATE artists
    SET active = CASE
      WHEN id IN (SELECT DISTINCT artist_id FROM songs WHERE active = 1 AND artist_id IS NOT NULL) THEN 1
      WHEN id IN (SELECT DISTINCT artist_id FROM albums WHERE active = 1 AND artist_id IS NOT NULL) THEN 1
      WHEN id IN (SELECT DISTINCT sa.artist_id FROM song_artists sa JOIN songs s ON s.id = sa.song_id WHERE s.active = 1) THEN 1
      WHEN id IN (SELECT DISTINCT aa.artist_id FROM album_artists aa JOIN albums a ON a.id = aa.album_id WHERE a.active = 1) THEN 1
      ELSE 0
    END
  `).run();
}

interface AlbumMeta {
  musicBrainzAlbumId?: string;
  musicBrainzReleaseGroupId?: string;
  musicBrainzAlbumArtistIds?: string[];
  labels?: string[];
  catalogNumbers?: string[];
  barcode?: string;
  asin?: string;
  originalYear?: number;
  compilation?: boolean;
  totalTracks?: string;
  totalDiscs?: string;
}

function ensureAlbum(
  db: Database.Database,
  name: string,
  artistNames: string[] | undefined,
  year?: number,
  genreNames?: string[],
  genreIds?: string[],
  meta: AlbumMeta = {},
): string {
  const artistIds = artistNames?.map((n) => ensureArtist(db, n)) ?? [];
  const primaryArtistId = artistIds[0];
  const existing = getAlbumByNameAndArtist(db, name, primaryArtistId);
  if (existing) {
    if (artistIds.length > 1) {
      setAlbumArtists(db, existing.id, artistIds);
    }
    if (genreIds && genreIds.length > 1) {
      setAlbumGenres(db, existing.id, genreIds);
    }
    return existing.id;
  }
  const id = randomUUID();
  upsertAlbum(db, {
    id,
    name,
    artistId: primaryArtistId,
    artistName: artistNames?.join(' / '),
    year,
    genre: genreNames?.[0],
    genreId: genreIds?.[0],
    labels: meta.labels,
    catalogNumbers: meta.catalogNumbers,
    barcode: meta.barcode,
    asin: meta.asin,
    musicBrainzAlbumId: meta.musicBrainzAlbumId,
    musicBrainzReleaseGroupId: meta.musicBrainzReleaseGroupId,
    musicBrainzAlbumArtistIds: meta.musicBrainzAlbumArtistIds,
    originalYear: meta.originalYear,
    compilation: meta.compilation,
    totalTracks: meta.totalTracks,
    totalDiscs: meta.totalDiscs,
  });
  if (artistIds.length) {
    setAlbumArtists(db, id, artistIds);
  }
  if (genreIds?.length) {
    setAlbumGenres(db, id, genreIds);
  }
  return id;
}
