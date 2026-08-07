import path from 'node:path';
import { statSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { lookup } from 'mime-types';
import type { Config } from '../../../config.js';
import { sendSubsonicReply } from '../responses.js';
import { getSongArtistEntriesForMany, getSongComposerEntriesForMany, getAlbumSongStatsForMany } from '../../songs/repository.js';
import { getAlbumArtistEntriesForMany, getAlbumLabelEntriesForMany } from '../../albums/repository.js';
import {
  getSongGenreNamesForMany,
  getAlbumGenreNamesForMany,
  getSongGenreNames,
  getAlbumGenreNames,
} from '../../genres/repository.js';

interface ArtistRow {
  id: string;
  name: string;
  artist_image_url: string | null;
  musicbrainz_artist_ids: string | null;
}

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  cover_art_id: string | null;
  year: number | null;
  genre: string | null;
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
}

interface SongRow {
  id: string;
  album_id: string | null;
  artist_id: string | null;
  title: string;
  track_number: number | null;
  disc_number: number | null;
  genre: string | null;
  year: number | null;
  duration: number | null;
  cover_art_id: string | null;
  mtime: number;
  file_path: string;
  bit_rate: number | null;
  bits_per_sample: number | null;
  sample_rate: number | null;
  channels: number | null;
  bpm: number | null;
  music_brainz_id: string | null;
  musicbrainz_track_id: string | null;
  musicbrainz_work_id: string | null;
  musicbrainz_disc_id: string | null;
  replay_gain: number | null;
  average_rating: number | null;
  comment: string | null;
  sort_name: string | null;
  mood: string | null;
  media_type: string | null;
  original_release_date: string | null;
  release_date: string | null;
  remix_of: string | null;
  display_artist: string | null;
  display_album_artist: string | null;
  album_name: string | null;
  artist_name: string | null;
  producers: string | null;
  isrcs: string | null;
  original_year: number | null;
  original_artist: string | null;
  gapless: number | null;
  total_tracks: string | null;
  total_discs: string | null;
}

export function registerBrowsingRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/rest/getMusicFolders.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const rows = db.prepare('SELECT id, name FROM libraries ORDER BY name').all() as { id: string; name: string }[];
    const folders = rows.length > 0
      ? rows.map((r, index) => ({ id: index, name: r.name }))
      : [{ id: 0, name: path.basename(config.LIBRARY_PATH) || 'library' }];
    sendSubsonicReply(reply, format, {
      musicFolders: { musicFolder: folders },
    });
  });

  app.get('/rest/getIndexes.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const artists = db.prepare(`
      SELECT ar.id, ar.name, ar.artist_image_url, ar.musicbrainz_artist_ids,
        (SELECT COUNT(*)
         FROM albums a
         WHERE a.active = 1
           AND (a.artist_id = ar.id
                OR EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = a.id AND aa.artist_id = ar.id))
        ) AS album_count
      FROM artists ar
      WHERE ar.active = 1
      ORDER BY ar.name
    `).all() as (ArtistRow & { album_count: number })[];
    sendSubsonicReply(reply, format, {
      indexes: {
        lastModified: Date.now(),
        index: groupArtistsByInitial(artists.map((artist) => toOpenSubsonicArtist(artist))),
        child: [],
        shortcut: [],
      },
    });
  });

  app.get('/rest/getArtists.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const artists = db.prepare(`
      SELECT ar.id, ar.name, ar.artist_image_url, ar.musicbrainz_artist_ids,
        uar.starred, uar.rating,
        (SELECT COUNT(*)
         FROM albums a
         WHERE a.active = 1
           AND (a.artist_id = ar.id
                OR EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = a.id AND aa.artist_id = ar.id))
        ) AS album_count
      FROM artists ar
      LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
      WHERE ar.active = 1
      ORDER BY ar.name
    `).all(userId ?? null) as (ArtistRow & ArtistInteractions & { album_count: number })[];
    sendSubsonicReply(reply, format, {
      artists: {
        ignoredArticles: '',
        index: groupArtistsByInitial(artists.map((artist) => toOpenSubsonicArtist(artist, userId))),
      },
    });
  });

  app.get('/rest/getAlbum.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const { id } = request.query as { id: string };
    const album = db.prepare(`
      SELECT a.*,
        ua.starred, ua.rating,
        (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
      FROM albums a
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.id = ? AND a.active = 1
    `).get(userId ?? null, id) as (AlbumRow & AlbumInteractions) | undefined;
    if (!album) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }
    const songs = db.prepare(`
      SELECT s.*, a.name AS album_name, ar.name AS artist_name,
        us.starred, us.rating, us.play_count
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.album_id = ? AND s.active = 1
      ORDER BY s.disc_number, s.track_number
    `).all(userId ?? null, id) as (SongRow & { starred: number | null; rating: number | null; play_count: number | null })[];
    const duration = songs.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const songArtistMap = getSongArtistEntriesForMany(db, songs.map((s) => s.id));
    const songComposerMap = getSongComposerEntriesForMany(db, songs.map((s) => s.id));
    const songGenreMap = getSongGenreNamesForMany(db, songs.map((s) => s.id));
    const albumGenreNames = getAlbumGenreNames(db, album.id);
    const albumLabelEntries = getAlbumLabelEntriesForMany(db, [album.id]).get(album.id);
    const openSubsonicSongs = songs.map((s) => toOpenSubsonicSong(s, userId, songArtistMap.get(s.id), songGenreMap.get(s.id), songComposerMap.get(s.id)));
    sendSubsonicReply(reply, format, {
      album: toOpenSubsonicAlbum(album, openSubsonicSongs, duration, userId, undefined, albumGenreNames, albumLabelEntries),
    });
  });

  app.get('/rest/getSong.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const { id } = request.query as { id: string };
    const song = db.prepare(`
      SELECT s.*, a.name AS album_name, ar.name AS artist_name,
        us.starred, us.rating, us.play_count
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.id = ? AND s.active = 1
    `).get(userId ?? null, id) as (SongRow & { starred: number | null; rating: number | null; play_count: number | null }) | undefined;
    if (!song) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }
    const songArtists = getSongArtistEntriesForMany(db, [song.id]).get(song.id);
    const songComposers = getSongComposerEntriesForMany(db, [song.id]).get(song.id);
    const songGenres = getSongGenreNames(db, song.id);
    sendSubsonicReply(reply, format, { song: toOpenSubsonicSong(song, userId, songArtists, songGenres, songComposers) });
  });

  app.get('/rest/getArtist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const { id } = request.query as { id: string };
    const artist = db.prepare(`
      SELECT ar.*, uar.starred, uar.rating
      FROM artists ar
      LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
      WHERE ar.id = ? AND ar.active = 1
    `).get(userId ?? null, id) as (ArtistRow & ArtistInteractions) | undefined;
    if (!artist) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }

    const albums = db.prepare(`
      SELECT a.*,
        ua.starred, ua.rating,
        (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
      FROM albums a
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.artist_id = ? AND a.active = 1
      ORDER BY a.year, a.name
    `).all(userId ?? null, id) as (AlbumRow & AlbumInteractions)[];

    const albumIds = albums.map((a) => a.id);
    const albumArtistMap = getAlbumArtistEntriesForMany(db, albumIds);
    const albumLabelMap = getAlbumLabelEntriesForMany(db, albumIds);
    const albumGenreMap = getAlbumGenreNamesForMany(db, albumIds);
    const albumStatsMap = getAlbumSongStatsForMany(db, albumIds);
    sendSubsonicReply(reply, format, {
      artist: {
        id: artist.id,
        name: artist.name,
        coverArt: artist.id,
        artistImageUrl: artist.artist_image_url ?? undefined,
        musicBrainzIds: artist.musicbrainz_artist_ids ? JSON.parse(artist.musicbrainz_artist_ids) : undefined,
        albumCount: albums.length,
        album: albums.map((album) => {
          const stats = albumStatsMap.get(album.id) ?? { songCount: 0, duration: 0 };
          return toOpenSubsonicAlbum(album, [], stats.duration, userId, albumArtistMap.get(album.id), albumGenreMap.get(album.id), albumLabelMap.get(album.id), stats.songCount);
        }),
        ...(userId ? toArtistInteractions(artist) : {}),
      },
    });
  });

  app.get('/rest/getAlbumList2.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const query = request.query as Record<string, string>;
    const type = query.type || 'alphabeticalByName';
    const size = Number.parseInt(query.size || '20', 10);
    const offset = Number.parseInt(query.offset || '0', 10);
    const genre = query.genre;
    const fromYear = query.fromYear ? Number.parseInt(query.fromYear, 10) : undefined;
    const toYear = query.toYear ? Number.parseInt(query.toYear, 10) : undefined;

    const albums = fetchAlbumList(db, userId, type, size, offset, genre, fromYear, toYear);
    sendSubsonicReply(reply, format, { albumList2: { album: albums } });
  });

  app.get('/rest/getGenres.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const rows = db.prepare(`
      SELECT g.name AS value,
        (SELECT COUNT(DISTINCT ag.album_id)
         FROM album_genres ag
         JOIN albums a ON a.id = ag.album_id
         WHERE ag.genre_id = g.id AND a.active = 1) AS album_count,
        (SELECT COUNT(DISTINCT sg.song_id)
         FROM song_genres sg
         JOIN songs s ON s.id = sg.song_id
         WHERE sg.genre_id = g.id AND s.active = 1) AS song_count
      FROM genres g
      WHERE g.active = 1
      ORDER BY g.name
    `).all() as { value: string; album_count: number; song_count: number }[];

    sendSubsonicReply(reply, format, {
      genres: {
        genre: rows.map((row) => ({
          value: row.value,
          albumCount: row.album_count,
          songCount: row.song_count,
        })),
      },
    });
  });

  app.get('/rest/search3.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const query = request.query as Record<string, string>;
    const term = (query.query || '').trim().replace(/^["']+|["']+$/g, '');
    const artistCount = Number.parseInt(query.artistCount || '20', 10);
    const artistOffset = Number.parseInt(query.artistOffset || '0', 10);
    const albumCount = Number.parseInt(query.albumCount || '20', 10);
    const albumOffset = Number.parseInt(query.albumOffset || '0', 10);
    const songCount = Number.parseInt(query.songCount || '20', 10);
    const songOffset = Number.parseInt(query.songOffset || '0', 10);

    const result: Record<string, unknown> = {};
    const like = term ? `%${term.replace(/%/g, '\\%').replace(/_/g, '\\_')}%` : '';

    const artistWhere = term ? "AND ar.name LIKE ? ESCAPE '\\'" : '';
    const artistParams = term ? [userId ?? null, like, artistCount, artistOffset] : [userId ?? null, artistCount, artistOffset];
    const artists = db.prepare(`
      SELECT ar.*, uar.starred, uar.rating,
        (SELECT COUNT(*)
         FROM albums a
         WHERE a.active = 1
           AND (a.artist_id = ar.id
                OR EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = a.id AND aa.artist_id = ar.id))
        ) AS album_count
      FROM artists ar
      LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
      WHERE ar.active = 1 ${artistWhere}
      ORDER BY ar.name
      LIMIT ? OFFSET ?
    `).all(...artistParams) as (ArtistRow & ArtistInteractions & { album_count: number })[];
    if (artists.length) {
      result.artist = artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        albumCount: artist.album_count,
        coverArt: artist.id,
        artistImageUrl: artist.artist_image_url ?? undefined,
        ...(userId ? toArtistInteractions(artist) : {}),
      }));
    }

    const albumWhere = term ? "AND (a.name LIKE ? ESCAPE '\\' OR a.artist_name LIKE ? ESCAPE '\\')" : '';
    const albumParams = term ? [userId ?? null, like, like, albumCount, albumOffset] : [userId ?? null, albumCount, albumOffset];
    const albums = db.prepare(`
      SELECT a.*, ua.starred, ua.rating,
        (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
      FROM albums a
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.active = 1 ${albumWhere}
      ORDER BY a.name
      LIMIT ? OFFSET ?
    `).all(...albumParams) as (AlbumRow & AlbumInteractions)[];
    if (albums.length) {
      const albumIds = albums.map((a) => a.id);
      const albumArtistMap = getAlbumArtistEntriesForMany(db, albumIds);
      const albumLabelMap = getAlbumLabelEntriesForMany(db, albumIds);
      const albumGenreMap = getAlbumGenreNamesForMany(db, albumIds);
      const albumStatsMap = getAlbumSongStatsForMany(db, albumIds);
      result.album = albums.map((album) => {
        const stats = albumStatsMap.get(album.id) ?? { songCount: 0, duration: 0 };
        return toOpenSubsonicAlbum(album, [], stats.duration, userId, albumArtistMap.get(album.id), albumGenreMap.get(album.id), albumLabelMap.get(album.id), stats.songCount);
      });
    }

    const songWhere = term ? "AND (s.title LIKE ? ESCAPE '\\' OR ar.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\')" : '';
    const songParams = term ? [userId ?? null, like, like, like, songCount, songOffset] : [userId ?? null, songCount, songOffset];
    const songs = db.prepare(`
      SELECT s.*, a.name AS album_name, ar.name AS artist_name,
        us.starred, us.rating, us.play_count
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.active = 1 ${songWhere}
      ORDER BY s.title
      LIMIT ? OFFSET ?
    `).all(...songParams) as (SongRow & { starred: number | null; rating: number | null; play_count: number | null })[];
    if (songs.length) {
      const songArtistMap = getSongArtistEntriesForMany(db, songs.map((s) => s.id));
      const songComposerMap = getSongComposerEntriesForMany(db, songs.map((s) => s.id));
      const songGenreMap = getSongGenreNamesForMany(db, songs.map((s) => s.id));
      result.song = songs.map((song) => toOpenSubsonicSong(song, userId, songArtistMap.get(song.id), songGenreMap.get(song.id), songComposerMap.get(song.id)));
    }

    sendSubsonicReply(reply, format, { searchResult3: result });
  });

  app.get('/rest/getAlbumList.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const query = request.query as Record<string, string>;
    const type = query.type || 'alphabeticalByName';
    const size = Number.parseInt(query.size || '20', 10);
    const offset = Number.parseInt(query.offset || '0', 10);
    const genre = query.genre;
    const fromYear = query.fromYear ? Number.parseInt(query.fromYear, 10) : undefined;
    const toYear = query.toYear ? Number.parseInt(query.toYear, 10) : undefined;
    const albums = fetchAlbumList(db, userId, type, size, offset, genre, fromYear, toYear);
    sendSubsonicReply(reply, format, { albumList: { album: albums } });
  });

  app.get('/rest/getSongsByGenre.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const query = request.query as Record<string, string>;
    const genre = query.genre ?? '';
    const size = Number.parseInt(query.size || '10', 10);
    const offset = Number.parseInt(query.offset || '0', 10);

    if (!genre) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing genre parameter' },
      }, 'failed');
    }

    const songs = fetchSongsByGenre(db, userId, genre, size, offset);
    sendSubsonicReply(reply, format, { songsByGenre: { song: songs } });
  });

  app.get('/rest/getRandomSongs.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const query = request.query as Record<string, string>;
    const size = Math.min(Number.parseInt(query.size || '10', 10), 500);
    const genre = query.genre;
    const fromYear = query.fromYear ? Number.parseInt(query.fromYear, 10) : undefined;
    const toYear = query.toYear ? Number.parseInt(query.toYear, 10) : undefined;

    const songs = fetchRandomSongs(db, userId, size, genre, fromYear, toYear);
    sendSubsonicReply(reply, format, { randomSongs: { song: songs } });
  });

  app.get('/rest/getArtistInfo2.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const { id } = request.query as { id: string };
    const count = Math.min(Number.parseInt((request.query as Record<string, string>).count || '5', 10), 100);

    const artist = db.prepare('SELECT id, name, artist_image_url, musicbrainz_artist_ids FROM artists WHERE id = ? AND active = 1').get(id) as
      | { id: string; name: string; artist_image_url: string | null; musicbrainz_artist_ids: string | null }
      | undefined;
    if (!artist) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }

    const similarArtists = db.prepare(`
      SELECT id, name, artist_image_url FROM artists
      WHERE active = 1 AND id != ?
        AND EXISTS (
          SELECT 1 FROM album_genres ag
          JOIN albums a ON a.id = ag.album_id
          WHERE a.artist_id = artists.id
            AND ag.genre_id IN (
              SELECT ag2.genre_id FROM album_genres ag2
              JOIN albums a2 ON a2.id = ag2.album_id
              WHERE a2.artist_id = ?
            )
        )
      ORDER BY RANDOM()
      LIMIT ?
    `).all(id, id, count) as { id: string; name: string; artist_image_url: string | null }[];

    const musicBrainzIds = artist.musicbrainz_artist_ids ? JSON.parse(artist.musicbrainz_artist_ids) as string[] : [];

    sendSubsonicReply(reply, format, {
      artistInfo2: {
        biography: '',
        smallImageUrl: artist.artist_image_url ?? undefined,
        largeImageUrl: artist.artist_image_url ?? undefined,
        musicBrainzId: musicBrainzIds[0] ?? undefined,
        similarArtists: similarArtists.map((a) => ({
          id: a.id,
          name: a.name,
          coverArt: a.id,
          artistImageUrl: a.artist_image_url ?? undefined,
        })),
      },
    });
  });

  app.get('/rest/getAlbumInfo2.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const { id } = request.query as { id: string };
    const album = db.prepare('SELECT id, name, cover_art_id, musicbrainz_album_id FROM albums WHERE id = ? AND active = 1').get(id) as
      | { id: string; name: string; cover_art_id: string | null; musicbrainz_album_id: string | null }
      | undefined;
    if (!album) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }

    sendSubsonicReply(reply, format, {
      albumInfo2: {
        notes: '',
        musicBrainzId: album.musicbrainz_album_id ?? undefined,
        smallImageUrl: album.cover_art_id ?? undefined,
        largeImageUrl: album.cover_art_id ?? undefined,
      },
    });
  });

  app.get('/rest/getSimilarSongs2.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const { id } = request.query as { id: string };
    const count = Math.min(Number.parseInt((request.query as Record<string, string>).count || '50', 10), 500);

    const song = db.prepare('SELECT artist_id, album_id FROM songs WHERE id = ? AND active = 1').get(id) as
      | { artist_id: string | null; album_id: string | null }
      | undefined;
    if (!song) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }

    const songs = fetchSimilarSongs(db, userId, id, song.artist_id, song.album_id, count);
    sendSubsonicReply(reply, format, { similarSongs2: { song: songs } });
  });

  app.get('/rest/getTopSongs.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const query = request.query as Record<string, string>;
    const artist = query.artist ?? '';
    const count = Math.min(Number.parseInt(query.count || '50', 10), 500);

    if (!artist) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing artist parameter' },
      }, 'failed');
    }

    const songs = fetchTopSongs(db, userId, artist, count);
    sendSubsonicReply(reply, format, { topSongs: { song: songs } });
  });
}

export function toOpenSubsonicAlbum(
  album: AlbumRow & Partial<AlbumInteractions>,
  songs: Record<string, unknown>[] = [],
  duration = 0,
  userId?: string,
  artistEntries?: { id: string; name: string }[],
  genreNames?: string[],
  labelEntries?: { id: string; name: string }[],
  songCount?: number,
): Record<string, unknown> {
  const artists = artistEntries && artistEntries.length > 0
    ? artistEntries
    : album.artist_id ? [{ id: album.artist_id, name: album.artist_name ?? '' }] : [];
  const genreName = (genreNames?.[0] ?? album.genre) || undefined;
  const genres = (genreNames ?? (album.genre ? [album.genre] : [])).map((name) => ({ name }));
  const result: Record<string, unknown> = {
    id: album.id,
    name: album.name,
    title: album.name,
    album: album.name,
    artist: (artists.map((a) => a.name).join(' / ') || album.artist_name) ?? '',
    artistId: artists[0]?.id ?? album.artist_id ?? '',
    artists,
    coverArt: album.cover_art_id ?? album.id,
    isDir: true,
    isVideo: false,
    parent: artists[0]?.id ?? album.artist_id ?? '',
    songCount: songCount ?? songs.length,
    duration: Math.round(duration),
    created: new Date().toISOString(),
  };
  if (album.year !== null && album.year !== undefined) {
    result.year = album.year;
  }
  if (genreName) {
    result.genre = genreName;
  }
  if (genres.length) {
    result.genres = genres;
  }
  if (songs.length) {
    result.song = songs;
  }

  if (album.average_rating !== undefined && album.average_rating !== null) {
    result.averageRating = album.average_rating;
  }
  if (album.original_year !== null && album.original_year !== undefined) {
    result.originalYear = album.original_year;
  }
  if (album.compilation === 1) {
    result.compilation = true;
  }
  if (labelEntries && labelEntries.length) {
    result.labels = labelEntries.map((entry) => entry.name);
  }
  if (album.catalog_numbers) {
    result.catalogNumbers = JSON.parse(album.catalog_numbers);
  }
  if (album.barcode !== null && album.barcode !== undefined) {
    result.barcode = album.barcode;
  }
  if (album.asin !== null && album.asin !== undefined) {
    result.asin = album.asin;
  }
  if (album.musicbrainz_album_id !== null && album.musicbrainz_album_id !== undefined) {
    result.musicBrainzId = album.musicbrainz_album_id;
  }
  if (album.musicbrainz_release_group_id !== null && album.musicbrainz_release_group_id !== undefined) {
    result.musicBrainzReleaseGroupId = album.musicbrainz_release_group_id;
  }
  if (album.musicbrainz_album_artist_ids) {
    result.musicBrainzArtistIds = JSON.parse(album.musicbrainz_album_artist_ids);
  }
  if (album.total_tracks !== null && album.total_tracks !== undefined) {
    const trackCount = parseInt(String(album.total_tracks), 10);
    if (!Number.isNaN(trackCount)) result.trackCount = trackCount;
  }
  if (album.total_discs !== null && album.total_discs !== undefined) {
    const discCount = parseInt(String(album.total_discs), 10);
    if (!Number.isNaN(discCount)) result.discCount = discCount;
  }

  if (userId) {
    const starredDate = toStarredDate(album.starred);
    if (starredDate !== undefined) {
      result.starred = starredDate;
    }
    if (album.rating !== undefined && album.rating !== null) {
      result.userRating = album.rating;
    }
  }

  return result;
}

function toArtistInteractions(artist: ArtistRow & Partial<ArtistInteractions>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const starredDate = toStarredDate(artist.starred);
  if (starredDate !== undefined) {
    result.starred = starredDate;
  }
  if (artist.rating !== undefined && artist.rating !== null) {
    result.userRating = artist.rating;
  }
  return result;
}

function groupArtistsByInitial(artists: Record<string, unknown>[]): { name: string; artist: Record<string, unknown>[] }[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const artist of artists) {
    const initial = (artist.name as string)?.[0]?.toUpperCase() || '#';
    const list = groups.get(initial) ?? [];
    list.push(artist);
    groups.set(initial, list);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, artist]) => ({ name, artist }));
}

export function toOpenSubsonicArtist(
  artist: ArtistRow & Partial<ArtistInteractions> & { album_count?: number },
  userId?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: artist.id,
    name: artist.name,
    coverArt: artist.id,
    albumCount: artist.album_count ?? 0,
  };
  if (artist.artist_image_url) {
    result.artistImageUrl = artist.artist_image_url;
  }
  if (artist.musicbrainz_artist_ids) {
    result.musicBrainzIds = JSON.parse(artist.musicbrainz_artist_ids);
  }
  if (userId) {
    const starredDate = toStarredDate(artist.starred);
    if (starredDate !== undefined) {
      result.starred = starredDate;
    }
    if (artist.rating !== undefined && artist.rating !== null) {
      result.userRating = artist.rating;
    }
  }
  return result;
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

interface SongInteractions {
  starred: number | null;
  rating: number | null;
  play_count: number | null;
}

interface AlbumInteractions {
  starred: number | null;
  rating: number | null;
  average_rating: number | null;
}

interface ArtistInteractions {
  starred: number | null;
  rating: number | null;
}

export function toStarredDate(starred: number | null | undefined): string | undefined {
  return starred === 1 ? '1970-01-01T00:00:00.000Z' : undefined;
}

function isValidDateString(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value === '0000' || value === '0000-00-00' || value === '0000-00-00T00:00:00') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() > 0;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
  } catch {
    // ignore invalid JSON
  }
  return [];
}

export function toOpenSubsonicSong(
  song: SongRow & Partial<SongInteractions>,
  userId?: string,
  artistEntries?: { id: string; name: string }[],
  genreNames?: string[],
  composerEntries?: { id: string; name: string }[],
): Record<string, unknown> {
  const suffix = path.extname(song.file_path).replace(/^\./, '').toLowerCase();
  const contentType = song.media_type ?? lookup(song.file_path) ?? 'audio/mpeg';
  const size = getFileSize(song.file_path);
  const artists = artistEntries && artistEntries.length > 0
    ? artistEntries
    : song.artist_id ? [{ id: song.artist_id, name: song.artist_name ?? '' }] : [];
  const displayArtist = song.display_artist ?? artists.map((a) => a.name).join(' / ') ?? '';
  const displayAlbumArtist = song.display_album_artist ?? artists.map((a) => a.name).join(' / ') ?? '';

  const songGenreName = (genreNames?.[0] ?? song.genre) || undefined;
  const songGenres = (genreNames ?? (song.genre ? [song.genre] : [])).map((name) => ({ name }));
  const result: Record<string, unknown> = {
    id: song.id,
    parent: song.album_id ?? '',
    title: song.title,
    album: song.album_name ?? '',
    albumId: song.album_id ?? '',
    artist: artists.map((a) => a.name).join(' / '),
    artistId: artists[0]?.id ?? song.artist_id ?? '',
    artists,
    albumArtists: artists,
    displayArtist,
    displayAlbumArtist,
    displayTitle: song.sort_name ?? song.title,
    duration: Math.max(1, Math.round(song.duration ?? 0)),
    isDir: false,
    isVideo: false,
    coverArt: song.cover_art_id ?? song.album_id ?? '',
    created: new Date(song.mtime).toISOString(),
    path: song.file_path,
    size,
    suffix,
    contentType,
    type: 'music',
  };
  if (song.track_number !== null && song.track_number !== undefined) {
    result.track = song.track_number;
  }
  if (song.disc_number !== null && song.disc_number !== undefined) {
    result.discNumber = song.disc_number;
  }
  if (song.year !== null && song.year !== undefined) {
    result.year = song.year;
  }
  if (songGenreName) {
    result.genre = songGenreName;
  }
  if (songGenres.length) {
    result.genres = songGenres;
  }

  if (song.bit_rate !== null && song.bit_rate !== undefined && song.bit_rate > 0) {
    result.bitRate = Math.round(song.bit_rate);
  }
  if (song.bits_per_sample !== null && song.bits_per_sample !== undefined && song.bits_per_sample > 0) {
    result.bitDepth = song.bits_per_sample;
  }
  if (song.sample_rate !== null && song.sample_rate !== undefined && song.sample_rate > 0) {
    result.samplingRate = song.sample_rate;
  }
  if (song.channels !== null && song.channels !== undefined && song.channels > 0) {
    result.channelCount = song.channels;
  }
  if (song.bpm !== null && song.bpm !== undefined && song.bpm > 0) {
    result.bpm = Math.round(song.bpm);
  }
  if (song.music_brainz_id) {
    result.musicBrainzId = song.music_brainz_id;
  }
  if (song.replay_gain !== null && song.replay_gain !== undefined) {
    result.replayGain = song.replay_gain;
  }
  if (song.average_rating !== null && song.average_rating !== undefined) {
    result.averageRating = song.average_rating;
  }
  if (song.comment) {
    result.comment = song.comment;
  }
  if (song.sort_name) {
    result.sortName = song.sort_name;
  }
  if (song.mood) {
    result.mood = song.mood;
  }
  if (song.media_type) {
    result.mediaType = song.media_type;
  }
  if (isValidDateString(song.original_release_date)) {
    result.originalReleaseDate = song.original_release_date;
  }
  if (isValidDateString(song.release_date)) {
    result.releaseDate = song.release_date;
  }
  if (song.remix_of) {
    result.remixOf = song.remix_of;
  }
  if (song.musicbrainz_track_id) {
    result.musicBrainzTrackId = song.musicbrainz_track_id;
  }
  if (song.musicbrainz_work_id) {
    result.musicBrainzWorkId = song.musicbrainz_work_id;
  }
  if (song.musicbrainz_disc_id) {
    result.musicBrainzDiscId = song.musicbrainz_disc_id;
  }
  if (composerEntries && composerEntries.length) {
    result.composers = composerEntries.map((entry) => entry.name);
  }
  if (song.producers) {
    const producers = parseStringArray(song.producers);
    if (producers.length) result.producers = producers;
  }
  if (song.isrcs) {
    const isrcs = parseStringArray(song.isrcs);
    if (isrcs.length) result.isrcs = isrcs;
  }
  if (song.original_year !== null && song.original_year !== undefined) {
    result.originalYear = song.original_year;
  }
  if (song.original_artist) {
    result.originalArtist = song.original_artist;
  }
  if (song.gapless === 1) {
    result.gapless = true;
  }
  if (song.total_tracks !== null && song.total_tracks !== undefined) {
    const trackCount = parseInt(String(song.total_tracks), 10);
    if (!Number.isNaN(trackCount)) result.trackCount = trackCount;
  }
  if (song.total_discs !== null && song.total_discs !== undefined) {
    const discCount = parseInt(String(song.total_discs), 10);
    if (!Number.isNaN(discCount)) result.discCount = discCount;
  }

  if (userId) {
    if (song.play_count !== undefined && song.play_count !== null) {
      result.playCount = song.play_count;
    }
    const starredDate = toStarredDate(song.starred);
    if (starredDate !== undefined) {
      result.starred = starredDate;
    }
    if (song.rating !== undefined && song.rating !== null) {
      result.userRating = song.rating;
    }
  }

  return result;
}

function songSelectSql(userIdPlaceholder: string): string {
  return `
    SELECT s.*, a.name AS album_name, ar.name AS artist_name,
      us.starred, us.rating, us.play_count
    FROM songs s
    LEFT JOIN albums a ON a.id = s.album_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN user_songs us ON us.user_id = ${userIdPlaceholder} AND us.song_id = s.id
  `;
}

export function mapSongRowsToOpenSubsonic(
  db: Database.Database,
  rows: (SongRow & Partial<SongInteractions>)[],
  userId?: string,
): Record<string, unknown>[] {
  const ids = rows.map((r) => r.id);
  const artistMap = getSongArtistEntriesForMany(db, ids);
  const composerMap = getSongComposerEntriesForMany(db, ids);
  const genreMap = getSongGenreNamesForMany(db, ids);
  return rows.map((row) => toOpenSubsonicSong(row, userId, artistMap.get(row.id), genreMap.get(row.id), composerMap.get(row.id)));
}

export function fetchOpenSubsonicSongsByIds(
  db: Database.Database,
  userId: string | undefined,
  ids: string[],
): Record<string, unknown>[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT s.*, a.name AS album_name, ar.name AS artist_name,
      us.starred, us.rating, us.play_count
    FROM songs s
    LEFT JOIN albums a ON a.id = s.album_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.active = 1 AND s.id IN (${placeholders})
  `).all(userId ?? null, ...ids) as (SongRow & Partial<SongInteractions>)[];
  return mapSongRowsToOpenSubsonic(db, rows, userId);
}

function fetchAlbumList(
  db: Database.Database,
  userId: string | undefined,
  type: string,
  size: number,
  offset: number,
  genre?: string,
  fromYear?: number,
  toYear?: number,
): Record<string, unknown>[] {
  let sql = `
    SELECT a.*, ua.starred, ua.rating,
      (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
    FROM albums a
    LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
    WHERE a.active = 1
  `;
  const params: (string | number | null)[] = [userId ?? null];

  if (genre) {
    sql += ` AND EXISTS (
      SELECT 1 FROM album_genres ag
      JOIN genres g ON g.id = ag.genre_id
      WHERE ag.album_id = a.id AND g.name = ?
    )`;
    params.push(genre);
  }
  if (fromYear !== undefined && toYear !== undefined) {
    const [lo, hi] = fromYear <= toYear ? [fromYear, toYear] : [toYear, fromYear];
    sql += ' AND a.year >= ? AND a.year <= ?';
    params.push(lo, hi);
  }

  switch (type) {
    case 'alphabeticalByArtist':
      sql += ' ORDER BY a.artist_name, a.name';
      break;
    case 'alphabeticalByName':
      sql += ' ORDER BY a.name';
      break;
    case 'newest':
      sql += ' ORDER BY a.year DESC NULLS LAST, a.name';
      break;
    case 'recent':
    case 'frequent':
      sql += ' ORDER BY a.year DESC NULLS LAST, a.name';
      break;
    case 'random':
      sql += ' ORDER BY RANDOM()';
      break;
    case 'byYear':
      sql += ' ORDER BY a.year, a.name';
      break;
    case 'byGenre':
      sql += ` ORDER BY (
        SELECT g.name FROM album_genres ag
        JOIN genres g ON g.id = ag.genre_id
        WHERE ag.album_id = a.id
        ORDER BY ag.position LIMIT 1
      ), a.name`;
      break;
    default:
      sql += ' ORDER BY a.name';
  }

  sql += ' LIMIT ? OFFSET ?';
  params.push(size, offset);

  const albums = db.prepare(sql).all(...params) as (AlbumRow & AlbumInteractions)[];
  const albumIds = albums.map((a) => a.id);
  const albumArtistMap = getAlbumArtistEntriesForMany(db, albumIds);
  const albumLabelMap = getAlbumLabelEntriesForMany(db, albumIds);
  const albumGenreMap = getAlbumGenreNamesForMany(db, albumIds);
  const albumStatsMap = getAlbumSongStatsForMany(db, albumIds);
  return albums.map((album) => {
    const stats = albumStatsMap.get(album.id) ?? { songCount: 0, duration: 0 };
    return toOpenSubsonicAlbum(album, [], stats.duration, userId, albumArtistMap.get(album.id), albumGenreMap.get(album.id), albumLabelMap.get(album.id), stats.songCount);
  });
}

function fetchSongsByGenre(
  db: Database.Database,
  userId: string | undefined,
  genre: string,
  size: number,
  offset: number,
): Record<string, unknown>[] {
  const rows = db.prepare(`
    ${songSelectSql('?')}
    JOIN song_genres sg ON sg.song_id = s.id
    JOIN genres g ON g.id = sg.genre_id
    WHERE s.active = 1 AND g.name = ?
    ORDER BY s.title
    LIMIT ? OFFSET ?
  `).all(userId ?? null, genre, size, offset) as (SongRow & Partial<SongInteractions>)[];
  return mapSongRowsToOpenSubsonic(db, rows, userId);
}

function fetchRandomSongs(
  db: Database.Database,
  userId: string | undefined,
  size: number,
  genre?: string,
  fromYear?: number,
  toYear?: number,
): Record<string, unknown>[] {
  const params: (string | number | null)[] = [userId ?? null];
  let sql = `${songSelectSql('?')} WHERE s.active = 1`;

  if (genre) {
    sql += ` AND EXISTS (
      SELECT 1 FROM song_genres sg
      JOIN genres g ON g.id = sg.genre_id
      WHERE sg.song_id = s.id AND g.name = ?
    )`;
    params.push(genre);
  }
  if (fromYear !== undefined && toYear !== undefined) {
    const [lo, hi] = fromYear <= toYear ? [fromYear, toYear] : [toYear, fromYear];
    sql += ' AND s.year >= ? AND s.year <= ?';
    params.push(lo, hi);
  }

  sql += ' ORDER BY RANDOM() LIMIT ?';
  params.push(size);

  const rows = db.prepare(sql).all(...params) as (SongRow & Partial<SongInteractions>)[];
  return mapSongRowsToOpenSubsonic(db, rows, userId);
}

function fetchSimilarSongs(
  db: Database.Database,
  userId: string | undefined,
  excludeId: string,
  artistId: string | null,
  albumId: string | null,
  count: number,
): Record<string, unknown>[] {
  const params: (string | number | null)[] = [userId ?? null];
  let where = 'WHERE s.active = 1 AND s.id != ?';
  params.push(excludeId);

  if (artistId) {
    where += ` AND (s.artist_id = ? OR EXISTS (
      SELECT 1 FROM song_artists sa WHERE sa.song_id = s.id AND sa.artist_id = ?
    ))`;
    params.push(artistId, artistId);
  } else if (albumId) {
    where += ' AND s.album_id = ?';
    params.push(albumId);
  } else {
    return [];
  }

  const rows = db.prepare(`
    ${songSelectSql('?')}
    ${where}
    ORDER BY RANDOM()
    LIMIT ?
  `).all(...params, count) as (SongRow & Partial<SongInteractions>)[];
  return mapSongRowsToOpenSubsonic(db, rows, userId);
}

function fetchTopSongs(
  db: Database.Database,
  userId: string | undefined,
  artistName: string,
  count: number,
): Record<string, unknown>[] {
  const rows = db.prepare(`
    ${songSelectSql('?')}
    WHERE s.active = 1 AND (
      ar.name = ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM song_artists sa
        JOIN artists a2 ON a2.id = sa.artist_id
        WHERE sa.song_id = s.id AND a2.name = ? COLLATE NOCASE
      )
      OR EXISTS (
        SELECT 1 FROM album_artists aa
        JOIN artists a3 ON a3.id = aa.artist_id
        WHERE aa.album_id = s.album_id AND a3.name = ? COLLATE NOCASE
      )
    )
    GROUP BY s.id
    ORDER BY COALESCE(SUM(us.play_count), 0) DESC, s.title
    LIMIT ?
  `).all(userId ?? null, artistName, artistName, artistName, count) as (SongRow & Partial<SongInteractions>)[];
  return mapSongRowsToOpenSubsonic(db, rows, userId);
}
