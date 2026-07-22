import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { listCollisionSongs } from '../songs/index.js';

interface ConflictRow {
  id: string;
  file_path: string;
  title: string;
  artist_name: string | null;
  album_name: string | null;
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerConflictManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/conflicts', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const songs = listCollisionSongs(db);
    const ids = songs.map((s) => s.id);
    const names = new Map<string, { artistName?: string; albumName?: string }>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT s.id, ar.name AS artist_name, al.name AS album_name
        FROM songs s
        LEFT JOIN artists ar ON ar.id = s.artist_id
        LEFT JOIN albums al ON al.id = s.album_id
        WHERE s.id IN (${placeholders})
      `).all(...ids) as ConflictRow[];
      for (const row of rows) {
        names.set(row.id, {
          artistName: row.artist_name ?? undefined,
          albumName: row.album_name ?? undefined,
        });
      }
    }

    reply.send({
      conflicts: songs.map((song) => ({
        id: song.id,
        filePath: song.filePath,
        title: song.title,
        artistName: names.get(song.id)?.artistName,
        albumName: names.get(song.id)?.albumName,
      })),
    });
  });
}
