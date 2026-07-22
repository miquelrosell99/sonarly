import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../../config.js';
import { registerOpenSubsonicAuth } from '../auth.js';
import { sendSubsonicReply } from '../responses.js';
import { registerBrowsingRoutes } from './browsing.js';
import { registerRetrievalRoutes } from './retrieval.js';
import { registerPlaylistRoutes } from '../../playlists/index.js';
import { registerStarringRoutes } from './starring.js';

export async function registerOpenSubsonicRoutes(app: FastifyInstance, config: Config, db: Database.Database): Promise<void> {
  registerOpenSubsonicAuth(app, db, config.SESSION_SECRET);
  registerBrowsingRoutes(app, config, db);
  registerRetrievalRoutes(app, db);
  registerPlaylistRoutes(app, db);
  registerStarringRoutes(app, db);

  app.get('/rest/ping.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/getLicense.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    sendSubsonicReply(reply, format, { license: { valid: true } });
  });
}
