import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { FavoriteEntityType, FavoriteInput, RatingInput } from '@sonarly/shared';
import { setFavorite, setRating } from './repository.js';

const ENTITY_TYPES: FavoriteEntityType[] = ['song', 'album', 'artist', 'playlist'];

function isFavoriteEntityType(value: unknown): value is FavoriteEntityType {
  return typeof value === 'string' && ENTITY_TYPES.includes(value as FavoriteEntityType);
}

function validateFavoriteInput(body: unknown): FavoriteInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Body must be an object');
  }
  const input = body as Record<string, unknown>;
  if (!isFavoriteEntityType(input.entityType)) {
    throw new Error(`Invalid entityType: ${input.entityType}`);
  }
  if (typeof input.entityId !== 'string' || input.entityId.length === 0) {
    throw new Error('entityId is required');
  }
  if (typeof input.starred !== 'boolean') {
    throw new Error('starred must be a boolean');
  }
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    starred: input.starred,
  };
}

function validateRatingInput(body: unknown): RatingInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Body must be an object');
  }
  const input = body as Record<string, unknown>;
  if (!isFavoriteEntityType(input.entityType)) {
    throw new Error(`Invalid entityType: ${input.entityType}`);
  }
  if (typeof input.entityId !== 'string' || input.entityId.length === 0) {
    throw new Error('entityId is required');
  }
  if ('rating' in input && input.rating !== undefined && input.rating !== null) {
    if (typeof input.rating !== 'number' || input.rating < 0 || input.rating > 5 || input.rating * 2 !== Math.round(input.rating * 2)) {
      throw new Error('rating must be between 0 and 5 in 0.5 increments');
    }
  }
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    rating: input.rating as number | undefined,
  };
}

export function registerFavoritesRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post('/api/favorites', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    let input: FavoriteInput;
    try {
      input = validateFavoriteInput(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid input' });
    }

    setFavorite(db, userId, input.entityType, input.entityId, input.starred);
    reply.send({ ok: true });
  });

  app.post('/api/ratings', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    let input: RatingInput;
    try {
      input = validateRatingInput(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid input' });
    }

    setRating(db, userId, input.entityType, input.entityId, input.rating);
    reply.send({ ok: true });
  });
}
