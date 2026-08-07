import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { sendSubsonicReply } from '../opensubsonic/responses.js';
import { fetchOpenSubsonicSongsByIds } from '../opensubsonic/routes/browsing.js';
import { getUserById } from '../users/index.js';
import { getBookmarks, createBookmark, deleteBookmark } from './repository.js';

export function registerBookmarkRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/getBookmarks.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    if (!userId) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing authentication' },
      }, 'failed');
    }

    const user = getUserById(db, userId);
    const bookmarks = getBookmarks(db, userId);
    const songs = fetchOpenSubsonicSongsByIds(
      db,
      userId,
      bookmarks.map((b) => b.songId),
    );
    const songMap = new Map(songs.map((s) => [s.id as string, s]));

    sendSubsonicReply(reply, format, {
      bookmarks: {
        bookmark: bookmarks.map((bookmark) => ({
          position: bookmark.position,
          username: user?.username ?? userId,
          comment: bookmark.comment ?? '',
          created: bookmark.createdAt,
          changed: bookmark.updatedAt,
          entry: songMap.get(bookmark.songId),
        })),
      },
    });
  });

  app.get('/rest/createBookmark.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    if (!userId) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing authentication' },
      }, 'failed');
    }

    const { id, position, comment } = request.query as {
      id?: string;
      position?: string;
      comment?: string;
    };

    if (!id || id === '') {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing id parameter' },
      }, 'failed');
    }

    const positionValue = parsePosition(position);
    if (positionValue === undefined) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing or invalid position parameter' },
      }, 'failed');
    }

    const song = db.prepare('SELECT id FROM songs WHERE id = ? AND active = 1').get(id) as { id: string } | undefined;
    if (!song) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }

    createBookmark(db, userId, id, positionValue, comment);
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/deleteBookmark.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    if (!userId) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing authentication' },
      }, 'failed');
    }

    const { id } = request.query as { id?: string };
    if (!id || id === '') {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing id parameter' },
      }, 'failed');
    }

    deleteBookmark(db, userId, id);
    sendSubsonicReply(reply, format, {});
  });
}

function parsePosition(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || !Number.isInteger(num)) return undefined;
  return num;
}
