import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { sendSubsonicReply } from '../responses.js';
import { getActivePlayers } from '../../players/tracker.js';
import { fetchOpenSubsonicSongsByIds } from './browsing.js';
import { getUserById } from '../../users/index.js';

export function registerNowPlayingRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/getNowPlaying.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const players = getActivePlayers();

    const songIds = players.map((p) => p.songId);
    const songsById = new Map(
      fetchOpenSubsonicSongsByIds(db, userId, songIds).map((s) => [String(s.id), s]),
    );

    const entries = players.map((player) => {
      const username = player.userId ? (getUserById(db, player.userId)?.username ?? '') : '';
      const song = songsById.get(player.songId);
      const minutesAgo = Math.max(0, Math.floor((Date.now() - new Date(player.updatedAt).getTime()) / 60000));
      return {
        username,
        playerId: player.id,
        minutesAgo,
        playerName: player.clientId,
        entry: song,
      };
    });

    sendSubsonicReply(reply, format, { nowPlaying: { entry: entries } });
  });
}
