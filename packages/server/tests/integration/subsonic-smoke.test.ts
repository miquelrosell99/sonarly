import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'node:worker_threads';
import {
  createTempConfig,
  createTestDatabase,
  seedUser,
  buildSubsonicUrl,
  waitForJob,
  closeAppAndCleanup,
  buildTestApp,
} from './helpers.js';

const fixturePath = fileURLToPath(new URL('../fixtures/sample.mp3', import.meta.url));

describe('Subsonic smoke', () => {
  let root: string;
  let config: ReturnType<typeof createTempConfig>['config'];
  let db: Database.Database;
  let app: FastifyInstance & { worker?: Worker };
  let user: Awaited<ReturnType<typeof seedUser>>;
  let albumId: string;
  let songId: string;

  beforeAll(async () => {
    ({ root, config } = createTempConfig('sonarly-subsonic-smoke'));
    copyFileSync(fixturePath, `${config.LIBRARY_PATH}/sample.mp3`);
    db = createTestDatabase(config);
    user = await seedUser(db, 'admin', 'adminpass');
    app = await buildTestApp(config, db);

    const job = await waitForJob(db, 'scan');
    expect(job.status).toBe('completed');
    expect(job.stats?.added).toBe(1);

    const row = db
      .prepare(
        `SELECT a.id AS albumId, s.id AS songId
         FROM albums a
         JOIN songs s ON s.album_id = a.id
         LIMIT 1`
      )
      .get() as { albumId: string; songId: string } | undefined;
    expect(row).toBeDefined();
    albumId = row!.albumId;
    songId = row!.songId;
  });

  afterAll(async () => {
    await closeAppAndCleanup(app, root);
  });

  it('returns ok from ping.view', async () => {
    const res = await app.inject({ method: 'GET', url: buildSubsonicUrl(user.username, user.passwordHash, '/rest/ping.view?') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].version).toBe('1.16.1');
    expect(body['subsonic-response'].type).toBe('sonarly');
  });

  it('returns the library music folder', async () => {
    const res = await app.inject({ method: 'GET', url: buildSubsonicUrl(user.username, user.passwordHash, '/rest/getMusicFolders.view?') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].musicFolders.musicFolder).toEqual([
      { id: 0, name: 'library' },
    ]);
  });

  it('returns artists grouped by initial', async () => {
    const res = await app.inject({ method: 'GET', url: buildSubsonicUrl(user.username, user.passwordHash, '/rest/getArtists.view?') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const indexes = body['subsonic-response'].artists.index;
    expect(indexes).toBeInstanceOf(Array);
    expect(indexes.length).toBeGreaterThan(0);
    const allArtists = indexes.flatMap((i: { artist: unknown[] }) => i.artist);
    expect(allArtists.some((a: { name: string }) => a.name === 'Sample Artist')).toBe(true);
  });

  it('returns the seeded album with its song', async () => {
    const res = await app.inject({ method: 'GET', url: buildSubsonicUrl(user.username, user.passwordHash, `/rest/getAlbum.view?id=${albumId}`) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].album.id).toBe(albumId);
    expect(body['subsonic-response'].album.name).toBe('Sample Album');
    expect(body['subsonic-response'].album.artist).toBe('Sample Artist');
    expect(body['subsonic-response'].album.song).toBeInstanceOf(Array);
    expect(body['subsonic-response'].album.song.length).toBe(1);
    const song = body['subsonic-response'].album.song[0];
    expect(song.id).toBe(songId);
    expect(song.title).toBe('Sample Song');
    expect(song.album).toBe('Sample Album');
    expect(song.artist).toBe('Sample Artist');
    expect(song.type).toBe('music');
  });

  it('streams the song with Accept-Ranges', async () => {
    const res = await app.inject({ method: 'GET', url: buildSubsonicUrl(user.username, user.passwordHash, `/rest/stream.view?id=${songId}`) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });
});
