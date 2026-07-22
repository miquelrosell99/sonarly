import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import type { SongTags } from '@sonarly/shared';
import { getSongById, deleteSongByPath } from '../songs/index.js';
import { writeTags } from '../tags/index.js';
import { organizeSongFile } from '../ingest/index.js';
import type { Config } from '../../config.js';

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
  if ('trackNumber' in input && !Number.isInteger(input.trackNumber)) {
    throw new Error('trackNumber must be an integer');
  }
  if ('discNumber' in input && !Number.isInteger(input.discNumber)) {
    throw new Error('discNumber must be an integer');
  }
  if ('year' in input && !Number.isInteger(input.year)) {
    throw new Error('year must be an integer');
  }
  return input as unknown as SongTags;
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
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

interface SongListRow {
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

function rowToSong(row: SongDetailRow | SongListRow) {
  return {
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
  };
}

export function registerSongManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/songs', (request: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare(`
      SELECT s.*, ar.name AS artist_name, al.name AS album_name
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      ORDER BY s.title
      LIMIT 500
    `).all() as SongListRow[];

    reply.send({ songs: rows.map(rowToSong) });
  });

  app.put('/api/songs/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

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

    let newPath: string;
    try {
      newPath = await organizeSongFile(config, db, song.filePath);
    } catch (err) {
      request.log.error({ err }, `Failed to organize file after tag write for ${song.filePath}`);
      return reply.status(500).send({ error: 'Tags were saved but the file could not be reorganized' });
    }

    try {
      queueResync(db, newPath);
    } catch (err) {
      request.log.error({ err }, 'Failed to queue resync job after tag write');
      return reply.status(500).send({ error: 'Tags saved and file reorganized, but resync queue failed' });
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

    reply.send({ song: rowToSong(row) });
  });

  app.delete('/api/songs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send({ error: 'Song not found' });

    try {
      await unlink(song.filePath);
    } catch (err) {
      request.log.error({ err }, `Failed to delete file ${song.filePath}`);
      return reply.status(500).send({ error: 'Failed to delete file' });
    }

    deleteSongByPath(db, song.filePath);
    reply.send({ ok: true });
  });
}
