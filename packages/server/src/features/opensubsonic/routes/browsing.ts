import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../../config.js';
import { sendSubsonicReply } from '../responses.js';

interface ArtistRow {
  id: string;
  name: string;
}

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  cover_art_id: string | null;
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
    const artists = db.prepare('SELECT id, name FROM artists WHERE active = 1 ORDER BY name').all() as ArtistRow[];
    sendSubsonicReply(reply, format, {
      indexes: {
        lastModified: Date.now(),
        index: groupArtistsByInitial(artists),
      },
    });
  });

  app.get('/rest/getArtists.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const artists = db.prepare('SELECT id, name FROM artists WHERE active = 1 ORDER BY name').all() as ArtistRow[];
    sendSubsonicReply(reply, format, {
      artists: {
        index: groupArtistsByInitial(artists),
      },
    });
  });

  app.get('/rest/getAlbum.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const { id } = request.query as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND active = 1').get(id) as AlbumRow | undefined;
    if (!album) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }
    const songs = db.prepare(`
      SELECT s.*, a.name AS album_name, ar.name AS artist_name
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      LEFT JOIN artists ar ON ar.id = s.artist_id
      WHERE s.album_id = ? AND s.active = 1
      ORDER BY s.disc_number, s.track_number
    `).all(id) as SongRow[];
    sendSubsonicReply(reply, format, {
      album: {
        id: album.id,
        name: album.name,
        artist: album.artist_name ?? '',
        artistId: album.artist_id ?? '',
        coverArt: album.cover_art_id ?? '',
        song: songs.map((s) => toOpenSubsonicSong(s)),
      },
    });
  });

  app.get('/rest/getSong.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const { id } = request.query as { id: string };
    const song = db.prepare(`
      SELECT s.*, a.name AS album_name, ar.name AS artist_name
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      LEFT JOIN artists ar ON ar.id = s.artist_id
      WHERE s.id = ? AND s.active = 1
    `).get(id) as SongRow | undefined;
    if (!song) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }
    sendSubsonicReply(reply, format, { song: toOpenSubsonicSong(song) });
  });
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

function toOpenSubsonicSong(song: SongRow): Record<string, unknown> {
  return {
    id: song.id,
    parent: song.album_id,
    title: song.title,
    album: song.album_name ?? '',
    artist: song.artist_name ?? '',
    track: song.track_number,
    discNumber: song.disc_number,
    genre: song.genre,
    year: song.year,
    duration: song.duration,
    isDir: false,
    coverArt: song.cover_art_id ?? '',
    created: new Date(song.mtime).toISOString(),
    albumId: song.album_id,
    artistId: song.artist_id,
    type: 'music',
  };
}
