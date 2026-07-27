import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { syncMissingArtistMetadata } from '../../../src/features/artists/metadata.js';

const originalFetch = global.fetch;

describe('syncMissingArtistMetadata', () => {
  let root: string;
  let db: Database.Database;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-artist-metadata-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
    db.prepare("INSERT INTO artists (id, name, active) VALUES (?, ?, ?)").run('artist-1', 'Radiohead', 1);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('fetches MusicBrainz metadata and stores bio and external urls', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/artist/?query=')) {
        return new Response(
          JSON.stringify({ artists: [{ id: 'mbid-1', name: 'Radiohead' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/ws/2/artist/mbid-1')) {
        return new Response(
          JSON.stringify({
            id: 'mbid-1',
            name: 'Radiohead',
            disambiguation: 'English rock band',
            relations: [
              { type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Radiohead' } },
              { type: 'official homepage', url: { resource: 'https://www.radiohead.com' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const stats = await syncMissingArtistMetadata(db);
    expect(stats.scanned).toBe(1);
    expect(stats.updated).toBe(1);
    expect(stats.failed).toBe(0);

    const row = db.prepare('SELECT bio, external_urls, musicbrainz_artist_ids FROM artists WHERE id = ?').get('artist-1') as {
      bio: string;
      external_urls: string;
      musicbrainz_artist_ids: string;
    };
    expect(row.bio).toBe('English rock band');
    const urls = JSON.parse(row.external_urls) as Record<string, string>;
    expect(urls.wikipedia).toBe('https://en.wikipedia.org/wiki/Radiohead');
    expect(urls.official_homepage).toBe('https://www.radiohead.com');
    expect(JSON.parse(row.musicbrainz_artist_ids)).toContain('mbid-1');
  });

  it('uses existing musicbrainz id when present', async () => {
    db.prepare('UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = ?').run(JSON.stringify(['mbid-2']), 'artist-1');

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/artist/mbid-2')) {
        return new Response(
          JSON.stringify({
            id: 'mbid-2',
            name: 'Radiohead',
            annotation: 'Annotation bio',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const stats = await syncMissingArtistMetadata(db);
    expect(stats.scanned).toBe(1);
    expect(stats.updated).toBe(1);

    const row = db.prepare('SELECT bio, musicbrainz_artist_ids FROM artists WHERE id = ?').get('artist-1') as {
      bio: string;
      musicbrainz_artist_ids: string;
    };
    expect(row.bio).toBe('Annotation bio');
    expect(JSON.parse(row.musicbrainz_artist_ids)).toEqual(['mbid-2']);
  });

  it('skips artists that already have external urls by default', async () => {
    db.prepare("UPDATE artists SET external_urls = ? WHERE id = ?").run('{}', 'artist-1');

    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

    const stats = await syncMissingArtistMetadata(db);
    expect(stats.scanned).toBe(0);
    expect(stats.updated).toBe(0);
  });

  it('refetches existing metadata when requested', async () => {
    db.prepare("UPDATE artists SET external_urls = ? WHERE id = ?").run('{}', 'artist-1');

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/artist/?query=')) {
        return new Response(
          JSON.stringify({ artists: [{ id: 'mbid-3', name: 'Radiohead' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/ws/2/artist/mbid-3')) {
        return new Response(
          JSON.stringify({ id: 'mbid-3', name: 'Radiohead', relations: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const stats = await syncMissingArtistMetadata(db, { refetchExisting: true });
    expect(stats.scanned).toBe(1);
    expect(stats.updated).toBe(1);
  });
});
