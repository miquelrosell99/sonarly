import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SongTags } from '@sonarly/shared';
import { getSongById } from '../db/repositories/song-repository.js';
import { writeTags } from '../tags/writer.js';

const ALLOWED_TAG_KEYS = new Set<keyof SongTags>([
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNumber',
  'discNumber',
  'genre',
  'year',
]);

export function validateSongTags(body: unknown): SongTags {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Tags must be an object');
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TAG_KEYS.has(key as keyof SongTags)) {
      throw new Error(`Unknown tag field: ${key}`);
    }
  }
  return input as unknown as SongTags;
}

export function queueResync(db: Database.Database, path: string): void {
  db.prepare("INSERT INTO scan_jobs (id, type, status, stats) VALUES (?, 'resync', 'pending', ?)")
    .run(randomUUID(), JSON.stringify({ path }));
}

interface SongDetailRow {
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
  cover_art: string | null;
  mtime: number;
  checksum: string;
  artist_name: string | null;
  album_name: string | null;
}

export function registerSongManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.put('/api/songs/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    let tags: SongTags;
    try {
      tags = validateSongTags(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid tags' });
    }

    await writeTags(song.filePath, tags);
    try {
      queueResync(db, song.filePath);
    } catch (err) {
      request.log.error({ err }, 'Failed to queue resync job after tag write');
      return reply.status(500).send({ error: 'Tag update succeeded but resync queue failed' });
    }
    return reply.send({ ok: true });
  });

  app.get('/api/songs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare(`
      SELECT s.*, ar.name AS artist_name, al.name AS album_name
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      WHERE s.id = ?
    `).get(id) as SongDetailRow | undefined;

    if (!row) return reply.status(404).send({ error: 'Song not found' });

    reply.send({
      song: {
        id: row.id,
        filePath: row.file_path,
        title: row.title,
        trackNumber: row.track_number ?? undefined,
        discNumber: row.disc_number ?? undefined,
        duration: row.duration ?? undefined,
        artistId: row.artist_id ?? undefined,
        albumId: row.album_id ?? undefined,
        genre: row.genre ?? undefined,
        year: row.year ?? undefined,
        coverArt: row.cover_art ?? undefined,
        mtime: row.mtime,
        checksum: row.checksum,
        artistName: row.artist_name ?? undefined,
        albumName: row.album_name ?? undefined,
      },
    });
  });
}
