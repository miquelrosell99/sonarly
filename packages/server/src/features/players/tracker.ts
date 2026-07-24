import type { FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';
import type { Song, PlayerInfo } from '@sonarly/shared';

const PLAYER_TTL_MS = 5 * 60 * 1000;

const activePlayers = new Map<string, PlayerInfo>();

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(player: PlayerInfo): boolean {
  return Date.now() - new Date(player.updatedAt).getTime() > PLAYER_TTL_MS;
}

function resolveNames(db: Database.Database, song: Song): { artistName?: string; albumName?: string } {
  const artist = song.artistId
    ? (db.prepare('SELECT name FROM artists WHERE id = ?').pluck().get(song.artistId) as string | undefined)
    : undefined;
  const album = song.albumId
    ? (db.prepare('SELECT name FROM albums WHERE id = ?').pluck().get(song.albumId) as string | undefined)
    : undefined;
  return {
    artistName: artist ?? undefined,
    albumName: album ?? undefined,
  };
}

function getClientId(request: FastifyRequest): string {
  const query = (request.query as Record<string, string | string[] | undefined> | undefined) ?? {};
  const c = query.c;
  if (typeof c === 'string' && c) return c;
  const ua = request.headers['user-agent'];
  if (typeof ua === 'string') {
    const product = ua.split(' ')[0];
    if (product) return product;
  }
  return request.id;
}

export function recordStream(db: Database.Database, request: FastifyRequest, song: Song): void {
  const userId = (request as any).subsonicUser ?? (request as any).session?.userId;
  const key = typeof userId === 'string' ? userId : request.id;
  const names = resolveNames(db, song);
  const existing = activePlayers.get(key);
  const startedAt = existing?.startedAt ?? nowIso();

  activePlayers.set(key, {
    id: key,
    userId: typeof userId === 'string' ? userId : undefined,
    clientId: getClientId(request),
    songId: song.id,
    songTitle: song.title,
    artistName: names.artistName,
    albumName: names.albumName,
    durationSeconds: song.duration,
    startedAt,
    updatedAt: nowIso(),
  });
}

export function getActivePlayers(): PlayerInfo[] {
  const result: PlayerInfo[] = [];
  for (const [key, player] of activePlayers.entries()) {
    if (isExpired(player)) {
      activePlayers.delete(key);
      continue;
    }
    result.push(player);
  }
  return result;
}

export function clearActivePlayers(): void {
  activePlayers.clear();
}
