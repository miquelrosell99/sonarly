import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';
import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { readTags, computeChecksum, writeCoverArt, type AudioMetadata } from '../tags/index.js';
import {
  upsertSong,
  getSongById,
  getSongByPath,
  deactivateSongByPath,
  findInactiveSongByTags,
  setSongArtists,
  getSongArtistIds,
  setSongComposers,
  getSongComposerIds,
} from '../songs/index.js';
import { ensureArtist } from '../artists/index.js';
export { ensureArtist };
import {
  upsertAlbum,
  getAlbumByNameAndArtist,
  setAlbumArtists,
  ensureLabel,
  setAlbumLabels,
} from '../albums/index.js';
import {
  getOrCreateGenreByName,
  setSongGenres,
  setAlbumGenres,
  getOrCreateGenreIdsByNames,
  getSongGenreIds,
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

function toStringArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
  const trimmed = value.trim();
  return trimmed.length > 0 ? [trimmed] : undefined;
}

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

export interface PersistSongOptions {
  /** When updating an existing song, merge multi-value fields (artists, genres, composers, etc.)
   *  and fill in missing scalar values from the existing record. New scalar values always win. */
  aggregate?: boolean;
  /** Keep the existing song cover art instead of overwriting it with the new file's cover art. */
  keepCoverArt?: boolean;
  /** When updating an existing song, only overwrite fields that are present in the new metadata.
   *  Missing scalar fields keep their existing values and missing array fields keep existing arrays.
   *  Used by "keep file replace metadata" to avoid clearing fields the new file does not specify. */
  replacePresentOnly?: boolean;
}

export async function persistSong(
  db: Database.Database,
  filePath: string,
  meta: AudioMetadata,
  mtime: number,
  checksum: string,
  libraryId: string | undefined,
  existingId?: string,
  options?: PersistSongOptions,
): Promise<Song> {
  const tags = meta.tags;
  const artistNames = meta.artists ?? toStringArray(tags.artist);
  const newArtistIds = artistNames?.length
    ? artistNames.map((name, index) =>
        ensureArtist(
          db,
          name,
          meta.musicBrainzArtistIds?.[index] ? [meta.musicBrainzArtistIds[index]] : undefined,
        ),
      )
    : undefined;
  const artistId = newArtistIds?.[0];
  const albumArtistNames = meta.albumArtists ?? toStringArray(tags.albumArtist) ?? artistNames;
  const genreNames = meta.genres ?? toStringArray(tags.genre);
  const newGenreIds = genreNames?.length ? getOrCreateGenreIdsByNames(db, genreNames) : undefined;
  const genreId = newGenreIds?.[0];
  const albumId = tags.album
    ? ensureAlbum(db, tags.album, albumArtistNames, tags.year, genreNames, newGenreIds, {
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
  const composerNames = meta.composers;
  const newComposerIds = composerNames?.length
    ? composerNames.map((name) => ensureArtist(db, name))
    : undefined;
  const id = existingId ?? randomUUID();

  // Seed the album cover from the first song that carries embedded art.
  if (albumId && meta.coverArt && !getAlbumCoverArtId(db, albumId)) {
    const coverArtId = createCoverArt(db, meta.coverArt.data, meta.coverArt.format);
    setAlbumCoverArtId(db, albumId, coverArtId);
  }

  let song: Song = {
    id,
    filePath,
    title: tags.title,
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    duration: meta.duration,
    artistId,
    albumId,
    genre: Array.isArray(tags.genre) ? tags.genre[0] : tags.genre,
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
    producers: meta.producers,
    isrcs: meta.isrcs,
    originalYear: meta.originalYear,
    originalArtist: meta.originalArtist,
    gapless: meta.gapless,
    totalTracks: meta.totalTracks,
    totalDiscs: meta.totalDiscs,
  };

  if (existingId) {
    const existing = getSongById(db, existingId);
    if (existing) {
      if (options?.aggregate) {
        song = mergeSongWithExisting(song, existing, options.keepCoverArt ?? false);
      } else if (options?.replacePresentOnly) {
        song = replacePresentOnly(song, existing, options.keepCoverArt ?? false);
      } else if (options?.keepCoverArt) {
        song.coverArt = existing.coverArt;
        song.coverArtMissing = existing.coverArtMissing;
      }
    }
  }

  upsertSong(db, song);

  let finalArtistIds = newArtistIds;
  let finalGenreIds = newGenreIds;
  let finalComposerIds = newComposerIds;
  if (existingId && options?.aggregate) {
    if (finalArtistIds) {
      finalArtistIds = unionIds(getSongArtistIds(db, existingId), finalArtistIds);
    }
    if (finalGenreIds) {
      finalGenreIds = unionIds(getSongGenreIds(db, existingId), finalGenreIds);
    }
    if (finalComposerIds) {
      finalComposerIds = unionIds(getSongComposerIds(db, existingId), finalComposerIds);
    }
  }

  if (finalArtistIds?.length) {
    setSongArtists(db, id, finalArtistIds);
  }
  if (finalGenreIds?.length) {
    setSongGenres(db, id, finalGenreIds);
  }
  if (finalComposerIds?.length) {
    setSongComposers(db, id, finalComposerIds);
  }

  if (!options?.keepCoverArt) {
    await syncSongCoverWithAlbum(db, id, albumId, filePath);
  }

  const updated = getSongById(db, id);
  return updated ?? song;
}

function unionIds(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a?.length) return b;
  if (!b?.length) return a;
  const set = new Set(a);
  const result = [...a];
  for (const id of b) {
    if (!set.has(id)) {
      set.add(id);
      result.push(id);
    }
  }
  return result;
}

function mergeSongWithExisting(song: Song, existing: Song, keepCoverArt: boolean): Song {
  return {
    ...existing,
    ...song,
    title: song.title || existing.title,
    trackNumber: song.trackNumber ?? existing.trackNumber,
    discNumber: song.discNumber ?? existing.discNumber,
    duration: song.duration ?? existing.duration,
    artistId: song.artistId ?? existing.artistId,
    albumId: song.albumId ?? existing.albumId,
    genre: song.genre ?? existing.genre,
    genreId: song.genreId ?? existing.genreId,
    libraryId: song.libraryId ?? existing.libraryId,
    year: song.year ?? existing.year,
    explicit: song.explicit ?? existing.explicit,
    coverArt: keepCoverArt ? existing.coverArt : (song.coverArt ?? existing.coverArt),
    coverArtMissing: keepCoverArt ? existing.coverArtMissing : (song.coverArtMissing ?? existing.coverArtMissing),
    mtime: song.mtime,
    checksum: song.checksum,
    bitRate: song.bitRate ?? existing.bitRate,
    bitsPerSample: song.bitsPerSample ?? existing.bitsPerSample,
    sampleRate: song.sampleRate ?? existing.sampleRate,
    channels: song.channels ?? existing.channels,
    bpm: song.bpm ?? existing.bpm,
    musicBrainzId: song.musicBrainzId ?? existing.musicBrainzId,
    musicBrainzTrackId: song.musicBrainzTrackId ?? existing.musicBrainzTrackId,
    musicBrainzWorkId: song.musicBrainzWorkId ?? existing.musicBrainzWorkId,
    musicBrainzDiscId: song.musicBrainzDiscId ?? existing.musicBrainzDiscId,
    replayGain: song.replayGain ?? existing.replayGain,
    comment: song.comment ?? existing.comment,
    sortName: song.sortName ?? existing.sortName,
    mood: song.mood ?? existing.mood,
    mediaType: song.mediaType ?? existing.mediaType,
    originalReleaseDate: song.originalReleaseDate ?? existing.originalReleaseDate,
    releaseDate: song.releaseDate ?? existing.releaseDate,
    remixOf: song.remixOf ?? existing.remixOf,
    displayArtist: song.displayArtist ?? existing.displayArtist,
    displayAlbumArtist: song.displayAlbumArtist ?? existing.displayAlbumArtist,
    lyrics: song.lyrics ?? existing.lyrics,
    syncedLyrics: song.syncedLyrics ?? existing.syncedLyrics,
    artists: unionArrays(song.artists, existing.artists),
    producers: unionArrays(song.producers, existing.producers),
    isrcs: unionArrays(song.isrcs, existing.isrcs),
    originalYear: song.originalYear ?? existing.originalYear,
    originalArtist: song.originalArtist ?? existing.originalArtist,
    gapless: song.gapless ?? existing.gapless,
    totalTracks: song.totalTracks ?? existing.totalTracks,
    totalDiscs: song.totalDiscs ?? existing.totalDiscs,
  };
}

function replacePresentOnly(song: Song, existing: Song, keepCoverArt: boolean): Song {
  return {
    ...existing,
    ...song,
    title: song.title || existing.title,
    trackNumber: song.trackNumber ?? existing.trackNumber,
    discNumber: song.discNumber ?? existing.discNumber,
    duration: song.duration ?? existing.duration,
    artistId: song.artistId ?? existing.artistId,
    albumId: song.albumId ?? existing.albumId,
    genre: song.genre ?? existing.genre,
    genreId: song.genreId ?? existing.genreId,
    libraryId: song.libraryId ?? existing.libraryId,
    year: song.year ?? existing.year,
    explicit: song.explicit ?? existing.explicit,
    coverArt: keepCoverArt ? existing.coverArt : (song.coverArt ?? existing.coverArt),
    coverArtMissing: keepCoverArt ? existing.coverArtMissing : (song.coverArtMissing ?? existing.coverArtMissing),
    mtime: song.mtime,
    checksum: song.checksum,
    bitRate: song.bitRate ?? existing.bitRate,
    bitsPerSample: song.bitsPerSample ?? existing.bitsPerSample,
    sampleRate: song.sampleRate ?? existing.sampleRate,
    channels: song.channels ?? existing.channels,
    bpm: song.bpm ?? existing.bpm,
    musicBrainzId: song.musicBrainzId ?? existing.musicBrainzId,
    musicBrainzTrackId: song.musicBrainzTrackId ?? existing.musicBrainzTrackId,
    musicBrainzWorkId: song.musicBrainzWorkId ?? existing.musicBrainzWorkId,
    musicBrainzDiscId: song.musicBrainzDiscId ?? existing.musicBrainzDiscId,
    replayGain: song.replayGain ?? existing.replayGain,
    comment: song.comment ?? existing.comment,
    sortName: song.sortName ?? existing.sortName,
    mood: song.mood ?? existing.mood,
    mediaType: song.mediaType ?? existing.mediaType,
    originalReleaseDate: song.originalReleaseDate ?? existing.originalReleaseDate,
    releaseDate: song.releaseDate ?? existing.releaseDate,
    remixOf: song.remixOf ?? existing.remixOf,
    displayArtist: song.displayArtist ?? existing.displayArtist,
    displayAlbumArtist: song.displayAlbumArtist ?? existing.displayAlbumArtist,
    lyrics: song.lyrics ?? existing.lyrics,
    syncedLyrics: song.syncedLyrics ?? existing.syncedLyrics,
    artists: song.artists ?? existing.artists,
    producers: song.producers ?? existing.producers,
    isrcs: song.isrcs ?? existing.isrcs,
    originalYear: song.originalYear ?? existing.originalYear,
    originalArtist: song.originalArtist ?? existing.originalArtist,
    gapless: song.gapless ?? existing.gapless,
    totalTracks: song.totalTracks ?? existing.totalTracks,
    totalDiscs: song.totalDiscs ?? existing.totalDiscs,
  };
}

function unionArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a?.length) return b;
  if (!b?.length) return a;
  const set = new Set(a);
  const result = [...a];
  for (const value of b) {
    if (!set.has(value)) {
      set.add(value);
      result.push(value);
    }
  }
  return result;
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
  meta: AudioMetadata,
  existing: Song,
  libraryId: string | undefined,
): Promise<void> {
  const tags = meta.tags;
  const artistNames = meta.artists ?? toStringArray(tags.artist);
  const artistIds = artistNames?.length
    ? artistNames.map((name) => ensureArtist(db, name))
    : undefined;
  const albumArtistNames = meta.albumArtists ?? toStringArray(tags.albumArtist) ?? artistNames;
  const genreNames = meta.genres ?? toStringArray(tags.genre);
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
      WHEN id IN (SELECT DISTINCT sc.artist_id FROM song_composers sc JOIN songs s ON s.id = sc.song_id WHERE s.active = 1) THEN 1
      ELSE 0
    END
  `).run();
  db.prepare(`
    UPDATE labels
    SET active = CASE
      WHEN id IN (SELECT DISTINCT al.label_id FROM album_labels al JOIN albums a ON a.id = al.album_id WHERE a.active = 1) THEN 1
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

export function ensureAlbum(
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
  const labelIds = meta.labels?.length ? meta.labels.map((n) => ensureLabel(db, n)) : undefined;
  const existing = getAlbumByNameAndArtist(db, name, primaryArtistId);
  if (existing) {
    if (artistIds.length > 1) {
      setAlbumArtists(db, existing.id, artistIds);
    }
    if (genreIds && genreIds.length > 1) {
      setAlbumGenres(db, existing.id, genreIds);
    }
    if (labelIds?.length) {
      setAlbumLabels(db, existing.id, labelIds);
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
  if (labelIds?.length) {
    setAlbumLabels(db, id, labelIds);
  }
  return id;
}
