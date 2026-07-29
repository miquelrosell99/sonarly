import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerMusicBrainzRoutes } from '../../../src/features/musicbrainz/routes.js';

const originalFetch = global.fetch;

function buildApp(session: { isAdmin?: boolean } = { isAdmin: true }) {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    (request as any).session = session;
  });
  registerMusicBrainzRoutes(app);
  return app;
}

describe('registerMusicBrainzRoutes', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns recording matches for song search', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          recordings: [
            {
              id: 'rec-1',
              title: 'Song Title',
              'artist-credit': [{ name: 'Artist Name' }],
              releases: [{ id: 'rel-1', title: 'Album Title', date: '2021' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/musicbrainz/search?entityType=song&title=Song&artist=Artist',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { matches: Array<{ title: string }> };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].title).toBe('Song Title');
  });

  it('returns release matches for album search', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          releases: [{ id: 'rel-1', title: 'Album Title', date: '2020', 'artist-credit': [{ name: 'Artist' }] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/musicbrainz/search?entityType=album&title=Album',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { matches: Array<{ title: string }> };
    expect(body.matches[0].title).toBe('Album Title');
  });

  it('returns artist matches', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ artists: [{ id: 'artist-1', name: 'Artist Name' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/musicbrainz/search?entityType=artist&title=Artist',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { matches: Array<{ title: string }> };
    expect(body.matches[0].title).toBe('Artist Name');
  });

  it('rejects non-admin users', async () => {
    const app = buildApp({ isAdmin: false });
    const response = await app.inject({
      method: 'GET',
      url: '/api/musicbrainz/search?entityType=artist&title=Artist',
    });
    expect(response.statusCode).toBe(403);
  });

  it('validates entityType', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/musicbrainz/search?entityType=invalid&title=Artist',
    });
    expect(response.statusCode).toBe(400);
  });
});
