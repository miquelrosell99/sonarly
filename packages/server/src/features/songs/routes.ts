import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import type { Song, SongTags, ScrobbleDetails } from '@sonarly/shared';
import { getSongById, deleteSongByPath, scrobbleSong, attachSongArtistEntries, attachSongComposerEntries } from './repository.js';
import { getSongGenreNamesForMany, getSongGenreNames } from '../genres/repository.js';
import { getUserById } from '../users/index.js';
import { writeTags, writeCoverArt } from '../tags/index.js';
import { createCoverArt, deleteCoverArt, setSongCoverArtId, getSongCoverArtId } from '../cover-art/index.js';
import { organizeSongFile } from '../ingest/index.js';
import { resolveGenreForTagWrite, resolveGenreForFilter } from '../genres/index.js';
import { ensureArtist } from '../artists/repository.js';
import { ensureAlbum } from '../albums/repository.js';
import type { Config } from '../../config.js';

const ALLOWED_TAG_KEYS = new Set<keyof SongTags>([
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNumber',
  'discNumber',
  'genre',
  'year',
  'explicit',
  'lyrics',
]);

const ALLOWED_COVER_ART_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_COVER_ART_BYTES = 2 * 1024 * 1024;

function cleanupOrphanCoverArt(db: Database.Database, coverArtId: string): void {
  const inUse = db.prepare("SELECT 1 FROM songs WHERE cover_art_id = ? UNION ALL SELECT 1 FROM albums WHERE cover_art_id = ? LIMIT 1").get(coverArtId, coverArtId);
  if (!inUse) {
    deleteCoverArt(db, coverArtId);
  }
}

interface OrphanedEntity {
  type: 'artist' | 'album';
  id: string;
  name: string;
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type ApplySongTagsResult =
  | { ok: true; orphanedEntities: OrphanedEntity[] }
  | { ok: false; error: string; statusCode: number };

async function applySongTags(
  db: Database.Database,
  config: Config,
  id: string,
  tags: SongTags,
  logError: (msg: string, err?: unknown) => void,
): Promise<ApplySongTagsResult> {
  const song = getSongById(db, id);
  if (!song) {
    return { ok: false, error: 'Song not found', statusCode: 404 };
  }

  try {
    await writeTags(song.filePath, tags);
  } catch (err) {
    logError(`Failed to write tags for ${song.filePath}`, err);
    return { ok: false, error: 'Failed to write tags', statusCode: 500 };
  }

  let newPath: string;
  try {
    newPath = await organizeSongFile(config, db, song.filePath);
  } catch (err) {
    logError(`Failed to organize file after tag write for ${song.filePath}`, err);
    return { ok: false, error: 'Tags were saved but the file could not be reorganized', statusCode: 500 };
  }

  const artistId = tags.artist !== undefined
    ? ensureArtist(db, tags.artist)
    : song.artistId;

  const albumArtistNames = tags.albumArtist !== undefined
    ? (normalizeName(tags.albumArtist) ? [tags.albumArtist] : undefined)
    : tags.artist !== undefined
      ? (normalizeName(tags.artist) ? [tags.artist] : undefined)
      : undefined;

  const albumId = tags.album !== undefined
    ? (normalizeName(tags.album)
        ? ensureAlbum(db, tags.album, albumArtistNames, tags.year, typeof tags.genre === 'string' ? tags.genre : undefined)
        : null)
    : (song.albumId ?? null);

  let genreId: string | null = null;
  let genreName: string | null = null;
  if (typeof tags.genre === 'string') {
    const trimmed = tags.genre.trim();
    if (trimmed.length > 0) {
      const resolved = resolveGenreForTagWrite(db, tags.genre);
      genreId = resolved.id;
      genreName = resolved.name;
    }
  } else if (song.genreId !== undefined) {
    genreId = song.genreId;
    genreName = song.genre ?? null;
  }

  db.prepare(`
    UPDATE songs SET
      file_path = ?,
      title = ?,
      artist_id = ?,
      album_id = ?,
      track_number = ?,
      disc_number = ?,
      year = ?,
      explicit = ?,
      lyrics = ?,
      genre_id = ?,
      genre = ?
    WHERE id = ?
  `).run(
    newPath,
    tags.title ?? song.title,
    artistId ?? null,
    albumId,
    tags.trackNumber !== undefined ? tags.trackNumber : (song.trackNumber ?? null),
    tags.discNumber !== undefined ? tags.discNumber : (song.discNumber ?? null),
    tags.year !== undefined ? tags.year : (song.year ?? null),
    tags.explicit === true ? 1 : tags.explicit === false ? 0 : (song.explicit ? 1 : 0),
    tags.lyrics !== undefined ? tags.lyrics : (song.lyrics ?? null),
    genreId,
    genreName,
    id,
  );

  try {
    queueResync(db, newPath);
  } catch (err) {
    logError('Failed to queue resync job after tag write', err);
    return { ok: false, error: 'Tags saved and file reorganized, but resync queue failed', statusCode: 500 };
  }

  const orphaned = findOrphanedEntities(db, song, tags);
  return { ok: true, orphanedEntities: orphaned };
}

function findOrphanedEntities(
  db: Database.Database,
  song: { id: string; artistId?: string; albumId?: string },
  tags: SongTags,
): OrphanedEntity[] {
  const orphaned: OrphanedEntity[] = [];

  const newArtist = normalizeName(tags.artist);
  if (song.artistId && newArtist !== undefined) {
    const artist = db.prepare('SELECT name FROM artists WHERE id = ?').get(song.artistId) as { name: string } | undefined;
    if (artist && newArtist.toLowerCase() !== artist.name.toLowerCase()) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM songs WHERE artist_id = ? AND id != ? AND active = 1').get(song.artistId, song.id) as { count: number };
      if (count.count === 0) {
        orphaned.push({ type: 'artist', id: song.artistId, name: artist.name });
      }
    }
  }

  const newAlbum = normalizeName(tags.album);
  if (song.albumId && newAlbum !== undefined) {
    const album = db.prepare('SELECT name FROM albums WHERE id = ?').get(song.albumId) as { name: string } | undefined;
    if (album && newAlbum.toLowerCase() !== album.name.toLowerCase()) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM songs WHERE album_id = ? AND id != ? AND active = 1').get(song.albumId, song.id) as { count: number };
      if (count.count === 0) {
        orphaned.push({ type: 'album', id: song.albumId, name: album.name });
      }
    }
  }

  return orphaned;
}

function parseScrobbleBody(body: unknown): ScrobbleDetails | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Scrobble body must be an object');
  }
  const input = body as Record<string, unknown>;
  const details: ScrobbleDetails = {};

  if ('durationListened' in input) {
    if (typeof input.durationListened !== 'number' || !Number.isFinite(input.durationListened)) {
      throw new Error('durationListened must be a finite number');
    }
    details.durationListened = input.durationListened;
  }

  if ('completion' in input) {
    if (typeof input.completion !== 'number' || !Number.isFinite(input.completion)) {
      throw new Error('completion must be a finite number');
    }
    details.completion = input.completion;
  }

  if ('client' in input) {
    if (typeof input.client !== 'string') throw new Error('client must be a string');
    details.client = input.client;
  }

  if ('source' in input) {
    if (typeof input.source !== 'string') throw new Error('source must be a string');
    details.source = input.source;
  }

  if ('playedAt' in input) {
    if (typeof input.playedAt !== 'string') throw new Error('playedAt must be an ISO date string');
    details.playedAt = input.playedAt;
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

export function validateSongTags(body: unknown): SongTags {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Tags must be an object');
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TAG_KEYS.has(key as keyof SongTags)) {
      throw new Error(`Unknown tag field: ${key}`);
    }
  }
  if ('trackNumber' in input && !Number.isInteger(input.trackNumber)) {
    throw new Error('trackNumber must be an integer');
  }
  if ('discNumber' in input && !Number.isInteger(input.discNumber)) {
    throw new Error('discNumber must be an integer');
  }
  if ('year' in input && !Number.isInteger(input.year)) {
    throw new Error('year must be an integer');
  }
  if ('explicit' in input && typeof input.explicit !== 'boolean') {
    throw new Error('explicit must be a boolean');
  }
  if ('lyrics' in input && typeof input.lyrics !== 'string') {
    throw new Error('lyrics must be a string');
  }
  return input as unknown as SongTags;
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function queueResync(db: Database.Database, path: string): void {
  db.prepare("INSERT INTO scan_jobs (id, type, status, stats) VALUES (?, 'resync', 'pending', ?)")
    .run(randomUUID(), JSON.stringify({ path }));
}

interface SongDetailRow {
  id: string;
  file_path: string;
  title: string;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  artist_id: string | null;
  album_id: string | null;
  genre: string | null;
  year: number | null;
  explicit: number;
  cover_art_id: string | null;
  album_cover_art_id: string | null;
  mtime: number;
  checksum: string;
  active: number;
  artist_name: string | null;
  album_name: string | null;
  album_artist_name: string | null;
  starred: number | null;
  rating: number | null;
  lyrics: string | null;
  synced_lyrics: string | null;
  musicbrainz_track_id: string | null;
  musicbrainz_work_id: string | null;
  musicbrainz_disc_id: string | null;
  producers: string | null;
  isrcs: string | null;
  original_year: number | null;
  original_artist: string | null;
  gapless: number | null;
  total_tracks: string | null;
  total_discs: string | null;
}

interface SongListRow {
  id: string;
  file_path: string;
  title: string;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  artist_id: string | null;
  album_id: string | null;
  genre: string | null;
  year: number | null;
  explicit: number;
  cover_art_id: string | null;
  album_cover_art_id: string | null;
  mtime: number;
  checksum: string;
  active: number;
  artist_name: string | null;
  album_name: string | null;
  album_artist_name: string | null;
  starred: number | null;
  rating: number | null;
  lyrics: string | null;
  synced_lyrics: string | null;
  musicbrainz_track_id: string | null;
  musicbrainz_work_id: string | null;
  musicbrainz_disc_id: string | null;
  producers: string | null;
  isrcs: string | null;
  original_year: number | null;
  original_artist: string | null;
  gapless: number | null;
  total_tracks: string | null;
  total_discs: string | null;
}

function rowToSong(row: SongDetailRow | SongListRow): Song & { artistName?: string; albumName?: string; albumArtistName?: string } {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    trackNumber: row.track_number ?? undefined,
    discNumber: row.disc_number ?? undefined,
    duration: row.duration ?? undefined,
    artistId: row.artist_id ?? undefined,
    albumId: row.album_id ?? undefined,
    genre: row.genre ?? undefined,
    year: row.year ?? undefined,
    explicit: row.explicit === 1,
    coverArt: row.cover_art_id ?? undefined,
    albumCoverArt: row.album_cover_art_id ?? undefined,
    mtime: row.mtime,
    checksum: row.checksum,
    active: row.active === 1,
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
    albumArtistName: row.album_artist_name ?? undefined,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
    lyrics: row.lyrics ?? undefined,
    syncedLyrics: row.synced_lyrics ? JSON.parse(row.synced_lyrics) : undefined,
    musicBrainzTrackId: row.musicbrainz_track_id ?? undefined,
    musicBrainzWorkId: row.musicbrainz_work_id ?? undefined,
    musicBrainzDiscId: row.musicbrainz_disc_id ?? undefined,
    producers: row.producers ? JSON.parse(row.producers) : undefined,
    isrcs: row.isrcs ? JSON.parse(row.isrcs) : undefined,
    originalYear: row.original_year ?? undefined,
    originalArtist: row.original_artist ?? undefined,
    gapless: row.gapless === 1,
    totalTracks: row.total_tracks ?? undefined,
    totalDiscs: row.total_discs ?? undefined,
  };
}

export function registerSongManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/songs', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;

    const { genre, libraryId } = request.query as { genre?: string; libraryId?: string };
    const resolvedGenre = typeof genre === 'string' && genre.length > 0 ? resolveGenreForFilter(db, genre) : undefined;
    const genreFilter = resolvedGenre !== undefined;
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    if (typeof genre === 'string' && genre.length > 0 && !genreFilter) {
      return reply.send({ songs: [] });
    }

    const params: (string | null)[] = [userId ?? null];
    if (libraryFilter) params.push(libraryId);
    if (genreFilter) params.push(resolvedGenre.id);

    const rows = db.prepare(`
      SELECT s.*, ar.name AS artist_name, al.name AS album_name, al.artist_name AS album_artist_name, al.cover_art_id AS album_cover_art_id, us.starred, us.rating
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.active = 1
      ${libraryFilter ? 'AND s.library_id = ?' : ''}
      ${hideExplicit ? 'AND s.explicit = 0' : ''}
      ${genreFilter ? 'AND EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id = ?)' : ''}
      ORDER BY s.title
      LIMIT 500
    `).all(...params) as SongListRow[];

    const songs = rows.map(rowToSong);
    attachSongArtistEntries(db, songs);
    attachSongComposerEntries(db, songs);
    const genreMap = getSongGenreNamesForMany(db, songs.map((s) => s.id));
    for (const song of songs) {
      const genres = genreMap.get(song.id);
      if (genres) song.genres = genres;
    }
    reply.send({ songs });
  });

  app.put('/api/songs/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };

    let tags: SongTags;
    try {
      tags = validateSongTags(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid tags' });
    }

    const result = await applySongTags(db, config, id, tags, (msg, err) => request.log.error({ err }, msg));
    if (!result.ok) {
      return reply.status(result.statusCode).send({ error: result.error });
    }

    return reply.send({ ok: true, orphanedEntities: result.orphanedEntities.length > 0 ? result.orphanedEntities : undefined });
  });

  app.put('/api/songs/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const body = request.body as { ids?: unknown; tags?: unknown };
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
      return reply.status(400).send({ error: 'ids must be an array of strings' });
    }
    const ids = body.ids as string[];

    let tags: SongTags;
    try {
      tags = validateSongTags(body.tags);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid tags' });
    }

    const allOrphaned: OrphanedEntity[] = [];
    for (const id of ids) {
      const result = await applySongTags(db, config, id, tags, (msg, err) => request.log.error({ err }, msg));
      if (!result.ok) {
        return reply.status(result.statusCode).send({ error: result.error, failedId: id });
      }
      allOrphaned.push(...result.orphanedEntities);
    }

    return reply.send({ ok: true, orphanedEntities: allOrphaned.length > 0 ? allOrphaned : undefined });
  });

  app.get('/api/songs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    const params: (string | null)[] = [userId ?? null];
    if (libraryFilter) params.push(libraryId);
    params.push(id);

    const row = db.prepare(`
      SELECT s.*, ar.name AS artist_name, al.name AS album_name, al.artist_name AS album_artist_name, al.cover_art_id AS album_cover_art_id, us.starred, us.rating
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.active = 1
      ${libraryFilter ? 'AND s.library_id = ?' : ''}
      AND s.id = ?
    `).get(...params) as SongDetailRow | undefined;

    if (!row) return reply.status(404).send({ error: 'Song not found' });
    if (hideExplicit && row.explicit === 1) {
      return reply.status(404).send({ error: 'Song not found' });
    }

    const song = rowToSong(row);
    attachSongArtistEntries(db, [song]);
    attachSongComposerEntries(db, [song]);
    const genres = getSongGenreNames(db, song.id);
    if (genres.length) song.genres = genres;
    reply.send({ song });
  });

  app.post('/api/songs/:id/scrobble', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    const details = parseScrobbleBody(request.body);
    scrobbleSong(db, userId, id, details);
    reply.send({ ok: true });
  });

  app.delete('/api/songs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    try {
      await unlink(song.filePath);
    } catch (err) {
      request.log.error({ err }, `Failed to delete file ${song.filePath}`);
      return reply.status(500).send({ error: 'Failed to delete file' });
    }

    deleteSongByPath(db, song.filePath);
    reply.send({ ok: true });
  });

  app.post('/api/songs/:id/cover-art', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    if (!ALLOWED_COVER_ART_TYPES.has(data.mimetype)) {
      await data.toBuffer().catch(() => undefined);
      return reply.status(400).send({ error: 'Invalid image format' });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_COVER_ART_BYTES) {
      return reply.status(400).send({ error: 'Cover art must be smaller than 2 MB' });
    }

    try {
      await writeCoverArt(song.filePath, { data: buffer, format: data.mimetype });
      const coverArtId = createCoverArt(db, buffer, data.mimetype);
      const oldCoverArtId = getSongCoverArtId(db, id);
      setSongCoverArtId(db, id, coverArtId);
      if (oldCoverArtId) cleanupOrphanCoverArt(db, oldCoverArtId);
      queueResync(db, song.filePath);
      reply.send({ coverArt: coverArtId });
    } catch (err) {
      request.log.error({ err }, `Failed to write cover art for ${song.filePath}`);
      return reply.status(500).send({ error: 'Failed to save cover art' });
    }
  });

  app.delete('/api/songs/:id/cover-art', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    const oldCoverArtId = getSongCoverArtId(db, id);
    setSongCoverArtId(db, id, null);
    if (oldCoverArtId) cleanupOrphanCoverArt(db, oldCoverArtId);
    reply.send({ ok: true });
  });
}
