import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { sendSubsonicReply } from '../responses.js';
import { scrobbleSong } from '../../songs/index.js';
import {
  toOpenSubsonicAlbum,
  fetchOpenSubsonicSongsByIds,
} from './browsing.js';
import { getAlbumArtistEntriesForMany } from '../../albums/repository.js';
import { getAlbumGenreNamesForMany } from '../../genres/repository.js';

export function registerStarringRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/star.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id, albumId, artistId } = request.query as {
      id?: string | string[];
      albumId?: string | string[];
      artistId?: string | string[];
    };
    for (const songId of normalizeIds(id)) {
      setStar(db, userId, 'user_songs', 'song_id', songId, true);
    }
    for (const aId of normalizeIds(albumId)) {
      setStar(db, userId, 'user_albums', 'album_id', aId, true);
    }
    for (const aId of normalizeIds(artistId)) {
      setStar(db, userId, 'user_artists', 'artist_id', aId, true);
    }
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/unstar.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id, albumId, artistId } = request.query as {
      id?: string | string[];
      albumId?: string | string[];
      artistId?: string | string[];
    };
    for (const songId of normalizeIds(id)) {
      setStar(db, userId, 'user_songs', 'song_id', songId, false);
    }
    for (const aId of normalizeIds(albumId)) {
      setStar(db, userId, 'user_albums', 'album_id', aId, false);
    }
    for (const aId of normalizeIds(artistId)) {
      setStar(db, userId, 'user_artists', 'artist_id', aId, false);
    }
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/setRating.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id, rating } = request.query as { id: string; rating: string | string[] };

    const ratingValue = parseRating(rating);
    if (ratingValue === undefined) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing or invalid rating parameter' },
      }, 'failed');
    }

    db.prepare(`
      INSERT INTO user_songs (user_id, song_id, rating) VALUES (?, ?, ?)
      ON CONFLICT(user_id, song_id) DO UPDATE SET rating = excluded.rating
    `).run(userId, id, ratingValue);

    db.prepare(`
      UPDATE songs
      SET average_rating = (SELECT AVG(rating) FROM user_songs WHERE song_id = ?)
      WHERE id = ?
    `).run(id, id);

    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/scrobble.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id } = request.query as { id: string | string[] };
    for (const songId of normalizeIds(id)) {
      scrobbleSong(db, userId, songId, { client: 'subsonic' });
    }
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/getStarred2.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string;

    const songIds = db.prepare('SELECT song_id FROM user_songs WHERE user_id = ? AND starred = 1').pluck().all(userId) as string[];
    const songs = fetchOpenSubsonicSongsByIds(db, userId, songIds);

    const albumRows = db.prepare(`
      SELECT a.*, ua.starred, ua.rating,
        (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
      FROM albums a
      JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ? AND ua.starred = 1
      WHERE a.active = 1
    `).all(userId) as AlbumRow[];
    const albumArtistMap = getAlbumArtistEntriesForMany(db, albumRows.map((a) => a.id));
    const albumGenreMap = getAlbumGenreNamesForMany(db, albumRows.map((a) => a.id));
    const albums = albumRows.map((album) => toOpenSubsonicAlbum(album, [], 0, userId, albumArtistMap.get(album.id), albumGenreMap.get(album.id)));

    const artistRows = db.prepare(`
      SELECT ar.*, uar.starred, uar.rating
      FROM artists ar
      JOIN user_artists uar ON uar.artist_id = ar.id AND uar.user_id = ? AND uar.starred = 1
      WHERE ar.active = 1
    `).all(userId) as StarredArtistRow[];
    const artists = artistRows.map((artist) => ({
      id: artist.id,
      name: artist.name,
      coverArt: artist.id,
      artistImageUrl: artist.artist_image_url ?? undefined,
      albumCount: String(artist.album_count ?? 0),
      ...(artist.starred !== null ? { starred: Boolean(artist.starred) } : {}),
      ...(artist.rating !== null ? { userRating: artist.rating } : {}),
    }));

    sendSubsonicReply(reply, format, { starred2: { song: songs, album: albums, artist: artists } });
  });
}

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  cover_art_id: string | null;
  year: number | null;
  genre: string | null;
  labels: string | null;
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
  starred: number | null;
  rating: number | null;
  average_rating: number | null;
}

interface StarredArtistRow {
  id: string;
  name: string;
  artist_image_url: string | null;
  musicbrainz_artist_ids: string | null;
  album_count: number | null;
  starred: number | null;
  rating: number | null;
}

function normalizeIds(value: string | string[] | undefined): string[] {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? value.filter((v) => v !== '') : [value];
}

function parseRating(value: string | string[] | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const num = parseInt(raw, 10);
  if (num < 0 || num > 5) return undefined;
  return num;
}

function setStar(
  db: Database.Database,
  userId: string,
  table: string,
  idColumn: string,
  entityId: string,
  starred: boolean,
): void {
  db.prepare(`
    INSERT INTO ${table} (user_id, ${idColumn}, starred) VALUES (?, ?, ?)
    ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET starred = excluded.starred
  `).run(userId, entityId, starred ? 1 : 0);
}
