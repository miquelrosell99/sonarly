import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';

interface ArtistRow {
  id: string;
  name: string;
}

interface AlbumRow {
  id: string;
  name: string;
  year: number | null;
  genre: string | null;
}

export function registerArtistManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/artists', (request: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare('SELECT * FROM artists ORDER BY name').all() as ArtistRow[];
    reply.send({ artists: rows.map((r) => ({ id: r.id, name: r.name })) });
  });

  app.get('/api/artists/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id) as ArtistRow | undefined;
    if (!artist) return reply.status(404).send({ error: 'Artist not found' });

    const albums = db.prepare('SELECT id, name, year, genre FROM albums WHERE artist_id = ? ORDER BY year, name')
      .all(id) as AlbumRow[];

    reply.send({
      artist: {
        id: artist.id,
        name: artist.name,
        albums: albums.map((a) => ({
          id: a.id,
          name: a.name,
          year: a.year ?? undefined,
          genre: a.genre ?? undefined,
        })),
      },
    });
  });
}
