import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { SongTags, Album } from '@sonarly/shared';
import { listSongsByAlbum } from '../db/repositories/song-repository.js';
import { writeTags } from '../tags/writer.js';
import { validateSongTags, queueResync } from './songs.js';

export function registerAlbumManagementRoutes(app: FastifyInstance, db: Database.Database): void {
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
      queueResync(db, song.filePath);
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
