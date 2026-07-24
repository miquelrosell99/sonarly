import path from 'node:path';
import { statSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { lookup } from 'mime-types';
import type { Config } from '../../../config.js';
import { sendSubsonicReply } from '../responses.js';

interface ArtistRow {
  id: string;
  name: string;
  artist_image_url: string | null;
}

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  cover_art_id: string | null;
  year: number | null;
  genre: string | null;
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
}

export function registerBrowsingRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/rest/getMusicFolders.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const name = path.basename(config.LIBRARY_PATH) || 'library';
    sendSubsonicReply(reply, format, {
      musicFolders: { musicFolder: [{ id: 0, name }] },
    });
  });

  app.get('/rest/getIndexes.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const artists = db.prepare('SELECT id, name, artist_image_url FROM artists WHERE active = 1 ORDER BY name').all() as ArtistRow[];
    sendSubsonicReply(reply, format, {
      indexes: {
        lastModified: Date.now(),
        index: groupArtistsByInitial(artists),
        child: [],
        shortcut: [],
      },
    });
  });

  app.get('/rest/getArtists.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const artists = db.prepare('SELECT id, name, artist_image_url FROM artists WHERE active = 1 ORDER BY name').all() as ArtistRow[];
    sendSubsonicReply(reply, format, {
      artists: {
        ignoredArticles: '',
        index: groupArtistsByInitial(artists),
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
    const openSubsonicSongs = songs.map((s) => toOpenSubsonicSong(s, userId));
    sendSubsonicReply(reply, format, {
      album: toOpenSubsonicAlbum(album, openSubsonicSongs, duration, userId),
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
    sendSubsonicReply(reply, format, { song: toOpenSubsonicSong(song, userId) });
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

    sendSubsonicReply(reply, format, {
      artist: {
        id: artist.id,
        name: artist.name,
        coverArt: artist.id,
        artistImageUrl: artist.artist_image_url ?? undefined,
        albumCount: String(albums.length),
        album: albums.map((album) => toOpenSubsonicAlbum(album, [], 0, userId)),
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

    let sql = `
      SELECT a.*, ua.starred, ua.rating,
        (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
      FROM albums a
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.active = 1
    `;
    const params: (string | number | null)[] = [userId ?? null];

    if (genre) {
      sql += ' AND a.genre = ?';
      params.push(genre);
    }
    if (fromYear !== undefined && toYear !== undefined) {
      if (fromYear <= toYear) {
        sql += ' AND a.year >= ? AND a.year <= ?';
        params.push(fromYear, toYear);
      } else {
        sql += ' AND a.year >= ? AND a.year <= ?';
        params.push(toYear, fromYear);
      }
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
        sql += ' ORDER BY a.genre, a.name';
        break;
      default:
        sql += ' ORDER BY a.name';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(size, offset);

    const albums = db.prepare(sql).all(...params) as (AlbumRow & AlbumInteractions)[];
    sendSubsonicReply(reply, format, {
      albumList2: { album: albums.map((album) => toOpenSubsonicAlbum(album, [], 0, userId)) },
    });
  });

  app.get('/rest/getGenres.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const rows = db.prepare(`
      SELECT genre AS value,
        COUNT(DISTINCT album_id) AS album_count,
        COUNT(*) AS song_count
      FROM songs
      WHERE active = 1 AND genre IS NOT NULL AND genre != ''
      GROUP BY genre
      ORDER BY genre
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
    const term = (query.query || '').trim();
    const artistCount = Number.parseInt(query.artistCount || '20', 10);
    const artistOffset = Number.parseInt(query.artistOffset || '0', 10);
    const albumCount = Number.parseInt(query.albumCount || '20', 10);
    const albumOffset = Number.parseInt(query.albumOffset || '0', 10);
    const songCount = Number.parseInt(query.songCount || '20', 10);
    const songOffset = Number.parseInt(query.songOffset || '0', 10);

    const result: Record<string, unknown> = {};

    if (term) {
      const like = `%${term.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

      const artists = db.prepare(`
        SELECT ar.*, uar.starred, uar.rating
        FROM artists ar
        LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
        WHERE ar.active = 1 AND ar.name LIKE ? ESCAPE '\\'
        ORDER BY ar.name
        LIMIT ? OFFSET ?
      `).all(userId ?? null, like, artistCount, artistOffset) as (ArtistRow & ArtistInteractions)[];
      if (artists.length) {
        result.artist = artists.map((artist) => ({
          id: artist.id,
          name: artist.name,
          albumCount: '0',
          coverArt: artist.id,
          artistImageUrl: artist.artist_image_url ?? undefined,
          ...(userId ? toArtistInteractions(artist) : {}),
        }));
      }

      const albums = db.prepare(`
        SELECT a.*, ua.starred, ua.rating,
          (SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating
        FROM albums a
        LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
        WHERE a.active = 1 AND (a.name LIKE ? ESCAPE '\\' OR a.artist_name LIKE ? ESCAPE '\\')
        ORDER BY a.name
        LIMIT ? OFFSET ?
      `).all(userId ?? null, like, like, albumCount, albumOffset) as (AlbumRow & AlbumInteractions)[];
      if (albums.length) {
        result.album = albums.map((album) => toOpenSubsonicAlbum(album, [], 0, userId));
      }

      const songs = db.prepare(`
        SELECT s.*, a.name AS album_name, ar.name AS artist_name,
          us.starred, us.rating, us.play_count
        FROM songs s
        LEFT JOIN albums a ON a.id = s.album_id
        LEFT JOIN artists ar ON ar.id = s.artist_id
        LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
        WHERE s.active = 1 AND (s.title LIKE ? ESCAPE '\\' OR ar.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\')
        ORDER BY s.title
        LIMIT ? OFFSET ?
      `).all(userId ?? null, like, like, like, songCount, songOffset) as (SongRow & { starred: number | null; rating: number | null; play_count: number | null })[];
      if (songs.length) {
        result.song = songs.map((song) => toOpenSubsonicSong(song, userId));
      }
    }

    sendSubsonicReply(reply, format, { searchResult3: result });
  });
}

function toOpenSubsonicAlbum(
  album: AlbumRow & Partial<AlbumInteractions>,
  songs: Record<string, unknown>[] = [],
  duration = 0,
  userId?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: album.id,
    name: album.name,
    title: album.name,
    album: album.name,
    artist: album.artist_name ?? '',
    artistId: album.artist_id ?? '',
    artists: album.artist_id ? [{ id: album.artist_id, name: album.artist_name }] : [],
    coverArt: album.cover_art_id ?? album.id,
    isDir: true,
    isVideo: false,
    parent: album.artist_id ?? '',
    songCount: songs.length,
    duration,
    created: new Date().toISOString(),
    year: album.year,
    genre: album.genre,
    song: songs,
  };

  if (album.average_rating !== undefined && album.average_rating !== null) {
    result.averageRating = album.average_rating;
  }

  if (userId) {
    if (album.starred !== undefined && album.starred !== null) {
      result.starred = Boolean(album.starred);
    }
    if (album.rating !== undefined && album.rating !== null) {
      result.userRating = album.rating;
    }
  }

  return result;
}

function toArtistInteractions(artist: ArtistRow & Partial<ArtistInteractions>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (artist.starred !== undefined && artist.starred !== null) {
    result.starred = Boolean(artist.starred);
  }
  if (artist.rating !== undefined && artist.rating !== null) {
    result.userRating = artist.rating;
  }
  return result;
}

function groupArtistsByInitial(artists: ArtistRow[]): { name: string; artist: ArtistRow[] }[] {
  const groups = new Map<string, ArtistRow[]>();
  for (const artist of artists) {
    const initial = artist.name[0]?.toUpperCase() || '#';
    const list = groups.get(initial) ?? [];
    list.push(artist);
    groups.set(initial, list);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, artist]) => ({ name, artist }));
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

function toOpenSubsonicSong(
  song: SongRow & Partial<SongInteractions>,
  userId?: string,
): Record<string, unknown> {
  const suffix = path.extname(song.file_path).replace(/^\./, '').toLowerCase();
  const contentType = song.media_type ?? lookup(song.file_path) ?? 'audio/mpeg';
  const size = getFileSize(song.file_path);
  const artist = song.artist_id ? { id: song.artist_id, name: song.artist_name ?? '' } : undefined;
  const displayArtist = song.display_artist ?? song.artist_name ?? '';
  const displayAlbumArtist = song.display_album_artist ?? song.artist_name ?? '';

  const result: Record<string, unknown> = {
    id: song.id,
    parent: song.album_id ?? '',
    title: song.title,
    album: song.album_name ?? '',
    albumId: song.album_id ?? '',
    artist: song.artist_name ?? '',
    artistId: song.artist_id ?? '',
    artists: artist ? [artist] : [],
    albumArtists: artist ? [artist] : [],
    displayArtist,
    displayAlbumArtist,
    displayTitle: song.sort_name ?? song.title,
    track: song.track_number,
    discNumber: song.disc_number,
    genre: song.genre,
    genres: song.genre ? [{ name: song.genre }] : [],
    year: song.year,
    duration: song.duration,
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

  if (song.bit_rate !== null && song.bit_rate !== undefined) {
    result.bitRate = song.bit_rate;
  }
  if (song.bits_per_sample !== null && song.bits_per_sample !== undefined) {
    result.bitDepth = song.bits_per_sample;
  }
  if (song.sample_rate !== null && song.sample_rate !== undefined) {
    result.samplingRate = song.sample_rate;
  }
  if (song.channels !== null && song.channels !== undefined) {
    result.channelCount = song.channels;
  }
  if (song.bpm !== null && song.bpm !== undefined) {
    result.bpm = song.bpm;
  }
  if (song.music_brainz_id !== null && song.music_brainz_id !== undefined) {
    result.musicBrainzId = song.music_brainz_id;
  }
  if (song.replay_gain !== null && song.replay_gain !== undefined) {
    result.replayGain = song.replay_gain;
  }
  if (song.average_rating !== null && song.average_rating !== undefined) {
    result.averageRating = song.average_rating;
  }
  if (song.comment !== null && song.comment !== undefined) {
    result.comment = song.comment;
  }
  if (song.sort_name !== null && song.sort_name !== undefined) {
    result.sortName = song.sort_name;
  }
  if (song.mood !== null && song.mood !== undefined) {
    result.mood = song.mood;
  }
  if (song.media_type !== null && song.media_type !== undefined) {
    result.mediaType = song.media_type;
  }
  if (song.original_release_date !== null && song.original_release_date !== undefined) {
    result.originalReleaseDate = song.original_release_date;
  }
  if (song.release_date !== null && song.release_date !== undefined) {
    result.releaseDate = song.release_date;
  }
  if (song.remix_of !== null && song.remix_of !== undefined) {
    result.remixOf = song.remix_of;
  }

  if (userId) {
    if (song.play_count !== undefined && song.play_count !== null) {
      result.playCount = song.play_count;
    }
    if (song.starred !== undefined && song.starred !== null) {
      result.starred = Boolean(song.starred);
    }
    if (song.rating !== undefined && song.rating !== null) {
      result.userRating = song.rating;
    }
  }

  return result;
}
