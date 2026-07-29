import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { unlink } from 'node:fs/promises';
import type { SongTags, Album } from '@sonarly/shared';
import { listSongsByAlbum, deleteSongByPath } from '../songs/index.js';
import { getAlbumArtistNamesForMany, getAlbumArtistNames, getAlbumLabelEntriesForMany, getAlbumLabelEntries } from './repository.js';
import { getAlbumGenreNamesForMany, getAlbumGenreNames } from '../genres/repository.js';
import { getUserById } from '../users/index.js';
import { writeTags, writeCoverArt } from '../tags/index.js';
import { validateSongTags, queueResync } from '../songs/index.js';
import { createCoverArt, deleteCoverArt, setAlbumCoverArtId, getAlbumCoverArtId } from '../cover-art/index.js';
import { organizeSongFile } from '../ingest/index.js';
import { resolveGenreForTagWrite, resolveGenreForFilter } from '../genres/index.js';
import type { Config } from '../../config.js';

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_art_id: string | null;
  active: number;
  starred: number | null;
  rating: number | null;
  catalog_numbers: string | null;
  barcode: string | null;
  asin: string | null;
  musicbrainz_album_id: string | null;
  musicbrainz_release_group_id: string | null;
  musicbrainz_album_artist_ids: string | null;
  original_year: number | null;
  compilation: number | null;
  total_tracks: string | null;
  total_discs: string | null;
  explicit?: number | null;
}

function rowToAlbum(row: AlbumRow): Album {
  return {
    id: row.id,
    name: row.name,
    artistId: row.artist_id ?? undefined,
    artistName: row.artist_name ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    coverArt: row.cover_art_id ?? undefined,
    active: row.active === 1,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
    explicit: row.explicit === 1,
    catalogNumbers: row.catalog_numbers ? JSON.parse(row.catalog_numbers) : undefined,
    barcode: row.barcode ?? undefined,
    asin: row.asin ?? undefined,
    musicBrainzAlbumId: row.musicbrainz_album_id ?? undefined,
    musicBrainzReleaseGroupId: row.musicbrainz_release_group_id ?? undefined,
    musicBrainzAlbumArtistIds: row.musicbrainz_album_artist_ids ? JSON.parse(row.musicbrainz_album_artist_ids) : undefined,
    originalYear: row.original_year ?? undefined,
    compilation: row.compilation === 1,
    totalTracks: row.total_tracks ?? undefined,
    totalDiscs: row.total_discs ?? undefined,
  };
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

const ALLOWED_COVER_ART_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_COVER_ART_BYTES = 2 * 1024 * 1024;

function cleanupOrphanCoverArt(db: Database.Database, coverArtId: string): void {
  const inUse = db.prepare("SELECT 1 FROM songs WHERE cover_art_id = ? UNION ALL SELECT 1 FROM albums WHERE cover_art_id = ? LIMIT 1").get(coverArtId, coverArtId);
  if (!inUse) {
    deleteCoverArt(db, coverArtId);
  }
}

export function registerAlbumManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/albums', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;

    const { genre, libraryId } = request.query as { genre?: string; libraryId?: string };
    const resolvedGenre = typeof genre === 'string' && genre.length > 0 ? resolveGenreForFilter(db, genre) : undefined;
    const genreFilter = resolvedGenre !== undefined;
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    if (typeof genre === 'string' && genre.length > 0 && !genreFilter) {
      return reply.send({ albums: [] });
    }

    const rows = db.prepare(`
      SELECT
        a.*,
        ua.starred,
        ua.rating,
        COUNT(s.id) AS total_song_count,
        SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) AS shown_song_count,
        MAX(s.explicit) AS explicit
      FROM albums a
      ${libraryFilter ? 'JOIN songs s ON s.album_id = a.id AND s.active = 1 AND s.library_id = ?' : 'LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1'}
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.active = 1
      ${genreFilter ? 'AND EXISTS (SELECT 1 FROM album_genres ag WHERE ag.album_id = a.id AND ag.genre_id = ?)' : ''}
      ${hideExplicit ? 'GROUP BY a.id HAVING shown_song_count > 0' : 'GROUP BY a.id'}
      ORDER BY a.name
      LIMIT 500
    `).all(...(libraryFilter
      ? (genreFilter ? [libraryId, userId ?? null, resolvedGenre.id] : [libraryId, userId ?? null])
      : (genreFilter ? [userId ?? null, resolvedGenre.id] : [userId ?? null]))
    ) as (AlbumRow & { total_song_count: number; shown_song_count: number })[];

    const albums = rows.map((row) => ({
      ...rowToAlbum(row),
      totalSongCount: row.total_song_count,
      shownSongCount: row.shown_song_count,
    }));
    const artistMap = getAlbumArtistNamesForMany(db, albums.map((a) => a.id));
    const genreMap = getAlbumGenreNamesForMany(db, albums.map((a) => a.id));
    const labelMap = getAlbumLabelEntriesForMany(db, albums.map((a) => a.id));
    for (const album of albums) {
      const artists = artistMap.get(album.id);
      if (artists) album.artists = artists;
      const genres = genreMap.get(album.id);
      if (genres) album.genres = genres;
      const labels = labelMap.get(album.id);
      if (labels) album.labelEntries = labels;
    }
    reply.send({ albums });
  });

  app.put('/api/albums/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND active = 1').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

    let tags: SongTags;
    try {
      tags = validateSongTags(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid tags' });
    }

    const tagsToWrite = { ...tags };
    delete (tagsToWrite as Record<string, unknown>).genre;

    const songs = listSongsByAlbum(db, id);
    for (const song of songs) {
      await writeTags(song.filePath, tagsToWrite);

      let newPath: string;
      try {
        newPath = await organizeSongFile(config, db, song.filePath);
      } catch (err) {
        request.log.error({ err }, `Failed to organize file after album tag write for ${song.filePath}`);
        return reply.status(500).send({ error: 'Tags were saved but a file could not be reorganized' });
      }

      try {
        queueResync(db, newPath);
      } catch (err) {
        request.log.error({ err }, 'Failed to queue resync job after album tag write');
        return reply.status(500).send({ error: 'Tags saved and files reorganized, but resync queue failed' });
      }
    }

    reply.send({ updated: songs.length });
  });

  app.get('/api/albums/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    const row = db.prepare(`
      SELECT a.*, ua.starred, ua.rating
      FROM albums a
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.id = ? AND a.active = 1
      ${libraryFilter ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = a.id AND s.active = 1 AND s.library_id = ?)' : ''}
    `).get(...(libraryFilter ? [userId ?? null, id, libraryId] : [userId ?? null, id])) as AlbumRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Album not found' });

    const songs = listSongsByAlbum(db, id, userId, libraryFilter ? libraryId : undefined);
    const visibleSongs = hideExplicit ? songs.filter((s) => !s.explicit) : songs;

    const album = {
      ...rowToAlbum(row),
      totalSongCount: songs.length,
      shownSongCount: visibleSongs.length,
      explicit: songs.some((s) => s.explicit),
    };
    const artists = getAlbumArtistNames(db, album.id);
    if (artists.length) album.artists = artists;
    const genres = getAlbumGenreNames(db, album.id);
    if (genres.length) album.genres = genres;
    const labels = getAlbumLabelEntries(db, album.id);
    if (labels.length) album.labelEntries = labels;
    reply.send({ album, songs: visibleSongs });
  });

  app.delete('/api/albums/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND active = 1').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

    const songs = listSongsByAlbum(db, id);
    for (const song of songs) {
      try {
        await unlink(song.filePath);
      } catch (err) {
        request.log.error({ err }, `Failed to delete file ${song.filePath}`);
      }
      deleteSongByPath(db, song.filePath);
    }

    db.prepare('DELETE FROM albums WHERE id = ?').run(id);
    reply.send({ ok: true });
  });

  app.post('/api/albums/:id/cover-art', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND active = 1').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

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
      const songs = listSongsByAlbum(db, id);
      for (const song of songs) {
        await writeCoverArt(song.filePath, { data: buffer, format: data.mimetype });
        queueResync(db, song.filePath);
      }
      const coverArtId = createCoverArt(db, buffer, data.mimetype);
      const oldCoverArtId = getAlbumCoverArtId(db, id);
      setAlbumCoverArtId(db, id, coverArtId);
      if (oldCoverArtId) cleanupOrphanCoverArt(db, oldCoverArtId);
      reply.send({ coverArt: coverArtId });
    } catch (err) {
      request.log.error({ err }, `Failed to write album cover art for ${id}`);
      return reply.status(500).send({ error: 'Failed to save cover art' });
    }
  });

  app.delete('/api/albums/:id/cover-art', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND active = 1').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

    const oldCoverArtId = getAlbumCoverArtId(db, id);
    setAlbumCoverArtId(db, id, null);
    if (oldCoverArtId) cleanupOrphanCoverArt(db, oldCoverArtId);
    reply.send({ ok: true });
  });
}
