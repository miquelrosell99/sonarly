import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerLrcLibRoutes } from '../../../src/features/lrclib/routes.js';

const originalFetch = global.fetch;

function buildApp(session: { isAdmin?: boolean } = { isAdmin: true }) {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    (request as any).session = session;
  });
  registerLrcLibRoutes(app);
  return app;
}

describe('registerLrcLibRoutes', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns lyric matches for a song search', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            id: 123,
            trackName: 'Song Title',
            artistName: 'Artist Name',
            albumName: 'Album Title',
            duration: 245,
            instrumental: false,
            plainLyrics: 'Line one\nLine two',
            syncedLyrics: '[00:12.34] Line one\n[00:15.67] Line two',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/lrclib/search?title=Song&artist=Artist',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { matches: Array<{ title: string; syncedLyrics?: unknown[] }> };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].title).toBe('Song Title');
    expect(body.matches[0].syncedLyrics).toHaveLength(2);
  });

  it('returns 400 when title is missing', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/lrclib/search?artist=Artist',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects non-admin users', async () => {
    const app = buildApp({ isAdmin: false });
    const response = await app.inject({
      method: 'GET',
      url: '/api/lrclib/search?title=Song',
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns 502 when LRCLIB fails', async () => {
    global.fetch = vi.fn(async () => new Response('Error', { status: 500 })) as unknown as typeof fetch;
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/lrclib/search?title=Song',
    });
    expect(response.statusCode).toBe(502);
  });
});
