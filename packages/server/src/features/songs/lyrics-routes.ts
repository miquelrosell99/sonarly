import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { SyncedLyricLine } from '@sonarly/shared';
import { getSongById } from './repository.js';
import { writeTags } from '../tags/index.js';
import { organizeSongFile } from '../ingest/index.js';
import { queueResync } from './routes.js';
import type { Config } from '../../config.js';

export function validateLyrics(body: unknown): { lyrics?: string; syncedLyrics?: SyncedLyricLine[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Lyrics body must be an object');
  }
  const input = body as Record<string, unknown>;
  const result: { lyrics?: string; syncedLyrics?: SyncedLyricLine[] } = {};

  if ('lyrics' in input) {
    if (typeof input.lyrics !== 'string') throw new Error('lyrics must be a string');
    result.lyrics = input.lyrics;
  }

  if ('syncedLyrics' in input) {
    if (!Array.isArray(input.syncedLyrics)) throw new Error('syncedLyrics must be an array');
    const lines: SyncedLyricLine[] = [];
    for (const item of input.syncedLyrics) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('syncedLyrics items must be objects');
      }
      const line = item as Record<string, unknown>;
      if (typeof line.time !== 'number' || !Number.isFinite(line.time)) {
        throw new Error('syncedLyrics item time must be a finite number');
      }
      if (typeof line.text !== 'string') throw new Error('syncedLyrics item text must be a string');
      lines.push({ time: line.time, text: line.text });
    }
    result.syncedLyrics = lines.sort((a, b) => a.time - b.time);
  }

  return result;
}

export function registerLyricsRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/songs/:id/lyrics', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });
    reply.send({ lyrics: song.lyrics, syncedLyrics: song.syncedLyrics });
  });

  app.put('/api/songs/:id/lyrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!session?.isAdmin) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    let payload: ReturnType<typeof validateLyrics>;
    try {
      payload = validateLyrics(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid lyrics' });
    }

    await writeTags(song.filePath, {
      title: song.title,
      lyrics: payload.lyrics,
      syncedLyrics: payload.syncedLyrics,
    });

    let newPath: string;
    try {
      newPath = await organizeSongFile(config, db, song.filePath);
    } catch (err) {
      request.log.error({ err }, `Failed to organize file after lyrics write for ${song.filePath}`);
      return reply.status(500).send({ error: 'Lyrics saved but the file could not be reorganized' });
    }

    try {
      queueResync(db, newPath);
    } catch (err) {
      request.log.error({ err }, 'Failed to queue resync job after lyrics write');
      return reply.status(500).send({ error: 'Lyrics saved and file reorganized, but resync queue failed' });
    }

    reply.send({ ok: true });
  });
}
