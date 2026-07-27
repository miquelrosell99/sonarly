import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { Song, Album, Artist, Playlist } from '@sonarly/shared';
import { getUserById } from '../users/index.js';
import { attachSongArtistEntries } from '../songs/index.js';

const searchQuerySchema = z.object({
  q: z.string().default(''),
  type: z.enum(['songs', 'albums', 'artists', 'playlists']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  libraryId: z.string().optional(),
});

interface SongSearchRow {
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
  mtime: number;
  checksum: string;
  active: number;
  artist_name: string | null;
  album_name: string | null;
  starred: number | null;
  rating: number | null;
}

interface AlbumSearchRow {
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
}

interface ArtistSearchRow {
  id: string;
  name: string;
  active: number;
  starred: number | null;
  rating: number | null;
}

interface PlaylistSearchRow {
  id: string;
  name: string;
  owner_id: string;
  owner_username: string;
  visibility: Playlist['visibility'];
  share_token: string | null;
  is_smart: number;
  created_at: string;
  updated_at: string;
  song_count: number;
  starred: number | null;
  rating: number | null;
}

function likePattern(query: string): string {
  return `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

function rowToSong(row: SongSearchRow): Song {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    trackNumber: row.track_number ?? undefined,
    discNumber: row.disc_number ?? undefined,
    duration: row.duration ?? undefined,
    artistId: row.artist_id ?? undefined,
    albumId: row.album_id ?? undefined,
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
    genre: row.genre ?? undefined,
    year: row.year ?? undefined,
    explicit: row.explicit === 1,
    coverArt: row.cover_art_id ?? undefined,
    mtime: row.mtime,
    checksum: row.checksum,
    active: row.active === 1,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

function rowToAlbum(row: AlbumSearchRow): Album {
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
  };
}

function rowToArtist(row: ArtistSearchRow): Artist {
  return {
    id: row.id,
    name: row.name,
    active: row.active === 1,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

function rowToPlaylist(row: PlaylistSearchRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    visibility: row.visibility,
    shareToken: row.share_token ?? undefined,
    songIds: [],
    isSmart: row.is_smart === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    songCount: row.song_count,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

const MAX_CATEGORY_RESULTS = 250;

function fetchSongs(
  db: Database.Database,
  userId: string | undefined,
  pattern: string,
  hideExplicit: boolean,
  limit?: number,
  libraryId?: string,
): Song[] {
  const limitClause = limit !== undefined ? `LIMIT ${limit}` : '';
  const libraryFilter = libraryId ? 'AND s.library_id = ?' : '';
  const libraryParams = libraryId ? [libraryId] : [];
  const rows = db.prepare(`
    SELECT
      s.*,
      ar.name AS artist_name,
      al.name AS album_name,
      us.starred,
      us.rating
    FROM songs s
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.active = 1 AND (
      LOWER(s.title) LIKE LOWER(?)
      OR LOWER(ar.name) LIKE LOWER(?)
      OR LOWER(al.name) LIKE LOWER(?)
    )
    ${libraryFilter}
    ${hideExplicit ? 'AND s.explicit = 0' : ''}
    ORDER BY s.title
    ${limitClause}
  `).all(userId ?? null, ...libraryParams, pattern, pattern, pattern) as SongSearchRow[];
  return rows.map(rowToSong);
}

function fetchAlbums(
  db: Database.Database,
  userId: string | undefined,
  pattern: string,
  limit?: number,
  libraryId?: string,
): Album[] {
  const limitClause = limit !== undefined ? `LIMIT ${limit}` : '';
  const libraryFilter = libraryId ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = a.id AND s.active = 1 AND s.library_id = ?)' : '';
  const libraryParams = libraryId ? [libraryId] : [];
  const rows = db.prepare(`
    SELECT
      a.*,
      ua.starred,
      ua.rating
    FROM albums a
    LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
    WHERE a.active = 1 AND LOWER(a.name) LIKE LOWER(?)
    ${libraryFilter}
    ORDER BY a.name
    ${limitClause}
  `).all(userId ?? null, ...libraryParams, pattern) as AlbumSearchRow[];
  return rows.map(rowToAlbum);
}

function fetchArtists(
  db: Database.Database,
  userId: string | undefined,
  pattern: string,
  limit?: number,
  libraryId?: string,
): Artist[] {
  const limitClause = limit !== undefined ? `LIMIT ${limit}` : '';
  const libraryFilter = libraryId ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.artist_id = ar.id AND s.active = 1 AND s.library_id = ?)' : '';
  const libraryParams = libraryId ? [libraryId] : [];
  const rows = db.prepare(`
    SELECT
      ar.*,
      ua.starred,
      ua.rating
    FROM artists ar
    LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
    WHERE ar.active = 1 AND LOWER(ar.name) LIKE LOWER(?)
    ${libraryFilter}
    ORDER BY ar.name
    ${limitClause}
  `).all(userId ?? null, ...libraryParams, pattern) as ArtistSearchRow[];
  return rows.map(rowToArtist);
}

function fetchPlaylists(
  db: Database.Database,
  userId: string | undefined,
  pattern: string,
  limit?: number,
): Playlist[] {
  const limitClause = limit !== undefined ? `LIMIT ${limit}` : '';
  const rows = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.owner_id,
      u.username AS owner_username,
      p.visibility,
      p.share_token,
      p.is_smart,
      p.created_at,
      p.updated_at,
      (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count,
      up.starred,
      up.rating
    FROM playlists p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN user_playlists up ON up.user_id = ? AND up.playlist_id = p.id
    WHERE LOWER(p.name) LIKE LOWER(?)
      AND (
        p.owner_id = ?
        OR p.visibility IN ('public', 'link')
        OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?)
      )
    ORDER BY p.updated_at DESC
    ${limitClause}
  `).all(userId ?? null, pattern, userId ?? '', userId ?? '') as PlaylistSearchRow[];
  return rows.map(rowToPlaylist);
}

export function registerSearchRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/search', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const parseResult = searchQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const { q, type, limit } = parseResult.data;
    const query = q.trim();
    if (query.length === 0) {
      return reply.send({ songs: [], albums: [], artists: [], playlists: [] });
    }

    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const pattern = likePattern(query);
    const categoryLimit = type
      ? Math.min(limit ?? MAX_CATEGORY_RESULTS, MAX_CATEGORY_RESULTS)
      : (limit ?? 5) + 1;
    const libraryId = typeof parseResult.data.libraryId === 'string' && parseResult.data.libraryId.length > 0
      ? parseResult.data.libraryId
      : undefined;

    const songs = !type || type === 'songs'
      ? fetchSongs(db, userId, pattern, hideExplicit, categoryLimit, libraryId)
      : [];
    attachSongArtistEntries(db, songs);
    const albums = !type || type === 'albums'
      ? fetchAlbums(db, userId, pattern, categoryLimit, libraryId)
      : [];
    const artists = !type || type === 'artists'
      ? fetchArtists(db, userId, pattern, categoryLimit, libraryId)
      : [];
    const playlists = !type || type === 'playlists'
      ? fetchPlaylists(db, userId, pattern, categoryLimit)
      : [];

    reply.send({ songs, albums, artists, playlists });
  });
}
