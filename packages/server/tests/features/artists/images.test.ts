import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { syncMissingArtistImages } from '../../../src/features/artists/images.js';

const originalFetch = global.fetch;

// Minimal JPEG magic bytes followed by dummy payload (sniffed before saving).
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-image')]);

describe('syncMissingArtistImages', () => {
  let root: string;
  let db: Database.Database;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-artist-images-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
    db.prepare("INSERT INTO artists (id, name, active) VALUES (?, ?, ?)").run('artist-1', 'Test Artist', 1);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('downloads and stores an artist image on disk', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('api.deezer.com/search/artist')) {
        return new Response(JSON.stringify({ data: [{ id: 1, name: 'Test Artist', picture_xl: 'https://cdn.deezer.com/artist.jpg' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://cdn.deezer.com/artist.jpg') {
        return new Response(FAKE_JPEG, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const stats = await syncMissingArtistImages(db, root);
    expect(stats.scanned).toBe(1);
    expect(stats.updated).toBe(1);
    expect(stats.failed).toBe(0);

    const row = db.prepare('SELECT artist_image_url, artist_image_local_path FROM artists WHERE id = ?').get('artist-1') as {
      artist_image_url: string;
      artist_image_local_path: string;
    };
    expect(row.artist_image_url).toBe('https://cdn.deezer.com/artist.jpg');
    expect(row.artist_image_local_path).toBe(join(root, 'artist-images', 'artist-1.jpg'));
  });

  it('skips artists that already have a local image by default', async () => {
    db.prepare('UPDATE artists SET artist_image_local_path = ? WHERE id = ?').run('/some/path.jpg', 'artist-1');

    global.fetch = vi.fn(async () => {
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const stats = await syncMissingArtistImages(db, root);
    expect(stats.scanned).toBe(0);
    expect(stats.updated).toBe(0);
  });

  it('refetches existing images when requested', async () => {
    db.prepare('UPDATE artists SET artist_image_local_path = ? WHERE id = ?').run(join(root, 'old.jpg'), 'artist-1');

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('api.deezer.com/search/artist')) {
        return new Response(JSON.stringify({ data: [{ id: 1, name: 'Test Artist', picture_xl: 'https://cdn.deezer.com/artist.jpg' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://cdn.deezer.com/artist.jpg') {
        return new Response(FAKE_JPEG, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const stats = await syncMissingArtistImages(db, root, { refetchExisting: true });
    expect(stats.scanned).toBe(1);
    expect(stats.updated).toBe(1);
  });
});
