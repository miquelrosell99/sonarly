import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  searchMusicBrainzRecordings,
  searchMusicBrainzReleases,
  searchMusicBrainzArtists,
  fetchMusicBrainzRecording,
  fetchMusicBrainzRelease,
  fetchMusicBrainzArtistMatch,
} from '../../../src/features/musicbrainz/search.js';

const originalFetch = global.fetch;

describe('musicbrainz search', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('searches recordings and maps fields', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/recording/')) {
        return new Response(
          JSON.stringify({
            recordings: [
              {
                id: 'rec-1',
                title: 'Song Title',
                disambiguation: 'live',
                'artist-credit': [{ name: 'Artist Name' }],
                releases: [
                  {
                    id: 'rel-1',
                    title: 'Album Title',
                    date: '2021-06-15',
                    'artist-credit': [{ name: 'Album Artist' }],
                    'release-group': { id: 'rg-1', 'primary-type': 'Album' },
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const matches = await searchMusicBrainzRecordings('Song Title', 'Artist Name');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: 'rec-1',
      title: 'Song Title',
      artist: 'Artist Name',
      album: 'Album Title',
      albumArtist: 'Album Artist',
      year: 2021,
      disambiguation: 'live',
    });
    expect(matches[0].coverArt).toContain('coverartarchive.org/release/rel-1/front');
  });

  it('searches releases and maps fields', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/release/')) {
        return new Response(
          JSON.stringify({
            releases: [
              {
                id: 'rel-2',
                title: 'Release Title',
                date: '2019',
                'artist-credit': [{ name: 'Release Artist' }],
                'release-group': { id: 'rg-2' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const matches = await searchMusicBrainzReleases('Release Title');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: 'rel-2',
      title: 'Release Title',
      albumArtist: 'Release Artist',
      year: 2019,
    });
  });

  it('searches artists and maps fields', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/artist/')) {
        return new Response(
          JSON.stringify({
            artists: [{ id: 'artist-1', name: 'Artist Name', disambiguation: 'rock band' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const matches = await searchMusicBrainzArtists('Artist Name');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: 'artist-1',
      title: 'Artist Name',
      disambiguation: 'rock band',
    });
  });

  it('fetches recording by mbid', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/recording/rec-1')) {
        return new Response(
          JSON.stringify({
            id: 'rec-1',
            title: 'Song Title',
            'artist-credit': [{ name: 'Artist Name' }],
            releases: [{ id: 'rel-1', title: 'Album Title', date: '2020' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const match = await fetchMusicBrainzRecording('rec-1');
    expect(match).toMatchObject({
      id: 'rec-1',
      title: 'Song Title',
      album: 'Album Title',
      year: 2020,
    });
  });

  it('returns undefined for missing mbid', async () => {
    global.fetch = vi.fn(async () => new Response('Not found', { status: 404 })) as unknown as typeof fetch;

    expect(await fetchMusicBrainzRecording('missing')).toBeUndefined();
    expect(await fetchMusicBrainzRelease('missing')).toBeUndefined();
    expect(await fetchMusicBrainzArtistMatch('missing')).toBeUndefined();
  });

  it('joins multiple artist credits with a semicolon', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/recording/')) {
        return new Response(
          JSON.stringify({
            recordings: [
              {
                id: 'rec-2',
                title: 'Collab',
                'artist-credit': [{ name: 'Artist A' }, { name: 'Artist B' }],
                releases: [{ id: 'rel-2', title: 'Album', date: '2020' }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const matches = await searchMusicBrainzRecordings('Collab');
    expect(matches[0].artist).toBe('Artist A; Artist B');
  });

  it('uses only the first local artist when building the recording query', async () => {
    let capturedUrl: string | undefined;
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/recording/')) {
        capturedUrl = url;
        return new Response(JSON.stringify({ recordings: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    await searchMusicBrainzRecordings('Song Title', 'Artist A; Artist B', 'Album Title');
    expect(capturedUrl).toContain('artist%3A%22Artist%20A%22');
    expect(capturedUrl).not.toContain('Artist%20B');
  });

  it('uses only the first local artist when building the release query', async () => {
    let capturedUrl: string | undefined;
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/ws/2/release/')) {
        capturedUrl = url;
        return new Response(JSON.stringify({ releases: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    await searchMusicBrainzReleases('Album Title', 'Artist A & Artist B');
    expect(capturedUrl).toContain('artist%3A%22Artist%20A%22');
    expect(capturedUrl).not.toContain('Artist%20B');
  });
});
