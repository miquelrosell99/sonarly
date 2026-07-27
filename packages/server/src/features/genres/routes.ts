import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import {
  listGenres,
  getGenreById,
  createGenre,
  updateGenre,
  deleteGenre,
  buildGenrePaths,
  updateGenreNameCache,
  getRandomAlbumsByGenre,
} from './repository.js';
import { getUserById } from '../users/index.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

interface GenreNode {
  id: string;
  name: string;
  parentId?: string;
  path: string;
  active: boolean;
  children: GenreNode[];
}

function buildTree(genres: ReturnType<typeof listGenres>): GenreNode[] {
  const byId = new Map<string, GenreNode>();
  const roots: GenreNode[] = [];

  for (const genre of genres) {
    byId.set(genre.id, {
      id: genre.id,
      name: genre.name,
      parentId: genre.parentId,
      path: genre.name,
      active: genre.active,
      children: [],
    });
  }

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setPath(node: GenreNode, prefix: string) {
    node.path = prefix ? `${prefix} > ${node.name}` : node.name;
    for (const child of node.children) {
      setPath(child, node.path);
    }
  }
  for (const root of roots) {
    setPath(root, '');
  }

  return roots;
}

export function registerGenreManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/genres', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId?: string; isAdmin?: boolean } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const genres = listGenres(db);
    const paths = buildGenrePaths(db);
    const nodes = genres.map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId,
      path: paths.get(g.id) ?? g.name,
      active: g.active,
    }));
    reply.send({ genres: nodes });
  });

  app.get('/api/genres/tree', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId?: string; isAdmin?: boolean } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const genres = listGenres(db);
    reply.send({ tree: buildTree(genres) });
  });

  app.post('/api/genres', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const body = request.body as Record<string, unknown>;
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return reply.status(400).send({ error: 'Genre name is required' });
    }
    const parentId = typeof body.parentId === 'string' ? body.parentId : undefined;
    if (parentId) {
      const parent = getGenreById(db, parentId);
      if (!parent) return reply.status(404).send({ error: 'Parent genre not found' });
    }

    const genre = createGenre(db, body.name, parentId);
    reply.status(201).send({ genre });
  });

  app.put('/api/genres/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const genre = getGenreById(db, id);
    if (!genre) return reply.status(404).send({ error: 'Genre not found' });

    const body = request.body as Record<string, unknown>;
    const changes: { name?: string; parentId?: string | null } = {};
    if (typeof body.name === 'string') {
      changes.name = body.name;
    }
    if ('parentId' in body) {
      const parentId = body.parentId === null || body.parentId === undefined ? null : String(body.parentId);
      if (parentId && parentId !== id) {
        const parent = getGenreById(db, parentId);
        if (!parent) return reply.status(404).send({ error: 'Parent genre not found' });
      }
      changes.parentId = parentId === id ? undefined : parentId;
    }

    updateGenre(db, id, changes);
    if (changes.name) {
      updateGenreNameCache(db, id);
    }
    reply.send({ genre: getGenreById(db, id) });
  });

  app.delete('/api/genres/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const genre = getGenreById(db, id);
    if (!genre) return reply.status(404).send({ error: 'Genre not found' });

    const children = db.prepare('SELECT id FROM genres WHERE parent_id = ? AND active = 1').all(id) as { id: string }[];
    if (children.length > 0) {
      return reply.status(409).send({ error: 'Cannot delete genre with children' });
    }

    db.prepare("UPDATE songs SET genre_id = NULL WHERE genre_id = ?").run(id);
    db.prepare("UPDATE albums SET genre_id = NULL WHERE genre_id = ?").run(id);
    deleteGenre(db, id);
    reply.send({ ok: true });
  });

  app.get('/api/genres/:id/albums', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId?: string; isAdmin?: boolean } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { id } = request.params as { id: string };
    const genre = getGenreById(db, id);
    if (!genre) return reply.status(404).send({ error: 'Genre not found' });

    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit ?? '4', 10) || 4, 1), 20);
    const hideExplicit = getUserById(db, session.userId)?.hideExplicit === true;

    const albums = getRandomAlbumsByGenre(db, id, limit, hideExplicit);
    reply.send({ albums });
  });
}
