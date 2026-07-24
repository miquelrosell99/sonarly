import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../../config.js';
import { registerOpenSubsonicAuth } from '../auth.js';
import { sendSubsonicReply } from '../responses.js';
import { registerBrowsingRoutes } from './browsing.js';
import { registerRetrievalRoutes } from './retrieval.js';
import { registerPlaylistRoutes } from '../../playlists/index.js';
import { registerStarringRoutes } from './starring.js';
import { getUserById } from '../../users/index.js';

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

  app.get('/rest/getOpenSubsonicExtensions.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    sendSubsonicReply(reply, format, { openSubsonicExtensions: [] });
  });

  app.get('/rest/getUser.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    if (!userId) {
      return sendSubsonicReply(reply.status(401), format, {
        error: { code: 40, message: 'Wrong username or password' },
      }, 'failed');
    }

    const user = getUserById(db, userId);
    if (!user) {
      return sendSubsonicReply(reply.status(401), format, {
        error: { code: 40, message: 'Wrong username or password' },
      }, 'failed');
    }

    sendSubsonicReply(reply, format, {
      user: {
        username: user.username,
        adminRole: user.isAdmin,
        commentRole: true,
        coverArtRole: true,
        downloadRole: true,
        folder: ['0'],
        jukeboxRole: false,
        playlistRole: true,
        podcastRole: false,
        scrobblingEnabled: true,
        settingsRole: user.isAdmin,
        shareRole: false,
        streamRole: true,
        uploadRole: user.isAdmin,
      },
    });
  });
}
