import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { sendSubsonicReply } from '../responses.js';

export function registerBrowsingRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/rest/getMusicFolders.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    sendSubsonicReply(reply, format, {
      musicFolders: { musicFolder: [{ id: 0, name: 'Music' }] },
    });
  });

  app.get('/rest/getIndexes.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const artists = db.prepare('SELECT id, name FROM artists ORDER BY name').all() as { id: string; name: string }[];
    sendSubsonicReply(reply, format, {
      indexes: {
        lastModified: Date.now(),
        index: artists.map((a) => ({ name: a.name[0]?.toUpperCase() || '#', artist: [{ id: a.id, name: a.name }] })),
      },
    });
  });

  app.get('/rest/getArtists.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const artists = db.prepare('SELECT id, name FROM artists ORDER BY name').all() as { id: string; name: string }[];
    sendSubsonicReply(reply, format, {
      artists: {
        index: artists.map((a) => ({ name: a.name[0]?.toUpperCase() || '#', artist: [{ id: a.id, name: a.name }] })),
      },
    });
  });

  app.get('/rest/getAlbum.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const { id } = request.query as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as any;
    const songs = db.prepare('SELECT * FROM songs WHERE album_id = ? ORDER BY disc_number, track_number').all(id) as any[];
    sendSubsonicReply(reply, format, {
      album: {
        id: album.id,
        name: album.name,
        artist: album.artist_name,
        artistId: album.artist_id,
        song: songs.map((s) => toOpenSubsonicSong(s)),
      },
    });
  });

  app.get('/rest/getSong.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const { id } = request.query as { id: string };
    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as any;
    sendSubsonicReply(reply, format, { song: toOpenSubsonicSong(song) });
  });
}

function toOpenSubsonicSong(song: any): Record<string, unknown> {
  return {
    id: song.id,
    parent: song.album_id,
    title: song.title,
    album: song.album_id,
    artist: song.artist_id,
    track: song.track_number,
    discNumber: song.disc_number,
    genre: song.genre,
    year: song.year,
    duration: song.duration,
    isDir: false,
    coverArt: song.cover_art,
    created: new Date(song.mtime).toISOString(),
    albumId: song.album_id,
    artistId: song.artist_id,
    type: 'music',
  };
}
