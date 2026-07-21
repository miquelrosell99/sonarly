import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { registerOpenSubsonicAuth } from '../auth.js';
import { sendSubsonicReply } from '../responses.js';
import { registerBrowsingRoutes } from './browsing.js';

export async function registerOpenSubsonicRoutes(app: FastifyInstance, config: Config, db: Database.Database): Promise<void> {
  registerOpenSubsonicAuth(app, db);
  registerBrowsingRoutes(app, config, db);

  app.get('/rest/ping.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/getLicense.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    sendSubsonicReply(reply, format, { license: { valid: true } });
  });
}
