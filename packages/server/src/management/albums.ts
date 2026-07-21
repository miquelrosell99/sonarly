import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { SongTags, Album } from '@sonarly/shared';
import { listSongsByAlbum } from '../db/repositories/song-repository.js';
import { writeTags } from '../tags/writer.js';
import { validateSongTags, queueResync } from './songs.js';

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_art: string | null;
}

export function registerAlbumManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/albums', (request: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare('SELECT * FROM albums ORDER BY name LIMIT 500').all() as AlbumRow[];
    reply.send({
      albums: rows.map((r) => ({
        id: r.id,
        name: r.name,
        artistId: r.artist_id ?? undefined,
        artistName: r.artist_name ?? undefined,
        year: r.year ?? undefined,
        genre: r.genre ?? undefined,
        coverArt: r.cover_art ?? undefined,
      })),
    });
  });

  app.put('/api/albums/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

    let tags: SongTags;
    try {
      tags = validateSongTags(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid tags' });
    }

    const songs = listSongsByAlbum(db, id);
    for (const song of songs) {
      await writeTags(song.filePath, tags);
      try {
        queueResync(db, song.filePath);
      } catch (err) {
        request.log.error({ err }, 'Failed to queue resync job after album tag write');
        return reply.status(500).send({ error: 'Tag update succeeded but resync queue failed' });
      }
    }

    reply.send({ updated: songs.length });
  });

  app.get('/api/albums/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

    const songs = listSongsByAlbum(db, id);
    reply.send({ album, songs });
  });
}
