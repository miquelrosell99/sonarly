import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectCapabilities,
  DEFAULT_CAPABILITIES,
  capabilitiesOptions,
} from './capabilities.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectCapabilities', () => {
  it('detects a v1-shaped song payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        songs: [{ id: 's1', title: 'Song', filePath: '/music/s1.flac', syncedLyrics: [] }],
      }),
    );
    const caps = await detectCapabilities();
    expect(caps.server).toBe('v1');
    expect(caps.rawUpload).toBe(false);
    expect(caps.hasFilePath).toBe(true);
    expect(caps.syncedLyricsArray).toBe(true);
  });

  it('detects a v2-shaped song payload with string syncedLyrics', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        songs: [{ id: 's1', title: 'Song', genreId: 'g1', syncedLyrics: '[00:01.00] line' }],
      }),
    );
    const caps = await detectCapabilities();
    expect(caps.server).toBe('v2');
    expect(caps.rawUpload).toBe(true);
    expect(caps.hasFilePath).toBe(false);
    expect(caps.syncedLyricsArray).toBe(false);
  });

  it('detects v2 with array syncedLyrics as array-capable', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        songs: [{ id: 's1', genreId: 'g1', syncedLyrics: [{ time: 0, text: 'line' }] }],
      }),
    );
    const caps = await detectCapabilities();
    expect(caps.server).toBe('v2');
    expect(caps.syncedLyricsArray).toBe(true);
  });

  it('probes GET /api/songs?limit=1 with credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { songs: [] }));
    await detectCapabilities();
    expect(fetchMock).toHaveBeenCalledWith('/api/songs?limit=1', {
      credentials: 'include',
    });
  });

  it('falls back to v1 defaults when the probe is not ok (logged out)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    await expect(detectCapabilities()).resolves.toEqual(DEFAULT_CAPABILITIES);
    expect(DEFAULT_CAPABILITIES.server).toBe('v1');
  });

  it('falls back to v1 defaults on an empty library (no sample row)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { songs: [] }));
    await expect(detectCapabilities()).resolves.toEqual(DEFAULT_CAPABILITIES);
  });

  it('falls back to v1 defaults when fetch rejects — never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(detectCapabilities()).resolves.toEqual(DEFAULT_CAPABILITIES);
  });

  it('falls back to v1 defaults on a malformed payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { notSongs: true }));
    await expect(detectCapabilities()).resolves.toEqual(DEFAULT_CAPABILITIES);
  });

  it('exposes a cache-forever query option for the boot load', () => {
    const options = capabilitiesOptions();
    expect(options.queryKey).toEqual(['capabilities']);
    expect(options.staleTime).toBe(Infinity);
    expect(options.gcTime).toBe(Infinity);
    expect(options.retry).toBe(false);
  });
});
