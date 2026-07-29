import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MusicBrainzSearchResult } from '@sonarly/shared';
import {
  searchMusicBrainzRecordings,
  searchMusicBrainzReleases,
  searchMusicBrainzArtists,
  fetchMusicBrainzRecording,
  fetchMusicBrainzRelease,
  fetchMusicBrainzArtistMatch,
} from './search.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerMusicBrainzRoutes(app: FastifyInstance): void {
  app.get('/api/musicbrainz/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { entityType, title, artist, album, mbid } = request.query as {
      entityType?: string;
      title?: string;
      artist?: string;
      album?: string;
      mbid?: string;
    };

    if (entityType !== 'song' && entityType !== 'album' && entityType !== 'artist') {
      return reply.status(400).send({ error: 'entityType must be song, album, or artist' });
    }

    try {
      if (mbid && mbid.trim().length > 0) {
        const match =
          entityType === 'song'
            ? await fetchMusicBrainzRecording(mbid)
            : entityType === 'album'
              ? await fetchMusicBrainzRelease(mbid)
              : await fetchMusicBrainzArtistMatch(mbid);
        if (match) {
          return reply.send({ matches: [match] } satisfies MusicBrainzSearchResult);
        }
      }

      const matches =
        entityType === 'song'
          ? await searchMusicBrainzRecordings(title ?? '', artist, album)
          : entityType === 'album'
            ? await searchMusicBrainzReleases(title ?? '', artist)
            : await searchMusicBrainzArtists(title ?? '');

      return reply.send({ matches } satisfies MusicBrainzSearchResult);
    } catch (err) {
      request.log.error({ err }, 'MusicBrainz search failed');
      return reply.status(502).send({
        error: err instanceof Error ? err.message : 'MusicBrainz search failed',
      });
    }
  });
}
