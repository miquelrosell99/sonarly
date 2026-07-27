import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { setSetting, getOrganizePattern } from './repository.js';

const templates = [
  {
    label: 'Album Artist / (Year) Album / Disc Number Track Number - Title',
    value: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
  },
  { label: 'Artist / Album / Track - Title', value: '{artist}/{album}/{track:00} - {title}' },
  { label: 'Artist / Album / Track - Title (no zero pad)', value: '{artist}/{album}/{track} - {title}' },
  { label: 'Album Artist / Album / Track - Title', value: '{albumArtist}/{album}/{track:00} - {title}' },
  { label: 'Artist / Year - Album / Track - Title', value: '{artist}/{year} - {album}/{track:00} - {title}' },
  { label: 'Artist / Title', value: '{artist}/{title}' },
];

const mediaPatchSchema = z.object({
  organizePattern: z.string().min(1),
});

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function validatePattern(pattern: string): string | undefined {
  if (pattern.startsWith('/')) {
    return 'Pattern must be relative';
  }
  if (pattern.split('/').some((segment) => segment === '..' || segment.includes('\0'))) {
    return 'Pattern contains invalid path segments';
  }
  return undefined;
}

export function registerSettingsManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/settings/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    reply.send({
      organizePattern: getOrganizePattern(db, config),
      templates,
    });
  });

  app.patch('/api/settings/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const parseResult = mediaPatchSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { organizePattern } = parseResult.data;
    const validationError = validatePattern(organizePattern);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    setSetting(db, 'organize_pattern', organizePattern);
    reply.send({ organizePattern });
  });

}
